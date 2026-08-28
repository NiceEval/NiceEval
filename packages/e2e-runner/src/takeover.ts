// Deterministic owner-takeover reliability matrix. Command parsing, output and
// the sole Node runtime boundary live in cli.ts.

import { createHash } from "node:crypto";
import { lstat as nodeLstat, type Stats } from "node:fs";
import * as FileSystem from "effect/FileSystem";
import { Data, Effect } from "effect";
import { join, relative, resolve, sep } from "node:path";

import { discoverAllRepos, e2eRootDir, repoRootDir, type DiscoveredRepo } from "./discovery.ts";
import { readCandidateTarball, type CandidateTarball } from "./injection.ts";
import { hasConfirmedOwnedGroupCleanup, hasSuccessfulOwnedProcessResult, OwnedProcess, runOwnedProcess } from "./owned-process.ts";
import { appendNativeArgs, copyRepoIsolated, E2E_COPY_EXCLUDED_BASENAMES, materializeCandidateArtifact, runRepoEffect, type RepoRunResult } from "./run-repo.ts";
import { buildTestkitPackage, type TestkitPackage } from "./testkit-snapshot.ts";
import type { StageReceipt } from "./receipt.ts";
import { ensureRealDirectory, writeContainedUtf8File } from "./durable-path.ts";
import {
  parseExactSelector,
  exactCaseNativeArgs,
  selectInventoryCase,
  sha256Hex,
  signFormalCaseReceipt,
  signTakeoverCertificate,
  validateInventoryReceipt,
  validateTakeoverCertificate,
  type FormalCaseReceiptV1,
  type TakeoverCertificateV1,
} from "./case-evidence.ts";

export interface TakeoverOptions {
  readonly candidatePath: string;
  readonly repoId: string;
  readonly artifactRoot?: string;
  readonly nativeArgs: readonly string[];
  readonly selector: string;
  readonly inventoryReceiptPath: string;
}

export class TakeoverOperationError extends Data.TaggedError("TakeoverOperationError")<{
  readonly operation: "candidate" | "discovery" | "checkout" | "snapshot" | "artifact" | "cleanup" | "evidence";
  readonly detail: string;
}> {}

interface SourceSnapshotFile { readonly path: string; readonly bytes: number; readonly sha256: string }
interface SourceSnapshotIdentity { readonly algorithm: "sha256"; readonly digest: string; readonly files: readonly SourceSnapshotFile[] }
interface CheckoutIdentity { readonly root: string; readonly commit: string; readonly dirty: boolean; readonly sourceSnapshot?: SourceSnapshotIdentity }

export interface TakeoverRunRecord {
  readonly label: string;
  readonly mode: "isolated-copy" | "same-installed-copy" | "repo-default-parallel" | "target-single";
  readonly copyId?: string;
  readonly sourceSnapshotDigest?: string;
  readonly receiptPath: string;
  readonly artifactDir: string;
  readonly category: RepoRunResult["category"];
  readonly detail: string;
  readonly testInvocations: number;
  readonly invocationIds: readonly string[];
  readonly testAttemptInvocationIds: readonly { readonly attempt: number; readonly invocationId: string }[];
  readonly cleanupOk: boolean;
}

export interface TakeoverSummary {
  readonly repoId: string;
  readonly candidate: Pick<CandidateTarball, "sha256" | "integrity">;
  readonly checkout: CheckoutIdentity;
  readonly testkit?: Pick<TestkitPackage, "name" | "version" | "sourcePath">;
  readonly targetNativeArgs: readonly string[];
  readonly noRetry: true;
  readonly runs: readonly TakeoverRunRecord[];
  readonly matrixValidation: { readonly ok: boolean; readonly complete: boolean; readonly issues: readonly string[] };
  readonly category: RepoRunResult["category"];
  readonly detail: string;
  readonly sourceSnapshotCleanup: { readonly ok: boolean; readonly detail: string };
  readonly certificate?: TakeoverCertificateV1;
  readonly certificatePath?: string;
}

type TakeoverRequirements = FileSystem.FileSystem | OwnedProcess;

