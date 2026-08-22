#!/usr/bin/env -S npx tsx
// Owner-takeover reliability run.
//
// This is intentionally not five ordinary `run` calls. One candidate, one
// checkout identity, one Testkit build, and one immutable scenario-source
// snapshot feed the required isolated-copy and same-installed-copy observations.

import { createHash } from "node:crypto";
import { lstat, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";

import { discoverAllRepos, e2eRootDir, repoRootDir, type DiscoveredRepo } from "./discovery.ts";
import { readCandidateTarball, type CandidateTarball } from "./injection.ts";
import {
  createUnmanagedExecutionControl,
  E2EExecutionCancelledError,
  hasConfirmedOwnedGroupCleanup,
  hasSuccessfulOwnedProcessResult,
  isExecutionCancelled,
  type E2EExecutionControl,
} from "./owned-process.ts";
import {
  appendNativeArgs,
  copyRepoIsolated,
  E2E_COPY_EXCLUDED_BASENAMES,
  runRepo,
  type RepoRunResult,
} from "./run-repo.ts";
import { buildTestkitPackage, type TestkitPackage } from "./testkit-snapshot.ts";
import type { StageReceipt } from "./receipt.ts";
import { ensureRealDirectory, writeContainedUtf8File } from "./durable-path.ts";

export interface TakeoverCli {
  candidatePath: string;
  repoId: string;
  artifactRoot?: string;
  nativeArgs: readonly string[];
}

function splitNativeArgs(argv: readonly string[]): { optionArgs: readonly string[]; nativeArgs: readonly string[] } {
  const separator = argv.indexOf("--");
  if (separator < 0) {
    throw new Error("takeover requires a target owner after -- (for example: -- --run test/owner.test.ts -t title)");
  }
  return { optionArgs: argv.slice(0, separator), nativeArgs: argv.slice(separator + 1) };
}

export function parseTakeoverCli(argv: readonly string[]): TakeoverCli {
  const { optionArgs, nativeArgs } = splitNativeArgs(argv);
  if (nativeArgs.length === 0) {
    throw new Error("takeover requires non-empty native file/title arguments after --");
  }
  const { values } = parseArgs({
    args: [...optionArgs],
    options: {
      candidate: { type: "string" },
      repo: { type: "string" },
      "artifact-root": { type: "string" },
    },
    allowPositionals: false,
    strict: true,
  });
  if (typeof values.candidate !== "string" || values.candidate.length === 0) {
    throw new Error("takeover requires --candidate <tgz>; pack exactly once before this reliability run");
  }
  if (typeof values.repo !== "string" || values.repo.length === 0) {
    throw new Error("takeover requires exactly one --repo <id>");
  }
  return {
    candidatePath: values.candidate,
    repoId: values.repo,
    ...(typeof values["artifact-root"] === "string" ? { artifactRoot: resolve(values["artifact-root"]) } : {}),
    nativeArgs,
  };
}

interface CheckoutIdentity {
  root: string;
  commit: string;
  /** Includes untracked files, because the source snapshot includes them. */
  dirty: boolean;
  sourceSnapshot?: SourceSnapshotIdentity;
}

interface SourceSnapshotFile {
  /** POSIX-style path relative to the fixed scenario snapshot root. */
  path: string;
  bytes: number;
  sha256: string;
}

interface SourceSnapshotIdentity {
  algorithm: "sha256";
  /** SHA-256 over ordered path, byte-count, and per-file SHA-256 entries. */
  digest: string;
  files: readonly SourceSnapshotFile[];
}

async function gitText(
  root: string,
  args: readonly string[],
  execution: E2EExecutionControl,
): Promise<string> {
  const result = await execution.supervisor.run(["git", ...args], {
    cwd: root,
    env: process.env,
    output: "capture",
    stream: false,
    timeoutMs: 10_000,
    abortSignal: execution.abortSignal,
  });
  if (result.cancelled || isExecutionCancelled(execution)) {
    throw new E2EExecutionCancelledError("takeover checkout identity collection cancelled");
  }
  if (!hasSuccessfulOwnedProcessResult(result)) {
    throw new Error(
      `git ${args.join(" ")} failed (${result.timedOut
        ? "timed out after TERM → grace → KILL"
        : !hasConfirmedOwnedGroupCleanup(result)
          ? result.groupCleanup.detail
          : result.error ?? result.signal ?? `exit ${result.exitCode}`})`,
    );
  }
  return result.stdout.trim();
}

async function fixedCheckoutIdentity(
  root: string,
  execution: E2EExecutionControl,
): Promise<CheckoutIdentity> {
  const [commit, status] = await Promise.all([
    gitText(root, ["rev-parse", "HEAD"], execution),
    // Snapshot copying includes ordinary untracked owner/fixture files, so
    // checkout identity must not claim clean by suppressing them here.
    gitText(root, ["status", "--porcelain=v1", "--untracked-files=all"], execution),
  ]);
  return {
    root,
    commit,
    dirty: status.length > 0,
  };
}

async function assertSnapshotTreeSafe(root: string): Promise<void> {
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error(`scenario snapshot root must be a real directory: ${root}`);
  }
  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (E2E_COPY_EXCLUDED_BASENAMES.has(entry.name)) continue;
      const path = join(dir, entry.name);
      const stat = await lstat(path);
      if (stat.isSymbolicLink()) {
        throw new Error(`scenario snapshot rejects source symlink: ${path}`);
      }
      if (stat.isDirectory()) {
        await walk(path);
      } else if (!stat.isFile()) {
        throw new Error(`scenario snapshot rejects source special file: ${path}`);
      }
    }
  };
  await walk(root);
}

