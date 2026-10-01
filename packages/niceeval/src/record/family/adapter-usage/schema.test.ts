// cases: docs/engineering/testing/unit/assertions.md
// Algorithm seam: overflow must yield unavailable/null rather than a rounded or zero total.
// Codec seam: normal published E2E results cannot expose decoder acceptance of contradictory
// previews, unavailable-with-value or revision-crossed extra keys. Public lifecycle, collector,
// historical reading and C9 configuration counts belong to the installed E2E owner.
import { describe, expect, it } from "vitest";
import { Result, Schema } from "effect";
import { adapterInspectionTokenTotal, projectAdapterModelUsage } from "../../../o11y/adapter-usage-projection.ts";
import { InspectionAttemptUsageResultSchema } from "../../../inspection/results.ts";
import { projectAttemptUsage } from "../../../inspection/trace.ts";
import { RecordExactParseOptions } from "../../codec/core.ts";
import {
  AdapterUsageAttachmentRevision1Schema, AdapterUsageAttachmentRevision2Schema,
  AdapterUsageAttachmentSchema, AdapterUsageCallSchema,
  type AdapterUsageCall, type ReadableAdapterUsageAttachment,
} from "./schema.ts";

function call(fields: Partial<AdapterUsageCall> = {}): AdapterUsageCall {
  return Schema.decodeUnknownSync(AdapterUsageCallSchema)({
    callId: "call", retryOf: null, modelSlot: "a", provider: "serving", model: "actual",
    status: "succeeded", inputTokens: 10, inputTotalTokens: 10, outputTokens: 2,
    cacheReadTokens: 0, cacheWriteTokens: 0,
    route: { transportProvider: "gateway", endpointId: "endpoint" },
    cost: { amount: "0", currency: "USD", source: { kind: "reported", id: "invoice" } },
    ...fields,
  });
}
function ledger(calls: readonly AdapterUsageCall[]): ReadableAdapterUsageAttachment {
  return { collection: { state: "complete", limitations: [] }, calls, priceReceipts: [] };
}
const models = {
  a: { model: "configured", reasoningEffort: null },
  z: { model: "configured", reasoningEffort: null },
  unused: { model: "configured", reasoningEffort: null },
} as const;
describe("Model usage algorithm and codec boundaries", () => {
  it("keeps observed zero, partial zero and unsafe sums in distinct numeric states", () => {
    const observed = ledger([call({ outputTokens: 0 })]);
    expect(adapterInspectionTokenTotal(observed, "outputTokens")).toEqual({ state: "available", value: 0, observationCount: 1 });
    const partial: ReadableAdapterUsageAttachment = { ...observed, collection: { state: "partial", limitations: [{ code: "capture-failed", stage: "adapter-usage" }] } };
    expect(adapterInspectionTokenTotal(partial, "outputTokens")).toEqual({ state: "partial", value: 0, observationCount: 1 });
    expect(adapterInspectionTokenTotal(ledger([call({ outputTokens: null })]), "outputTokens"))
      .toEqual({ state: "unavailable", value: null, observationCount: 0 });
    expect(adapterInspectionTokenTotal(ledger([call({ outputTokens: Number.MAX_SAFE_INTEGER }), call({ callId: "overflow", outputTokens: 1 })]), "outputTokens"))
      .toEqual({ state: "unavailable", value: null, observationCount: 2 });
  });

  it("rejects revision-crossed fields rather than silently discarding purpose evidence", () => {
    const current = call();
    const { modelSlot: _slot, ...v2Call } = current;
    const envelope = { collection: { state: "complete", limitations: [] }, calls: [v2Call], priceReceipts: [] };
    expect(Result.isFailure(Schema.decodeUnknownResult(AdapterUsageAttachmentRevision1Schema, RecordExactParseOptions)(envelope))).toBe(true);
    expect(Result.isFailure(Schema.decodeUnknownResult(AdapterUsageAttachmentRevision2Schema, RecordExactParseOptions)({ ...envelope, calls: [current] }))).toBe(true);
    expect(Result.isFailure(Schema.decodeUnknownResult(AdapterUsageAttachmentSchema, RecordExactParseOptions)(envelope))).toBe(true);
    expect(Result.isFailure(Schema.decodeUnknownResult(AdapterUsageCallSchema, RecordExactParseOptions)({ ...current, modelSlot: "a\n" }))).toBe(true);
  });

  it("strictly decodes closed usage results and rejects inconsistent previews or invented total completeness", () => {
    const source = ledger([call({ modelSlot: "a" })]);
    const result = { ...projectAttemptUsage({ models }), ...projectAdapterModelUsage(source, models),
      totalCosts: { state: "partial", values: [{ currency: "USD", value: "0", source: "reported" }], missingSources: ["judge"] },
    };
    const decode = Schema.decodeUnknownResult(InspectionAttemptUsageResultSchema, RecordExactParseOptions);
    expect(Result.isSuccess(decode(result))).toBe(true);
    expect(Result.isFailure(decode({ ...result, configuredModels: { ...result.configuredModels, extra: true } }))).toBe(true);
    expect(Result.isFailure(decode({ ...result, modelGroups: { ...result.modelGroups, omittedGroupCount: 1 } }))).toBe(true);
    expect(Result.isFailure(decode({ ...result, modelGroups: { ...result.modelGroups, groups: [...result.modelGroups.groups, ...result.modelGroups.groups] } }))).toBe(true);
    expect(Result.isFailure(decode({ ...result, totalCosts: { ...result.totalCosts, state: "complete" } }))).toBe(true);
    expect(Result.isFailure(decode({ ...result, totalCosts: { ...result.totalCosts, state: "unavailable" } }))).toBe(true);
    expect(Result.isFailure(decode({ ...result, totalCosts: { ...result.totalCosts, values: [{ currency: "USD", value: "0.00", source: "reported" }] } }))).toBe(true);
    expect(Result.isFailure(decode({ ...result, totalCosts: { ...result.totalCosts, values: [{ currency: "USD", value: "1\n", source: "reported" }] } }))).toBe(true);
    expect(Result.isSuccess(decode({ ...result, totalCosts: { ...result.totalCosts, values: [{ currency: "USD", value: "1".repeat(65), source: "reported" }] } }))).toBe(true);
  });
});
