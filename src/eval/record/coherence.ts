import type { SlotId } from "../../record/model/identifiers.ts";
import {
  projectEvaluationsPayload,
  type EvaluationSlotProjection,
  type EvaluationsPayloadIssue,
  type EvaluationsPayload,
  validateEvaluationsPayload,
} from "./evaluation.ts";
import {
  type ScoreCoherenceIssue,
  type ScorePayload,
  validateScoreCoherence,
} from "./score.ts";
import type { EvaluationAttemptFacts } from "./sealed-assertion.ts";
import {
  type VerdictCoherenceIssue,
  type VerdictPayload,
  validateVerdictCoherence,
} from "./verdict.ts";

/** One origin Attempt's facts before Record's generic writer owns the writes. */
export interface EvaluationRecordAttempt {
  readonly slotId: SlotId;
  readonly facts: EvaluationAttemptFacts;
  readonly verdict: VerdictPayload;
  readonly score?: ScorePayload;
}

/**
 * The domain aggregate validated before the generic Record writer checks only
 * owner, exact schemas, references, and owner-local blob closure.
 */
export interface EvaluationRecordCoherenceInput {
  readonly expectedSlots: readonly SlotId[];
  readonly evaluations: EvaluationsPayload;
  readonly attempts: readonly EvaluationRecordAttempt[];
}

export type EvaluationRecordCoherenceIssue =
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
      readonly issue: EvaluationsPayloadIssue;
    }
  | {
      readonly code: "evaluation-record-verdict-invalid";
      readonly slotId: SlotId;
      readonly issue: VerdictCoherenceIssue;
    }
  | {
      readonly code: "evaluation-record-score-invalid";
      readonly slotId: SlotId;
      readonly issue: ScoreCoherenceIssue;
    };

function evaluationBySlot(
  evaluations: EvaluationsPayload,
): ReadonlyMap<string, EvaluationSlotProjection> {
  const projection = projectEvaluationsPayload(evaluations);
  const bySlot = new Map<string, EvaluationSlotProjection>();
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
export function validateEvaluationRecordCoherence(
  input: EvaluationRecordCoherenceInput,
): readonly EvaluationRecordCoherenceIssue[] {
  const issues: EvaluationRecordCoherenceIssue[] = [];
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

  for (const issue of validateEvaluationsPayload(input.evaluations)) {
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

    for (const issue of validateVerdictCoherence({
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

    for (const issue of validateScoreCoherence({
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