async function fingerprintSourceSnapshot(snapshotDir: string): Promise<SourceSnapshotIdentity> {
  await assertSnapshotTreeSafe(snapshotDir);
  const files: SourceSnapshotFile[] = [];
  const root = resolve(snapshotDir);
  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (E2E_COPY_EXCLUDED_BASENAMES.has(entry.name)) continue;
      const path = join(dir, entry.name);
      const stat = await lstat(path);
      if (stat.isDirectory()) {
        await walk(path);
        continue;
      }
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new Error(`scenario snapshot identity found unsupported entry: ${path}`);
      }
      const bytes = await readFile(path);
      const relativePath = relative(root, path).split(sep).join("/");
      files.push({
        path: relativePath,
        bytes: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
    }
  };
  await walk(root);
  const digest = createHash("sha256");
  for (const file of files) digest.update(`${file.path}\0${file.bytes}\0${file.sha256}\n`);
  return { algorithm: "sha256", digest: digest.digest("hex"), files };
}

export interface TakeoverRunRecord {
  label: string;
  mode: "isolated-copy" | "same-installed-copy" | "repo-default-parallel" | "target-single";
  copyId?: string;
  sourceSnapshotDigest?: string;
  receiptPath: string;
  artifactDir: string;
  category: RepoRunResult["category"];
  detail: string;
  testInvocations: number;
  invocationIds: readonly string[];
  /** Ordered test attempt → unique child namespace mapping, auditable for same-copy runs. */
  testAttemptInvocationIds: readonly { attempt: number; invocationId: string }[];
  cleanupOk: boolean;
}

export interface TakeoverSummary {
  format: "niceeval.e2e.takeover/v2";
  repoId: string;
  candidate: Pick<CandidateTarball, "sha256" | "integrity">;
  checkout: CheckoutIdentity;
  testkit?: Pick<TestkitPackage, "name" | "version" | "sourcePath">;
  targetNativeArgs: readonly string[];
  noRetry: true;
  runs: readonly TakeoverRunRecord[];
  matrixValidation: { ok: boolean; complete: boolean; issues: readonly string[] };
  category: RepoRunResult["category"];
  detail: string;
  sourceSnapshotCleanup: { ok: boolean; detail: string };
}

