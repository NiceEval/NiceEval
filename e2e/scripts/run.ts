#!/usr/bin/env -S npx tsx
// Root E2E orchestrator (docs/engineering/testing/e2e/README.md §5).
//
// Consumes an already-built candidate tarball once, then for each selected
// repo: copies it into an ephemeral working directory under scratchRoot/runs/,
// points its niceeval dependency at the candidate, installs, verifies
// injection via lockfile integrity only, runs its command, collects declared
// artifacts into an independent durable artifactRoot/<repo-id>/ (never back
// into the source repo, never under scratchRoot), writes a structured receipt
// there, and always deletes the isolated working copy. scratchRoot is removed
// at process end; artifactRoot is retained and its absolute path is logged for
// workflow upload. A non-zero exit code is a regression; this runner does not
// guess infrastructure from a numeric exit code. Non-host executors are
// rejected as unsupported.
//
// This script must never hardcode SDK names, ports, or expected eval/verdict
// counts, and must never parse a repo's .niceeval/ for pass/fail.

import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { parseArgs } from "node:util";

import { discoverAllRepos, e2eRootDir } from "./discovery.ts";
import { readCandidateTarball } from "./injection.ts";
import { selectRepos } from "./plan.ts";
import { LANES, type Lane } from "./manifest.ts";
import { appendNativeArgs, runRepo, type RepoRunResult } from "./run-repo.ts";

export { appendNativeArgs } from "./run-repo.ts";
export type { RepoRunResult } from "./run-repo.ts";

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface Cli {
  repoIds: string[];
  lane?: Lane;
  capability?: string;
  diffPaths?: string[];
  candidatePath: string;
  nativeArgs: string[];
}

function splitNativeArgs(argv: readonly string[]): { optionArgs: readonly string[]; nativeArgs: string[] } {
  const separator = argv.indexOf("--");
  if (separator < 0) return { optionArgs: argv, nativeArgs: [] };
  return { optionArgs: argv.slice(0, separator), nativeArgs: [...argv.slice(separator + 1)] };
}

export function parseRunCli(argv: readonly string[]): Cli {
  const { optionArgs, nativeArgs } = splitNativeArgs(argv);
  const { values } = parseArgs({
    args: [...optionArgs],
    options: {
      candidate: { type: "string" },
      repo: { type: "string", multiple: true, default: [] },
      lane: { type: "string" },
      capability: { type: "string" },
      "diff-path": { type: "string", multiple: true },
    },
    allowPositionals: false,
    strict: true,
  });

  if (typeof values.candidate !== "string" || values.candidate.length === 0) {
    throw new Error("run requires --candidate <tgz>");
  }

  const laneValue = values.lane;
  if (laneValue !== undefined && (typeof laneValue !== "string" || !(LANES as readonly string[]).includes(laneValue))) {
    throw new Error(`--lane must be one of ${LANES.join("|")}, got ${JSON.stringify(laneValue)}`);
  }

  const repoIds = Array.isArray(values.repo) ? values.repo.filter((value): value is string => typeof value === "string") : [];
  const diffPaths = Array.isArray(values["diff-path"])
    ? values["diff-path"].filter((value): value is string => typeof value === "string")
    : [];
  return {
    repoIds,
    lane: typeof laneValue === "string" ? (laneValue as Lane) : undefined,
    capability: typeof values.capability === "string" ? values.capability : undefined,
    diffPaths: diffPaths.length > 0 ? diffPaths : undefined,
    candidatePath: values.candidate,
    nativeArgs,
  };
}

// ---------------------------------------------------------------------------
// Summary (structured paths for workflow upload)
// ---------------------------------------------------------------------------

export interface RunSummary {
  artifactRoot: string;
  summaryPath: string;
  results: Array<{
    id: string;
    exitCode: number | null;
    category: string;
    detail: string;
    artifactDir: string;
    receiptPath: string;
  }>;
  passed: number;
  regression: number;
  infra: number;
  total: number;
}

