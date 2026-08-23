import { recordAttachmentVersion } from "../../attachment/index.ts";
import { withRecordAttachmentMaterializedRefine } from "../../attachment/internal.ts";
import { FixedAttachmentValueLimits } from "../common.ts";
import {
  AssertionsAttachmentSchema,
  AssertionsAttachmentV1Schema,
  AssertionsBlobBudget,
  assertionsAttachmentIntegrityIssues,
  assertionsBlobRefs,
  assertionsV1AttachmentIntegrityIssues,
  assertionsV1BlobRefs,
  type AssertionsAttachment,
  type AssertionsAttachmentV1,
} from "./schema.ts";

function sourceReferences(
  value: AssertionsAttachment | AssertionsAttachmentV1,
) {
  return value.sourceSites.length > 0
    ? Object.freeze([{ owner: "run" as const, family: "niceeval.sources" }])
    : Object.freeze([]);
}

const references = {
  select: sourceReferences,
  maximumReferences: 1,
} as const;

export const assertionsV1 = withRecordAttachmentMaterializedRefine(
  recordAttachmentVersion({
    version: 1,
    schema: AssertionsAttachmentV1Schema,
    invariants: () => Object.freeze([]),
    contents: {
      select: assertionsV1BlobRefs,
      valueLimits: FixedAttachmentValueLimits,
      budget: AssertionsBlobBudget,
    },
    references,
  }),
  assertionsV1AttachmentIntegrityIssues,
);

export const assertionsV2 = withRecordAttachmentMaterializedRefine(
  recordAttachmentVersion({
    version: 2,
    schema: AssertionsAttachmentSchema,
    invariants: () => Object.freeze([]),
    contents: {
      select: assertionsBlobRefs,
      valueLimits: FixedAttachmentValueLimits,
      budget: AssertionsBlobBudget,
    },
    references,
  }),
  assertionsAttachmentIntegrityIssues,
);
