import { Effect, Result } from "effect";

import { encodeAttemptLocator } from "../attempt-locator.ts";
import type { RecordIssue } from "../record/errors/record-errors.ts";
import type {
  RecordAttachmentRead,
  ReadableAttempt,
  RecordReadSession,
  SelectedAttemptRef,
} from "../record/host/types.ts";
import { NiceEvalRecordAttachments } from "../record/family/catalog.ts";
import type { RecordAttachmentRead as CanonicalRecordAttachmentRead } from "../record/model/read-state.ts";
import type { RecordReaderReadError } from "../record/reader/errors.ts";
import {
  foldRecordedAttemptScore,
  type ScorePayload,
  type ScorePayloadBuildError,
} from "../eval/record/score.ts";
import { foldRecordedAttemptVerdict } from "../eval/record/verdict.ts";
import { projectSourcesAttachment } from "../sources/projector.ts";
import type { Verdict } from "../shared/types.ts";
import {
  type ExecutionReusePlan,
  type ExecutionReusePlanSource,
  type ReusePlanSlot,
  type TargetSlot,
} from "./reuse-plan.ts";

/** Fixed-family read states remain visible; a readback never invents a result file. */
export type CurrentRecordRead<Value> = CanonicalRecordAttachmentRead<Value>;

export interface CurrentReusedAttemptReadback {
  readonly state: "reused";
  readonly target: CurrentReusedAttemptTarget;
  readonly source: CurrentReusedAttemptSource;
  readonly verdict: "passed" | "failed";
  readonly score: CurrentReusedAttemptScore;
  readonly executionErrors: CurrentRecordRead<readonly CurrentReusedExecutionError[]>;
}

export interface CurrentReuseCandidateReadback {
  readonly state: "prior";
  readonly target: CurrentReusedAttemptTarget;
  readonly source: CurrentReusedAttemptSource;
  readonly verdict: CurrentRecordRead<Verdict>;
  readonly score: CurrentReusedAttemptScore;
  readonly executionErrors: CurrentRecordRead<readonly CurrentReusedExecutionError[]>;
  readonly sourceFiles: CurrentReuseSourceFiles;
}

export type CurrentReuseReadback = CurrentReusedAttemptReadback | CurrentReuseCandidateReadback;

export interface CurrentReusedAttemptTarget {
  readonly runId: TargetSlot["runId"];
  readonly slotId: TargetSlot["slotId"];
  readonly experimentId: TargetSlot["experimentId"];
  readonly evalId: TargetSlot["evalId"];
  readonly attempt: TargetSlot["attempt"];
}

export interface CurrentReusedAttemptSource {
  readonly attempt: SelectedAttemptRef;
  readonly attemptId: ExecutionReusePlanSource["attemptId"];
  readonly origin: ExecutionReusePlanSource["origin"];
  readonly sourceBarrier: ExecutionReusePlanSource["sourceBarrier"];
  readonly evaluationKind: ExecutionReusePlanSource["evaluationKind"];
}

export type CurrentReusedAttemptScore =
  | { readonly state: "not-applicable" }
  | {
      readonly state: "applicable";
      readonly attachment: CurrentRecordRead<ScorePayload>;
    };

export interface CurrentReusedExecutionCause {
  readonly code: string;
  readonly summary: string;
}

export interface CurrentReusedExecutionError {
  readonly kind: "execution-error";
  readonly code: string;
  readonly phase: string;
  readonly summary: string;
  readonly causes: readonly CurrentReusedExecutionCause[];
}

export interface CurrentReuseSourceFile {
  readonly path: string;
  readonly sha256: string;
}

export type CurrentReuseSourceFiles =
  | CurrentRecordRead<readonly CurrentReuseSourceFile[]>
  | { readonly state: "origin-run-missing" }
  | { readonly state: "origin-run-invalid"; readonly issues: readonly RecordIssue[] }
  | { readonly state: "projection-invalid" };

export interface CurrentReuseReadbackPlanInvalid {
  readonly code: "current-reuse-readback-plan-invalid";
  readonly reason:
    | "source-attempt-unavailable"
    | "source-verdict-unavailable"
    | "source-verdict-ineligible"
    | ScorePayloadBuildError["code"];
}