/** Build structured run summary with absolute artifactDir/receiptPath per repo. */
export function buildSummary(artifactRoot: string, results: readonly RepoRunResult[]): RunSummary {
  const summaryPath = join(artifactRoot, "summary.json");
  return {
    artifactRoot,
    summaryPath,
    results: results.map((r) => ({
      id: r.id,
      exitCode: r.exitCode,
      category: r.category,
      detail: r.detail,
      artifactDir: r.artifactDir,
      receiptPath: r.receiptPath,
    })),
    passed: results.filter((r) => r.category === "pass").length,
    regression: results.filter((r) => r.category === "regression").length,
    infra: results.filter((r) => r.category === "infra").length,
    total: results.length,
  };
}

function printSummary(summary: RunSummary): void {
  console.log("\n=== e2e summary ===");
  console.log(`artifactRoot: ${summary.artifactRoot}`);
  console.log(`summaryPath:  ${summary.summaryPath}`);
  const idWidth = Math.max(2, ...summary.results.map((r) => r.id.length));
  for (const r of summary.results) {
    const codeStr = r.exitCode === null ? "-" : String(r.exitCode);
    console.log(
      `${r.id.padEnd(idWidth)}  exit=${codeStr.padEnd(4)} category=${r.category.padEnd(10)}  ${r.detail}`,
    );
    console.log(`${"".padEnd(idWidth)}  artifactDir=${r.artifactDir}`);
    console.log(`${"".padEnd(idWidth)}  receiptPath=${r.receiptPath}`);
  }
  console.log(
    `\n${summary.passed} passed, ${summary.regression} regression, ${summary.infra} infra (of ${summary.total} selected)`,
  );
  console.log(`[e2e] durable artifactRoot retained (not deleted): ${summary.artifactRoot}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  // Ephemeral working copies only — always deleted.
  let scratchRoot: string | undefined;
  // Durable artifacts + receipts — never deleted by this runner.
  let artifactRoot: string | undefined;

  try {
    const cli = parseRunCli(argv);
    const candidate = readCandidateTarball(cli.candidatePath);
    scratchRoot = mkdtempSync(join(tmpdir(), "niceeval-e2e-scratch-"));
    artifactRoot = mkdtempSync(join(tmpdir(), "niceeval-e2e-artifacts-"));
    console.log(`[e2e] scratch root (ephemeral): ${scratchRoot}`);
    console.log(`[e2e] artifact root (durable):  ${artifactRoot}`);
    console.log(`[e2e] candidate tarball: ${candidate.path}`);
    console.log(`[e2e] candidate fingerprint: ${candidate.integrity} (sha256:${candidate.sha256})`);

    const { repos, errors } = discoverAllRepos(e2eRootDir());
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

    const results: RepoRunResult[] = [];
    for (const repo of selected) {
      console.log(`\n[e2e] === ${repo.manifest.id} ===`);
      const result = await runRepo(
        repo,
        candidate,
        scratchRoot,
        artifactRoot,
        allSecretNames,
        cli.nativeArgs,
      );
      console.log(`[e2e] ${repo.manifest.id}: artifactDir=${result.artifactDir}`);
      console.log(`[e2e] ${repo.manifest.id}: receiptPath=${result.receiptPath}`);
      results.push(result);
    }

    const summary = buildSummary(artifactRoot, results);
    await writeFile(summary.summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
    printSummary(summary);

    const anyNotClean = results.some((r) => r.category !== "pass");
    process.exitCode = anyNotClean ? 1 : 0;
  } catch (err) {
    console.error(`[e2e] ${(err as Error).message}`);
    process.exitCode = 1;
  } finally {
    // Only the ephemeral scratch tree is removed. artifactRoot is retained.
    if (scratchRoot !== undefined) {
      await rm(scratchRoot, { recursive: true, force: true }).catch((err: unknown) => {
        console.error(`[e2e] scratch cleanup failed: ${(err as Error).message}`);
      });
    }
  }
}

if (process.argv[1] !== undefined && new URL(import.meta.url).pathname === process.argv[1]) {
  void main();
}
