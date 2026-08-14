import { Effect } from "effect";

import { encodeAttemptLocator } from "../attempt-locator.ts";
import { attemptDiagnosticsProjector, type AttemptDiagnosticsView } from "../o11y/record/family-projectors.ts";
import {
  projectRecordAttachmentRead,
  type ProjectedRecordAttachmentResult,
} from "../projection/attachment-result.ts";
import {
  withRecordAttachmentProjector,
  type RecordAttachmentProjector,
} from "../projection/projector.ts";
import type { RecordIssue } from "../record/errors/record-errors.ts";
import type { RecordReaderReadError } from "../record/reader/errors.ts";
import type {
  FrozenRecordAttempt,
  FrozenRecordRun,
  FrozenRecordView,
} from "../record/reader/types.ts";
import { scoreProjector, type Score } from "../eval/record/score.ts";
import { verdictProjector } from "../eval/record/verdict.ts";
import type { Verdict } from "../shared/types.ts";
import { sourcesProjector } from "../sources/projector.ts";
import type {
  ExecutionReusePlan,
  ExecutionReusePlanSource,
  ReusePlanSlot,
  TargetSlot,
} from "./reuse-plan.ts";

/**
 * A carry is a current projection of a frozen source Attempt, not a recreated
 * legacy EvalResult. The exact source capability stays scoped to the reader.
 */
export interface CurrentReusedAttemptReadback {
  readonly state: "reused";
  readonly target: CurrentReusedAttemptTarget;
  readonly source: CurrentReusedAttemptSource;
  /** Reuse is fail-closed unless the current Verdict is a reusable terminal fact. */
  readonly verdict: "passed" | "failed";
  readonly score: CurrentReusedAttemptScore;
  readonly executionErrors: ProjectedRecordAttachmentResult<
    readonly CurrentReusedExecutionError[]
  >;
}

/** A gap's observed current source. It explains dry output but never authorizes reuse. */
export interface CurrentReuseCandidateReadback {
  readonly state: "prior";
  readonly target: CurrentReusedAttemptTarget;
  readonly source: CurrentReusedAttemptSource;
  readonly verdict: ProjectedRecordAttachmentResult<Verdict>;
  readonly score: CurrentReusedAttemptScore;
  readonly executionErrors: ProjectedRecordAttachmentResult<
    readonly CurrentReusedExecutionError[]
  >;
  /** Origin Run's current Sources projection, retained only as a projection. */
  readonly sourceFiles: CurrentReuseSourceFiles;
}

export type CurrentReuseReadback =
  | CurrentReusedAttemptReadback
  | CurrentReuseCandidateReadback;

/** The target identity needed by runtime and dry output, without old result fields. */
export interface CurrentReusedAttemptTarget {
  readonly runId: TargetSlot["runId"];
  readonly slotId: TargetSlot["slotId"];
  readonly experimentId: TargetSlot["experimentId"];
  readonly evalId: TargetSlot["evalId"];
  readonly attempt: TargetSlot["attempt"];
}

/** The exact current source authority. It is never reconstructed from an id string. */
export interface CurrentReusedAttemptSource {
  readonly attempt: FrozenRecordAttempt;
  readonly attemptId: ExecutionReusePlanSource["attemptId"];
  readonly origin: ExecutionReusePlanSource["origin"];
  readonly sourceBarrier: ExecutionReusePlanSource["sourceBarrier"];
  readonly evaluationKind: ExecutionReusePlanSource["evaluationKind"];
}

/** Score exists only for a Score Eval; an absent Score is not an invented zero. */
export type CurrentReusedAttemptScore =
  | { readonly state: "not-applicable" }
  | {
      readonly state: "applicable";
      readonly attachment: ProjectedRecordAttachmentResult<Score>;
    };

/** Durable diagnostic facts normalized before entering the runner/readback ABI. */
export interface CurrentReusedExecutionCause {
  readonly code: string;
  readonly summary: string;
}

/** The display-safe execution-error subset of the current diagnostics projection. */
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

/** Source files retain every projection/read state instead of guessing historic inputs. */
export type CurrentReuseSourceFiles =
  | ProjectedRecordAttachmentResult<readonly CurrentReuseSourceFile[]>
  | { readonly state: "origin-run-missing" }
  | { readonly state: "origin-run-invalid"; readonly issues: readonly RecordIssue[] };