const operationError = (operation: TakeoverOperationError["operation"], cause: unknown): TakeoverOperationError =>
  new TakeoverOperationError({ operation, detail: cause instanceof Error ? cause.message : String(cause) });

/** Node's `stat` follows links; snapshot admission needs the non-following primitive. */
const lstatSnapshotEntry = (path: string): Effect.Effect<Stats, TakeoverOperationError> =>
  Effect.callback((resume) => {
    nodeLstat(path, (cause, stat) => {
      resume(cause === null
        ? Effect.succeed(stat)
        : Effect.fail(operationError("snapshot", cause)));
    });
  });

const gitText = (
  root: string,
  args: readonly string[],
): Effect.Effect<string, TakeoverOperationError, OwnedProcess | import("effect").Scope.Scope> =>
  runOwnedProcess(["git", ...args], {
    cwd: root,
    env: process.env,
    output: "capture",
    stream: false,
    timeoutMs: 10_000,
  }).pipe(
    Effect.flatMap((result) => {
      if (result.cancelled) {
        return Effect.fail(operationError("checkout", "takeover checkout identity collection cancelled"));
      }
      if (!hasSuccessfulOwnedProcessResult(result)) {
        return Effect.fail(operationError(
          "checkout",
          `git ${args.join(" ")} failed (${result.timedOut
            ? "timed out after TERM → grace → KILL"
            : !hasConfirmedOwnedGroupCleanup(result)
              ? result.groupCleanup.detail
              : result.error ?? result.signal ?? `exit ${result.exitCode}`})`,
        ));
      }
      return Effect.succeed(result.stdout.trim());
    }),
    Effect.mapError((cause) => cause instanceof TakeoverOperationError ? cause : operationError("checkout", cause)),
  );

export const assertSnapshotTreeSafe = (root: string): Effect.Effect<void, TakeoverOperationError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const walk = (directory: string): Effect.Effect<void, TakeoverOperationError, FileSystem.FileSystem> => Effect.gen(function* () {
      const entries = yield* fileSystem.readDirectory(directory).pipe(Effect.mapError((cause) => operationError("snapshot", cause)));
      entries.sort((left, right) => left.localeCompare(right));
      for (const name of entries) {
        if (E2E_COPY_EXCLUDED_BASENAMES.has(name)) continue;
        const path = join(directory, name);
        const stat = yield* lstatSnapshotEntry(path);
        if (stat.isSymbolicLink()) {
          return yield* Effect.fail(operationError("snapshot", `scenario snapshot rejects source symlink: ${path}`));
        }
        if (stat.isDirectory()) {
          yield* walk(path);
        } else if (!stat.isFile()) {
          return yield* Effect.fail(operationError("snapshot", `scenario snapshot rejects source special file: ${path}`));
        }
      }
    });
    const rootStat = yield* lstatSnapshotEntry(root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
      return yield* Effect.fail(operationError("snapshot", `scenario snapshot root must be a real directory: ${root}`));
    }
    yield* walk(root);
  });

export const fingerprintSourceSnapshot = (snapshotDir: string): Effect.Effect<SourceSnapshotIdentity, TakeoverOperationError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    yield* assertSnapshotTreeSafe(snapshotDir);
    const fileSystem = yield* FileSystem.FileSystem;
    const root = resolve(snapshotDir);
    const files: SourceSnapshotFile[] = [];
    const walk = (directory: string): Effect.Effect<void, TakeoverOperationError, FileSystem.FileSystem> => Effect.gen(function* () {
      const entries = yield* fileSystem.readDirectory(directory).pipe(Effect.mapError((cause) => operationError("snapshot", cause)));
      entries.sort((left, right) => left.localeCompare(right));
      for (const name of entries) {
        if (E2E_COPY_EXCLUDED_BASENAMES.has(name)) continue;
        const path = join(directory, name);
        const stat = yield* lstatSnapshotEntry(path);
        if (stat.isDirectory()) {
          yield* walk(path);
          continue;
        }
        if (!stat.isFile() || stat.isSymbolicLink()) {
          return yield* Effect.fail(operationError("snapshot", `scenario snapshot identity found unsupported entry: ${path}`));
        }
        const bytes = yield* fileSystem.readFile(path).pipe(Effect.mapError((cause) => operationError("snapshot", cause)));
        files.push({
          path: relative(root, path).split(sep).join("/"),
          bytes: bytes.byteLength,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        });
      }
    });
    yield* walk(root);
    const digest = createHash("sha256");
    for (const file of files) digest.update(`${file.path}\0${file.bytes}\0${file.sha256}\n`);
    return { algorithm: "sha256", digest: digest.digest("hex"), files };
  });

