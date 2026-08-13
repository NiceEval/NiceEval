import { metricValue, type MetricValue } from "./metric.ts";
import type { AggregationSubject, ClassicEvalUnit, Sample } from "./sample.ts";

export type GroupFunction = (subject: AggregationSubject) => string;

export interface ClassicCalculation {
  readonly id: string;
  readonly compute: (units: readonly ClassicEvalUnit[]) => MetricValue;
}

export type AggregateRow<
  Groups extends Readonly<Record<string, GroupFunction>> = Readonly<Record<string, GroupFunction>>,
  Values extends Readonly<Record<string, ClassicCalculation>> = Readonly<Record<string, ClassicCalculation>>,
> = {
  readonly [Key in keyof Groups]: string;
} & {
  readonly [Key in keyof Values]: MetricValue;
};

const RESERVED_VALUE_KEY = "refs";

/**
 * Groups already-projected Eval units, then runs each named Calculation.
 * Grouping is Eval-equal: attempts are never a grouping grain.
 */
export async function aggregate<
  const Groups extends Readonly<Record<string, GroupFunction>>,
  const Values extends Readonly<Record<string, ClassicCalculation>>,
>(
  sample: Sample,
  spec: {
    readonly by: Groups;
    readonly values: Values;
  },
): Promise<readonly AggregateRow<Groups, Values>[]> {
  const byEntries = ownFunctions(spec.by, "by");
  const valueEntries = ownCalculations(spec.values, "values");
  const byKeys = new Set(byEntries.map(([key]) => key));
  for (const [key] of valueEntries) {
    if (key === RESERVED_VALUE_KEY) {
      throw new TypeError("aggregate values cannot use the reserved key refs");
    }
    if (byKeys.has(key)) {
      throw new TypeError(`aggregate by/values keys must be exclusive; "${key}" is used twice`);
    }
  }

  const groups = new Map<string, {
    readonly labels: Readonly<Record<string, string>>;
    readonly units: ClassicEvalUnit[];
  }>();

  for (const unit of sample.units) {
    const labels: Record<string, string> = Object.create(null) as Record<string, string>;
    for (const [key, group] of byEntries) {
      labels[key] = invokeGroup(group, unit.subject, key);
    }
    const identity = JSON.stringify(byEntries.map(([key]) => labels[key] ?? ""));
    const existing = groups.get(identity);
    if (existing === undefined) {
      groups.set(identity, {
        labels: Object.freeze(labels),
        units: [unit],
      });
    } else {
      existing.units.push(unit);
    }
  }

  const rows: Array<AggregateRow<Groups, Values>> = [];
  for (const group of groups.values()) {
    const row: Record<string, string | MetricValue> = Object.create(null) as Record<
      string,
      string | MetricValue
    >;
    for (const [key, label] of Object.entries(group.labels)) {
      row[key] = label;
    }
    for (const [key, calculation] of valueEntries) {
      row[key] = calculation.compute(group.units);
    }
    rows.push(Object.freeze(row) as AggregateRow<Groups, Values>);
  }

  rows.sort((left, right) => compareRows(left, right, byEntries.map(([key]) => key)));
  return Object.freeze(rows);
}

/**
 * Attempt mean inside one (experimentId, evalId), then equal weight across
 * Eval units. passed=1, failed/errored=0; skipped and missing do not fabricate.
 */
export const experiment: GroupFunction = (subject) => subject.experimentId;
Object.defineProperty(experiment, "name", { value: "experiment" });

export const costUSD: ClassicCalculation = Object.freeze({
  id: "costUSD",
  compute: (units: readonly ClassicEvalUnit[]): MetricValue =>
    meanMetric(units, "costUSD", { unit: "USD", better: "lower" }),
});

export const passRate: ClassicCalculation = Object.freeze({
  id: "passRate",
  compute: (units: readonly ClassicEvalUnit[]): MetricValue => {
    const values: number[] = [];
    const refs: string[] = [];
    for (const unit of units) {
      const scores: number[] = [];
      for (const attempt of unit.attempts) {
        if (attempt.target !== undefined) {
          refs.push(attempt.target.locator);
        }
        if (attempt.verdict === "passed") {
          scores.push(1);
        } else if (attempt.verdict === "failed" || attempt.verdict === "errored") {
          scores.push(0);
        }
      }
      if (scores.length > 0) {
        values.push(scores.reduce((sum, score) => sum + score, 0) / scores.length);
      }
    }
    return metricValue({
      value: values.length === 0
        ? null
        : values.reduce((sum, score) => sum + score, 0) / values.length,
      samples: values.length,
      total: units.length,
      basis: "eval",
      unit: "ratio",
      better: "higher",
      bounds: { min: 0, max: 1 },
      refs,
    });
  },
});

/** Equal-weight Eval mean of per-Eval attempt means. Missing Attempt values stay out. */
export function meanMetric(
  units: readonly ClassicEvalUnit[],
  field: "durationMs" | "costUSD" | "tokens",
  options: {
    readonly unit?: string;
    readonly better?: "higher" | "lower";
  } = {},
): MetricValue {
  const values: number[] = [];
  const refs: string[] = [];
  for (const unit of units) {
    const scores: number[] = [];
    for (const attempt of unit.attempts) {
      if (attempt.target !== undefined) {
        refs.push(attempt.target.locator);
      }
      const value = attempt[field];
      if (value !== null) {
        scores.push(value);
      }
    }
    if (scores.length > 0) {
      values.push(scores.reduce((sum, score) => sum + score, 0) / scores.length);
    }
  }
  return metricValue({
    value: values.length === 0
      ? null
      : values.reduce((sum, score) => sum + score, 0) / values.length,
    samples: values.length,
    total: units.length,
    basis: "eval",
    ...(options.unit === undefined ? {} : { unit: options.unit }),
    ...(options.better === undefined ? {} : { better: options.better }),
    refs,
  });
}

