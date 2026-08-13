export type MetricBasis = "eval" | "attempt" | "run" | "pair";
export type MetricBetter = "higher" | "lower";
export type MetricFormat =
  | "number"
  | "percent"
  | "duration"
  | "currency"
  | { readonly kind: "custom"; readonly format: (value: number, locale: string) => string };

export interface MetricBounds {
  readonly min?: number;
  readonly max?: number;
}

/**
 * A closed Calculation value. `basis` is the samples/total counting unit.
 * `refs` are Attempt locators and are not a second denominator.
 */
export interface MetricValue {
  readonly value: number | null;
  readonly samples: number;
  readonly total: number;
  readonly basis: MetricBasis;
  readonly unit?: string;
  readonly format?: MetricFormat;
  readonly better?: MetricBetter;
  readonly bounds?: MetricBounds;
  readonly refs: readonly string[];
}

export function metricValue(input: {
  readonly value: number | null;
  readonly samples: number;
  readonly total: number;
  readonly basis?: MetricBasis;
  readonly unit?: string;
  readonly format?: MetricFormat;
  readonly better?: MetricBetter;
  readonly bounds?: MetricBounds;
  readonly refs?: readonly string[];
}): MetricValue {
  if (!Number.isInteger(input.samples) || input.samples < 0) {
    throw new TypeError("MetricValue.samples must be a non-negative integer");
  }
  if (!Number.isInteger(input.total) || input.total < 0) {
    throw new TypeError("MetricValue.total must be a non-negative integer");
  }
  if (input.samples > input.total) {
    throw new TypeError("MetricValue.samples cannot exceed total");
  }
  if (input.value !== null && !Number.isFinite(input.value)) {
    throw new TypeError("MetricValue.value must be finite or null");
  }
  const refs = uniqueSorted(input.refs ?? []);
  return Object.freeze({
    value: input.value,
    samples: input.samples,
    total: input.total,
    basis: input.basis ?? "eval",
    ...(input.unit === undefined ? {} : { unit: input.unit }),
    ...(input.format === undefined ? {} : { format: input.format }),
    ...(input.better === undefined ? {} : { better: input.better }),
    ...(input.bounds === undefined ? {} : { bounds: Object.freeze({ ...input.bounds }) }),
    refs,
  });
}

export function isMetricValue(value: unknown): value is MetricValue {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as MetricValue;
  return (
    (candidate.value === null || typeof candidate.value === "number")
    && typeof candidate.samples === "number"
    && typeof candidate.total === "number"
    && (candidate.basis === "eval" || candidate.basis === "attempt" || candidate.basis === "run" || candidate.basis === "pair")
    && Array.isArray(candidate.refs)
  );
}

export function metricNumeric(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (isMetricValue(value)) {
    return value.value;
  }
  return null;
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort());
}
