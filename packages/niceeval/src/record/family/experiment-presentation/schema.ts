import * as Schema from "effect/Schema";
import { Result } from "effect";
import { ExperimentIdSchema } from "../../codec/identifiers.ts";
import { recordAttachmentIssue, type RecordAttachmentIssue } from "../../attachment/index.ts";
import { experimentDisplayName } from "../../../experiment/presentation.ts";

/** Run-owned display snapshot; `experimentId` only cross-checks the Run Core and never forms identity. */
export const ExperimentPresentationAttachmentSchema = Schema.Struct({
  experimentId: ExperimentIdSchema,
  displayName: Schema.String,
});
export type ExperimentPresentationAttachment = Schema.Schema.Type<typeof ExperimentPresentationAttachmentSchema>;

/**
 * A recorded displayName is either a valid explicit name or the full Experiment ID fallback;
 * any other value would forge a name the definition never produced.
 */
export function validateExperimentPresentationAttachment(
  value: ExperimentPresentationAttachment,
): readonly RecordAttachmentIssue[] {
  if (value.displayName === value.experimentId) return [];
  return Result.isSuccess(experimentDisplayName(value.displayName))
    ? []
    : [recordAttachmentIssue("record-attachment-schema-invalid", ["displayName"])];
}
