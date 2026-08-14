import type { SlotId } from "../../record/model/identifiers.ts";
import {
  projectEvaluationsPayloadV1,
  type EvaluationSlotProjectionV1,
  type EvaluationsPayloadIssueV1,
  type EvaluationsPayloadV1,
  validateEvaluationsPayloadV1,
} from "./evaluation.ts";
import {
  type ScoreCoherenceIssueV1,
  type ScorePayloadV1,
  validateScoreCoherenceV1,
} from "./score.ts";
import type { EvaluationAttemptFactsV1 } from "./sealed-assertion.ts";
import {
  type VerdictCoherenceIssueV1,
  type VerdictPayloadV1,
  validateVerdictCoherenceV1,
} from "./verdict.ts";

/** One origin Attempt's facts before Record's generic writer owns the writes. */
export interface EvaluationRecordAttemptV1 {
  readonly slotId: SlotId;
  readonly facts: EvaluationAttemptFactsV1;
  readonly verdict: VerdictPayloadV1;
  readonly score?: ScorePayloadV1;
}

/**
 * The domain aggregate validated before the generic Record writer checks only
 * owner, exact schemas, references, and owner-local blob closure.
 */
export interface EvaluationRecordCoherenceInputV1 {
  readonly expectedSlots: readonly SlotId[];
  readonly evaluations: EvaluationsPayloadV1;
  readonly attempts: readonly EvaluationRecordAttemptV1[];
}

export type EvaluationRecordCoherenceIssueV1 =
  | {
      readonly code: "evaluation-record-expected-slot-duplicate";
      readonly slotId: SlotId;
    }
  | {
      readonly code: "evaluation-record-evaluation-slot-missing";
      readonly slotId: SlotId;
    }
  | {
      readonly code: "evaluation-record-evaluation-slot-unexpected";
      readonly slotId: SlotId;
    }
  | {
      readonly code: "evaluation-record-attempt-slot-duplicate";
      readonly slotId: SlotId;
    }
  | {
      readonly code: "evaluation-record-attempt-slot-unexpected";
      readonly slotId: SlotId;
    }
  | {
      readonly code: "evaluation-record-score-missing";
      readonly slotId: SlotId;
    }
  | {
      readonly code: "evaluation-record-score-unexpected";
      readonly slotId: SlotId;
    }
  | {
      readonly code: "evaluation-record-evaluations-invalid";
      readonly issue: EvaluationsPayloadIssueV1;
    }
  | {
      readonly code: "evaluation-record-verdict-invalid";
      readonly slotId: SlotId;
      readonly issue: VerdictCoherenceIssueV1;
    }
  | {
      readonly code: "evaluation-record-score-invalid";
      readonly slotId: SlotId;
      readonly issue: ScoreCoherenceIssueV1;
    };

function evaluationBySlot(
  evaluations: EvaluationsPayloadV1,
): ReadonlyMap<string, EvaluationSlotProjectionV1> {
  const projection = projectEvaluationsPayloadV1(evaluations);
  const bySlot = new Map<string, EvaluationSlotProjectionV1>();
  for (const definition of evaluations.evaluations) {
    for (const slot of definition.slots) {
      const entry = projection.evaluationForSlot(slot.slotId);
      if (entry !== undefined) bySlot.set(slot.slotId, entry);
    }
  }
  return bySlot;
}

/**
 * Verifies cross-Attachment facts owned by the Evaluation producer: denominator
 * coverage, type-specific Score presence, and two independent folds from the
 * same sealed Assertion facts. Missing outcomes remain legal—those Slots have
 * no Member in the published Run.
 */
export function validateEvaluationRecordCoherenceV1(
  input: EvaluationRecordCoherenceInputV1,
): readonly EvaluationRecordCoherenceIssueV1[] {
  const issues: EvaluationRecordCoherenceIssueV1[] = [];
  const expectedSlots = new Set<string>();

  for (const slotId of input.expectedSlots) {
    if (expectedSlots.has(slotId)) {
      issues.push(
        Object.freeze({
          code: "evaluation-record-expected-slot-duplicate" as const,
          slotId,
        }),
      );
    }
    expectedSlots.add(slotId);
  }

  for (const issue of validateEvaluationsPayloadV1(input.evaluations)) {
    issues.push(
      Object.freeze({
        code: "evaluation-record-evaluations-invalid" as const,
        issue,
      }),
    );
  }

  const bySlot = evaluationBySlot(input.evaluations);
  for (const slotId of input.expectedSlots) {
    if (!bySlot.has(slotId)) {
      issues.push(
        Object.freeze({
          code: "evaluation-record-evaluation-slot-missing" as const,
          slotId,
        }),
      );
    }
  }
  for (const definition of input.evaluations.evaluations) {
    for (const slot of definition.slots) {
      if (!expectedSlots.has(slot.slotId)) {
        issues.push(
          Object.freeze({
            code: "evaluation-record-evaluation-slot-unexpected" as const,
            slotId: slot.slotId,
          }),
        );
      }
    }
  }

  const attemptedSlots = new Set<string>();
  for (const attempt of input.attempts) {
    if (attemptedSlots.has(attempt.slotId)) {
      issues.push(
        Object.freeze({
          code: "evaluation-record-attempt-slot-duplicate" as const,
          slotId: attempt.slotId,
        }),
      );
    }
    attemptedSlots.add(attempt.slotId);

    const evaluation = bySlot.get(attempt.slotId);
    if (evaluation === undefined || !expectedSlots.has(attempt.slotId)) {
      issues.push(
        Object.freeze({
          code: "evaluation-record-attempt-slot-unexpected" as const,
          slotId: attempt.slotId,
        }),
      );
      continue;
    }

    for (const issue of validateVerdictCoherenceV1({
      payload: attempt.verdict,
      fold: attempt.facts,
    })) {
      issues.push(
        Object.freeze({
          code: "evaluation-record-verdict-invalid" as const,
          slotId: attempt.slotId,
          issue,
        }),
      );
    }

    if (evaluation.evaluationKind === "pass") {
      if (attempt.score !== undefined) {
        issues.push(
          Object.freeze({
            code: "evaluation-record-score-unexpected" as const,
            slotId: attempt.slotId,
          }),
        );
      }
      continue;
    }

    if (attempt.score === undefined) {
      issues.push(
        Object.freeze({
          code: "evaluation-record-score-missing" as const,
          slotId: attempt.slotId,
        }),
      );
      continue;
    }

    for (const issue of validateScoreCoherenceV1({
      payload: attempt.score,
      fold: attempt.facts,
    })) {
      issues.push(
        Object.freeze({
          code: "evaluation-record-score-invalid" as const,
          slotId: attempt.slotId,
          issue,
        }),
      );
    }
  }

  return Object.freeze(issues);
}