export interface CurrentReusedAttemptSourceSnapshot {
  readonly attemptId: string;
  readonly locator: string;
  readonly origin: { readonly runId: string; readonly slotId: string };
  readonly sourceBarrier: { readonly runId: string; readonly startedAt: number };
  readonly evaluationKind: CurrentReusedAttemptSource["evaluationKind"];
}

export interface CurrentReusedAttemptTargetSnapshot {
  readonly runId: string;
  readonly slotId: string;
  readonly experimentId: string;
  readonly evalId: string;
  readonly attempt: number;
}

export interface CurrentReusedAttemptSnapshot {
  readonly state: "reused";
  readonly target: CurrentReusedAttemptTargetSnapshot;
  readonly source: CurrentReusedAttemptSourceSnapshot;
  readonly verdict: CurrentReusedAttemptReadback["verdict"];
  readonly score: CurrentReusedAttemptScore;
  readonly executionErrors: CurrentReusedAttemptReadback["executionErrors"];
}

export interface CurrentReuseCandidateSnapshot {
  readonly state: "prior";
  readonly target: CurrentReusedAttemptTargetSnapshot;
  readonly source: CurrentReusedAttemptSourceSnapshot;
  readonly verdict: CurrentReuseCandidateReadback["verdict"];
  readonly score: CurrentReusedAttemptScore;
  readonly executionErrors: CurrentReusedAttemptReadback["executionErrors"];
  readonly sourceFiles: CurrentReuseSourceFiles;
}

export type CurrentReuseReadbackSnapshot = CurrentReusedAttemptSnapshot | CurrentReuseCandidateSnapshot;

function nonAvailableRead<Value>(
  value: Exclude<RecordAttachmentRead<unknown>, { readonly state: "available" }>,
): Exclude<CurrentRecordRead<Value>, { readonly state: "available" }> {
  return value;
}

function invalid(reason: CurrentReuseReadbackPlanInvalid["reason"]): CurrentReuseReadbackPlanInvalid {
  return Object.freeze({ code: "current-reuse-readback-plan-invalid", reason });
}

function readSourceAttempt(input: {
  readonly reader: RecordReadSession;
  readonly source: ExecutionReusePlanSource;
}): Effect.Effect<ReadableAttempt, RecordReaderReadError | CurrentReuseReadbackPlanInvalid> {
  return input.reader.readAttempt(input.source.attempt).pipe(
    Effect.flatMap((read) => read.state === "available"
      ? Effect.succeed(read.value)
      : Effect.fail(invalid("source-attempt-unavailable"))),
  );
}

function detailsFor(input: {
  readonly reader: RecordReadSession;
  readonly attempt: ReadableAttempt;
  readonly evaluationKind: ExecutionReusePlanSource["evaluationKind"];
}): Effect.Effect<
  {
    readonly assertions: CurrentRecordRead<Verdict>;
    readonly score: CurrentReusedAttemptScore;
    readonly executionErrors: CurrentRecordRead<readonly CurrentReusedExecutionError[]>;
  },
  RecordReaderReadError | CurrentReuseReadbackPlanInvalid
> {
  return Effect.gen(function* () {
    const assertions = yield* input.reader.read(
      input.attempt.owner,
      NiceEvalRecordAttachments.assertions,
    );
    const assertionRead: CurrentRecordRead<Verdict> = assertions.state === "available"
      ? Object.freeze({
          state: "available" as const,
          value: foldRecordedAttemptVerdict({
            outcome: input.attempt.document.outcome,
            assertions: assertions.value,
          }) as Verdict,
        })
      : nonAvailableRead(assertions);
    const diagnostics = yield* input.reader.read(
      input.attempt.owner,
      NiceEvalRecordAttachments.runnerDiagnostics.attempt,
    );
    const executionErrors: CurrentRecordRead<readonly CurrentReusedExecutionError[]> = diagnostics.state === "available"
      ? Object.freeze({
          state: "available" as const,
          value: Object.freeze(diagnostics.value.segments
            .filter((diagnostic) => diagnostic.kind === "execution-error")
            .map((diagnostic) => Object.freeze({
              kind: "execution-error" as const,
              code: diagnostic.code,
              phase: diagnostic.phase,
              summary: diagnostic.summary,
              causes: Object.freeze(diagnostic.causes.map((cause) => Object.freeze({
                code: cause.code,
                summary: cause.summary,
              }))),
            }))),
        })
      : nonAvailableRead(diagnostics);
    let scoreAttachment: CurrentRecordRead<ScorePayload>;
    if (assertions.state === "available") {
      const folded = foldRecordedAttemptScore({
        outcome: input.attempt.document.outcome,
        assertions: assertions.value,
      });
      if (Result.isFailure(folded)) return yield* Effect.fail(invalid(folded.failure.code));
      scoreAttachment = Object.freeze({ state: "available" as const, value: folded.success });
    } else {
      scoreAttachment = nonAvailableRead(assertions);
    }
    const score: CurrentReusedAttemptScore = input.evaluationKind === "score"
      ? Object.freeze({ state: "applicable" as const, attachment: scoreAttachment })
      : Object.freeze({ state: "not-applicable" as const });
    return Object.freeze({ assertions: assertionRead, score, executionErrors });
  });
}

