import { Effect, Either } from "effect";

import { encodeAttemptLocator } from "../attempt-locator.ts";
import type { RecordIssue } from "../record/errors/record-errors.ts";
import type {
  FixedFamilyRead,
  ReadableAttempt,
  RecordReadSession,
  SelectedAttemptRef,
} from "../record/host/types.ts";
import type { RecordReaderReadError } from "../record/reader/errors.ts";
import { projectSourcesAttachment } from "../sources/projector.ts";
import type { Verdict } from "../shared/types.ts";
import {
  recordedAttemptVerdict,
  type ExecutionReusePlan,
  type ExecutionReusePlanSource,
  type ReusePlanSlot,
  type TargetSlot,
} from "./reuse-plan.ts";

/** Fixed-family read states remain visible; a readback never invents a result file. */
export type CurrentRecordRead<Value> =
  | { readonly state: "available"; readonly value: Value }
  | { readonly state: "not-recorded" }
  | {
      readonly state: "migration-required";
      readonly family: string;
      readonly fromSchemaVersion: number;
      readonly toSchemaVersion: number;
      readonly command: "niceeval migrate";
    }
  | { readonly state: "unsupported"; readonly family: string; readonly schemaVersion: number }
  | { readonly state: "invalid"; readonly issues: readonly RecordIssue[] };

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
      readonly attachment: CurrentRecordRead<{
        readonly state: "complete" | "partial" | "unavailable";
        readonly earned?: number;
      }>;
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
    | "source-verdict-ineligible";
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

function recordRead<Value>(value: FixedFamilyRead<Value>): CurrentRecordRead<Value> {
  switch (value.state) {
    case "available":
      return Object.freeze({ state: "available" as const, value: value.value as Value });
    case "not-recorded":
      return Object.freeze({ state: "not-recorded" as const });
    case "unsupported":
      return Object.freeze({
        state: "unsupported" as const,
        family: value.family,
        schemaVersion: value.schemaVersion,
      });
    case "migration-required":
      return Object.freeze({
        state: "migration-required" as const,
        family: value.family,
        fromSchemaVersion: value.fromSchemaVersion,
        toSchemaVersion: value.toSchemaVersion,
        command: value.command,
      });
    case "invalid":
      return Object.freeze({ state: "invalid" as const, issues: Object.freeze([...value.issues]) });
  }
}

function nonAvailableRead<Value>(value: Exclude<FixedFamilyRead<unknown>, { readonly state: "available" }>): CurrentRecordRead<Value> {
  switch (value.state) {
    case "not-recorded":
      return Object.freeze({ state: "not-recorded" as const });
    case "unsupported":
      return Object.freeze({
        state: "unsupported" as const,
        family: value.family,
        schemaVersion: value.schemaVersion,
      });
    case "migration-required":
      return Object.freeze({
        state: "migration-required" as const,
        family: value.family,
        fromSchemaVersion: value.fromSchemaVersion,
        toSchemaVersion: value.toSchemaVersion,
        command: value.command,
      });
    case "invalid":
      return Object.freeze({ state: "invalid" as const, issues: Object.freeze([...value.issues]) });
  }
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

function scoreOf(entries: readonly { readonly result: { readonly score: unknown } }[]): {
  readonly state: "complete" | "partial" | "unavailable";
  readonly earned?: number;
} {
  let earned = 0;
  let unavailable = false;
  for (const entry of entries) {
    const score = entry.result.score as { readonly state?: unknown; readonly earned?: unknown };
    if (score.state === "earned" && typeof score.earned === "number") earned += score.earned;
    if (score.state === "unavailable") unavailable = true;
  }
  return unavailable
    ? Object.freeze({ state: earned > 0 ? "partial" as const : "unavailable" as const, ...(earned > 0 ? { earned } : {}) })
    : Object.freeze({ state: "complete" as const, earned });
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
  RecordReaderReadError
> {
  return Effect.gen(function* () {
    const assertions = yield* input.reader.readAssertions(input.attempt.owner);
    const assertionRead: CurrentRecordRead<Verdict> = assertions.state === "available"
      ? Object.freeze({
          state: "available" as const,
          value: recordedAttemptVerdict({
            outcome: input.attempt.document.outcome,
            assertions: assertions.value,
          }) as Verdict,
        })
      : nonAvailableRead(assertions);
    const observability = yield* input.reader.readAttemptObservability(input.attempt.owner);
    const executionErrors: CurrentRecordRead<readonly CurrentReusedExecutionError[]> = observability.state === "available"
      ? Object.freeze({
          state: "available" as const,
          value: Object.freeze(observability.value.diagnostics.diagnostics
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
      : nonAvailableRead(observability);
    const scoreAttachment: CurrentRecordRead<{
      readonly state: "complete" | "partial" | "unavailable";
      readonly earned?: number;
    }> = assertions.state === "available"
      ? Object.freeze({ state: "available" as const, value: scoreOf(assertions.value.entries) })
      : nonAvailableRead(assertions);
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
    const sources = yield* input.reader.readSources(origin.value.owner);
    if (sources.state !== "available") return nonAvailableRead(sources);
    const projection = projectSourcesAttachment(sources.value, sources.blobs);
    if (Either.isLeft(projection)) return Object.freeze({ state: "projection-invalid" as const });
    return Object.freeze({
      state: "available" as const,
      value: Object.freeze(projection.right.items.map((item) => Object.freeze({
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
