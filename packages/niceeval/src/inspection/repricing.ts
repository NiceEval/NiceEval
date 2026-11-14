// @concord-file
// @concord-implements docs/feature/inspection/architecture.md#historical-repricing
import * as Schema from "effect/Schema";
import { createAdapterCallPriceReceipts } from "../o11y/adapter-call-price.ts";
import { createJudgeCallPriceReceipts } from "../o11y/judge-call-price.ts";
import {
  AdapterCallPriceReceiptSchema,
  type ReadableAdapterUsageAttachment,
} from "../record/family/adapter-usage/schema.ts";
import { JudgePriceReceiptSchema, type JudgeUsageAttachment } from "../record/family/judge-usage/schema.ts";
import { addCanonicalDecimals, canonicalDecimalFromNumber } from "../record/family/adapter-usage/pricing.ts";
import { CanonicalDecimalSchema } from "../record/family/source-receipt/codec.ts";
import { isCanonicalDecimal } from "../record/family/source-receipt/model.ts";
import { NonNegativeSafeIntegerSchema, PositiveSafeIntegerSchema } from "../record/family/common.ts";

const Identity = Schema.String.check(
  Schema.makeFilter(
    (value) => value.trim().length > 0 && Buffer.byteLength(value) <= 256 && !/[\u0000-\u001f\u007f]/u.test(value),
  ),
);
const Rate = Schema.Number.check(
  Schema.makeFilter((value) => {
    const decimal = canonicalDecimalFromNumber(value);
    return decimal !== undefined && isCanonicalDecimal(decimal);
  }),
);
export const InspectionRepricingInputSchema = Schema.Record(
  Schema.String,
  Schema.Struct({
    inputPerMTok: Rate,
    outputPerMTok: Rate,
    cacheReadPerMTok: Schema.optional(Rate),
    cacheWritePerMTok: Schema.optional(Rate),
    source: Schema.Struct({ id: Identity, asOf: Schema.optional(PositiveSafeIntegerSchema) }),
  }),
).check(
  Schema.makeFilter((value) => {
    const keys = Object.keys(value);
    return (
      keys.length > 0 &&
      keys.length <= 256 &&
      keys.every(
        (key) => key.trim().length > 0 && Buffer.byteLength(key) <= 8_192 && !/[\u0000-\u001f\u007f]/u.test(key),
      )
    );
  }),
);
export type InspectionRepricingInput = Schema.Schema.Type<typeof InspectionRepricingInputSchema>;

const Money = Schema.Struct({
  state: Schema.Literals(["complete", "partial", "unavailable"]),
  currency: Schema.Literal("USD"),
  amount: Schema.NullOr(CanonicalDecimalSchema),
});
const Source = Money.pipe(
  Schema.fieldsAssign({
    collection: Schema.Literals(["complete", "partial", "unavailable", "invalid"]),
    callCount: Schema.NullOr(NonNegativeSafeIntegerSchema),
    estimates: Schema.Array(Schema.Union([AdapterCallPriceReceiptSchema, JudgePriceReceiptSchema])),
    missingCallIds: Schema.Array(Schema.String),
  }),
);
export const InspectionRepricingResultSchema = Schema.Struct({
  application: Source,
  judge: Source,
  total: Money,
});
export type InspectionRepricingResult = Schema.Schema.Type<typeof InspectionRepricingResultSchema>;
type RepricedSource = InspectionRepricingResult["application"];
const decimal = Schema.decodeUnknownSync(CanonicalDecimalSchema);

function summarize(
  calls: readonly { readonly callId: string }[] | undefined,
  collection: RepricedSource["collection"],
  estimates: RepricedSource["estimates"],
): RepricedSource {
  const priced = new Set(estimates.map((estimate) => estimate.callId));
  const missingCallIds = calls?.filter((call) => !priced.has(call.callId)).map((call) => call.callId) ?? [];
  const complete =
    collection === "complete" &&
    calls !== undefined &&
    missingCallIds.length === 0 &&
    estimates.every((estimate) => estimate.state === "complete");
  const amount =
    estimates.length > 0 || complete
      ? decimal(addCanonicalDecimals(estimates.map((estimate) => estimate.amount)))
      : null;
  return Object.freeze({
    state: complete ? "complete" : amount === null ? "unavailable" : "partial",
    currency: "USD",
    amount,
    collection,
    callCount: calls?.length ?? null,
    estimates,
    missingCallIds,
  });
}

/** Hypothetical prices are projections; original reported amounts and receipts are never changed. */
export function repriceRecordedUsage(input: {
  readonly application: ReadableAdapterUsageAttachment | undefined;
  readonly applicationCollection: RepricedSource["collection"];
  readonly judge: JudgeUsageAttachment | undefined;
  readonly judgeCollection: RepricedSource["collection"];
  readonly pricing: InspectionRepricingInput;
}): InspectionRepricingResult {
  const application = summarize(
    input.application?.calls,
    input.applicationCollection,
    createAdapterCallPriceReceipts(
      input.application?.calls.map((call) => ({ ...call, cost: null })) ?? [],
      input.pricing,
    ),
  );
  const judge = summarize(
    input.judge?.calls,
    input.judgeCollection,
    createJudgeCallPriceReceipts(input.judge?.calls.map((call) => ({ ...call, cost: null })) ?? [], input.pricing),
  );
  const known = [application.amount, judge.amount].filter((amount) => amount !== null);
  return Object.freeze({
    application,
    judge,
    total: Object.freeze({
      state:
        application.state === "complete" && judge.state === "complete"
          ? "complete"
          : known.length > 0
            ? "partial"
            : "unavailable",
      currency: "USD",
      amount: known.length > 0 ? decimal(addCanonicalDecimals(known)) : null,
    }),
  });
}
