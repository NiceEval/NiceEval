import { resolve } from "node:path";

import * as FileSystem from "effect/FileSystem";
import { Data, Effect, Result } from "effect";

import { decodeRepoReceipt, type RepoReceipt } from "./contracts.ts";
import { repoRootDir } from "./discovery.ts";
import { runEffect } from "./run.ts";
import { saveManagedRedEvidence } from "./managed-evidence.ts";
import { hasConfirmedOwnedGroupCleanup, hasSuccessfulOwnedProcessResult, OwnedProcess, runOwnedProcess } from "./owned-process.ts";
import {
  selectInventoryCase,
  exactCaseNativeArgs,
  sha256Hex,
  signFormalCaseReceipt,
  readManagedInventoryReceipt,
  validateFormalCaseReceipt,
  type FormalCaseReceiptV1,
} from "./case-evidence.ts";

export interface RedEvidenceOptions {
  readonly candidatePath: string;
  readonly candidateGitSha: string;
  readonly repoId: string;
  readonly selector: string;
  readonly inventoryId: string;
  readonly artifactRoot?: string;
  readonly nativeArgs: readonly string[];
}

export interface RedEvidenceSummary {
  readonly format: "niceeval.e2e-red-evidence-summary/v1";
  readonly evidence: string;
  readonly receiptPath: string;
  readonly receipt: FormalCaseReceiptV1;
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

export const validateExpectedRegression = (receipt: RepoReceipt): { readonly test: NonNullable<RepoReceipt["stages"][number]["capture"]>; readonly invocationId: string; readonly resources: readonly object[] } => {
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
  const sourcePath = resolve(selected.path.startsWith("e2e/") ? repoRootDir() : resolve(repoRootDir(), "e2e", options.repoId), selected.path);
  const [testFile, sidecar] = yield* Effect.all([fileSystem.readFile(sourcePath), fileSystem.readFile(sourcePath + ".cases.json")], { concurrency: 2 }).pipe(Effect.mapError(failure));
  const nativeArgs = [...options.nativeArgs, ...exactCaseNativeArgs(inventory.executor.name, runnerPath, selected.caseId)];
  const summary = yield* runEffect({ repoIds: [options.repoId], candidatePath: options.candidatePath, ...(options.artifactRoot === undefined ? {} : { artifactRoot: options.artifactRoot }), nativeArgs, keepWorkdir: false, repoConcurrency: 1 }).pipe(Effect.mapError(failure));
  if (summary.runner.category !== "pass" || summary.results.length !== 1) return yield* Effect.fail(new RedEvidenceError({ detail: "runner infrastructure or scratch cleanup failed" }));
  const repoResult = summary.results[0]!;
  const repoReceiptText = yield* fileSystem.readFileString(repoResult.receiptPath).pipe(Effect.mapError(failure));
  const repoReceipt = yield* decodeReceipt(repoReceiptText, repoResult.receiptPath);
  if (repoReceipt.category !== "regression") {
    return yield* Effect.fail(new RedEvidenceError({ detail: repoReceipt.detail }));
  }
  const regression = yield* Effect.try({ try: () => validateExpectedRegression(repoReceipt), catch: failure });
  const receipt = signFormalCaseReceipt({
    format: "niceeval.e2e-case-receipt/v1", mode: "formal", observation: "red", selector: options.selector, caseId: selected.caseId, inventoryDigest: inventory.digest,
    candidate: { gitSha: options.candidateGitSha, sha256: repoReceipt.candidate.sha256, sri: repoReceipt.candidate.integrity },
    source: { checkout: head, testFileSha256: sha256Hex(testFile), sidecarSha256: sha256Hex(sidecar) },
    runner: { executor: inventory.executor.name, version: inventory.executor.version, argv: repoReceipt.stages.find((stage) => stage.stage === "test")!.command ?? [] },
    result: { disposition: "regression", stage: "test", exitCode: regression.test.exitCode, signal: regression.test.signal },
    cleanup: { ok: true, resources: regression.resources }, invocationId: regression.invocationId,
  });
  validateFormalCaseReceipt(receipt);
  const receiptPath = resolve(summary.artifactRoot, "case-evidence", "red-receipt.json");
  yield* fileSystem.makeDirectory(resolve(summary.artifactRoot, "case-evidence"), { recursive: true }).pipe(Effect.mapError(failure));
  yield* fileSystem.writeFileString(receiptPath, JSON.stringify(receipt, null, 2) + "\n").pipe(Effect.mapError(failure));
  const evidence = yield* Effect.try({ try: () => saveManagedRedEvidence(repoRootDir(), receipt, options.candidatePath), catch: failure });
  return { format: "niceeval.e2e-red-evidence-summary/v1" as const, evidence, receiptPath, receipt };
}).pipe(Effect.mapError(failure));
