import * as Schema from "effect/Schema";
import type { ResolvedModelRoles } from "../model-roles.ts";
import type { AdapterUsageCall, ReadableAdapterUsageAttachment } from "../record/family/adapter-usage/schema.ts";
import { NonNegativeSafeIntegerSchema } from "../record/family/common.ts";

const Reason = Schema.Literals([
  "usage-not-recorded",
  "source-invalid",
  "adapter-usage-required",
  "collection-incomplete",
  "call-status-unknown",
  "no-calls",
  "cache-read-missing",
  "input-total-missing",
  "zero-input-total",
  "unsafe-token-total",
]);
type Reason = typeof Reason.Type;
const Rate = Schema.Union([
  Schema.Struct({
    state: Schema.Literal("exact"),
    value: Schema.Number.check(Schema.makeFilter((value) => Number.isFinite(value) && value >= 0 && value <= 1)),
  }),
  Schema.Struct({ state: Schema.Literal("unavailable"), reason: Reason }),
]);
const fields = {
  rate: Rate,
  recordedCalls: NonNegativeSafeIntegerSchema,
  coveredCalls: NonNegativeSafeIntegerSchema,
  missingCacheReadCalls: NonNegativeSafeIntegerSchema,
  missingInputTotalCalls: NonNegativeSafeIntegerSchema,
  unknownStatusCalls: NonNegativeSafeIntegerSchema,
  collectionComplete: Schema.Boolean,
  reasons: Schema.Array(Reason),
};
const consistent = (value: typeof SummaryShape.Type): boolean => {
  const count = value.recordedCalls;
  return (
    count <= 4000 &&
    value.coveredCalls <= count &&
    value.unknownStatusCalls <= count &&
    value.missingCacheReadCalls <= count &&
    value.missingInputTotalCalls <= count &&
    value.coveredCalls <= count - Math.max(value.missingCacheReadCalls, value.missingInputTotalCalls) &&
    value.coveredCalls >= count - value.missingCacheReadCalls - value.missingInputTotalCalls &&
    new Set(value.reasons).size === value.reasons.length &&
    (value.rate.state === "exact"
      ? value.reasons.length === 0 &&
        value.collectionComplete &&
        count > 0 &&
        value.coveredCalls === count &&
        value.unknownStatusCalls === 0
      : value.rate.reason === value.reasons[0])
  );
};
const SummaryShape = Schema.Struct(fields);
const Summary = SummaryShape.check(Schema.makeFilter(consistent));
/** Token-weighted cache reading, with explicit input coverage and collection completeness. */
export type CacheReadSummary = typeof Summary.Type;
export const CacheReadReportSchema = Schema.Struct({
  total: Summary,
  roles: Schema.Array(
    Schema.Struct({ modelRole: Schema.NullOr(Schema.String), ...fields }).check(Schema.makeFilter(consistent)),
  ),
  models: Schema.Array(
    Schema.Struct({
      modelRole: Schema.NullOr(Schema.String),
      provider: Schema.NullOr(Schema.String),
      model: Schema.NullOr(Schema.String),
      ...fields,
    }).check(Schema.makeFilter(consistent)),
  ),
}).check(Schema.makeFilter((value) => value.roles.length <= 65 && value.models.length <= 4000));
/** Complete per-Attempt report; unknown model identities remain null. */
export type CacheReadReport = typeof CacheReadReportSchema.Type;

