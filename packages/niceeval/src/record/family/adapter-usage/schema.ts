import { Schema } from "effect";
import { recordAttachmentIssue, type RecordAttachmentIssue } from "../../attachment/index.ts";
import { CollectionStateSchema, NonNegativeSafeIntegerSchema } from "../common.ts";

const Identity = Schema.String.pipe(Schema.check(Schema.makeFilter(
  (value) => value.trim().length > 0 && new TextEncoder().encode(value).byteLength <= 256 && !/[\u0000-\u001f\u007f]/u.test(value),
)));
const Tokens = Schema.NullOr(NonNegativeSafeIntegerSchema);
export const AdapterUsageCallSchema = Schema.Struct({
  callId: Identity,
  retryOf: Schema.NullOr(Identity),
  provider: Schema.NullOr(Identity),
  model: Schema.NullOr(Identity),
  status: Schema.Literals(["succeeded", "failed", "cancelled", "unknown"]),
  inputTokens: Tokens,
  inputTotalTokens: Tokens,
  outputTokens: Tokens,
  cacheReadTokens: Tokens,
  cacheWriteTokens: Tokens,
});
export type AdapterUsageCall = Schema.Schema.Type<typeof AdapterUsageCallSchema>;
export const AdapterUsageLimits = Object.freeze({ maximumCalls: 4_000 });
export const AdapterUsageAttachmentSchema = Schema.Struct({
  /** Completeness of accepted snapshots, never proof that all external calls were reported. */
  collection: CollectionStateSchema,
  calls: Schema.Array(AdapterUsageCallSchema),
});
export type AdapterUsageAttachment = Schema.Schema.Type<typeof AdapterUsageAttachmentSchema>;
export function validateAdapterUsageAttachment(value: AdapterUsageAttachment): readonly RecordAttachmentIssue[] {
  const seen = new Set<string>();
  for (const call of value.calls) {
    const buckets = [call.inputTokens, call.cacheReadTokens, call.cacheWriteTokens];
    const known = buckets.filter((value): value is number => value !== null);
    const sum = known.reduce((total, value) => total + value, 0);
    if (!Number.isSafeInteger(sum) || (call.inputTotalTokens !== null &&
      (sum > call.inputTotalTokens || (known.length === 3 && sum !== call.inputTotalTokens)))) {
      return [recordAttachmentIssue("record-attachment-schema-invalid", ["calls", "inputTotalTokens"])];
    }
    if (seen.has(call.callId) || (call.retryOf !== null && !seen.has(call.retryOf))) {
      return [recordAttachmentIssue("record-attachment-schema-invalid", ["calls"])];
    }
    seen.add(call.callId);
  }
  return value.calls.length <= AdapterUsageLimits.maximumCalls ? []
    : [recordAttachmentIssue("record-attachment-schema-invalid", ["calls"])];
}
