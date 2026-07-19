#!/usr/bin/env -S npx tsx
// Root E2E orchestrator (docs/engineering/e2e-ci/README.md §5).
//
// Builds the current niceeval checkout into a candidate tarball once, then
// for each selected e2e/repos/* repo: copies it into an isolated temp
// working directory, points its niceeval dependency at the candidate
// tarball, installs there, injects only its own declared secrets, runs its
// single command, and — before trusting the exit code — independently
// verifies the isolated copy actually resolved the candidate tarball (not a
// lockfile-pinned baseline). Exit code 75 (EX_TEMPFAIL) gets one retry in a
// fresh copy; any other non-zero exit code is a regression and is never
// retried or downgraded.
//
// This script must never hardcode SDK names, ports, or expected eval/verdict
// counts, and must never read e2e/repos/*/.niceeval/.

import { spawn } from "node:child_process";
import { basename, join } from "node:path";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { parseArgs } from "node:util";

import { discoverRepos, repoRootDir, reposRootDir, GROUPS, type DiscoveredRepo, type Group } from "./discovery.ts";
import { buildCandidateTarball, verifyInjection, type CandidateTarball } from "./injection.ts";
import { buildChildEnv } from "./secrets.ts";

const EX_TEMPFAIL = 75;

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface Cli {
  repoIds: string[];
  group?: Group;
}

function parseCli(argv: string[]): Cli {
  const { values } = parseArgs({
    args: argv,
    options: {
      repo: { type: "string", multiple: true, default: [] },
      group: { type: "string" },
    },
    allowPositionals: false,
    strict: true,
  });

  const group = values.group as string | undefined;
  if (group !== undefined && !(GROUPS as readonly string[]).includes(group)) {
    throw new Error(`--group must be one of ${GROUPS.join("|")}, got "${group}"`);
  }

  return { repoIds: (values.repo as string[]) ?? [], group: group as Group | undefined };
}

function selectRepos(all: DiscoveredRepo[], cli: Cli): DiscoveredRepo[] {
  if (cli.repoIds.length === 0 && !cli.group) return all;

  if (cli.repoIds.length > 0) {
    const byId = new Map(all.map((r) => [r.manifest.id, r] as const));
    const missing = cli.repoIds.filter((id) => !byId.has(id));
    if (missing.length > 0) {
      const known = all.map((r) => r.manifest.id).join(", ") || "(none discovered)";
      throw new Error(`--repo requested unknown id(s): ${missing.join(", ")}. Known ids: ${known}`);
    }
    let selected = cli.repoIds.map((id) => byId.get(id)!);
    if (cli.group) selected = selected.filter((r) => r.manifest.group === cli.group);
    return selected;
  }

  return all.filter((r) => r.manifest.group === cli.group);
}

// ---------------------------------------------------------------------------
// Process helpers
// ---------------------------------------------------------------------------

function runInherited(cmd: string, args: string[], cwd: string): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => resolvePromise(code ?? 1));
  });
}

interface CommandOutcome {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
}

function runWithTimeout(
  command: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<CommandOutcome> {
  return new Promise((resolvePromise, reject) => {
    const [cmd, ...args] = command;
    const child = spawn(cmd, args, { cwd, env, stdio: "inherit" });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      resolvePromise({ exitCode: code, signal, timedOut });
    });
  });
}

// ---------------------------------------------------------------------------
// Per-repo isolated run
// ---------------------------------------------------------------------------

const EXCLUDED_FROM_COPY = new Set(["node_modules", ".niceeval", ".git"]);

async function copyRepoIsolated(sourceDir: string, destDir: string): Promise<void> {
  await cp(sourceDir, destDir, {
    recursive: true,
    filter: (src) => !EXCLUDED_FROM_COPY.has(basename(src)),
  });
}

/** Mutates only the isolated copy's package.json — never the checked-in repo. */
async function pointAtCandidateTarball(copyDir: string, tarballPath: string): Promise<void> {
  const pkgPath = join(copyDir, "package.json");
  const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as Record<string, unknown>;
  const spec = `file:${tarballPath}`;

  let found = false;
  for (const field of ["dependencies", "devDependencies"]) {
    const deps = pkg[field];
    if (deps && typeof deps === "object" && Object.prototype.hasOwnProperty.call(deps, "niceeval")) {
      (deps as Record<string, string>).niceeval = spec;
      found = true;
    }
  }
  if (!found) {
    throw new Error(
      `${copyDir}/package.json declares no "niceeval" dependency (checked dependencies and devDependencies) — nothing to inject the candidate tarball into`,
    );
  }

  await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`^${escaped.join(".*")}$`);
}

