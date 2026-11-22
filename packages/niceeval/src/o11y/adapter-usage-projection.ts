import { INSPECTION_USAGE_GROUP_PAGE_SIZE } from "../inspection/limits.ts";
import { projectCacheRead } from "./cache-read.ts";
import type {
  ReadableAdapterUsageAttachment,
  AdapterUsageCall,
  AdapterCallPriceReceipt,
} from "../record/family/adapter-usage/schema.ts";
import { addCanonicalDecimals } from "../record/family/adapter-usage/pricing.ts";
import type { NumericMaterial } from "../assertions/match.ts";
import type { ModelRolesWire } from "../model-roles.ts";
import { compareAdapterModelGroups } from "./usage-contract.ts";
export interface EffectiveCallCost {
  readonly amount: string;
  readonly currency: string;
  readonly source: { readonly kind: "reported" | "estimated"; readonly id: string };
  readonly state: "complete" | "partial";
}
export type EffectiveUsageCall = Omit<AdapterUsageCall, "modelSlot"> & { readonly modelRole: string | null } & {
  readonly effectiveCost: EffectiveCallCost | undefined;
};
export function effectiveUsageCalls(usage: ReadableAdapterUsageAttachment): readonly EffectiveUsageCall[] {
  const receipts = new Map((usage.priceReceipts ?? []).map((receipt) => [receipt.callId, receipt]));
  return usage.calls.map((call) => {
    const receipt = receipts.get(call.callId);
    const { modelSlot, ...fields } = call;
    function effectiveCost(): EffectiveCallCost | undefined {
      if (call.cost !== null) return { ...call.cost, state: "complete" };
      if (receipt === undefined) return undefined;
      return { amount: receipt.amount, currency: receipt.currency, source: receipt.source, state: receipt.state };
    }
    return {
      ...fields,
      modelRole: modelSlot,
      effectiveCost: effectiveCost(),
    };
  });
}
export function effectiveCostTotals(
  calls: readonly { readonly effectiveCost: EffectiveCallCost | undefined }[],
  collectionState: "complete" | "partial",
) {
  const known = calls.flatMap((call) => (call.effectiveCost === undefined ? [] : [call.effectiveCost]));
  const kind = (values: readonly EffectiveCallCost[]) => {
    const sources = new Set(values.map((value) => value.source.kind));
    if (sources.size > 1) return "mixed" as const;
    const [source] = sources;
    return source ?? null;
  };
  const grouped = new Map<string, EffectiveCallCost[]>();
  for (const cost of known) grouped.set(cost.currency, [...(grouped.get(cost.currency) ?? []), cost]);
  const complete =
    collectionState === "complete" && known.length === calls.length && known.every((cost) => cost.state === "complete");
  function totalState() {
    if (known.length === 0) return "unavailable" as const;
    return complete ? ("complete" as const) : ("partial" as const);
  }
  return {
    state: totalState(),
    source: kind(known),
    values: [...grouped.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([currency, values]) => ({
        currency,
        value: addCanonicalDecimals(values.map((value) => value.amount)),
        source: kind(values)!,
        coveredCalls: values.filter((value) => value.state === "complete").length,
        reportedCalls: values.filter((value) => value.source.kind === "reported").length,
        estimatedCalls: values.filter((value) => value.source.kind === "estimated").length,
      })),
    totalCalls: calls.length,
  };
}
function inputTotal(call: Omit<AdapterUsageCall, "modelSlot">): { value: number | undefined; complete: boolean } {
  const known = [call.inputTokens, call.cacheReadTokens, call.cacheWriteTokens].filter(
    (value): value is number => value !== null,
  );
  return {
    value: call.inputTotalTokens ?? (known.length === 0 ? undefined : known.reduce((sum, value) => sum + value, 0)),
    complete: call.inputTotalTokens !== null || known.length === 3,
  };
}
export function adapterTokenMaterial(
  usage: {
    readonly collection: ReadableAdapterUsageAttachment["collection"];
    readonly calls: readonly Omit<AdapterUsageCall, "modelSlot">[];
  },
  metric: "inputTokens" | "inputTotalTokens" | "outputTokens" | "cacheReadTokens" | "cacheWriteTokens" | "totalTokens",
): NumericMaterial {
  const provenance = { source: "adapter", scope: "recorded-calls", unit: "tokens", cut: "call-time" };
  let value = 0;
  let observations = 0;
  let complete = usage.collection.state === "complete" && usage.calls.length > 0;
  for (const call of usage.calls) {
    if (call.status === "unknown") complete = false;
    const input = inputTotal(call);
    function tokenBuckets() {
      if (metric === "totalTokens") return [input.value, call.outputTokens ?? undefined];
      if (metric === "inputTotalTokens") return [input.value];
      return [call[metric] ?? undefined];
    }
    const buckets = tokenBuckets();
    const observedBuckets =
      metric === "totalTokens" || metric === "inputTotalTokens"
        ? [
            ...(call.inputTotalTokens === null
              ? [call.inputTokens ?? undefined, call.cacheReadTokens ?? undefined, call.cacheWriteTokens ?? undefined]
              : [call.inputTotalTokens]),
            ...(metric === "totalTokens" ? [call.outputTokens ?? undefined] : []),
          ]
        : buckets;
    if (observedBuckets.some((bucket) => bucket !== undefined && (!Number.isSafeInteger(bucket) || bucket < 0))) {
      return {
        state: "unavailable",
        reason: "usage-invalid-token-value",
        provenance,
        unit: undefined,
      };
    }
    for (const bucket of buckets) {
      if (bucket === undefined) complete = false;
      else {
        value += bucket;
        observations += 1;
      }
    }
    if ((metric === "totalTokens" || metric === "inputTotalTokens") && !input.complete) complete = false;
  }
  if (!Number.isSafeInteger(value))
    return {
      state: "unavailable",
      reason: "usage-exceeds-safe-integer",
      provenance,
      unit: undefined,
    };
  if (observations === 0)
    return {
      state: "unavailable",
      reason: "usage-not-recorded",
      provenance,
      unit: undefined,
    };
  return {
    state: complete ? "exact" : "lower-bound",
    value,
    provenance,
    unit: undefined,
  };
}

