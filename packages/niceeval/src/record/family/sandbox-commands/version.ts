import { recordAttachmentVersion } from "../../attachment/index.ts";
import { withRecordAttachmentMaterializedRefine } from "../../attachment/internal.ts";
import { FixedAttachmentValueLimits } from "../common.ts";
import {
  SandboxCommandsAttachmentSchema,
  SandboxCommandsBlobBudget,
  sandboxCommandBlobRefs,
  sandboxCommandsIntegrityIssues,
} from "./schema.ts";

export const sandboxCommandsV1 = withRecordAttachmentMaterializedRefine(
  recordAttachmentVersion({
    version: 1,
    schema: SandboxCommandsAttachmentSchema,
    invariants: () => Object.freeze([]),
    contents: {
      select: sandboxCommandBlobRefs,
      valueLimits: FixedAttachmentValueLimits,
      budget: SandboxCommandsBlobBudget,
    },
    references: {
      select: () => Object.freeze([]),
      maximumReferences: 0,
    },
  }),
  sandboxCommandsIntegrityIssues,
);
