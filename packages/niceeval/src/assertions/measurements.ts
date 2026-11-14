import { isQuantity, type Quantity, type Unit } from "./quantity.ts";
import type { NumericMaterial } from "./match.ts";

/** Preserve a missing observation instead of coercing null to zero. */
export function measured(value: number | null, options: { readonly unavailable: string }): NumericMaterial;
export function measured<U extends Unit>(
  value: Quantity<U> | null,
  options: { readonly unavailable: string },
): NumericMaterial<U>;
export function measured(
  value: number | Quantity | null,
  options: { readonly unavailable: string },
): NumericMaterial<Unit | undefined> {
  if (typeof options?.unavailable !== "string" || options.unavailable.trim().length === 0) {
    throw new TypeError("measured() requires a non-empty unavailable reason.");
  }
  if (value === null) return Object.freeze({ state: "unavailable", reason: options.unavailable });
  if (isQuantity(value)) return Object.freeze({ state: "exact", value: value.value, unit: value.unit });
  if (typeof value !== "number") throw new TypeError("measured() requires a number or null.");
  return Number.isFinite(value)
    ? Object.freeze({ state: "exact", value })
    : Object.freeze({ state: "unavailable", reason: "non-finite-number" });
}

/** Chooses linear interpolation or nearest-rank sample quantiles; the method is part of the observation and must not be inferred. */
export type QuantileMethod = "linear" | "nearest-rank";
/** Carries a quantile observation with sample count, probability and method; retain unavailable or lower-bound state when the sample cannot prove an exact value. */
export type QuantileMaterial<U extends Unit | undefined = undefined> = NumericMaterial<U> & {
  readonly statistics: {
    readonly sampleCount: number;
    readonly probability: number;
    readonly method: QuantileMethod;
  };
};

/** Compute a quantile without changing or retaining the samples. Empty or invalid samples remain unavailable. */
export function quantile(
  samples: readonly number[],
  p: number,
  options?: { readonly method?: QuantileMethod },
): QuantileMaterial;
export function quantile<U extends Unit>(
  samples: readonly Quantity<U>[],
  p: number,
  options?: { readonly method?: QuantileMethod },
): QuantileMaterial<U>;
export function quantile(
  samples: readonly (number | Quantity)[],
  p: number,
  options: { readonly method?: QuantileMethod } = {},
): QuantileMaterial<Unit | undefined> {
  if (!Array.isArray(samples)) throw new TypeError("quantile() requires an array of samples.");
  if (!Number.isFinite(p) || p < 0 || p > 1)
    throw new TypeError("quantile() probability must be a finite number in [0, 1].");
  const method = options.method ?? "linear";
  if (method !== "linear" && method !== "nearest-rank")
    throw new TypeError("quantile() method must be linear or nearest-rank.");
  const statistics = Object.freeze({ sampleCount: samples.length, probability: p, method });
  if (samples.length === 0) return Object.freeze({ state: "unavailable", reason: "no-samples", statistics });
  const sampleUnits = new Set<Unit | undefined>();
  const values: number[] = [];
  let invalidSample = false;
  for (const sample of samples) {
    if (typeof sample !== "number" && !isQuantity(sample)) {
      invalidSample = true;
      continue;
    }
    sampleUnits.add(typeof sample === "number" ? undefined : sample.unit);
    const value = typeof sample === "number" ? sample : sample.value;
    if (!Number.isFinite(value)) invalidSample = true;
    values.push(value);
  }
  if (sampleUnits.size > 1) throw new TypeError("quantile() samples must use one unit, or all be numbers.");
  const unit = sampleUnits.values().next().value;
  if (invalidSample)
    return Object.freeze({
      state: "unavailable",
      reason: "non-finite-sample",
      statistics,
      ...(unit === undefined ? {} : { unit }),
    });
  const sorted = values.sort((a, b) => a - b);
  const position = (sorted.length - 1) * p;
  const lower = sorted[Math.floor(position)]!;
  const upper = sorted[Math.ceil(position)]!;
  const fraction = position - Math.floor(position);
  const delta = upper - lower;
  const value =
    method === "nearest-rank"
      ? sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)]!
      : Number.isFinite(delta)
        ? lower + delta * fraction
        : lower * (1 - fraction) + upper * fraction;
  return Object.freeze({ state: "exact", value, statistics, ...(unit === undefined ? {} : { unit }) });
}