export function readCurrentReusedAttempt(input: {
  readonly reader: RecordReadSession;
  readonly slot: ReusePlanSlot;
}): Effect.Effect<
  CurrentReusedAttemptReadback,
  RecordReaderReadError | CurrentReuseReadbackPlanInvalid
> {
  return Effect.gen(function* () {
    const attempt = yield* readSourceAttempt({ reader: input.reader, source: input.slot.source });
    const details = yield* detailsFor({
      reader: input.reader,
      attempt,
      evaluationKind: input.slot.source.evaluationKind,
    });
    if (details.assertions.state !== "available") {
      return yield* Effect.fail(invalid("source-verdict-unavailable"));
    }
    if (details.assertions.value !== "passed" && details.assertions.value !== "failed") {
      return yield* Effect.fail(invalid("source-verdict-ineligible"));
    }
    return Object.freeze({
      state: "reused" as const,
      target: targetOf(input.slot),
      source: sourceOf(input.slot.source),
      verdict: details.assertions.value,
      score: details.score,
      executionErrors: details.executionErrors,
    });
  });
}

export function readCurrentReuseCandidate(input: {
  readonly reader: RecordReadSession;
  readonly slot: Extract<ExecutionReusePlan["slots"][number], { readonly state: "gap" }>;
}): Effect.Effect<
  CurrentReuseCandidateReadback | undefined,
  RecordReaderReadError | CurrentReuseReadbackPlanInvalid
> {
  return Effect.suspend(() => {
    const source = input.slot.candidate;
    if (source === undefined) return Effect.succeed(undefined);
    return Effect.gen(function* () {
      const attempt = yield* readSourceAttempt({ reader: input.reader, source });
      const details = yield* detailsFor({ reader: input.reader, attempt, evaluationKind: source.evaluationKind });
      const sourceFiles = yield* readCurrentReuseSourceFiles({ reader: input.reader, source });
      return Object.freeze({
        state: "prior" as const,
        target: targetOf(input.slot),
        source: sourceOf(source),
        verdict: details.assertions,
        score: details.score,
        executionErrors: details.executionErrors,
        sourceFiles,
      });
    });
  });
}

export function readCurrentExecutionReusePlanReadbacks(input: {
  readonly reader: RecordReadSession;
  readonly plan: ExecutionReusePlan;
}): Effect.Effect<
  readonly CurrentReuseReadback[],
  RecordReaderReadError | CurrentReuseReadbackPlanInvalid
> {
  return Effect.forEach(input.plan.slots, (slot) => slot.state === "reuse"
    ? readCurrentReusedAttempt({ reader: input.reader, slot }).pipe(
        Effect.map((value): CurrentReuseReadback | undefined => value),
      )
    : readCurrentReuseCandidate({ reader: input.reader, slot }), { concurrency: 1 }).pipe(
      Effect.map((values) => Object.freeze(values.flatMap((value) => value === undefined ? [] : [value]))),
    );
}

export function readCurrentExecutionReusePlanResults(input: {
  readonly reader: RecordReadSession;
  readonly plan: ExecutionReusePlan;
}): Effect.Effect<
  readonly CurrentReusedAttemptReadback[],
  RecordReaderReadError | CurrentReuseReadbackPlanInvalid
