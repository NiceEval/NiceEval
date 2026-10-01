import type { ReadableAdapterUsageAttachment, AdapterUsageCall, AdapterCallPriceReceipt } from "../record/family/adapter-usage/schema.ts";
import { addCanonicalDecimals } from "../record/family/adapter-usage/pricing.ts";
import type { NumericMaterial } from "../assertions/match.ts";
import type { ResolvedModelSlots } from "../model-slots.ts";
export interface EffectiveCallCost { readonly amount: string; readonly currency: string; readonly source: { readonly kind: "reported" | "estimated"; readonly id: string }; readonly state: "complete" | "partial" }
export type EffectiveUsageCall = AdapterUsageCall & { readonly effectiveCost: EffectiveCallCost | null };
export function effectiveUsageCalls(usage: ReadableAdapterUsageAttachment): readonly EffectiveUsageCall[] {
  const receipts = new Map((usage.priceReceipts ?? []).map((receipt) => [receipt.callId, receipt]));
  return Object.freeze(usage.calls.map((call) => {
    const receipt = receipts.get(call.callId);
    return Object.freeze({ ...call, effectiveCost: call.cost !== null ? Object.freeze({ ...call.cost, state: "complete" as const }) : receipt === undefined ? null : Object.freeze({ amount: receipt.amount, currency: receipt.currency, source: receipt.source, state: receipt.state }) });
  }));
}
export function effectiveCostTotals(calls: readonly { readonly effectiveCost: EffectiveCallCost | null }[], collectionState: "complete" | "partial") {
  const known = calls.flatMap((call) => call.effectiveCost === null ? [] : [call.effectiveCost]);
  const kind = (values: readonly EffectiveCallCost[]) => { const sources = new Set(values.map((value) => value.source.kind)); return sources.size === 0 ? null : sources.size === 1 ? [...sources][0]! : "mixed" as const; };
  const grouped = new Map<string, EffectiveCallCost[]>();
  for (const cost of known) grouped.set(cost.currency, [...(grouped.get(cost.currency) ?? []), cost]);
  const complete = collectionState === "complete" && known.length === calls.length && known.every((cost) => cost.state === "complete");
  return Object.freeze({ state: known.length === 0 ? "unavailable" as const : complete ? "complete" as const : "partial" as const, source: kind(known), values: Object.freeze([...grouped.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([currency, values]) => Object.freeze({ currency, value: addCanonicalDecimals(values.map((value) => value.amount)), source: kind(values)!, coveredCalls: values.filter((value) => value.state === "complete").length, reportedCalls: values.filter((value) => value.source.kind === "reported").length, estimatedCalls: values.filter((value) => value.source.kind === "estimated").length }))), totalCalls: calls.length });
}
function inputTotal(call: AdapterUsageCall): { value: number | null; complete: boolean } {
  const known = [call.inputTokens, call.cacheReadTokens, call.cacheWriteTokens].filter((value): value is number => value !== null);
  return { value: call.inputTotalTokens ?? (known.length === 0 ? null : known.reduce((sum, value) => sum + value, 0)), complete: call.inputTotalTokens !== null || known.length === 3 };
}
export function adapterTokenMaterial(usage: ReadableAdapterUsageAttachment, metric: "inputTokens" | "inputTotalTokens" | "outputTokens" | "cacheReadTokens" | "cacheWriteTokens" | "totalTokens"): NumericMaterial {
  const provenance = Object.freeze({ source: "adapter", scope: "recorded-calls", unit: "tokens", cut: "call-time" });
  let value = 0; let observations = 0; let complete = usage.collection.state === "complete" && usage.calls.length > 0;
  for (const call of usage.calls) {
    if (call.status === "unknown") complete = false;
    const input = inputTotal(call);
    const buckets = metric === "totalTokens" ? [input.value, call.outputTokens] : metric === "inputTotalTokens" ? [input.value] : [call[metric]];
    const observedBuckets = metric === "totalTokens" || metric === "inputTotalTokens"
      ? [...(call.inputTotalTokens === null ? [call.inputTokens, call.cacheReadTokens, call.cacheWriteTokens] : [call.inputTotalTokens]), ...(metric === "totalTokens" ? [call.outputTokens] : [])]
      : buckets;
    if (observedBuckets.some((bucket) => bucket !== null && (!Number.isSafeInteger(bucket) || bucket < 0))) {
      return Object.freeze({ state: "unavailable", reason: "usage-invalid-token-value", provenance });
    }
    for (const bucket of buckets) { if (bucket === null) complete = false; else { value += bucket; observations += 1; } }
    if ((metric === "totalTokens" || metric === "inputTotalTokens") && !input.complete) complete = false;
  }
  return Object.freeze(!Number.isSafeInteger(value) ? { state: "unavailable", reason: "usage-exceeds-safe-integer", provenance } : observations === 0 ? { state: "unavailable", reason: "usage-not-recorded", provenance } : { state: complete ? "exact" : "lower-bound", value, provenance });
}

export function adapterInspectionTokenTotal(
  usage: ReadableAdapterUsageAttachment,
  metric: "inputTotalTokens" | "outputTokens" | "totalTokens",
) {
  const material = adapterTokenMaterial(usage, metric);
  const observationCount = usage.calls.filter((call) => metric === "outputTokens"
    ? call.outputTokens !== null
    : inputTotal(call).value !== null || (metric === "totalTokens" && call.outputTokens !== null)).length;
  return Object.freeze({
    state: material.state === "exact" ? "available" as const
      : material.state === "lower-bound" ? "partial" as const : "unavailable" as const,
    value: material.state === "unavailable" ? null : material.value,
    observationCount,
  });
}

