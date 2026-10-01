import { resolve } from "node:path";
import { governanceSuiteForFile } from "concord-sdlc/governance-config";
import { projectExecutionSources, resolveRepositorySourceIdentity, sameRepositorySourceIdentity } from "concord-sdlc/repository/source-identity";

import * as FileSystem from "effect/FileSystem";
import { Data, Effect, Result } from "effect";

import { decodeRepoReceipt, type RepoReceipt } from "./contracts.ts";
import { discoverAllRepos, e2eRootDir, repoRootDir } from "./discovery.ts";
import { runEffect } from "./run.ts";
import { saveManagedRedEvidence } from "./managed-evidence.ts";
import { nativeReporterArgs } from "./native-observation.ts";
import { copyRepoIsolated } from "./run-repo.ts";
import { hasConfirmedOwnedGroupCleanup, hasSuccessfulOwnedProcessResult, OwnedProcess, runOwnedProcess } from "./owned-process.ts";
import {
  selectInventoryCase,
  exactCaseNativeArgs,
  signFormalCaseReceipt,
  readManagedInventoryReceipt,
  managedInventoryImplementationDigest,
  sha256Sri,
  validateFormalCaseReceipt,
  type FormalCaseReceiptV2,
  type EvidenceResource,
} from "./case-evidence.ts";

export interface RedEvidenceOptions {
  readonly candidatePath: string;
  readonly candidateGitSha: string;
  readonly repoId: string;
  readonly selector: string;
  readonly inventoryId: string;
  readonly artifactRoot?: string;
  readonly nativeArgs: readonly string[];
  readonly problem: { readonly path: string; readonly epoch: number };
}

export interface RedEvidenceSummary {
  readonly format: "niceeval.e2e-red-evidence-summary/v1";
  readonly evidence: string;
  readonly receiptPath: string;
  readonly receipt: FormalCaseReceiptV2;
}

export class RedEvidenceError extends Data.TaggedError("RedEvidenceError")<{ readonly detail: string }> {}
const failure = (cause: unknown): RedEvidenceError => new RedEvidenceError({
  detail: typeof cause === "object" && cause !== null && "detail" in cause && typeof cause.detail === "string"
    ? cause.detail
    : cause instanceof Error
      ? cause.message
      : String(cause),
});

const checkoutHead = (root: string): Effect.Effect<string, RedEvidenceError, OwnedProcess | import("effect").Scope.Scope> =>
  runOwnedProcess(["git", "rev-parse", "HEAD"], { cwd: root, env: process.env, output: "capture", stream: false, timeoutMs: 10_000 }).pipe(
    Effect.flatMap((result) => hasSuccessfulOwnedProcessResult(result) && hasConfirmedOwnedGroupCleanup(result)
      ? Effect.succeed(result.stdout.trim())
      : Effect.fail(new RedEvidenceError({ detail: "could not bind red evidence to checkout HEAD" }))),
    Effect.mapError(failure),
  );

const decodeReceipt = (text: string, path: string): Effect.Effect<RepoReceipt, RedEvidenceError> =>
  Effect.try({ try: () => JSON.parse(text) as unknown, catch: failure }).pipe(
    Effect.flatMap((input) => Result.match(decodeRepoReceipt(input), {
      onFailure: (cause) => Effect.fail(new RedEvidenceError({ detail: "invalid formal runner receipt at " + path + ": " + String(cause) })),
      onSuccess: Effect.succeed,
    })),
  );

const receiptCaptureClean = (capture: RepoReceipt["stages"][number]["capture"]): boolean =>
  capture !== undefined && capture.processGroupOwned && capture.groupCleanup.gone === true;