const REQUIRED_TAKEOVER_RUNS = [
  { label: "takeover/isolated-copy-1", mode: "isolated-copy", copyId: "isolated-copy-1", attempts: 1, target: true },
  { label: "takeover/isolated-copy-2", mode: "isolated-copy", copyId: "isolated-copy-2", attempts: 1, target: true },
  { label: "takeover/isolated-copy-3", mode: "isolated-copy", copyId: "isolated-copy-3", attempts: 1, target: true },
  { label: "takeover/same-copy", mode: "same-installed-copy", copyId: "same-installed-copy", attempts: 2, target: true },
  { label: "takeover/repo-default-parallel", mode: "repo-default-parallel", copyId: "repo-default-parallel", attempts: 1, target: false },
  { label: "takeover/target-single", mode: "target-single", copyId: "target-single", attempts: 1, target: true },
] as const;
type RequiredTakeoverRun = (typeof REQUIRED_TAKEOVER_RUNS)[number];

const testStages = (receiptStages: readonly StageReceipt[]) => receiptStages.filter((stage) => stage.stage === "test");
const sameCommand = (left: readonly string[] | undefined, right: readonly string[]) =>
  left !== undefined && left.length === right.length && left.every((value, index) => value === right[index]);

/** Pure business validation: defects remain durable matrix findings, not operational failures. */
export const validateTakeoverMatrix = (
  results: readonly RepoRunResult[],
  repo: DiscoveredRepo,
  candidate: CandidateTarball,
  targetNativeArgs: readonly string[],
  cancelled: boolean,
  sourceSnapshotCleanup: { readonly ok: boolean },
  checkout: CheckoutIdentity | undefined,
): { ok: boolean; complete: boolean; issues: string[] } => {
  const issues: string[] = [];
  const expectedByLabel = new Map<string, RequiredTakeoverRun>(REQUIRED_TAKEOVER_RUNS.map((entry) => [entry.label, entry]));
  const seenLabels = new Set<string>();
  const allInvocationIds = new Set<string>();
  for (const result of results) {
    const label = result.receipt.runLabel;
    if (label === undefined || !expectedByLabel.has(label)) { issues.push(`unexpected or missing takeover run label ${JSON.stringify(label)}`); continue; }
    if (seenLabels.has(label)) issues.push(`duplicate takeover run label ${JSON.stringify(label)}`);
    seenLabels.add(label);
    const expected = expectedByLabel.get(label)!;
    if (result.receipt.repoId !== repo.manifest.id) issues.push(`${label}: receipt repo id ${JSON.stringify(result.receipt.repoId)} does not match ${repo.manifest.id}`);
    if (result.receipt.copyId !== expected.copyId) issues.push(`${label}: expected copy id ${expected.copyId}, got ${JSON.stringify(result.receipt.copyId)}`);
    if (checkout?.sourceSnapshot !== undefined && result.receipt.sourceSnapshotDigest !== checkout.sourceSnapshot.digest) issues.push(`${label}: receipt source snapshot digest does not match the fixed snapshot identity`);
    if (result.receipt.candidate.sha256 !== candidate.sha256 || result.receipt.candidate.integrity !== candidate.integrity) issues.push(`${label}: receipt candidate identity differs from fixed takeover candidate`);
    const observedTests = testStages(result.receipt.stages);
    if (!cancelled && (result.receipt.testInvocations !== expected.attempts || observedTests.length !== expected.attempts)) issues.push(`${label}: expected exactly ${expected.attempts} test attempt(s), got receipt=${result.receipt.testInvocations} stages=${observedTests.length}`);
    const command = appendNativeArgs(repo.manifest.command, expected.target ? targetNativeArgs : []);
    for (let index = 0; index < observedTests.length; index += 1) {
      const stage = observedTests[index]!;
      if (!cancelled && stage.attempt !== index + 1) issues.push(`${label}: test stage ${index + 1} has attempt ${JSON.stringify(stage.attempt)}`);
      if (!sameCommand(stage.command, command)) issues.push(`${label}: test attempt ${stage.attempt ?? index + 1} command does not match its required native selection`);
      if (typeof stage.invocationId !== "string" || stage.invocationId.length === 0) issues.push(`${label}: test attempt ${stage.attempt ?? index + 1} has no invocation id`);
      else if (!result.receipt.invocationIds.includes(stage.invocationId)) issues.push(`${label}: test attempt ${stage.attempt ?? index + 1} invocation id is absent from receipt invocationIds`);
    }
    for (const invocationId of result.receipt.invocationIds) {
      if (invocationId.length === 0) issues.push(`${label}: receipt has an empty invocation id`);
      else if (allInvocationIds.has(invocationId)) issues.push(`${label}: invocation id was reused across takeover commands`);
      else allInvocationIds.add(invocationId);
    }
    const cleanupStages = result.receipt.stages.filter((stage) => stage.stage === "cleanup");
    if (cleanupStages.length !== 1) issues.push(`${label}: expected exactly one cleanup receipt, got ${cleanupStages.length}`);
    else if (!cleanupStages[0]!.ok) issues.push(`${label}: cleanup receipt is not successful`);
    for (const stage of result.receipt.stages) {
      if (stage.capture?.processGroupOwned === true && stage.capture.groupCleanup.gone !== true) issues.push(`${label}: ${stage.stage} owned process group did not reach a confirmed terminal state`);
      for (const check of stage.checks ?? []) if (check.capture?.processGroupOwned === true && check.capture.groupCleanup.gone !== true) issues.push(`${label}: ${stage.stage}/${check.kind} owned process group did not reach a confirmed terminal state`);
    }
  }
  const expectedOrder = REQUIRED_TAKEOVER_RUNS.map((entry) => entry.label);
  const actualOrder = results.map((result) => result.receipt.runLabel ?? "<missing>");
  const complete = expectedOrder.every((label) => seenLabels.has(label)) && results.length === expectedOrder.length;
  if (!cancelled) {
    const missing = expectedOrder.filter((label) => !seenLabels.has(label));
    if (missing.length > 0) issues.push(`required takeover observations missing: ${missing.join(", ")}`);
    if (results.length !== expectedOrder.length || actualOrder.some((label, index) => label !== expectedOrder[index])) issues.push(`takeover observation order/set differs from required matrix: ${actualOrder.join(", ")}`);
    if (!sourceSnapshotCleanup.ok) issues.push("fixed source snapshot scratch cleanup failed");
    if (checkout?.sourceSnapshot === undefined) issues.push("fixed source snapshot identity is missing");
  }
  return { ok: issues.length === 0, complete: !cancelled && complete, issues };
};