/** Tuple order is stable across hosts, with missing identities before strings. */
export function compareAdapterModelGroups(
  left: Pick<AdapterUsageCall, "modelSlot" | "provider" | "model">,
  right: Pick<AdapterUsageCall, "modelSlot" | "provider" | "model">,
): number {
  for (const key of ["modelSlot", "provider", "model"] as const) {
    const a = left[key]; const b = right[key];
    if (a === b) continue;
    if (a === null) return -1;
    if (b === null) return 1;
    return a < b ? -1 : 1;
  }
  return 0;
}

/** Configuration counts and grouped statistics both consume the complete sealed ledger. */
export function projectAdapterModelUsage(
  usage: ReadableAdapterUsageAttachment | null,
  models: ResolvedModelSlots | undefined,
  unavailable: {
    readonly basis: "recorded-calls" | "reported-sends" | "unavailable";
    readonly reason: "source-invalid" | "usage-not-recorded" | "physical-call-identity-not-recorded";
  } = { basis: "unavailable", reason: "usage-not-recorded" },
) {
  const counts = new Map<string, number>();
  for (const call of usage?.calls ?? []) {
    if (call.modelSlot !== null) counts.set(call.modelSlot, (counts.get(call.modelSlot) ?? 0) + 1);
  }
  const configuredModels = models === undefined
    ? Object.freeze({ state: "not-recorded" as const })
    : Object.freeze({
        state: "available" as const,
        bindings: Object.freeze(Object.keys(models).sort().map((modelSlot) => Object.freeze({
          modelSlot, ...models[modelSlot]!,
          recordedCalls: usage === null ? null : counts.get(modelSlot) ?? 0,
        }))),
      });
  if (usage === null) return Object.freeze({
    configuredModels,
    modelGroups: Object.freeze({
      state: "unavailable" as const, ...unavailable,
      groups: Object.freeze([]) as readonly [], totalGroupCount: null,
      groupsTruncated: false as const, omittedGroupCount: 0 as const,
    }),
  });
  const grouped = new Map<string, EffectiveUsageCall[]>();
  for (const call of effectiveUsageCalls(usage)) {
    const identity = JSON.stringify([call.modelSlot, call.provider, call.model]);
    const group = grouped.get(identity);
    if (group === undefined) grouped.set(identity, [call]);
    else group.push(call);
  }
  const allGroups = [...grouped.values()].sort((left, right) => compareAdapterModelGroups(left[0]!, right[0]!));
  const groups = allGroups.slice(0, 64).map((calls) => {
    const { modelSlot, provider, model } = calls[0]!;
    const groupUsage = { ...usage, calls };
    return Object.freeze({
      modelSlot, provider, model, recordedCalls: calls.length,
      tokens: Object.freeze({
        inputTotalTokens: adapterInspectionTokenTotal(groupUsage, "inputTotalTokens"),
        outputTokens: adapterInspectionTokenTotal(groupUsage, "outputTokens"),
        totalTokens: adapterInspectionTokenTotal(groupUsage, "totalTokens"),
      }),
      costs: effectiveCostTotals(calls, usage.collection.state),
    });
  });
  return Object.freeze({
    configuredModels,
    modelGroups: Object.freeze({
      state: "available" as const, basis: "recorded-calls" as const,
      groups: Object.freeze(groups), totalGroupCount: allGroups.length,
      groupsTruncated: allGroups.length > groups.length,
      omittedGroupCount: allGroups.length - groups.length,
    }),
  });
}
export interface AdapterAttemptUsageSnapshot {
  readonly source: "adapter";
  readonly scope: "recorded-calls";
  readonly cut: "call-time";
  readonly collection: ReadableAdapterUsageAttachment["collection"];
  readonly calls: readonly EffectiveUsageCall[];
  readonly priceReceipts: readonly AdapterCallPriceReceipt[];
  readonly inputTokens: NumericMaterial;
  readonly inputTotalTokens: NumericMaterial;
  readonly outputTokens: NumericMaterial;
  readonly cacheReadTokens: NumericMaterial;
  readonly cacheWriteTokens: NumericMaterial;
  readonly totalTokens: NumericMaterial;
  readonly costs: ReturnType<typeof effectiveCostTotals>;
}
export type AttemptUsageSnapshot = AdapterAttemptUsageSnapshot | { readonly source: "unavailable"; readonly reason: "usage-owner-not-bound" };
export function projectAdapterUsageSnapshot(usage: ReadableAdapterUsageAttachment): AdapterAttemptUsageSnapshot {
  const calls = effectiveUsageCalls(usage);
  return Object.freeze({ source: "adapter", scope: "recorded-calls", cut: "call-time", collection: usage.collection, calls, priceReceipts: usage.priceReceipts ?? [], inputTokens: adapterTokenMaterial(usage, "inputTokens"), inputTotalTokens: adapterTokenMaterial(usage, "inputTotalTokens"), outputTokens: adapterTokenMaterial(usage, "outputTokens"), cacheReadTokens: adapterTokenMaterial(usage, "cacheReadTokens"), cacheWriteTokens: adapterTokenMaterial(usage, "cacheWriteTokens"), totalTokens: adapterTokenMaterial(usage, "totalTokens"), costs: effectiveCostTotals(calls, usage.collection.state) });
}
export function compareCanonicalDecimal(left: string, right: string): -1 | 0 | 1 {
  const [li, lf = ""] = left.split("."); const [ri, rf = ""] = right.split(".");
  const width = Math.max(lf.length, rf.length);
  const l = BigInt(li! + lf.padEnd(width, "0")); const r = BigInt(ri! + rf.padEnd(width, "0"));
  return l < r ? -1 : l > r ? 1 : 0;
}