export const validateExpectedRegression = (receipt: RepoReceipt): { readonly test: NonNullable<RepoReceipt["stages"][number]["capture"]>; readonly invocationId: string; readonly resources: readonly EvidenceResource[] } => {
  if (receipt.category !== "regression") throw new Error("exact case did not produce the expected public regression");
  const tests = receipt.stages.filter((stage) => stage.stage === "test");
  if (tests.length !== 1) throw new Error("red evidence requires exactly one test invocation and forbids retry");
  const stage = tests[0]!; const capture = stage.capture;
  if (capture === undefined || stage.invocationId === undefined || stage.ok || capture.exitCode === null || capture.exitCode === 0 || capture.timedOut || capture.cancelled || capture.signal !== null || !receiptCaptureClean(capture)) throw new Error("test result is not an ordinary public regression");
  if (/no tests?(?: were)? (?:found|matched)|no test files found/i.test(capture.stdout + "\n" + capture.stderr)) throw new Error("exact selector did not execute the collected case");
  const nonTests = receipt.stages.filter((entry) => entry.stage !== "test");
  if (nonTests.some((entry) => !entry.ok)) throw new Error("prepare, infrastructure, collect, or cleanup failure cannot become red evidence");
  const cleanup = receipt.stages.findLast((entry) => entry.stage === "cleanup");
  if (cleanup?.ok !== true) throw new Error("red evidence cleanup was not confirmed");
  for (const entry of receipt.stages) {
    if (entry.capture?.processGroupOwned === true && !receiptCaptureClean(entry.capture)) throw new Error("an owned process group was not cleaned up");
    for (const check of entry.checks ?? []) if (check.capture?.processGroupOwned === true && !receiptCaptureClean(check.capture)) throw new Error("a preflight process group was not cleaned up");
  }
  return { test: capture, invocationId: stage.invocationId, resources: [{ kind: "workdir", path: cleanup.path ?? "<missing>", ok: true }, { kind: "owned-process-group", gone: true, detail: capture.groupCleanup.detail }] };
};