function summary(calls: readonly AdapterUsageCall[], collectionComplete: boolean, absent?: Reason): CacheReadSummary {
  let numerator = 0;
  let denominator = 0;
  let coveredCalls = 0;
  let missingCacheReadCalls = 0;
  let missingInputTotalCalls = 0;
  let unknownStatusCalls = 0;
  let unsafe = false;
  for (const call of calls) {
    const total =
      call.inputTotalTokens ??
      (call.inputTokens !== null && call.cacheReadTokens !== null && call.cacheWriteTokens !== null
        ? call.inputTokens + call.cacheReadTokens + call.cacheWriteTokens
        : null);
    if (call.status === "unknown") unknownStatusCalls++;
    if (call.cacheReadTokens === null) missingCacheReadCalls++;
    else numerator += call.cacheReadTokens;
    if (total === null) missingInputTotalCalls++;
    else denominator += total;
    if (total !== null && call.cacheReadTokens !== null) coveredCalls++;
    if (
      (total !== null && !Number.isSafeInteger(total)) ||
      !Number.isSafeInteger(numerator) ||
      !Number.isSafeInteger(denominator)
    )
      unsafe = true;
  }
  const reasons: Reason[] =
    absent === undefined
      ? [
          ...(!collectionComplete ? ["collection-incomplete" as const] : []),
          ...(unknownStatusCalls > 0 ? ["call-status-unknown" as const] : []),
          ...(calls.length === 0 ? ["no-calls" as const] : []),
          ...(missingCacheReadCalls > 0 ? ["cache-read-missing" as const] : []),
          ...(missingInputTotalCalls > 0 ? ["input-total-missing" as const] : []),
          ...(calls.length > 0 && missingInputTotalCalls === 0 && denominator === 0
            ? ["zero-input-total" as const]
            : []),
          ...(unsafe ? ["unsafe-token-total" as const] : []),
        ]
      : [absent];
  const rate: CacheReadSummary["rate"] =
    reasons.length === 0
      ? Object.freeze({ state: "exact", value: numerator / denominator })
      : Object.freeze({ state: "unavailable", reason: reasons[0]! });
  return Object.freeze({
    rate,
    recordedCalls: calls.length,
    coveredCalls,
    missingCacheReadCalls,
    missingInputTotalCalls,
    unknownStatusCalls,
    collectionComplete,
    reasons: Object.freeze(reasons),
  });
}
const compare = (a: string | null, b: string | null): number =>
  a === b ? 0 : a === null ? -1 : b === null ? 1 : a < b ? -1 : 1;

/** A historical collection marked complete is not proof of an explicit producer seal. */
export function projectCacheRead(
  usage: ReadableAdapterUsageAttachment | null,
  roles: ResolvedModelRoles | undefined,
  producerCompletenessKnown: boolean,
  absent: "usage-not-recorded" | "source-invalid" | "adapter-usage-required" = "usage-not-recorded",
): CacheReadReport {
  if (usage === null)
    return Object.freeze({ total: summary([], false, absent), roles: Object.freeze([]), models: Object.freeze([]) });
  const complete = producerCompletenessKnown && usage.collection.state === "complete";
  const byRole = new Map<string | null, AdapterUsageCall[]>(Object.keys(roles ?? {}).map((role) => [role, []]));
  const byModel = new Map<string, AdapterUsageCall[]>();
  for (const call of usage.calls) {
    const role = byRole.get(call.modelSlot);
    if (role === undefined) byRole.set(call.modelSlot, [call]);
    else role.push(call);
    const key = JSON.stringify([call.modelSlot, call.provider, call.model]);
    const model = byModel.get(key);
    if (model === undefined) byModel.set(key, [call]);
    else model.push(call);
  }
  const models = [...byModel.values()]
    .map((calls) => {
      const { modelSlot: modelRole, provider, model } = calls[0]!;
      return Object.freeze({ modelRole, provider, model, ...summary(calls, complete) });
    })
    .sort((a, b) => compare(a.modelRole, b.modelRole) || compare(a.provider, b.provider) || compare(a.model, b.model));
  return Object.freeze({
    total: summary(usage.calls, complete),
    roles: Object.freeze(
      [...byRole]
        .sort(([a], [b]) => compare(a, b))
        .map(([modelRole, calls]) => Object.freeze({ modelRole, ...summary(calls, complete) })),
    ),
    models: Object.freeze(models),
  });
}
