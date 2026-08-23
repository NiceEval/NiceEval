import { recordAttachmentVersion } from "../../attachment/index.ts";
import { withRecordAttachmentMaterializedRefine } from "../../attachment/internal.ts";
import { FixedAttachmentValueLimits } from "../common.ts";
import {
  ArtifactsAttachmentSchema,
  ArtifactsBlobBudget,
  artifactBlobRefs,
  artifactsAttachmentIntegrityIssues,
} from "./schema.ts";

function artifactsVersion() {
  return withRecordAttachmentMaterializedRefine(
    recordAttachmentVersion({
      version: 1,
      schema: ArtifactsAttachmentSchema,
      invariants: () => Object.freeze([]),
      contents: {
        select: artifactBlobRefs,
        valueLimits: FixedAttachmentValueLimits,
        budget: ArtifactsBlobBudget,
      },
      references: {
        select: () => Object.freeze([]),
        maximumReferences: 0,
      },
    }),
    artifactsAttachmentIntegrityIssues,
  );
}

export const attemptArtifactsV1 = artifactsVersion();
export const runArtifactsV1 = artifactsVersion();
