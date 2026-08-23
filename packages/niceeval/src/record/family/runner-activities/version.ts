import { recordAttachmentVersion } from "../../attachment/index.ts";
import { FixedAttachmentValueLimits } from "../common.ts";
import { NoBlobSourceReceiptBudget } from "../source-receipt/index.ts";
import {
  AttemptRunnerActivitiesAttachmentSchema,
  RunRunnerActivitiesAttachmentSchema,
} from "./schema.ts";

const noContents = {
  select: () => Object.freeze([]),
  valueLimits: FixedAttachmentValueLimits,
  budget: NoBlobSourceReceiptBudget,
} as const;

const noReferences = {
  select: () => Object.freeze([]),
  maximumReferences: 0,
} as const;

export const attemptRunnerActivitiesV1 = recordAttachmentVersion({
  version: 1,
  schema: AttemptRunnerActivitiesAttachmentSchema,
  invariants: () => Object.freeze([]),
  contents: noContents,
  references: noReferences,
});

export const runRunnerActivitiesV1 = recordAttachmentVersion({
  version: 1,
  schema: RunRunnerActivitiesAttachmentSchema,
  invariants: () => Object.freeze([]),
  contents: noContents,
  references: noReferences,
});
