import { recordAttachmentVersion } from "../../attachment/index.ts";
import { withRecordAttachmentMaterializedRefine } from "../../attachment/internal.ts";
import {
  FileChangesAttachmentSchema,
  FileChangesAttachmentValueLimits,
  FileChangesBlobBudget,
  fileChangesAttachmentIntegrityIssues,
  fileChangesBlobRefs,
} from "./schema.ts";

export const fileChangesV1 = withRecordAttachmentMaterializedRefine(
  recordAttachmentVersion({
    version: 1,
    schema: FileChangesAttachmentSchema,
    invariants: () => Object.freeze([]),
    contents: {
      select: fileChangesBlobRefs,
      valueLimits: FileChangesAttachmentValueLimits,
      budget: FileChangesBlobBudget,
    },
    references: {
      select: () => Object.freeze([]),
      maximumReferences: 0,
    },
  }),
  fileChangesAttachmentIntegrityIssues,
);
