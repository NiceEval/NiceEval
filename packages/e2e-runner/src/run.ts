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
// compiles packages/testkit once into an invocation-local immutable snapshot
// and injects that snapshot only into isolated copies. Testkit is private
// harness code, not a durable or replayable tarball. Repos that do not declare
// it must not import it.
//
// This script must never hardcode SDK names, ports, or expected eval/verdict
// counts, and must never parse a repo's .niceeval/ for pass/fail.

import { join, resolve } from "node:path";
import { mkdtempSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { parseArgs } from "node:util";

import { discoverAllRepos, e2eRootDir, repoRootDir } from "./discovery.ts";
import { readCandidateTarball } from "./injection.ts";
import { buildTestkitPackage, verifyTestkitSnapshot } from "./testkit-snapshot.ts";
import { selectRepos } from "./plan.ts";
import { LANES, type Lane } from "./manifest.ts";
import { appendNativeArgs, materializeCandidateArtifact, runRepo, type RepoRunResult } from "./run-repo.ts";
import type { Category } from "./receipt.ts";
import type { SelectionReceipt } from "./receipt.ts";
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
  candidatePath: string;
  artifactRoot: string | undefined;
  nativeArgs: string[];
  keepWorkdir: boolean;
  repoConcurrency: number;
  planPath?: string;
  cellId?: string;
  selection?: SelectionReceipt;
}

interface RunPlanCell {
  repoIds: readonly string[];
  selection: SelectionReceipt;
}