/** A forged or internally inconsistent plan/readback must never produce a carry. */
export interface CurrentReuseReadbackPlanInvalid {
  readonly code: "current-reuse-readback-plan-invalid";
  readonly reason:
    | "source-attempt-id-mismatch"
    | "source-origin-run-mismatch"
    | "source-evaluation-kind-invalid"
    | "source-verdict-unavailable"
    | "source-verdict-ineligible";
}

/**
 * A self-contained source identity suitable outside a FrozenRecordView Scope.
 * It deliberately omits the opaque Attempt capability.
 */
export interface CurrentReusedAttemptSourceSnapshot {
  readonly attemptId: string;
  readonly locator: string;
  readonly origin: {
    readonly runId: string;
    readonly slotId: string;
  };
  readonly sourceBarrier: {
    readonly runId: string;
    readonly startedAt: number;
  };
  readonly evaluationKind: CurrentReusedAttemptSource["evaluationKind"];
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
  readonly executionErrors: CurrentReuseCandidateReadback["executionErrors"];
  readonly sourceFiles: CurrentReuseSourceFiles;
}

export type CurrentReuseReadbackSnapshot =
  | CurrentReusedAttemptSnapshot
  | CurrentReuseCandidateSnapshot;

export interface CurrentReusedAttemptTargetSnapshot {
  readonly runId: string;
  readonly slotId: string;
  readonly experimentId: string;
  readonly evalId: string;
  readonly attempt: number;
}

/**
 * Reads one typed Attachment from the current frozen view and preserves every
 * durable read state. This never opens a path or reaches into retired graph/evidence data.
 */
export function readFrozenAttemptAttachmentProjection<Value>(input: {
  readonly view: FrozenRecordView<RecordReaderReadError>;
  readonly attempt: FrozenRecordAttempt;
  readonly projector: RecordAttachmentProjector<"attempt", Value>;
}): Effect.Effect<ProjectedRecordAttachmentResult<Value>, RecordReaderReadError> {
  return withRecordAttachmentProjector(input.projector, (family, project) =>
    input.view.readAttemptAttachment(input.attempt, family).pipe(
      Effect.flatMap((read) => projectRecordAttachmentRead(read, project)),
    ));
}

function readFrozenRunAttachmentProjection<Value>(input: {
  readonly view: FrozenRecordView<RecordReaderReadError>;
  readonly run: FrozenRecordRun;
  readonly projector: RecordAttachmentProjector<"run", Value>;
}): Effect.Effect<ProjectedRecordAttachmentResult<Value>, RecordReaderReadError> {
  return withRecordAttachmentProjector(input.projector, (family, project) =>
    input.view.readRunAttachment(input.run, family).pipe(
      Effect.flatMap((read) => projectRecordAttachmentRead(read, project)),
    ));
}

/**
 * Resolves one carried slot from its exact source Attempt. A current nonterminal
 * or unreadable Verdict is a typed failure, never a fake legacy result.
 */
export function readCurrentReusedAttempt(input: {
  readonly view: FrozenRecordView<RecordReaderReadError>;
  readonly slot: ReusePlanSlot;
}): Effect.Effect<
  CurrentReusedAttemptReadback,
  RecordReaderReadError | CurrentReuseReadbackPlanInvalid
> {
  return Effect.suspend<
    CurrentReusedAttemptReadback,
    RecordReaderReadError | CurrentReuseReadbackPlanInvalid,
    never
  >(() => {
    const invalid = validateReuseReadbackSource(input.slot.source);
    if (invalid !== undefined) return Effect.fail(invalid);

    return Effect.gen(function* () {
      const verdict = yield* readFrozenAttemptAttachmentProjection({
        view: input.view,
        attempt: input.slot.source.attempt,
        projector: verdictProjector,
      });
      if (verdict.state !== "available") {
        return yield* Effect.fail(readbackPlanInvalid("source-verdict-unavailable"));
      }
      if (verdict.value !== "passed" && verdict.value !== "failed") {
        return yield* Effect.fail(readbackPlanInvalid("source-verdict-ineligible"));
      }

      const details = yield* readCurrentAttemptDetails({
        view: input.view,
        source: input.slot.source,
      });
      return Object.freeze({
        state: "reused" as const,
        target: targetOf(input.slot),
        source: sourceOf(input.slot.source),
        verdict: verdict.value,
        score: details.score,
        executionErrors: details.executionErrors,
      });
    });
  });
}

