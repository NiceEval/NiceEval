import { defineRecordAttachment, RecordOwner } from "../../attachment/index.ts";
import { ExperimentPresentationAttachmentSchema, validateExperimentPresentationAttachment } from "./schema.ts";

export * from "./schema.ts";

/** `niceeval.experiment-presentation/v1`: the display value a Run was created with. */
export const experimentPresentationRecordAttachment = defineRecordAttachment({
  owner: RecordOwner.run,
  family: "niceeval.experiment-presentation",
  schema: ExperimentPresentationAttachmentSchema,
  validate: validateExperimentPresentationAttachment,
});