/**
 * Copies e2e.json's declared `artifacts` out of the isolated copy and back into the repo's
 * real directory, regardless of pass/fail/timeout — the isolated copy is deleted afterward
 * (see `runRepoOnce`'s caller), so CI/crabbox can only collect evidence that lands here.
 * Supports the two shapes actually used by e2e.json today: a directory glob ("dir/**",
 * copied recursively) and a single-path-segment filename glob ("junit.xml", "*.xml",
 * "junit-*.xml") matched against copyDir's own top-level entries. Patterns with a "/" that
 * aren't a bare "dir/**" are not supported and are skipped (log a warning) rather than
 * silently matching nothing subtly wrong — this orchestrator doesn't need a full glob
 * implementation for the patterns real repos declare.
 */
async function collectArtifacts(copyDir: string, destDir: string, patterns: readonly string[]): Promise<void> {
  for (const pattern of patterns) {
    if (pattern.endsWith("/**")) {
      const dirName = pattern.slice(0, -3);
      const src = join(copyDir, dirName);
      if (existsSync(src)) {
        await cp(src, join(destDir, dirName), { recursive: true, force: true });
      }
      continue;
    }
    if (pattern.includes("/")) {
      console.warn(`[e2e] artifacts pattern "${pattern}" has an unsupported shape (only "dir/**" or a top-level filename glob are supported) — skipping`);
      continue;
    }
    const regex = globToRegExp(pattern);
    let entries: string[];
    try {
      entries = await readdir(copyDir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (regex.test(name)) {
        await cp(join(copyDir, name), join(destDir, name), { recursive: true, force: true });
      }
    }
  }
}

interface AttemptResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  injectionOk: boolean;
  injectionReason?: string;
}

async function runRepoOnce(
  repo: DiscoveredRepo,
  candidate: CandidateTarball,
  scratchRoot: string,
  allSecretNames: ReadonlySet<string>,
  attemptLabel: string,
): Promise<AttemptResult> {
  const copyDir = join(scratchRoot, "runs", repo.manifest.id, attemptLabel);
  await mkdir(copyDir, { recursive: true });

  await copyRepoIsolated(repo.dir, copyDir);
  await pointAtCandidateTarball(copyDir, candidate.path);

  const installCode = await runInherited(
    "pnpm",
    ["install", "--no-frozen-lockfile", "--config.dangerouslyAllowAllBuilds=true"],
    copyDir,
  );
  if (installCode !== 0) {
    return {
      exitCode: null,
      signal: null,
      timedOut: false,
      injectionOk: false,
      injectionReason: `pnpm install failed (exit ${installCode}) in the isolated copy — see output above`,
    };
  }

  const childEnv = buildChildEnv(process.env, allSecretNames, repo.manifest.secrets);
  const timeoutMs = repo.manifest.timeoutMinutes * 60_000;
  const outcome = await runWithTimeout(repo.manifest.command, copyDir, childEnv, timeoutMs);

  // Regardless of pass/fail/timeout — the isolated copy is deleted once this function
  // returns, so this is the only chance to hand evidence back to the real repo directory
  // for CI/crabbox to collect (README §5 point 6, §6.1).
  await collectArtifacts(copyDir, repo.dir, repo.manifest.artifacts);

  let injectionOk: boolean;
  let injectionReason: string | undefined;
  try {
    const lockText = readFileSync(join(copyDir, "pnpm-lock.yaml"), "utf8");
    const verdict = verifyInjection(lockText, candidate.integrity);
    injectionOk = verdict.ok;
    if (!verdict.ok) injectionReason = verdict.reason;
  } catch (err) {
    injectionOk = false;
    injectionReason = `could not read isolated copy's pnpm-lock.yaml: ${(err as Error).message}`;
  }

  return {
    exitCode: outcome.exitCode,
    signal: outcome.signal,
    timedOut: outcome.timedOut,
    injectionOk,
    injectionReason,
  };
}

type Category = "pass" | "regression" | "infra";

function classify(a: AttemptResult): { category: Category; detail: string } {
  if (a.exitCode === null && !a.timedOut) {
    return { category: "infra", detail: a.injectionReason ?? "command never produced an exit code" };
  }
  if (a.timedOut) {
    return { category: "regression", detail: "exceeded e2e.json timeoutMinutes; process killed" };
  }
  if (!a.injectionOk) {
    return { category: "infra", detail: `injection verification failed: ${a.injectionReason}` };
  }
  if (a.exitCode === 0) {
    return { category: "pass", detail: "clean pass" };
  }
  if (a.exitCode === EX_TEMPFAIL) {
    return { category: "infra", detail: `EX_TEMPFAIL (exit ${EX_TEMPFAIL})` };
  }
  return { category: "regression", detail: `exit ${a.exitCode}` };
}

