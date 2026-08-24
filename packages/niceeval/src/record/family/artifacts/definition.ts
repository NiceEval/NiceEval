import {
  defineRecordAttachment,
  RecordOwner,
} from "../../attachment/index.ts";
import {
  ArtifactsAttachmentSchema,
  validateArtifactsAttachment,
} from "./schema.ts";

/** Current Attempt-owned Artifacts fact; durable history is separate. */
export const attemptArtifactsRecordAttachment = defineRecordAttachment({
  owner: RecordOwner.attempt,
  family: "niceeval.artifacts",
  schema: ArtifactsAttachmentSchema,
  validate: validateArtifactsAttachment,
});

/** Current Run-owned Artifacts fact; it has the same logical value shape. */
export const runArtifactsRecordAttachment = defineRecordAttachment({
  owner: RecordOwner.run,
  family: "niceeval.artifacts",
  schema: ArtifactsAttachmentSchema,
  validate: validateArtifactsAttachment,
});