/** Reads a policy-declined source for dry explanation without turning it into a carry. */
export function readCurrentReuseCandidate(input: {
  readonly view: FrozenRecordView<RecordReaderReadError>;
  readonly slot: Extract<ExecutionReusePlan["slots"][number], { readonly state: "gap" }>;
}): Effect.Effect<
  CurrentReuseCandidateReadback | undefined,
  RecordReaderReadError | CurrentReuseReadbackPlanInvalid
> {
  return Effect.suspend<
    CurrentReuseCandidateReadback | undefined,
    RecordReaderReadError | CurrentReuseReadbackPlanInvalid,
    never
  >(() => {
    const source = input.slot.candidate;
    if (source === undefined) return Effect.succeed(undefined);
    const invalid = validateReuseReadbackSource(source);
    if (invalid !== undefined) return Effect.fail(invalid);

    return Effect.gen(function* () {
      const verdict = yield* readFrozenAttemptAttachmentProjection({
        view: input.view,
        attempt: source.attempt,
        projector: verdictProjector,
      });
      const details = yield* readCurrentAttemptDetails({ view: input.view, source });
      const sourceFiles = yield* readCurrentReuseSourceFiles({ view: input.view, source });
      return Object.freeze({
        state: "prior" as const,
        target: targetOf(input.slot),
        source: sourceOf(source),
        verdict,
        score: details.score,
        executionErrors: details.executionErrors,
        sourceFiles,
      });
    });
  });
}

/**
 * Resolves all current readbacks in stable target order. This is for dry/readback
 * consumers; runtime carries use the narrower `readCurrentExecutionReusePlanResults`.
 */
export function readCurrentExecutionReusePlanReadbacks(input: {
  readonly view: FrozenRecordView<RecordReaderReadError>;
  readonly plan: ExecutionReusePlan;
}): Effect.Effect<
  readonly CurrentReuseReadback[],
  RecordReaderReadError | CurrentReuseReadbackPlanInvalid
> {
  return Effect.forEach(
    input.plan.slots,
    (slot): Effect.Effect<
      CurrentReuseReadback | undefined,
      RecordReaderReadError | CurrentReuseReadbackPlanInvalid
    > => slot.state === "reuse"
      ? readCurrentReusedAttempt({ view: input.view, slot }).pipe(
          Effect.map((readback): CurrentReuseReadback => readback),
        )
      : readCurrentReuseCandidate({ view: input.view, slot }).pipe(
          Effect.map((readback): CurrentReuseReadback | undefined => readback),
        ),
    { concurrency: 1 },
  ).pipe(
    Effect.map((readbacks): readonly CurrentReuseReadback[] =>
      Object.freeze(
        readbacks.flatMap((readback) => readback === undefined ? [] : [readback]),
      )),
  );
}

/** Resolves only scheduler-authorized carries in the planner's stable target order. */
export function readCurrentExecutionReusePlanResults(input: {
  readonly view: FrozenRecordView<RecordReaderReadError>;
  readonly plan: ExecutionReusePlan;
}): Effect.Effect<
  readonly CurrentReusedAttemptReadback[],
  RecordReaderReadError | CurrentReuseReadbackPlanInvalid
> {
  return Effect.forEach(
    input.plan.reuse,
    (slot) => readCurrentReusedAttempt({ view: input.view, slot }),
    { concurrency: 1 },
  ).pipe(Effect.map((results) => Object.freeze(results)));
}

