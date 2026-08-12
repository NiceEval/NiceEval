import { Effect } from "effect";

import { attemptDiagnosticsProjector, type AttemptDiagnosticsView } from "../o11y/record/family-projectors.ts";
import type { AttemptDiagnosticV1 } from "../o11y/record/families.ts";
import {
  projectRecordAttachmentRead,
  type ProjectedRecordAttachmentResult,
} from "../projection/attachment-result.ts";
import {
  withRecordAttachmentProjector,
  type RecordAttachmentProjector,
} from "../projection/projector.ts";
import type { RecordReaderReadError } from "../record/reader/errors.ts";
import type {
  FrozenRecordAttempt,
  FrozenRecordView,
} from "../record/reader/types.ts";
import { scoreProjector, type Score } from "../eval/record/score.ts";
import { verdictProjector } from "../eval/record/verdict.ts";
import type { Verdict } from "../shared/types.ts";
import type {
  ExecutionReusePlan,
  ReusePlanSlot,
} from "./reuse-plan.ts";

/**
 * A carry is a current projection of a frozen source Attempt, not a recreated
 * legacy EvalResult. The source handle stays exact so callers can make any
 * further current Record reads while the originating scope remains open.
 */
export interface CurrentReusedAttemptReadback {
  readonly state: "reused";
  readonly target: CurrentReusedAttemptTarget;
  readonly source: CurrentReusedAttemptSource;
  readonly verdict: ProjectedRecordAttachmentResult<Verdict>;
  readonly score: CurrentReusedAttemptScore;
  readonly executionErrors: ProjectedRecordAttachmentResult<
    readonly CurrentReusedExecutionError[]
  >;
}

/** The target identity needed by runtime and dry output, without old result fields. */
export interface CurrentReusedAttemptTarget {
  readonly runId: ReusePlanSlot["runId"];
  readonly slotId: ReusePlanSlot["slotId"];
  readonly experimentId: ReusePlanSlot["experimentId"];
  readonly evalId: ReusePlanSlot["evalId"];
  readonly attempt: ReusePlanSlot["attempt"];
}

/** The original Attempt is retained as the only authority for carried facts. */
export interface CurrentReusedAttemptSource {
  readonly attempt: FrozenRecordAttempt;
  readonly origin: ReusePlanSlot["origin"];
  readonly sourceBarrier: ReusePlanSlot["sourceBarrier"];
  readonly evaluationKind: ReusePlanSlot["sourceEvaluationKind"];
}

/** Score exists only for a Score Eval; an absent Score is not an invented zero. */
export type CurrentReusedAttemptScore =
  | { readonly state: "not-applicable" }
  | {
      readonly state: "applicable";
      readonly attachment: ProjectedRecordAttachmentResult<Score>;
    };

/** The display-safe execution-error subset of the durable diagnostics fact. */
export interface CurrentReusedExecutionError {
  readonly kind: "execution-error";
  readonly code: AttemptDiagnosticV1["code"];
  readonly phase: AttemptDiagnosticV1["phase"];
  readonly summary: AttemptDiagnosticV1["summary"];
  readonly causes: AttemptDiagnosticV1["causes"];
}

/** A forged or internally inconsistent reuse plan must never produce a carry. */
export interface CurrentReuseReadbackPlanInvalid {
  readonly code: "current-reuse-readback-plan-invalid";
  readonly reason:
    | "source-attempt-id-mismatch"
    | "source-origin-run-mismatch"
    | "source-evaluation-kind-invalid";
}

/**
 * Reads one typed Attachment from the current frozen view and preserves every
 * durable read state. This never opens a path or reaches into retired Record
 * graph/evidence data.
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

/**
 * Resolves one carried slot from its exact source Attempt. The source was
 * selected by `project-target/v1`; this capability only projects its durable
 * facts for later runtime and dry consumers.
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
    const invalid = validateReuseReadbackSlot(input.slot);
    if (invalid !== undefined) return Effect.fail(invalid);

    return Effect.gen(function* () {
      const verdict = yield* readFrozenAttemptAttachmentProjection({
        view: input.view,
        attempt: input.slot.sourceAttempt,
        projector: verdictProjector,
      });
      const diagnostics = yield* readFrozenAttemptAttachmentProjection({
        view: input.view,
        attempt: input.slot.sourceAttempt,
        projector: attemptDiagnosticsProjector,
      });
      const score = input.slot.sourceEvaluationKind === "score"
        ? Object.freeze({
            state: "applicable" as const,
            attachment: yield* readFrozenAttemptAttachmentProjection({
              view: input.view,
              attempt: input.slot.sourceAttempt,
              projector: scoreProjector,
            }),
          })
        : Object.freeze({ state: "not-applicable" as const });

      return Object.freeze({
        state: "reused" as const,
        target: Object.freeze({
          runId: input.slot.runId,
          slotId: input.slot.slotId,
          experimentId: input.slot.experimentId,
          evalId: input.slot.evalId,
          attempt: input.slot.attempt,
        }),
        source: Object.freeze({
          attempt: input.slot.sourceAttempt,
          origin: input.slot.origin,
          sourceBarrier: input.slot.sourceBarrier,
          evaluationKind: input.slot.sourceEvaluationKind,
        }),
        verdict,
        score,
        executionErrors: mapProjectedAttachment(diagnostics, executionErrorsOf),
      });
    });
  });
}

/**
 * Resolves every carried slot in the planner's stable target order. Keeping
 * the reads serial avoids unbounded Attachment I/O while retaining the plan's
 * deterministic order for CLI and runner consumers.
 */
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

function validateReuseReadbackSlot(
  slot: ReusePlanSlot,
): CurrentReuseReadbackPlanInvalid | undefined {
  if (slot.sourceAttempt.attemptId !== slot.attemptId) {
    return readbackPlanInvalid("source-attempt-id-mismatch");
  }
  if (slot.sourceAttempt.originRunId !== slot.origin.runId) {
    return readbackPlanInvalid("source-origin-run-mismatch");
  }
  if (slot.sourceEvaluationKind !== "pass" && slot.sourceEvaluationKind !== "score") {
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
      causes: diagnostic.causes,
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
