import { recordAttachmentVersion } from "../../attachment/index.ts";
import { FixedAttachmentValueLimits } from "../common.ts";
import { NoBlobSourceReceiptBudget } from "../source-receipt/index.ts";
import {
  AttemptRunnerDiagnosticsAttachmentSchema,
  RunRunnerDiagnosticsAttachmentSchema,
  type RunnerDiagnosticsAttachment,
} from "./schema.ts";

function sourceReferences(value: RunnerDiagnosticsAttachment) {
  return value.segments.some((diagnostic) => diagnostic.sourceFrame !== null)
    ? Object.freeze([{ owner: "run" as const, family: "niceeval.sources" }])
    : Object.freeze([]);
}

const noContents = {
  select: () => Object.freeze([]),
  valueLimits: FixedAttachmentValueLimits,
  budget: NoBlobSourceReceiptBudget,
} as const;

const references = {
  select: sourceReferences,
  maximumReferences: 1,
} as const;

export const attemptRunnerDiagnosticsV1 = recordAttachmentVersion({
  version: 1,
  schema: AttemptRunnerDiagnosticsAttachmentSchema,
  invariants: () => Object.freeze([]),
  contents: noContents,
  references,
});

export const runRunnerDiagnosticsV1 = recordAttachmentVersion({
  version: 1,
  schema: RunRunnerDiagnosticsAttachmentSchema,
  invariants: () => Object.freeze([]),
  contents: noContents,
  references,
});