function categoryFor(results: readonly RepoRunResult[], cancelled: boolean): RepoRunResult["category"] {
  if (cancelled || results.some((result) => result.category === "cancelled")) return "cancelled";
  if (results.some((result) => result.category === "regression")) return "regression";
  if (results.some((result) => result.category === "infra")) return "infra";
  if (results.some((result) => result.category === "configuration")) return "configuration";
  return results.length > 0 ? "pass" : "infra";
}

function toRunRecord(
  label: string,
  mode: TakeoverRunRecord["mode"],
  result: RepoRunResult,
): TakeoverRunRecord {
  const cleanup = result.receipt.stages.findLast((stage) => stage.stage === "cleanup");
  return {
    label,
    mode,
    ...(result.receipt.copyId === undefined ? {} : { copyId: result.receipt.copyId }),
    ...(result.receipt.sourceSnapshotDigest === undefined
      ? {}
      : { sourceSnapshotDigest: result.receipt.sourceSnapshotDigest }),
    receiptPath: result.receiptPath,
    artifactDir: result.artifactDir,
    category: result.category,
    detail: result.detail,
    testInvocations: result.receipt.testInvocations,
    invocationIds: result.receipt.invocationIds,
    testAttemptInvocationIds: result.receipt.stages.flatMap((stage) =>
      stage.stage === "test" && stage.attempt !== undefined && stage.invocationId !== undefined
        ? [{ attempt: stage.attempt, invocationId: stage.invocationId }]
        : [],
    ),
    cleanupOk: cleanup?.ok === true,
  };
}

const REQUIRED_TAKEOVER_RUNS = [
  { label: "takeover/isolated-copy-1", mode: "isolated-copy", copyId: "isolated-copy-1", attempts: 1, target: true },
  { label: "takeover/isolated-copy-2", mode: "isolated-copy", copyId: "isolated-copy-2", attempts: 1, target: true },
  { label: "takeover/isolated-copy-3", mode: "isolated-copy", copyId: "isolated-copy-3", attempts: 1, target: true },
  { label: "takeover/same-copy", mode: "same-installed-copy", copyId: "same-installed-copy", attempts: 2, target: true },
  { label: "takeover/repo-default-parallel", mode: "repo-default-parallel", copyId: "repo-default-parallel", attempts: 1, target: false },
  { label: "takeover/target-single", mode: "target-single", copyId: "target-single", attempts: 1, target: true },
] as const;
type RequiredTakeoverRun = (typeof REQUIRED_TAKEOVER_RUNS)[number];

function sameCommand(left: readonly string[] | undefined, right: readonly string[]): boolean {
  return left !== undefined && left.length === right.length && left.every((value, index) => value === right[index]);
}

function testStages(receiptStages: readonly StageReceipt[]): StageReceipt[] {
  return receiptStages.filter((stage) => stage.stage === "test");
}