/** Sum observed Attempt values. Missing values stay out and never become 0. */
export function totalAttempts(
  units: readonly ClassicEvalUnit[],
  field: "durationMs" | "costUSD" | "tokens",
  options: {
    readonly unit?: string;
    readonly better?: "higher" | "lower";
  } = {},
): MetricValue {
  const scores: number[] = [];
  const refs: string[] = [];
  let total = 0;
  for (const unit of units) {
    for (const attempt of unit.attempts) {
      total += 1;
      if (attempt.target !== undefined) {
        refs.push(attempt.target.locator);
      }
      const value = attempt[field];
      if (value !== null) {
        scores.push(value);
      }
    }
  }
  return metricValue({
    value: scores.length === 0 ? null : scores.reduce((sum, score) => sum + score, 0),
    samples: scores.length,
    total,
    basis: "eval",
    ...(options.unit === undefined ? {} : { unit: options.unit }),
    ...(options.better === undefined ? {} : { better: options.better }),
    refs,
  });
}

export function foldEvalVerdict(
  unit: ClassicEvalUnit,
): "passed" | "failed" | "errored" | undefined {
  let passed = false;
  let failed = false;
  let errored = false;
  for (const attempt of unit.attempts) {
    if (attempt.verdict === "errored") {
      errored = true;
    } else if (attempt.verdict === "failed") {
      failed = true;
    } else if (attempt.verdict === "passed") {
      passed = true;
    }
  }
  if (errored) {
    return "errored";
  }
  if (failed) {
    return "failed";
  }
  if (passed) {
    return "passed";
  }
  return undefined;
}

export function sumMetric(
  units: readonly ClassicEvalUnit[],
  field: "durationMs" | "costUSD" | "tokens",
  options: {
    readonly unit?: string;
    readonly better?: "higher" | "lower";
  } = {},
): MetricValue {
  const values: number[] = [];
  const refs: string[] = [];
  for (const unit of units) {
    const scores: number[] = [];
    for (const attempt of unit.attempts) {
      if (attempt.target !== undefined) {
        refs.push(attempt.target.locator);
      }
      const value = attempt[field];
      if (value !== null) {
        scores.push(value);
      }
    }
    if (scores.length > 0) {
      values.push(scores.reduce((sum, score) => sum + score, 0));
    }
  }
  return metricValue({
    value: values.length === 0
      ? null
      : values.reduce((sum, score) => sum + score, 0) / values.length,
    samples: values.length,
    total: units.length,
    basis: "eval",
    ...(options.unit === undefined ? {} : { unit: options.unit }),
    ...(options.better === undefined ? {} : { better: options.better }),
    refs,
  });
}

function invokeGroup(
  group: GroupFunction,
  subject: AggregationSubject,
  field: string,
): string {
  let value: unknown;
  try {
    value = group(subject);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new TypeError(
      `group function ${field} failed for ${subject.experimentId} × ${subject.evalId}: ${detail}`,
    );
  }
  if (typeof value !== "string") {
    throw new TypeError(
      `group function ${field} must return a string for ${subject.experimentId} × ${subject.evalId}`,
    );
  }
  return value;
}

function ownFunctions(
  value: Readonly<Record<string, GroupFunction>>,
  label: string,
): readonly (readonly [string, GroupFunction])[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`aggregate ${label} must be a plain object`);
  }
  const entries: Array<readonly [string, GroupFunction]> = [];
  for (const [key, candidate] of Object.entries(value)) {
    if (typeof candidate !== "function") {
      throw new TypeError(`aggregate ${label}.${key} must be a function`);
    }
    entries.push(Object.freeze([key, candidate]));
  }
  return Object.freeze(entries);
}

function ownCalculations(
  value: Readonly<Record<string, ClassicCalculation>>,
  label: string,
): readonly (readonly [string, ClassicCalculation])[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`aggregate ${label} must be a plain object`);
  }
  const entries: Array<readonly [string, ClassicCalculation]> = [];
  for (const [key, candidate] of Object.entries(value)) {
    if (
      typeof candidate !== "object"
      || candidate === null
      || typeof candidate.compute !== "function"
    ) {
      throw new TypeError(`aggregate ${label}.${key} must be a classic Calculation`);
    }
    entries.push(Object.freeze([key, candidate]));
  }
  return Object.freeze(entries);
}

function compareRows(
  left: Readonly<Record<string, string | MetricValue>>,
  right: Readonly<Record<string, string | MetricValue>>,
  keys: readonly string[],
): number {
  for (const key of keys) {
    const leftValue = left[key];
    const rightValue = right[key];
    const leftText = typeof leftValue === "string" ? leftValue : "";
    const rightText = typeof rightValue === "string" ? rightValue : "";
    if (leftText !== rightText) {
      return leftText < rightText ? -1 : 1;
    }
  }
  return 0;
}
