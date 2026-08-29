import { Schema } from "effect";

import { recordAttachmentIssue, type RecordAttachmentIssue } from "../../attachment/index.ts";
import { NonNegativeSafeIntegerSchema, SafeTextSchema } from "../common.ts";

const USD = Schema.Number.pipe(Schema.check(Schema.makeFilter(
  (value) => Number.isFinite(value) && value >= 0,
  { identifier: "AttemptCostUSD", description: "a finite non-negative USD amount" },
)));

const ObservedCostFactSchema = Schema.Struct({
  kind: Schema.Literal("observed"),
  amountUSD: USD,
});

const PricingChargeSchema = Schema.Struct({
  bucket: Schema.Literals(["input", "output", "cache-read", "cache-write"]),
  tokens: NonNegativeSafeIntegerSchema,
  rateUSDPerMTok: USD,
  amountUSD: USD,
});

const EstimatedCostFactSchema = Schema.Struct({
  kind: Schema.Literal("estimated"),
  amountUSD: USD,
  model: SafeTextSchema,
  priceSource: Schema.Union([
    Schema.Struct({ kind: Schema.Literal("configured-override"), selector: SafeTextSchema }),
    Schema.Struct({ kind: Schema.Literal("builtin"), selector: SafeTextSchema }),
  ]),
  charges: Schema.Array(PricingChargeSchema),
});

/** Raw Attempt-owned cost facts; comparison selection is intentionally absent. */
export const AttemptCostAttachmentSchema = Schema.Struct({
  observed: Schema.optional(ObservedCostFactSchema),
  estimated: Schema.optional(EstimatedCostFactSchema),
});

export type AttemptCostAttachment = Schema.Schema.Type<typeof AttemptCostAttachmentSchema>;

export function validateAttemptCostAttachment(
  value: AttemptCostAttachment,
): readonly RecordAttachmentIssue[] {
  return value.estimated === undefined || value.estimated.charges.length > 0
    ? Object.freeze([])
    : Object.freeze([recordAttachmentIssue("record-attachment-schema-invalid", ["estimated", "charges"])]);
}