export function adapterInspectionTokenTotal(
  usage: {
    readonly collection: ReadableAdapterUsageAttachment["collection"];
    readonly calls: readonly Omit<AdapterUsageCall, "modelSlot">[];
  },
  metric: "inputTotalTokens" | "outputTokens" | "totalTokens",
) {
  const material = adapterTokenMaterial(usage, metric);
  const observationCount = usage.calls.filter((call) =>
    metric === "outputTokens"
      ? call.outputTokens !== null
      : inputTotal(call).value !== undefined || (metric === "totalTokens" && call.outputTokens !== null),
  ).length;
  function tokenState() {
    if (material.state === "exact") return "available" as const;
    if (material.state === "lower-bound") return "partial" as const;
    return "unavailable" as const;
  }
  return {
    state: tokenState(),
    value: material.state === "unavailable" ? null : material.value,
    observationCount,
  };
}

/** Configuration counts and grouped statistics both consume the complete sealed ledger. */
export function projectAdapterModelUsage(
  usage: ReadableAdapterUsageAttachment | undefined,
  models: ModelRolesWire | undefined,
  unavailable: {
    readonly basis: "recorded-calls" | "reported-sends" | "unavailable";
    readonly reason: "source-invalid" | "usage-not-recorded" | "physical-call-identity-not-recorded";
  } = { basis: "unavailable", reason: "usage-not-recorded" },
  producerCompletenessKnown = true,
  page = 0,
) {
  const cacheRead = projectCacheRead(
    usage,
    models === undefined ? undefined : Object.keys(models),
    producerCompletenessKnown,
    unavailable.reason === "physical-call-identity-not-recorded" ? "adapter-usage-required" : unavailable.reason,
  );
  const counts = new Map<string, number>();
  for (const call of usage?.calls ?? []) {
    if (call.modelSlot !== null) counts.set(call.modelSlot, (counts.get(call.modelSlot) ?? 0) + 1);
  }
  const configuredModels =
    models === undefined
      ? { state: "not-recorded" as const }
      : {
          state: "available" as const,
          bindings: Object.keys(models)
            .sort()
            .map((modelRole) => ({
              modelRole,
              model: models[modelRole]!.model,
              reasoningEffort: models[modelRole]!.reasoningEffort,
              recordedCalls: usage === undefined ? null : (counts.get(modelRole) ?? 0),
            })),
        };
  if (usage === undefined)
    return {
      cacheRead,
      configuredModels,
      modelGroups: {
        state: "unavailable" as const,
        ...unavailable,
        groups: [] as readonly [],
        totalGroupCount: null,
        groupsTruncated: false as const,
        omittedGroupCount: 0 as const,
      },
    };
  const grouped = new Map<string, EffectiveUsageCall[]>();
  for (const call of effectiveUsageCalls(usage)) {
    const identity = JSON.stringify([call.modelRole, call.provider, call.model]);
    const group = grouped.get(identity);
    if (group === undefined) grouped.set(identity, [call]);
    else group.push(call);
  }
  const allGroups = [...grouped.values()].sort((left, right) => compareAdapterModelGroups(left[0]!, right[0]!));
  const start = Math.min(page * INSPECTION_USAGE_GROUP_PAGE_SIZE, allGroups.length);
  const groups = allGroups.slice(start, start + INSPECTION_USAGE_GROUP_PAGE_SIZE).map((calls) => {
    const { modelRole, provider, model } = calls[0]!;
    const groupUsage = { ...usage, calls };
    return {
      modelRole,
      provider,
      model,
      recordedCalls: calls.length,
      tokens: {
        inputTotalTokens: adapterInspectionTokenTotal(groupUsage, "inputTotalTokens"),
        outputTokens: adapterInspectionTokenTotal(groupUsage, "outputTokens"),
        totalTokens: adapterInspectionTokenTotal(groupUsage, "totalTokens"),
      },
      costs: effectiveCostTotals(calls, usage.collection.state),
    };
  });
  return {
    cacheRead,
    configuredModels,
    modelGroups: {
      state: "available" as const,
      basis: "recorded-calls" as const,
      groups: groups,
      totalGroupCount: allGroups.length,
      groupsTruncated: allGroups.length > start + groups.length,
      omittedGroupCount: allGroups.length - start - groups.length,
    },
  };
}
/** Projects recorded application calls and price receipts at a call-time cut; retain exact, lower-bound and unavailable numeric states rather than filling gaps with zero. */
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
/** Distinguishes an Adapter-owned usage projection from an unbound usage owner; unavailable usage is not an empty ledger. */
export type AttemptUsageSnapshot =
  | AdapterAttemptUsageSnapshot
  | { readonly source: "unavailable"; readonly reason: "usage-owner-not-bound" };