/** Removes the scoped frozen capability before handing a current projection to a longer-lived consumer. */
export function projectCurrentReuseReadback(
  readback: CurrentReuseReadback,
): CurrentReuseReadbackSnapshot {
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

function readCurrentAttemptDetails(input: {
  readonly view: FrozenRecordView<RecordReaderReadError>;
  readonly source: ExecutionReusePlanSource;
}): Effect.Effect<
  {
    readonly score: CurrentReusedAttemptScore;
    readonly executionErrors: CurrentReusedAttemptReadback["executionErrors"];
  },
  RecordReaderReadError
> {
  return Effect.gen(function* () {
    const diagnostics = yield* readFrozenAttemptAttachmentProjection({
      view: input.view,
      attempt: input.source.attempt,
      projector: attemptDiagnosticsProjector,
    });
    const score = input.source.evaluationKind === "score"
      ? Object.freeze({
          state: "applicable" as const,
          attachment: yield* readFrozenAttemptAttachmentProjection({
            view: input.view,
            attempt: input.source.attempt,
            projector: scoreProjector,
          }),
        })
      : Object.freeze({ state: "not-applicable" as const });
    return Object.freeze({
      score,
      executionErrors: mapProjectedAttachment(diagnostics, executionErrorsOf),
    });
  });
}

function readCurrentReuseSourceFiles(input: {
  readonly view: FrozenRecordView<RecordReaderReadError>;
  readonly source: ExecutionReusePlanSource;
}): Effect.Effect<CurrentReuseSourceFiles, RecordReaderReadError> {
  return Effect.gen(function* () {
    const originRun = yield* input.view.run(input.source.origin.runId);
    switch (originRun.state) {
      case "missing":
        return Object.freeze({ state: "origin-run-missing" as const });
      case "core-invalid":
        return Object.freeze({
          state: "origin-run-invalid" as const,
          issues: Object.freeze([...originRun.issues]),
        });
      case "available": {
        const sources = yield* readFrozenRunAttachmentProjection({
          view: input.view,
          run: originRun.value,
          projector: sourcesProjector,
        });
        return mapProjectedAttachment(sources, (projection) => Object.freeze(
          projection.packages.flatMap((sourcePackage) => sourcePackage.files.map((file) => Object.freeze({
            path: file.path,
            sha256: file.ref.sha256,
          }))),
        ));
      }
    }
  });
}

function validateReuseReadbackSource(
  source: ExecutionReusePlanSource,
): CurrentReuseReadbackPlanInvalid | undefined {
  if (source.attempt.attemptId !== source.attemptId) {
    return readbackPlanInvalid("source-attempt-id-mismatch");
  }
  if (source.attempt.originRunId !== source.origin.runId) {
    return readbackPlanInvalid("source-origin-run-mismatch");
  }
  if (source.evaluationKind !== "pass" && source.evaluationKind !== "score") {
    return readbackPlanInvalid("source-evaluation-kind-invalid");
  }
  return undefined;
}

function readbackPlanInvalid(
  reason: CurrentReuseReadbackPlanInvalid["reason"],
): CurrentReuseReadbackPlanInvalid {
  return Object.freeze({
    code: "current-reuse-readback-plan-invalid" as const,
    reason,
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

function targetSnapshotOf(
  target: CurrentReusedAttemptTarget,
): CurrentReusedAttemptTargetSnapshot {
  return Object.freeze({
    runId: String(target.runId),
    slotId: String(target.slotId),
    experimentId: target.experimentId,
    evalId: target.evalId,
    attempt: target.attempt,
  });
}

function sourceSnapshotOf(
  source: CurrentReusedAttemptSource,
): CurrentReusedAttemptSourceSnapshot {
  return Object.freeze({
    attemptId: String(source.attemptId),
    locator: encodeAttemptLocator(source.attemptId),
    origin: Object.freeze({
      runId: String(source.origin.runId),
      slotId: String(source.origin.slotId),
    }),
    sourceBarrier: Object.freeze({
      runId: String(source.sourceBarrier.runId),
      startedAt: source.sourceBarrier.startedAt,
    }),
    evaluationKind: source.evaluationKind,
  });
}

function executionErrorsOf(
  diagnostics: AttemptDiagnosticsView,
): readonly CurrentReusedExecutionError[] {
  const errors: CurrentReusedExecutionError[] = [];
  for (const diagnostic of diagnostics.diagnostics) {
    if (diagnostic.kind !== "execution-error") continue;
    errors.push(Object.freeze({
      kind: "execution-error" as const,
      code: diagnostic.code,
      phase: diagnostic.phase,
      summary: diagnostic.summary,
      causes: Object.freeze(diagnostic.causes.map((cause) => Object.freeze({
        code: cause.code,
        summary: cause.summary,
      }))),
    }));
  }
  return Object.freeze(errors);
}

function mapProjectedAttachment<From, To>(
  attachment: ProjectedRecordAttachmentResult<From>,
  project: (value: From) => To,
): ProjectedRecordAttachmentResult<To> {
  switch (attachment.state) {
    case "available":
      return Object.freeze({
        state: "available" as const,
        value: project(attachment.value),
      });
    case "unavailable":
    case "migration-required":
    case "migration-unavailable":
    case "unsupported":
    case "invalid":
      return attachment;
  }
}
