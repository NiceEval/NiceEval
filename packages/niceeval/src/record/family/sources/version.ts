import { recordAttachmentVersion } from "../../attachment/index.ts";
import { withRecordAttachmentMaterializedRefine } from "../../attachment/internal.ts";
import { FixedAttachmentValueLimits } from "../common.ts";
import {
  SourcesAttachmentSchema,
  SourcesBlobBudget,
  sourcesAttachmentIntegrityIssues,
  sourcesBlobRefs,
} from "./schema.ts";

export const sourcesV1 = withRecordAttachmentMaterializedRefine(
  recordAttachmentVersion({
    version: 1,
    schema: SourcesAttachmentSchema,
    invariants: () => Object.freeze([]),
    contents: {
      select: sourcesBlobRefs,
      valueLimits: FixedAttachmentValueLimits,
      budget: SourcesBlobBudget,
    },
    references: {
      select: () => Object.freeze([]),
      maximumReferences: 0,
    },
  }),
  sourcesAttachmentIntegrityIssues,
);