export const runRedEvidence = (options: RedEvidenceOptions): Effect.Effect<RedEvidenceSummary, RedEvidenceError, FileSystem.FileSystem | OwnedProcess | import("effect").Scope.Scope> => Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(options.candidateGitSha)) return yield* Effect.fail(new RedEvidenceError({ detail: "candidateGitSha must be a full Git object id" }));
  const inventory = yield* Effect.try({ try: () => readManagedInventoryReceipt(repoRootDir(), options.inventoryId, options.selector), catch: failure });
  const selected = yield* Effect.try({ try: () => selectInventoryCase(inventory, options.selector, options.repoId), catch: failure });
  const head = yield* checkoutHead(repoRootDir());
  if (head !== inventory.checkout) return yield* Effect.fail(new RedEvidenceError({ detail: "inventory checkout does not match current checkout HEAD" }));
  const repoPrefix = "e2e/" + options.repoId + "/";
  const runnerPath = selected.path.startsWith(repoPrefix) ? selected.path.slice(repoPrefix.length) : selected.path;
  const discovered = yield* discoverAllRepos(e2eRootDir()).pipe(Effect.mapError(failure));
  const repo = discovered.repos.find((entry) => entry.manifest.id === options.repoId);
  if (repo === undefined || discovered.errors.length > 0) return yield* Effect.fail(new RedEvidenceError({ detail: `cannot freeze source for ${options.repoId}: ${discovered.errors.join("; ")}` }));
  const root = repoRootDir();
  const suite = yield* Effect.try({ try: () => governanceSuiteForFile(root, selected.path), catch: failure });
  const scratch = yield* Effect.acquireRelease(
    fileSystem.makeTempDirectory({ prefix: "niceeval-e2e-red-source-" }).pipe(Effect.mapError(failure)),
    (path) => fileSystem.remove(path, { recursive: true, force: true }).pipe(Effect.catch(() => Effect.void)),
  );
  const sourceSnapshot = resolve(scratch, suite.root);
  yield* copyRepoIsolated(repo.dir, sourceSnapshot).pipe(Effect.mapError(failure));
  const sourceIdentity = yield* Effect.try({ try: () => resolveRepositorySourceIdentity(root, options.selector), catch: failure });
  const copiedProjection = yield* Effect.try({ try: () => projectExecutionSources(sourceSnapshot, suite.root), catch: failure });
  if (copiedProjection.digest !== sourceIdentity.projection.digest) return yield* Effect.fail(new RedEvidenceError({ detail: "red execution copy projection differs from the current source identity" }));
  const exactArgs = exactCaseNativeArgs(inventory.executor.name, runnerPath, selected.titlePath);
  const nativeArgs = [...options.nativeArgs, ...nativeReporterArgs(inventory.executor.name), ...exactArgs];
  const summary = yield* runEffect({ repoIds: [options.repoId], candidatePath: options.candidatePath, ...(options.artifactRoot === undefined ? {} : { artifactRoot: options.artifactRoot }), nativeArgs, keepWorkdir: false, repoConcurrency: 1, caseSelections: { [options.repoId]: { executor: inventory.executor.name, caseId: selected.caseId, titlePath: selected.titlePath, checkout: inventory.checkout, only: true } }, caseCollectionNativeArgs: { [options.repoId]: [...options.nativeArgs, ...exactArgs] }, sourceDirs: { [options.repoId]: sourceSnapshot }, sourceSnapshotDigests: { [options.repoId]: sourceIdentity.projection.digest }, sourceProjectionPrefixes: { [options.repoId]: suite.root }, copyIds: { [options.repoId]: "red-single" } }).pipe(Effect.mapError(failure));
  if (summary.runner.category !== "pass" || summary.results.length !== 1) return yield* Effect.fail(new RedEvidenceError({ detail: "runner infrastructure or scratch cleanup failed" }));
  const repoResult = summary.results[0]!;
  const repoReceiptText = yield* fileSystem.readFileString(repoResult.receiptPath).pipe(Effect.mapError(failure));
  const repoReceipt = yield* decodeReceipt(repoReceiptText, repoResult.receiptPath);
  if (repoReceipt.category !== "regression") {
    return yield* Effect.fail(new RedEvidenceError({ detail: repoReceipt.detail }));
  }
  const regression = yield* Effect.try({ try: () => validateExpectedRegression(repoReceipt), catch: failure });
  const afterSourceIdentity = yield* Effect.try({ try: () => resolveRepositorySourceIdentity(root, options.selector), catch: failure });
  if (!sameRepositorySourceIdentity(sourceIdentity, afterSourceIdentity)) return yield* Effect.fail(new RedEvidenceError({ detail: "fixed red source identity drifted during execution" }));
  const testStage = repoReceipt.stages.find((stage) => stage.stage === "test")!;
  const cleanupStage = repoReceipt.stages.findLast((stage) => stage.stage === "cleanup");
  if (testStage.native === undefined) return yield* Effect.fail(new RedEvidenceError({ detail: `native red observation is unavailable: ${testStage.nativeObservationError ?? "missing native reporter result"}` }));
  const receipt = signFormalCaseReceipt({
    format: "concord.native-case-receipt/v1", mode: "formal", observation: "red", selector: options.selector, caseId: selected.caseId, inventoryDigest: inventory.digest,
    problem: options.problem,
    candidate: { gitSha: options.candidateGitSha, sha256: repoReceipt.candidate.sha256, sri: sha256Sri(repoReceipt.candidate.sha256) },
    source: sourceIdentity,
    runner: { executor: inventory.executor.name, version: inventory.executor.version, implementationDigest: managedInventoryImplementationDigest(root), argv: testStage.command ?? [] },
    result: { disposition: "regression", stage: "test", exitCode: regression.test.exitCode, signal: regression.test.signal, timedOut: regression.test.timedOut, startupFailed: regression.test.error !== undefined },
    native: { copyId: repoReceipt.copyId ?? "red-single", copyPath: cleanupStage?.path ?? "unavailable", sequence: 1, mode: "single", ...testStage.native, parallelism: 1 },
    cleanup: { ok: true, resources: regression.resources }, invocationId: regression.invocationId,
  });
  validateFormalCaseReceipt(receipt);
  const receiptPath = resolve(summary.artifactRoot, "case-evidence", "red-receipt.json");
  yield* fileSystem.makeDirectory(resolve(summary.artifactRoot, "case-evidence"), { recursive: true }).pipe(Effect.mapError(failure));
  yield* fileSystem.writeFileString(receiptPath, JSON.stringify(receipt, null, 2) + "\n").pipe(Effect.mapError(failure));
  const evidence = yield* Effect.try({ try: () => saveManagedRedEvidence(repoRootDir(), receipt, options.candidatePath), catch: failure });
  return { format: "niceeval.e2e-red-evidence-summary/v1" as const, evidence, receiptPath, receipt };
}).pipe(Effect.mapError(failure));
