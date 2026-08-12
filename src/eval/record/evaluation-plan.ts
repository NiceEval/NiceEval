import {
  defineRecordAttachmentProjector,
  type RecordAttachmentProjector,
} from "../../projection/projector.ts";
import type { SlotId } from "../../record/model/identifiers.ts";
import {
  evaluationsAttachmentFamily,
  type ExperimentId,
} from "../experiment-id.ts";
import type { EvaluationKind } from "./evaluation.ts";

/** The semantic evaluation coordinates assigned to one Run denominator Slot. */
export interface EvaluationPlanCoordinate {
  readonly experimentId: ExperimentId;
  readonly evalId: string;
  readonly attempt: number;
  readonly kind: EvaluationKind;
}

/** A Run-local lookup over the evaluation plan without exposing its durable shape. */
export interface EvaluationPlanView {
  readonly coordinateForSlot: (
    slotId: SlotId,
  ) => EvaluationPlanCoordinate | undefined;
}

/** The public semantic projection for the Run-owned evaluation plan. */
export const evaluationPlanProjector: RecordAttachmentProjector<
  "run",
  EvaluationPlanView
> = defineRecordAttachmentProjector({
  attachment: evaluationsAttachmentFamily,
  project: (value): EvaluationPlanView => {
    const coordinatesBySlot = new Map<SlotId, EvaluationPlanCoordinate>();
    for (const evaluation of value.payload.evaluations) {
      for (const slot of evaluation.slots) {
        coordinatesBySlot.set(
          slot.slotId,
          Object.freeze({
            experimentId: value.payload.experimentId,
            evalId: evaluation.evalId,
            attempt: slot.attempt,
            kind: evaluation.evaluationKind,
          }),
        );
      }
    }

    return Object.freeze({
      coordinateForSlot: (slotId: SlotId) => coordinatesBySlot.get(slotId),
    });
  },
});