function validateTakeoverMatrix(
  results: readonly RepoRunResult[],
  repo: DiscoveredRepo,
  candidate: CandidateTarball,
  targetNativeArgs: readonly string[],
  cancelled: boolean,
  sourceSnapshotCleanup: { ok: boolean },
  checkout: CheckoutIdentity | undefined,
): { ok: boolean; complete: boolean; issues: string[] } {
  const issues: string[] = [];
  const expectedByLabel = new Map<string, RequiredTakeoverRun>(
    REQUIRED_TAKEOVER_RUNS.map((entry) => [entry.label, entry]),
  );
  const seenLabels = new Set<string>();
  const allInvocationIds = new Set<string>();

  for (const result of results) {
    const label = result.receipt.runLabel;
    if (label === undefined || !expectedByLabel.has(label)) {
      issues.push(`unexpected or missing takeover run label ${JSON.stringify(label)}`);
      continue;
    }
    if (seenLabels.has(label)) issues.push(`duplicate takeover run label ${JSON.stringify(label)}`);
    seenLabels.add(label);
    const expected = expectedByLabel.get(label)!;
    if (result.receipt.repoId !== repo.manifest.id) {
      issues.push(`${label}: receipt repo id ${JSON.stringify(result.receipt.repoId)} does not match ${repo.manifest.id}`);
    }
    if (result.receipt.copyId !== expected.copyId) {
      issues.push(`${label}: expected copy id ${expected.copyId}, got ${JSON.stringify(result.receipt.copyId)}`);
    }
    if (checkout?.sourceSnapshot !== undefined && result.receipt.sourceSnapshotDigest !== checkout.sourceSnapshot.digest) {
      issues.push(`${label}: receipt source snapshot digest does not match the fixed snapshot identity`);
    }
    if (
      result.receipt.candidate.sha256 !== candidate.sha256 ||
      result.receipt.candidate.integrity !== candidate.integrity
    ) {
      issues.push(`${label}: receipt candidate identity differs from fixed takeover candidate`);
    }

    const stages = testStages(result.receipt.stages);
    if (!cancelled && (result.receipt.testInvocations !== expected.attempts || stages.length !== expected.attempts)) {
      issues.push(`${label}: expected exactly ${expected.attempts} test attempt(s), got receipt=${result.receipt.testInvocations} stages=${stages.length}`);
    }
    const expectedCommand = appendNativeArgs(repo.manifest.command, expected.target ? targetNativeArgs : []);
    for (let index = 0; index < stages.length; index += 1) {
      const stage = stages[index]!;
      if (!cancelled && stage.attempt !== index + 1) {
        issues.push(`${label}: test stage ${index + 1} has attempt ${JSON.stringify(stage.attempt)}`);
      }
      if (!sameCommand(stage.command, expectedCommand)) {
        issues.push(`${label}: test attempt ${stage.attempt ?? index + 1} command does not match its required native selection`);
      }
      if (typeof stage.invocationId !== "string" || stage.invocationId.length === 0) {
        issues.push(`${label}: test attempt ${stage.attempt ?? index + 1} has no invocation id`);
      } else if (!result.receipt.invocationIds.includes(stage.invocationId)) {
        issues.push(`${label}: test attempt ${stage.attempt ?? index + 1} invocation id is absent from receipt invocationIds`);
      }
    }
    for (const invocationId of result.receipt.invocationIds) {
      if (invocationId.length === 0) {
        issues.push(`${label}: receipt has an empty invocation id`);
      } else if (allInvocationIds.has(invocationId)) {
        issues.push(`${label}: invocation id was reused across takeover commands`);
      } else {
        allInvocationIds.add(invocationId);
      }
    }
    const cleanupStages = result.receipt.stages.filter((stage) => stage.stage === "cleanup");
    if (cleanupStages.length !== 1) {
      issues.push(`${label}: expected exactly one cleanup receipt, got ${cleanupStages.length}`);
    } else if (!cleanupStages[0]!.ok) {
      issues.push(`${label}: cleanup receipt is not successful`);
    }
    for (const stage of result.receipt.stages) {
      const capture = stage.capture;
      if (capture?.processGroupOwned === true && capture.groupCleanup.gone !== true) {
        issues.push(`${label}: ${stage.stage} owned process group did not reach a confirmed terminal state`);
      }
      for (const check of stage.checks ?? []) {
        const checkCapture = check.capture;
        if (checkCapture?.processGroupOwned === true && checkCapture.groupCleanup.gone !== true) {
          issues.push(`${label}: ${stage.stage}/${check.kind} owned process group did not reach a confirmed terminal state`);
        }
      }
    }
  }

  const actualOrder = results.map((result) => result.receipt.runLabel ?? "<missing>");
  const expectedOrder = REQUIRED_TAKEOVER_RUNS.map((entry) => entry.label);
  const complete = expectedOrder.every((label) => seenLabels.has(label)) && results.length === expectedOrder.length;
  if (!cancelled) {
    const missing = expectedOrder.filter((label) => !seenLabels.has(label));
    if (missing.length > 0) issues.push(`required takeover observations missing: ${missing.join(", ")}`);
    if (results.length !== expectedOrder.length || actualOrder.some((label, index) => label !== expectedOrder[index])) {
      issues.push(`takeover observation order/set differs from required matrix: ${actualOrder.join(", ")}`);
    }
    if (!sourceSnapshotCleanup.ok) issues.push("fixed source snapshot scratch cleanup failed");
    if (checkout?.sourceSnapshot === undefined) issues.push("fixed source snapshot identity is missing");
  }
  return { ok: issues.length === 0, complete: !cancelled && complete, issues };
}

