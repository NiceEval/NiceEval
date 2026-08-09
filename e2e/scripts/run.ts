#!/usr/bin/env -S npx tsx
// Root E2E orchestrator (docs/engineering/testing/e2e/README.md §5).
//
// Consumes an already-built candidate tarball once, then for each selected
// repo: copies it into an ephemeral working directory under scratchRoot/runs/,
// points its niceeval dependency at the candidate, installs, verifies
// injection via lockfile integrity + installed identity, runs its command,
// collects declared artifacts into an independent durable artifactRoot/<repo-id>/
// (never back into the source repo, never under scratchRoot), writes a
// structured receipt there, and always deletes the isolated working copy.
// scratchRoot is removed at process end; artifactRoot is retained and its
// absolute path is logged for workflow upload. A non-zero exit code is a
// regression; this runner does not guess infrastructure from a numeric exit
// code. Non-host executors are rejected as unsupported.
//
// When selected repos declare `harness.testkit: true`, this invocation
// clean-builds packages/testkit once and injects that checkout directory only
// into isolated copies. Testkit is private harness code, not a durable or
// replayable tarball. Repos that do not declare it must not import it.
//
// This script must never hardcode SDK names, ports, or expected eval/verdict
// counts, and must never parse a repo's .niceeval/ for pass/fail.

import { join, resolve } from "node:path";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { parseArgs } from "node:util";

import { discoverAllRepos, e2eRootDir, repoRootDir } from "./discovery.ts";
import { readCandidateTarball } from "./injection.ts";
import { buildTestkitPackage } from "./testkit.ts";
import { selectRepos } from "./plan.ts";
import { LANES, type Lane } from "./manifest.ts";
import { appendNativeArgs, runRepo, type RepoRunResult } from "./run-repo.ts";
import type { Category } from "./receipt.ts";
import {
  createUnmanagedExecutionControl,
  isExecutionCancelled,
  type E2EExecutionControl,
} from "./owned-process.ts";
import { ensureRealDirectory, writeContainedUtf8File } from "./durable-path.ts";

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
  artifactRoot: string | undefined;
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
      "artifact-root": { type: "string" },
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
    artifactRoot: typeof values["artifact-root"] === "string"
      ? resolve(values["artifact-root"])
      : undefined,
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
    category: RepoRunResult["category"];
    detail: string;
    artifactDir: string;
    receiptPath: string;
  }>;
  passed: number;
  regression: number;
  infra: number;
  configuration: number;
  cancelled: number;
  total: number;
  /** Primary terminal category; runner cleanup never turns an earlier regression/cancellation into pass. */
  category: Category;
  detail: string;
  runner: RunnerTerminalSummary;
}

export interface RunnerTerminalSummary {
  category: "pass" | "infra" | "cancelled";
  detail: string;
  scratchCleanup: {
    attempted: boolean;
    ok: boolean;
    path?: string;
    detail: string;
  };
}

/** Narrow injection seam for one-shot fault smoke; production uses fs.rm. */
export interface RunDependencies {
  removeScratch?: (path: string) => Promise<void>;
}

function primaryCategory(results: readonly RepoRunResult[], runner: RunnerTerminalSummary): Category {
  if (runner.category === "cancelled" || results.some((result) => result.category === "cancelled")) return "cancelled";
  if (results.some((result) => result.category === "regression")) return "regression";
  if (results.some((result) => result.category === "infra")) return "infra";
  if (results.some((result) => result.category === "configuration")) return "configuration";
  if (runner.category === "infra") return "infra";
  return "pass";
}