const categoryFor = (results: readonly RepoRunResult[], cancelled: boolean): RepoRunResult["category"] =>
  cancelled || results.some((result) => result.category === "cancelled") ? "cancelled"
    : results.some((result) => result.category === "regression") ? "regression"
      : results.some((result) => result.category === "infra") ? "infra"
        : results.some((result) => result.category === "configuration") ? "configuration"
          : results.length > 0 ? "pass" : "infra";

const toRunRecord = (result: RepoRunResult): TakeoverRunRecord => {
  const label = result.receipt.runLabel ?? "takeover/unknown";
  const mode: TakeoverRunRecord["mode"] = label.includes("same-copy")
    ? "same-installed-copy"
    : label.includes("repo-default-parallel")
      ? "repo-default-parallel"
      : label.includes("target-single")
        ? "target-single"
        : "isolated-copy";
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
};

const evidenceFileName = (label: string, attempt: number): string =>
  label.replaceAll("/", "-") + "-" + String(attempt) + ".json";

const cleanupResources = (result: RepoRunResult): readonly object[] => {
  const cleanup = result.receipt.stages.findLast((stage) => stage.stage === "cleanup");
  const ownedGroups = result.receipt.stages.flatMap((stage) => {
    const captures = [stage.capture, ...(stage.checks ?? []).map((check) => check.capture)].filter((capture) => capture?.processGroupOwned === true);
    return captures.map((capture) => ({ kind: "owned-process-group", stage: stage.stage, gone: capture!.groupCleanup.gone, detail: capture!.groupCleanup.detail }));
  });
  return [{ kind: "workdir", path: cleanup?.path ?? "<missing>", ok: cleanup?.ok === true }, ...ownedGroups];
};

