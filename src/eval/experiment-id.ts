import { Schema } from "effect";

/**
 * A current Experiment identity used by Analysis selection. Its text is
 * portable across Record snapshots, while the Record Attachment that carries
 * it remains an implementation detail of the Evaluation producer.
 */
export const ExperimentIdSchema = Schema.String.pipe(
  Schema.filter(
    (value) => value.length > 0 && !value.includes("\u0000"),
    {
      identifier: "ExperimentId",
      description: "a non-empty Experiment identity string without NUL",
    },
  ),
);

export type ExperimentId = Schema.Schema.Type<typeof ExperimentIdSchema>;

/** @internal Current Evaluation producer bridge for Analysis selection. */
export {
  EVALUATIONS_ATTACHMENT_NAME_V1 as evaluationsAttachmentName,
  evaluationsAttachmentFamilyV1 as evaluationsAttachmentFamily,
} from "./record/evaluation.ts";
