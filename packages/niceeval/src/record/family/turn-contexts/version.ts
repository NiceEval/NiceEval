import { recordAttachmentVersion } from "../../attachment/index.ts";
import { FixedAttachmentValueLimits } from "../common.ts";
import { NoBlobSourceReceiptBudget } from "../source-receipt/index.ts";
import {
  TurnContextsAttachmentSchema,
  type TurnContextsAttachment,
} from "./schema.ts";

function sourceReferences(value: TurnContextsAttachment) {
  return value.segments.some((segment) => segment.source.state === "mapped")
    ? Object.freeze([{ owner: "run" as const, family: "niceeval.sources" }])
    : Object.freeze([]);
}

export const turnContextsV1 = recordAttachmentVersion({
  version: 1,
  schema: TurnContextsAttachmentSchema,
  invariants: () => Object.freeze([]),
  contents: {
    select: () => Object.freeze([]),
    valueLimits: FixedAttachmentValueLimits,
    budget: NoBlobSourceReceiptBudget,
  },
  references: {
    select: sourceReferences,
    maximumReferences: 1,
  },
});