/** One Effect program shares candidate, fixed source snapshot and optional Testkit across all six observations. */
export const runTakeover = (options: TakeoverOptions): Effect.Effect<TakeoverSummary, TakeoverOperationError, TakeoverRequirements> => Effect.scoped(Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const discovered = yield* discoverAllRepos(e2eRootDir()).pipe(Effect.mapError((cause) => operationError("discovery", cause)));
  if (discovered.errors.length > 0) return yield* Effect.fail(operationError("discovery", `repo discovery found ${discovered.errors.length} problem(s): ${discovered.errors.join("; ")}`));
  const repo = discovered.repos.find((entry) => entry.manifest.id === options.repoId);
  if (repo === undefined) return yield* Effect.fail(operationError("discovery", `takeover requested unknown repo ${JSON.stringify(options.repoId)}`));
  const inventoryText = yield* fileSystem.readFileString(resolve(options.inventoryReceiptPath)).pipe(Effect.mapError((cause) => operationError("evidence", cause)));
  const inventory = yield* Effect.try({
    try: () => validateInventoryReceipt(JSON.parse(inventoryText)),
    catch: (cause) => operationError("evidence", cause),
  });
  const selectedCase = yield* Effect.try({
    try: () => selectInventoryCase(inventory, options.selector, options.repoId),
    catch: (cause) => operationError("evidence", cause),
  });
  const exactSelector = parseExactSelector(options.selector);
  const selectedTitle = inventory.executor.name === "playwright" ? selectedCase.titlePath.join(" ") : selectedCase.titlePath.at(-1);
  if (selectedTitle === undefined) return yield* Effect.fail(operationError("evidence", "selected inventory case has no visible title"));
  const repoPrefix = "e2e/" + options.repoId + "/";
  const runnerCasePath = selectedCase.path.startsWith(repoPrefix) ? selectedCase.path.slice(repoPrefix.length) : selectedCase.path;
  const targetNativeArgs = [...options.nativeArgs, ...exactCaseNativeArgs(inventory.executor.name, runnerCasePath, selectedTitle)];
  const candidate = yield* readCandidateTarball(options.candidatePath).pipe(Effect.mapError((cause) => operationError("candidate", cause)));
  const root = repoRootDir();
  const testFilePath = resolve(selectedCase.path.startsWith("e2e/") ? root : repo.dir, selectedCase.path);
  const sidecarPath = testFilePath + ".cases.json";
  const [testFileBytes, sidecarBytes] = yield* Effect.all([
    fileSystem.readFile(testFilePath),
    fileSystem.readFile(sidecarPath),
  ], { concurrency: 2 }).pipe(Effect.mapError((cause) => operationError("evidence", cause)));
  const sourceDigests = { testFileSha256: sha256Hex(testFileBytes), sidecarSha256: sha256Hex(sidecarBytes) };
  const declaredArtifactRoot = options.artifactRoot ?? (yield* fileSystem.makeTempDirectory({ prefix: "niceeval-e2e-takeover-artifacts-" }).pipe(Effect.mapError((cause) => operationError("artifact", cause))));
  const artifactRoot = yield* ensureRealDirectory(declaredArtifactRoot, "takeover durable artifact root").pipe(Effect.mapError((cause) => operationError("artifact", cause)));
  const materializedCandidate = {
    ...candidate,
    path: yield* materializeCandidateArtifact(artifactRoot, candidate).pipe(
      Effect.mapError((cause) => operationError("artifact", cause)),
    ),
  };
  let sourceSnapshotCleanup: TakeoverSummary["sourceSnapshotCleanup"] = { ok: true, detail: "source snapshot scratch was not created" };
  const scratchRoot = yield* Effect.acquireRelease(
    fileSystem.makeTempDirectory({ prefix: "niceeval-e2e-takeover-scratch-" }).pipe(Effect.mapError((cause) => operationError("snapshot", cause))),
    (path) => fileSystem.remove(path, { recursive: true, force: true }).pipe(Effect.catch(() => Effect.void)),
  );
  sourceSnapshotCleanup = { ok: true, detail: `removed ${scratchRoot}` };
  const sourceSnapshotDir = join(scratchRoot, "source", repo.manifest.id);
  const results: RepoRunResult[] = [];
  let checkout: CheckoutIdentity | undefined;
  let testkit: TestkitPackage | undefined;
  let setupFailure: string | undefined;
  yield* Effect.gen(function* () {
    const [commit, status] = yield* Effect.all([gitText(root, ["rev-parse", "HEAD"]), gitText(root, ["status", "--porcelain=v1", "--untracked-files=all"])], { concurrency: 2 });
    if (inventory.checkout !== commit) return yield* Effect.fail(operationError("evidence", "inventory checkout does not match takeover checkout: " + inventory.checkout + " != " + commit));
    yield* assertSnapshotTreeSafe(repo.dir);
    yield* copyRepoIsolated(repo.dir, sourceSnapshotDir).pipe(Effect.mapError((cause) => operationError("snapshot", cause)));
    const sourceSnapshot = yield* fingerprintSourceSnapshot(sourceSnapshotDir);
    checkout = { root, commit, dirty: status.length > 0, sourceSnapshot };
    if (repo.manifest.harness?.testkit === true) testkit = yield* buildTestkitPackage(root, scratchRoot).pipe(Effect.mapError((cause) => operationError("snapshot", cause)));
    const allSecretNames = new Set(discovered.repos.flatMap((entry) => entry.manifest.secrets));
    for (const required of REQUIRED_TAKEOVER_RUNS) {
      const result = yield* runRepoEffect(repo, materializedCandidate, scratchRoot, artifactRoot, allSecretNames, required.target ? targetNativeArgs : [], testkit, { sourceDir: sourceSnapshotDir, runLabel: required.label, workdirKey: `${required.label}/${repo.manifest.id}`, testRuns: required.attempts, copyId: required.copyId, sourceSnapshotDigest: sourceSnapshot.digest }).pipe(Effect.mapError((cause) => operationError("artifact", cause)));
      results.push(result);
    }
  }).pipe(Effect.catch((cause) => Effect.sync(() => {
    setupFailure = cause instanceof TakeoverOperationError ? cause.detail : String(cause);
  })));
  yield* fileSystem.remove(scratchRoot, { recursive: true, force: true }).pipe(Effect.catch((cause) => Effect.sync(() => { sourceSnapshotCleanup = { ok: false, detail: `failed to remove ${scratchRoot}: ${String(cause)}` }; })));
  const cancelled = results.some((result) => result.category === "cancelled");
  const matrixValidation = validateTakeoverMatrix(results, repo, candidate, targetNativeArgs, cancelled, sourceSnapshotCleanup, checkout);
  const baseCategory = categoryFor(results, cancelled);
  const category = baseCategory === "cancelled" || baseCategory === "regression" || baseCategory === "configuration" ? baseCategory : setupFailure !== undefined || !matrixValidation.ok || !sourceSnapshotCleanup.ok ? "infra" : baseCategory;
  let certificate: TakeoverCertificateV1 | undefined;
  let certificatePath: string | undefined;
  if (category === "pass" && checkout !== undefined) {
    const evidenceRoot = join(artifactRoot, "case-evidence");
    yield* fileSystem.makeDirectory(evidenceRoot, { recursive: true }).pipe(Effect.mapError((cause) => operationError("artifact", cause)));
    const receipts = new Map<string, FormalCaseReceiptV1>();
    const pathsByLabel = new Map<string, string[]>();
    for (const result of results) {
      const label = result.receipt.runLabel!;
      const cleanup = result.receipt.stages.findLast((stage) => stage.stage === "cleanup");
      const resources = cleanupResources(result);
      for (const stage of testStages(result.receipt.stages)) {
        const receiptPath = join(evidenceRoot, evidenceFileName(label, stage.attempt ?? 1));
        const receipt = signFormalCaseReceipt({
          format: "niceeval.e2e-case-receipt/v1",
          mode: "formal",
          observation: label === "takeover/target-single" ? "green" : "reliability",
          selector: options.selector,
          caseId: exactSelector.caseId,
          inventoryDigest: inventory.digest,
          candidate: { gitSha: checkout.commit, sha256: candidate.sha256, sri: candidate.integrity },
          source: { checkout: checkout.commit, ...sourceDigests },
          runner: { executor: inventory.executor.name, version: inventory.executor.version, argv: stage.command ?? [] },
          result: { disposition: result.category === "pass" ? "pass" : "regression", stage: stage.stage, exitCode: stage.capture?.exitCode ?? null, signal: stage.capture?.signal ?? null },
          cleanup: { ok: cleanup?.ok === true && resources.every((resource) => "gone" in resource ? resource.gone === true : "ok" in resource && resource.ok === true), resources },
          invocationId: stage.invocationId!,
        });
        yield* writeContainedUtf8File(artifactRoot, receiptPath, JSON.stringify(receipt, null, 2) + "\n", "formal case receipt").pipe(Effect.mapError((cause) => operationError("artifact", cause)));
        receipts.set(receiptPath, receipt);
        pathsByLabel.set(label, [...(pathsByLabel.get(label) ?? []), receiptPath]);
      }
    }
    const isolated = [1, 2, 3].map((number) => pathsByLabel.get("takeover/isolated-copy-" + String(number))?.[0]);
    const sameCopy = pathsByLabel.get("takeover/same-copy") ?? [];
    const defaultParallel = pathsByLabel.get("takeover/repo-default-parallel")?.[0];
    const singleCase = pathsByLabel.get("takeover/target-single")?.[0];
    if (isolated.some((path) => path === undefined) || sameCopy.length !== 2 || defaultParallel === undefined || singleCase === undefined) return yield* Effect.fail(operationError("evidence", "formal receipt matrix is incomplete after successful takeover"));
    certificate = signTakeoverCertificate({
      format: "niceeval.e2e-takeover-certificate/v1",
      selector: options.selector,
      caseId: exactSelector.caseId,
      candidateSha256: candidate.sha256,
      greenReceipt: singleCase,
      observations: { isolatedCopies: isolated as [string, string, string], sameCopy: sameCopy as [string, string], defaultParallel, singleCase, cleanup: [...receipts.keys()] },
    });
    validateTakeoverCertificate(certificate, receipts);
    certificatePath = join(evidenceRoot, "takeover-certificate.json");
    yield* writeContainedUtf8File(artifactRoot, certificatePath, JSON.stringify(certificate, null, 2) + "\n", "takeover certificate").pipe(Effect.mapError((cause) => operationError("artifact", cause)));
  }
  const summary: TakeoverSummary = { repoId: repo.manifest.id, candidate: { sha256: candidate.sha256, integrity: candidate.integrity }, checkout: checkout ?? { root, commit: "unavailable", dirty: false }, ...(testkit === undefined ? {} : { testkit: { name: testkit.name, version: testkit.version, sourcePath: testkit.sourcePath } }), targetNativeArgs, noRetry: true, runs: results.map(toRunRecord), matrixValidation, category, detail: setupFailure ?? (!matrixValidation.ok ? `takeover matrix validation failed: ${matrixValidation.issues.join("; ")}` : category === "pass" ? "all required takeover observations passed" : "one or more takeover observations did not pass"), sourceSnapshotCleanup, ...(certificate === undefined || certificatePath === undefined ? {} : { certificate, certificatePath }) };
  yield* writeContainedUtf8File(artifactRoot, join(artifactRoot, "takeover-summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "takeover summary").pipe(Effect.mapError((cause) => operationError("artifact", cause)));
  return summary;
}));