interface RepoResult {
  id: string;
  group: Group;
  exitCode: number | null;
  category: Category;
  detail: string;
  attempts: number;
}

async function runRepoWithRetry(
  repo: DiscoveredRepo,
  candidate: CandidateTarball,
  scratchRoot: string,
  allSecretNames: ReadonlySet<string>,
): Promise<RepoResult> {
  const first = await runRepoOnce(repo, candidate, scratchRoot, allSecretNames, "attempt-1");

  if (first.exitCode === EX_TEMPFAIL) {
    console.log(
      `[e2e] ${repo.manifest.id}: exit ${EX_TEMPFAIL} (EX_TEMPFAIL) — retrying once with a fresh isolated copy`,
    );
    const second = await runRepoOnce(repo, candidate, scratchRoot, allSecretNames, "attempt-2");
    const c = classify(second);
    return { id: repo.manifest.id, group: repo.manifest.group, exitCode: second.exitCode, category: c.category, detail: c.detail, attempts: 2 };
  }

  const c = classify(first);
  return { id: repo.manifest.id, group: repo.manifest.group, exitCode: first.exitCode, category: c.category, detail: c.detail, attempts: 1 };
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

function printSummary(results: RepoResult[]): void {
  console.log("\n=== e2e summary ===");
  const idWidth = Math.max(2, ...results.map((r) => r.id.length));
  for (const r of results) {
    const codeStr = r.exitCode === null ? "-" : String(r.exitCode);
    console.log(
      `${r.id.padEnd(idWidth)}  exit=${codeStr.padEnd(4)} category=${r.category.padEnd(10)} attempts=${r.attempts}  ${r.detail}`,
    );
  }
  const passed = results.filter((r) => r.category === "pass").length;
  const regression = results.filter((r) => r.category === "regression").length;
  const infra = results.filter((r) => r.category === "infra").length;
  console.log(`\n${passed} passed, ${regression} regression, ${infra} infra (of ${results.length} selected)`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const root = repoRootDir();
  const scratchRoot = mkdtempSync(join(tmpdir(), "niceeval-e2e-"));
  console.log(`[e2e] scratch root: ${scratchRoot}`);

  try {
    // a. Build the candidate tarball once, before anything else — including
    //    before CLI/discovery validation, per the orchestrator's step order.
    console.log(`[e2e] building candidate niceeval tarball from ${root} ...`);
    const candidate = await buildCandidateTarball(root, join(scratchRoot, "tarball"));
    console.log(`[e2e] candidate tarball: ${candidate.path}`);
    console.log(`[e2e] candidate fingerprint: ${candidate.integrity} (sha256:${candidate.shortHash})`);

    // b. Parse CLI args + discover/validate + select.
    const cli = parseCli(process.argv.slice(2));
    const { repos, errors } = discoverRepos(reposRootDir());
    if (errors.length > 0) {
      console.error(`[e2e] repo discovery found ${errors.length} problem(s):\n`);
      for (const e of errors) console.error(`  - ${e}`);
      process.exitCode = 1;
      return;
    }

    const selected = selectRepos(repos, cli);
    if (selected.length === 0) {
      console.log("[e2e] no repos matched the selection — nothing to run.");
      return;
    }

    const allSecretNames = new Set<string>();
    for (const r of repos) for (const s of r.manifest.secrets) allSecretNames.add(s);

    // c-g. Isolated copy, install, inject env, spawn, verify, retry-on-75 — per repo.
    const results: RepoResult[] = [];
    for (const repo of selected) {
      console.log(`\n[e2e] === ${repo.manifest.id} (${repo.manifest.group}) ===`);
      results.push(await runRepoWithRetry(repo, candidate, scratchRoot, allSecretNames));
    }

    // h. Aggregate.
    printSummary(results);
    const anyNotClean = results.some((r) => r.category !== "pass");
    process.exitCode = anyNotClean ? 1 : 0;
  } catch (err) {
    console.error(`[e2e] ${(err as Error).message}`);
    process.exitCode = 1;
  } finally {
    await rm(scratchRoot, { recursive: true, force: true });
  }
}

main();