function readRunPlanCell(planPath: string, cellId: string): RunPlanCell {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(planPath, "utf8"));
  } catch (error) {
    throw new Error(`could not parse E2E plan ${planPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("E2E plan must be the JSON document emitted by `pnpm e2e plan --batch --json`");
  }
  const document = raw as {
    schemaVersion?: unknown;
    mode?: unknown;
    reason?: unknown;
    lane?: unknown;
    range?: unknown;
    cells?: unknown;
  };
  if (
    document.schemaVersion !== 1 ||
    !(["affected", "full", "fail-open-full"] as unknown[]).includes(document.mode) ||
    typeof document.reason !== "string" ||
    document.reason.length === 0 ||
    !(LANES as readonly unknown[]).includes(document.lane) ||
    !Array.isArray(document.cells)
  ) {
    throw new Error("E2E plan must have schemaVersion 1, a valid mode/reason/lane, and a cells array");
  }
  const range = document.range;
  if (
    range !== undefined &&
    (
      typeof range !== "object" ||
      range === null ||
      Array.isArray(range) ||
      typeof (range as { base?: unknown }).base !== "string" ||
      typeof (range as { head?: unknown }).head !== "string"
    )
  ) throw new Error("E2E plan range must contain string base/head commits");
  const matches = document.cells.filter((entry): entry is Record<string, unknown> =>
    typeof entry === "object" && entry !== null && !Array.isArray(entry) && entry.id === cellId
  );
  if (matches.length !== 1) {
    throw new Error(`E2E plan must contain exactly one cell ${JSON.stringify(cellId)}, found ${matches.length}`);
  }
  const entry = matches[0]!;
  const repoIds = entry.repoIds;
  if (
    !Array.isArray(repoIds) ||
    repoIds.length === 0 ||
    !repoIds.every((id) => typeof id === "string" && id.length > 0) ||
    new Set(repoIds).size !== repoIds.length
  ) {
    throw new Error(`E2E plan cell ${JSON.stringify(cellId)} must contain unique non-empty string repoIds`);
  }
  return {
    repoIds: repoIds as string[],
    selection: {
      schemaVersion: 1,
      mode: document.mode as SelectionReceipt["mode"],
      reason: document.reason,
      lane: document.lane as Lane,
      cellId,
      ...(range === undefined ? {} : { range: range as { base: string; head: string } }),
    },
  };
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
      "keep-workdir": { type: "boolean", default: false },
      "repo-concurrency": { type: "string" },
      plan: { type: "string" },
      cell: { type: "string" },
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

  let repoIds = Array.isArray(values.repo) ? values.repo.filter((value): value is string => typeof value === "string") : [];
  const planValue = values.plan;
  const cellValue = values.cell;
  if ((planValue === undefined) !== (cellValue === undefined)) {
    throw new Error("--plan and --cell must be supplied together");
  }
  let repoConcurrency = 1;
  let planPath: string | undefined;
  let cellId: string | undefined;
  let selection: SelectionReceipt | undefined;
  if (typeof planValue === "string" && typeof cellValue === "string") {
    if (
      repoIds.length > 0 ||
      values.lane !== undefined ||
      values.capability !== undefined ||
      values["repo-concurrency"] !== undefined
    ) {
      throw new Error("--plan/--cell cannot be combined with selection options or --repo-concurrency");
    }
    if (planValue.length === 0 || cellValue.length === 0) throw new Error("--plan and --cell require non-empty values");
    planPath = resolve(planValue);
    cellId = cellValue;
    const planned = readRunPlanCell(planPath, cellId);
    repoIds = [...planned.repoIds];
    repoConcurrency = planned.repoIds.length;
    selection = planned.selection;
  } else {
    const concurrencyValue = values["repo-concurrency"] ?? "1";
    if (!/^\d+$/.test(concurrencyValue)) {
      throw new Error(`--repo-concurrency must be a positive integer, got ${JSON.stringify(concurrencyValue)}`);
    }
    repoConcurrency = Number(concurrencyValue);
    if (!Number.isSafeInteger(repoConcurrency) || repoConcurrency < 1) {
      throw new Error(`--repo-concurrency must be a positive integer, got ${JSON.stringify(concurrencyValue)}`);
    }
  }
  return {
    repoIds,
    ...(typeof laneValue === "string" ? { lane: laneValue as Lane } : {}),
    ...(typeof values.capability === "string" ? { capability: values.capability } : {}),
    candidatePath: values.candidate,
    artifactRoot: typeof values["artifact-root"] === "string"
      ? resolve(values["artifact-root"])
      : undefined,
    nativeArgs,
    keepWorkdir: values["keep-workdir"] === true,
    repoConcurrency,
    ...(planPath === undefined ? {} : { planPath }),
    ...(cellId === undefined ? {} : { cellId }),
    ...(selection === undefined ? {} : { selection }),
  };
}

async function runRepoPool<T>(
  items: readonly T[],
  concurrency: number,
  execution: E2EExecutionControl,
  run: (item: T, index: number) => Promise<RepoRunResult>,
): Promise<RepoRunResult[]> {
  const ordered: Array<RepoRunResult | undefined> = Array.from({ length: items.length });
  const unexpectedFailures: Array<{ index: number; error: unknown }> = [];
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    while (!isExecutionCancelled(execution)) {
      const index = nextIndex;
      if (index >= items.length) return;
      nextIndex += 1;
      const item = items[index];
      if (item === undefined) return;
      try {
        ordered[index] = await run(item, index);
      } catch (error) {
        unexpectedFailures.push({ index, error });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  if (unexpectedFailures.length > 0) {
    throw new AggregateError(
      unexpectedFailures.map(({ error }) => error),
      `${unexpectedFailures.length} repo worker(s) failed unexpectedly after all started repos settled`,
    );
  }
  return ordered.filter((result): result is RepoRunResult => result !== undefined);
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
  /** Present when this process executed one machine-readable plan cell. */
  selection?: SelectionReceipt;
}

export interface RunnerTerminalSummary {
  category: "pass" | "infra" | "cancelled";
  detail: string;
  scratchDisposition: ScratchDisposition;
}

export type ScratchDisposition =
  | { kind: "not-created"; ok: true; detail: string }
  | { kind: "removed"; ok: true; path: string; detail: string }
  | { kind: "retained"; ok: true; path: string; detail: string }
  | { kind: "remove-failed"; ok: false; path: string; detail: string };

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
    scratchDisposition: { kind: "not-created", ok: true, detail: "scratch root not created" },
  },
  selection?: SelectionReceipt,
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
    ...(selection === undefined ? {} : { selection }),
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
  console.log(`runner scratch: ${summary.runner.scratchDisposition.kind}; ${summary.runner.scratchDisposition.detail}`);
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
  // Scratch working copies are deleted unless local --keep-workdir retains them.
  let scratchRoot: string | undefined;
  // Durable artifacts + receipts — never deleted by this runner.
  let artifactRoot: string | undefined;
  const results: RepoRunResult[] = [];
  let runnerFailure: string | undefined;
  let cancelled = false;
  let keepWorkdir = false;
  let selection: SelectionReceipt | undefined;
  let scratchDisposition: ScratchDisposition = {
    kind: "not-created",
    ok: true,
    detail: "no scratch root was created",
  };

  try {
    const cli = parseRunCli(argv);
    keepWorkdir = cli.keepWorkdir;
    selection = cli.selection;
    if (keepWorkdir && process.env.CI !== undefined) {
      throw new Error("--keep-workdir is local-only and is rejected whenever CI is set");
    }
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
    candidate.path = await materializeCandidateArtifact(artifactRoot, candidate);

    const { repos, errors } = discoverAllRepos(e2eRootDir());
    if (errors.length > 0) {
      throw new Error(`repo discovery found ${errors.length} problem(s): ${errors.join("; ")}`);
    }

    const selected = selectRepos(repos, cli);
    if (selected.length === 0) {
      console.log("[e2e] no repos matched the selection — nothing to run.");
    } else {
      const testkit = selected.some((repo) => repo.manifest.harness?.testkit === true)
        ? await buildTestkitPackage(repoRootDir(), scratchRoot, {}, execution)
        : undefined;
      if (testkit !== undefined) {
        console.log(`[e2e] Testkit snapshot: ${testkit.path} (@niceeval/testkit@${testkit.version})`);
      }

      const allSecretNames = new Set<string>();
      for (const r of repos) for (const s of r.manifest.secrets) allSecretNames.add(s);
      const activeScratchRoot = scratchRoot;
      const activeArtifactRoot = artifactRoot;

      if (cli.cellId !== undefined) {
        console.log(`[e2e] plan cell: ${cli.cellId} (${cli.planPath})`);
      }
      console.log(`[e2e] repo concurrency: ${Math.min(cli.repoConcurrency, selected.length)}`);
      results.push(...await runRepoPool(selected, cli.repoConcurrency, execution, async (repo) => {
        console.log(`\n[e2e] === ${repo.manifest.id} ===`);
        const result = await runRepo(
          repo,
          candidate,
          activeScratchRoot,
          activeArtifactRoot,
          allSecretNames,
          cli.nativeArgs,
          testkit,
          {
            execution,
            keepWorkdir: cli.keepWorkdir,
            logPrefix: `e2e:${repo.manifest.id}`,
            ...(cli.selection === undefined ? {} : { selection: cli.selection }),
          },
        );
        console.log(`[e2e] ${repo.manifest.id}: artifactDir=${result.artifactDir}`);
        console.log(`[e2e] ${repo.manifest.id}: receiptPath=${result.receiptPath}`);
        return result;
      }));
      if (testkit !== undefined) {
        await verifyTestkitSnapshot(testkit);
        console.log(`[e2e] Testkit snapshot sha256:${testkit.digest} unchanged after all repos settled`);
      }
    }
  } catch (err) {
    runnerFailure = err instanceof Error ? err.message : String(err);
    cancelled = isExecutionCancelled(execution);
    console.error(`[e2e] ${cancelled ? "run cancelled" : "runner failure"}: ${runnerFailure}`);
  } finally {
    // Only the ephemeral scratch tree is removed. artifactRoot is retained.
    if (scratchRoot !== undefined) {
      if (keepWorkdir) {
        scratchDisposition = {
          kind: "retained",
          ok: true,
          path: scratchRoot,
          detail: `retained ${scratchRoot} because --keep-workdir was requested`,
        };
      } else {
        scratchDisposition = { kind: "removed", ok: true, path: scratchRoot, detail: `removed ${scratchRoot}` };
        try {
          const removeScratch = dependencies.removeScratch ?? ((path: string) => rm(path, { recursive: true, force: true }));
          await removeScratch(scratchRoot);
        } catch (error) {
          scratchDisposition = {
            kind: "remove-failed",
            ok: false,
            path: scratchRoot,
            detail: `scratch cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
          };
          console.error(`[e2e] ${scratchDisposition.detail}`);
        }
      }
    }

    cancelled ||= isExecutionCancelled(execution);
    const runner: RunnerTerminalSummary = {
      category: cancelled ? "cancelled" : runnerFailure !== undefined || !scratchDisposition.ok ? "infra" : "pass",
      detail:
        cancelled
          ? `${runnerFailure ?? "root cancellation requested"}${scratchDisposition.ok ? "" : `; ${scratchDisposition.detail}`}`
          : runnerFailure ?? (scratchDisposition.ok ? "root orchestrator completed" : scratchDisposition.detail),
      scratchDisposition,
    };
    if (artifactRoot !== undefined) {
      const summary = buildSummary(artifactRoot, results, runner, selection);
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
