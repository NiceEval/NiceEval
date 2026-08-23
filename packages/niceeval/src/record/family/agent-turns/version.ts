import { recordAttachmentVersion } from "../../attachment/index.ts";
import { FixedAttachmentValueLimits } from "../common.ts";
import { NoBlobSourceReceiptBudget } from "../source-receipt/index.ts";
import { AgentTurnsAttachmentSchema } from "./schema.ts";

export const agentTurnsV1 = recordAttachmentVersion({
  version: 1,
  schema: AgentTurnsAttachmentSchema,
  invariants: () => Object.freeze([]),
  contents: {
    select: () => Object.freeze([]),
    valueLimits: FixedAttachmentValueLimits,
    budget: NoBlobSourceReceiptBudget,
  },
  references: {
    select: () => Object.freeze([]),
    maximumReferences: 0,
  },
});