function findRepo(repoId: string): DiscoveredRepo {
  const { repos, errors } = discoverAllRepos(e2eRootDir());
  if (errors.length > 0) {
    throw new Error(`repo discovery found ${errors.length} problem(s): ${errors.join("; ")}`);
  }
  const repo = repos.find((candidate) => candidate.manifest.id === repoId);
  if (repo === undefined) {
    throw new Error(`takeover requested unknown repo ${JSON.stringify(repoId)}`);
  }
  return repo;
}

/** Execute the fixed reliability matrix for one owner and return its durable summary. */
export async function runTakeover(
  cli: TakeoverCli,
  execution: E2EExecutionControl = createUnmanagedExecutionControl(),
): Promise<TakeoverSummary> {
  const repo = findRepo(cli.repoId);
  const candidate = readCandidateTarball(cli.candidatePath);
  const root = repoRootDir();
  const declaredArtifactRoot = cli.artifactRoot ?? await mkdtemp(join(tmpdir(), "niceeval-e2e-takeover-artifacts-"));
  const artifactRoot = await ensureRealDirectory(declaredArtifactRoot, "takeover durable artifact root");
  const scratchRoot = await mkdtemp(join(tmpdir(), "niceeval-e2e-takeover-scratch-"));
  const sourceSnapshotDir = join(scratchRoot, "source", repo.manifest.id);
  const results: RepoRunResult[] = [];
  let checkout: CheckoutIdentity | undefined;
  let testkit: TestkitPackage | undefined;
  let setupFailure: string | undefined;
  let sourceSnapshotCleanup = { ok: true, detail: `removed ${scratchRoot}` };

  const allSecretNames = new Set<string>();
  for (const discovered of discoverAllRepos(e2eRootDir()).repos) {
    for (const secret of discovered.manifest.secrets) allSecretNames.add(secret);
  }

  const run = async (
    label: string,
    mode: TakeoverRunRecord["mode"],
    nativeArgs: readonly string[],
    testRuns: number,
    copyId: string,
  ): Promise<void> => {
    if (isExecutionCancelled(execution)) return;
    const result = await runRepo(
      repo,
      candidate,
      scratchRoot,
      artifactRoot,
      allSecretNames,
      nativeArgs,
      testkit,
      {
        execution,
        sourceDir: sourceSnapshotDir,
        runLabel: label,
        workdirKey: `${label}/${repo.manifest.id}`,
        testRuns,
        copyId,
        ...(checkout?.sourceSnapshot === undefined
          ? {}
          : { sourceSnapshotDigest: checkout.sourceSnapshot.digest }),
      },
    );
    results.push(result);
    console.log(`[e2e] takeover ${label}: ${result.category}; receipt=${result.receiptPath}`);
  };

  try {
    const checkoutState = await fixedCheckoutIdentity(root, execution);
    // Validate before the source is copied and again while fingerprinting the
    // fixed copy. A symlink/special file never gains snapshot semantics.
    await assertSnapshotTreeSafe(repo.dir);
    await copyRepoIsolated(repo.dir, sourceSnapshotDir);
    checkout = { ...checkoutState, sourceSnapshot: await fingerprintSourceSnapshot(sourceSnapshotDir) };
    if (repo.manifest.harness?.testkit === true) {
      testkit = await buildTestkitPackage(root, scratchRoot, {}, execution);
    }

    for (let index = 1; index <= 3 && !isExecutionCancelled(execution); index += 1) {
      await run(
        `takeover/isolated-copy-${index}`,
        "isolated-copy",
        cli.nativeArgs,
        1,
        `isolated-copy-${index}`,
      );
    }
    if (!isExecutionCancelled(execution)) {
      // One install, two deliberately distinct test command invocations. Their
      // invocation IDs are recorded by runRepo and must not collide with
      // stageArtifacts' collision:error namespace.
      await run("takeover/same-copy", "same-installed-copy", cli.nativeArgs, 2, "same-installed-copy");
    }
    if (!isExecutionCancelled(execution)) {
      await run("takeover/repo-default-parallel", "repo-default-parallel", [], 1, "repo-default-parallel");
    }
    if (!isExecutionCancelled(execution)) {
      await run("takeover/target-single", "target-single", cli.nativeArgs, 1, "target-single");
    }
  } catch (error) {
    setupFailure = error instanceof Error ? error.message : String(error);
  } finally {
    try {
      await rm(scratchRoot, { recursive: true, force: true });
    } catch (error) {
      sourceSnapshotCleanup = {
        ok: false,
        detail: `failed to remove ${scratchRoot}: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  const baseCategory = categoryFor(results, isExecutionCancelled(execution));
  const matrixValidation = validateTakeoverMatrix(
    results,
    repo,
    candidate,
    cli.nativeArgs,
    isExecutionCancelled(execution),
    sourceSnapshotCleanup,
    checkout,
  );
  const category =
    baseCategory === "cancelled" || baseCategory === "regression" || baseCategory === "configuration"
      ? baseCategory
      : setupFailure !== undefined || !matrixValidation.ok || !sourceSnapshotCleanup.ok
        ? "infra"
        : baseCategory;
  const summary: TakeoverSummary = {
    format: "niceeval.e2e.takeover/v2",
    repoId: repo.manifest.id,
    candidate: { sha256: candidate.sha256, integrity: candidate.integrity },
    checkout: checkout ?? {
      root,
      commit: "unavailable",
      dirty: false,
    },
    ...(testkit === undefined ? {} : { testkit: { name: testkit.name, version: testkit.version, sourcePath: testkit.sourcePath } }),
    targetNativeArgs: cli.nativeArgs,
    noRetry: true,
    runs: results.map((result) => {
      const label = result.receipt.runLabel ?? "takeover/unknown";
      const mode = label.includes("same-copy")
        ? "same-installed-copy"
        : label.includes("repo-default-parallel")
          ? "repo-default-parallel"
          : label.includes("target-single")
            ? "target-single"
            : "isolated-copy";
      return toRunRecord(label, mode, result);
    }),
    matrixValidation,
    category,
    detail:
      setupFailure ??
      (!matrixValidation.ok
        ? `takeover matrix validation failed: ${matrixValidation.issues.join("; ")}`
        : category === "pass"
          ? "all required takeover observations passed"
          : "one or more takeover observations did not pass"),
    sourceSnapshotCleanup,
  };
  const summaryPath = join(artifactRoot, "takeover-summary.json");
  await writeContainedUtf8File(
    artifactRoot,
    summaryPath,
    `${JSON.stringify(summary, null, 2)}\n`,
    "takeover summary",
  );
  console.log(`[e2e] takeover summary: ${summaryPath}`);

  if (setupFailure !== undefined && !isExecutionCancelled(execution)) {
    throw new Error(setupFailure);
  }
  return summary;
}

export async function main(
  argv: readonly string[] = process.argv.slice(2),
  execution: E2EExecutionControl = createUnmanagedExecutionControl(),
): Promise<void> {
  try {
    const summary = await runTakeover(parseTakeoverCli(argv), execution);
    if (summary.category !== "pass") process.exitCode = summary.category === "cancelled" ? 130 : 1;
  } catch (error) {
    console.error(`[e2e] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = isExecutionCancelled(execution) ? 130 : 1;
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  void main();
}
