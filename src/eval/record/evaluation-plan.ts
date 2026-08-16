import type { SlotId } from "../../record/model/identifiers.ts";
import {
  projectEvaluationsPayload,
  type EvaluationKind,
  type EvaluationsPayload,
} from "./evaluation.ts";

/** A transient lookup over the Eval plan; Core owns published Slot identities. */
export interface EvaluationPlanCoordinate {
  readonly slotId: SlotId;
  readonly evalId: string;
  readonly evaluationKind: EvaluationKind;
  readonly attempt: number;
}

export interface EvaluationPlanView {
  readonly coordinateForSlot: (slotId: SlotId) => EvaluationPlanCoordinate | undefined;
}

export function projectEvaluationPlan(
  payload: EvaluationsPayload,
): EvaluationPlanView {
  const projection = projectEvaluationsPayload(payload);
  return Object.freeze({
    coordinateForSlot: (slotId: SlotId) => {
      const value = projection.evaluationForSlot(slotId);
      return value === undefined
        ? undefined
        : Object.freeze({
            slotId: value.slotId,
            evalId: value.evalId,
            evaluationKind: value.evaluationKind,
            attempt: value.attempt,
          });
    },
  });
}