export function projectAdapterUsageSnapshot(usage: ReadableAdapterUsageAttachment): AdapterAttemptUsageSnapshot {
  const calls = effectiveUsageCalls(usage);
  return {
    source: "adapter",
    scope: "recorded-calls",
    cut: "call-time",
    collection: usage.collection,
    calls,
    priceReceipts: usage.priceReceipts ?? [],
    inputTokens: adapterTokenMaterial(usage, "inputTokens"),
    inputTotalTokens: adapterTokenMaterial(usage, "inputTotalTokens"),
    outputTokens: adapterTokenMaterial(usage, "outputTokens"),
    cacheReadTokens: adapterTokenMaterial(usage, "cacheReadTokens"),
    cacheWriteTokens: adapterTokenMaterial(usage, "cacheWriteTokens"),
    totalTokens: adapterTokenMaterial(usage, "totalTokens"),
    costs: effectiveCostTotals(calls, usage.collection.state),
  };
}
export function compareCanonicalDecimal(left: string, right: string): -1 | 0 | 1 {
  const [li, lf = ""] = left.split(".");
  const [ri, rf = ""] = right.split(".");
  const width = Math.max(lf.length, rf.length);
  const l = BigInt(li! + lf.padEnd(width, "0"));
  const r = BigInt(ri! + rf.padEnd(width, "0"));
  if (l < r) return -1;
  return l > r ? 1 : 0;
}