> {
  return Effect.forEach(
    input.plan.reuse,
    (slot) => readCurrentReusedAttempt({ reader: input.reader, slot }),
    { concurrency: 1 },
  ).pipe(Effect.map((values) => Object.freeze(values)));
}

function readCurrentReuseSourceFiles(input: {
  readonly reader: RecordReadSession;
  readonly source: ExecutionReusePlanSource;
}): Effect.Effect<CurrentReuseSourceFiles, RecordReaderReadError> {
  return Effect.gen(function* () {
    const origin = yield* input.reader.readRun(input.source.originRun);
    if (origin.state === "missing") return Object.freeze({ state: "origin-run-missing" as const });
    if (origin.state === "core-invalid") {
      return Object.freeze({ state: "origin-run-invalid" as const, issues: Object.freeze([...origin.issues]) });
    }
    const sources = yield* input.reader.read(
      origin.value.owner,
      NiceEvalRecordAttachments.sources,
    );
    if (sources.state !== "available") return nonAvailableRead(sources);
    const projection = yield* Effect.result(
      projectSourcesAttachment(sources.value, sources.content),
    );
    if (Result.isFailure(projection)) {
      switch (projection.failure.code) {
        case "source-blob-unavailable":
        case "source-blob-utf8-invalid":
        case "source-blob-digest-mismatch":
          return Object.freeze({ state: "projection-invalid" as const });
        default:
          return yield* Effect.fail(projection.failure);
      }
    }
    return Object.freeze({
      state: "available" as const,
      value: Object.freeze(projection.success.items.map((item) => Object.freeze({
        path: item.path,
        sha256: item.sha256,
      }))),
    });
  });
}

export function projectCurrentReuseReadback(readback: CurrentReuseReadback): CurrentReuseReadbackSnapshot {
  return readback.state === "reused"
    ? projectCurrentReusedAttemptReadback(readback)
    : projectCurrentReuseCandidateReadback(readback);
}

export function projectCurrentReusedAttemptReadback(
  readback: CurrentReusedAttemptReadback,
): CurrentReusedAttemptSnapshot {
  return Object.freeze({
    state: "reused" as const,
    target: targetSnapshotOf(readback.target),
    source: sourceSnapshotOf(readback.source),
    verdict: readback.verdict,
    score: readback.score,
    executionErrors: readback.executionErrors,
  });
}

export function projectCurrentReuseCandidateReadback(
  readback: CurrentReuseCandidateReadback,
): CurrentReuseCandidateSnapshot {
  return Object.freeze({
    state: "prior" as const,
    target: targetSnapshotOf(readback.target),
    source: sourceSnapshotOf(readback.source),
    verdict: readback.verdict,
    score: readback.score,
    executionErrors: readback.executionErrors,
    sourceFiles: readback.sourceFiles,
  });
}

function targetOf(slot: TargetSlot): CurrentReusedAttemptTarget {
  return Object.freeze({
    runId: slot.runId,
    slotId: slot.slotId,
    experimentId: slot.experimentId,
    evalId: slot.evalId,
    attempt: slot.attempt,
  });
}

function sourceOf(source: ExecutionReusePlanSource): CurrentReusedAttemptSource {
  return Object.freeze({
    attempt: source.attempt,
    attemptId: source.attemptId,
    origin: source.origin,
    sourceBarrier: source.sourceBarrier,
    evaluationKind: source.evaluationKind,
  });
}

function targetSnapshotOf(target: CurrentReusedAttemptTarget): CurrentReusedAttemptTargetSnapshot {
  return Object.freeze({
    runId: String(target.runId),
    slotId: String(target.slotId),
    experimentId: target.experimentId,
    evalId: target.evalId,
    attempt: target.attempt,
  });
}

function sourceSnapshotOf(source: CurrentReusedAttemptSource): CurrentReusedAttemptSourceSnapshot {
  return Object.freeze({
    attemptId: String(source.attemptId),
    locator: encodeAttemptLocator(source.attemptId),
    origin: Object.freeze({ runId: String(source.origin.runId), slotId: String(source.origin.slotId) }),
    sourceBarrier: Object.freeze({
      runId: String(source.sourceBarrier.runId),
      startedAt: source.sourceBarrier.startedAt,
    }),
    evaluationKind: source.evaluationKind,
  });
}