/** Build structured run summary with absolute artifactDir/receiptPath per repo. */
export function buildSummary(
  artifactRoot: string,
  results: readonly RepoRunResult[],
  runner: RunnerTerminalSummary = {
    category: "pass",
    detail: "root orchestrator completed",
    scratchCleanup: { attempted: false, ok: true, detail: "scratch cleanup not yet attempted" },
  },
): RunSummary {
  const summaryPath = join(artifactRoot, "summary.json");
  const category = primaryCategory(results, runner);
  const primaryResult = results.find((result) => result.category === category);
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
    configuration: results.filter((r) => r.category === "configuration").length,
    cancelled: results.filter((r) => r.category === "cancelled").length,
    total: results.length,
    category,
    detail:
      primaryResult?.detail ??
      (category === "pass" ? "clean pass" : runner.detail),
    runner,
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
      `${r.id.padEnd(idWidth)}  exit=${codeStr.padEnd(4)} category=${r.category.padEnd(13)}  ${r.detail}`,
    );
    console.log(`${"".padEnd(idWidth)}  artifactDir=${r.artifactDir}`);
    console.log(`${"".padEnd(idWidth)}  receiptPath=${r.receiptPath}`);
  }
  console.log(
    `\n${summary.passed} passed, ${summary.regression} regression, ${summary.infra} infra, ${summary.configuration} configuration, ${summary.cancelled} cancelled (of ${summary.total} selected)`,
  );
  console.log(`overall=${summary.category}  runner=${summary.runner.category}  ${summary.runner.detail}`);
  console.log(`runner scratch cleanup: ${summary.runner.scratchCleanup.ok ? "ok" : "failed"}; ${summary.runner.scratchCleanup.detail}`);
  console.log(`[e2e] durable artifactRoot retained (not deleted): ${summary.artifactRoot}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function main(
  argv: readonly string[] = process.argv.slice(2),
  execution: E2EExecutionControl = createUnmanagedExecutionControl(),
  dependencies: RunDependencies = {},
): Promise<void> {
  // Ephemeral working copies only — always deleted.
  let scratchRoot: string | undefined;
  // Durable artifacts + receipts — never deleted by this runner.
  let artifactRoot: string | undefined;
  const results: RepoRunResult[] = [];
  let runnerFailure: string | undefined;
  let cancelled = false;
  let scratchCleanup: RunnerTerminalSummary["scratchCleanup"] = {
    attempted: false,
    ok: true,
    detail: "no scratch root was created",
  };

  try {
    const cli = parseRunCli(argv);
    if (isExecutionCancelled(execution)) {
      throw new Error("run cancelled before candidate validation");
    }
    const candidate = readCandidateTarball(cli.candidatePath);
    scratchRoot = mkdtempSync(join(tmpdir(), "niceeval-e2e-scratch-"));
    artifactRoot = cli.artifactRoot ?? mkdtempSync(join(tmpdir(), "niceeval-e2e-artifacts-"));
    artifactRoot = await ensureRealDirectory(artifactRoot, "durable artifact root");
    console.log(`[e2e] scratch root (ephemeral): ${scratchRoot}`);
    console.log(`[e2e] artifact root (durable):  ${artifactRoot}`);
    console.log(`[e2e] candidate tarball: ${candidate.path}`);
    console.log(`[e2e] candidate fingerprint: ${candidate.integrity} (sha256:${candidate.sha256})`);

    const { repos, errors } = discoverAllRepos(e2eRootDir());
    if (errors.length > 0) {
      throw new Error(`repo discovery found ${errors.length} problem(s): ${errors.join("; ")}`);
    }

    const selected = selectRepos(repos, cli);
    if (selected.length === 0) {
      console.log("[e2e] no repos matched the selection — nothing to run.");
    } else {
      const testkit = selected.some((repo) => repo.manifest.harness?.testkit === true)
        ? await buildTestkitPackage(repoRootDir(), {}, execution)
        : undefined;
      if (testkit !== undefined) {
        console.log(`[e2e] workspace testkit: ${testkit.path} (@niceeval/testkit@${testkit.version})`);
      }

      const allSecretNames = new Set<string>();
      for (const r of repos) for (const s of r.manifest.secrets) allSecretNames.add(s);

      for (const repo of selected) {
        if (isExecutionCancelled(execution)) break;
        console.log(`\n[e2e] === ${repo.manifest.id} ===`);
        const result = await runRepo(
          repo,
          candidate,
          scratchRoot,
          artifactRoot,
          allSecretNames,
          cli.nativeArgs,
          testkit,
          { execution },
        );
        console.log(`[e2e] ${repo.manifest.id}: artifactDir=${result.artifactDir}`);
        console.log(`[e2e] ${repo.manifest.id}: receiptPath=${result.receiptPath}`);
        results.push(result);
        if (result.category === "cancelled") break;
      }
    }
  } catch (err) {
    runnerFailure = err instanceof Error ? err.message : String(err);
    cancelled = isExecutionCancelled(execution);
    console.error(`[e2e] ${cancelled ? "run cancelled" : "runner failure"}: ${runnerFailure}`);
  } finally {
    // Only the ephemeral scratch tree is removed. artifactRoot is retained.
    if (scratchRoot !== undefined) {
      scratchCleanup = { attempted: true, ok: true, path: scratchRoot, detail: `removed ${scratchRoot}` };
      try {
        const removeScratch = dependencies.removeScratch ?? ((path: string) => rm(path, { recursive: true, force: true }));
        await removeScratch(scratchRoot);
      } catch (error) {
        scratchCleanup = {
          attempted: true,
          ok: false,
          path: scratchRoot,
          detail: `scratch cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
        };
        console.error(`[e2e] ${scratchCleanup.detail}`);
      }
    }

    cancelled ||= isExecutionCancelled(execution);
    const runner: RunnerTerminalSummary = {
      category: cancelled ? "cancelled" : runnerFailure !== undefined || !scratchCleanup.ok ? "infra" : "pass",
      detail:
        cancelled
          ? `${runnerFailure ?? "root cancellation requested"}${scratchCleanup.ok ? "" : `; ${scratchCleanup.detail}`}`
          : runnerFailure ?? (scratchCleanup.ok ? "root orchestrator completed" : scratchCleanup.detail),
      scratchCleanup,
    };
    if (artifactRoot !== undefined) {
      const summary = buildSummary(artifactRoot, results, runner);
      let summaryPersisted = false;
      try {
        await writeContainedUtf8File(
          artifactRoot,
          summary.summaryPath,
          `${JSON.stringify(summary, null, 2)}\n`,
          "run summary",
        );
        summaryPersisted = true;
        printSummary(summary);
      } catch (error) {
        console.error(`[e2e] could not persist final summary: ${error instanceof Error ? error.message : String(error)}`);
      }
      // A durable root artifact is part of the runner contract. If that final
      // write fails, do not report a green process merely because every child
      // passed. Cancellation remains the primary terminal reason and keeps
      // its conventional exit status.
      process.exitCode = summary.category === "cancelled" ? 130 : summary.category === "pass" && summaryPersisted ? 0 : 1;
    } else {
      process.exitCode = runner.category === "cancelled" ? 130 : runner.category === "pass" ? 0 : 1;
    }
  }
}

if (process.argv[1] !== undefined && new URL(import.meta.url).pathname === process.argv[1]) {
  void main();
}
