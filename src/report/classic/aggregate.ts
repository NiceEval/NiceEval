import { metricValue, type MetricBetter, type MetricFormat, type MetricValue } from "./metric.ts";
import { classicAttemptHandleFromRow, type ClassicAttemptHandle } from "./attempt.ts";
import {
  type AggregationSubject,
  type ClassicAttemptRow,
  type ClassicEvalUnit,
  type Sample,
} from "./sample.ts";

export type GroupFunction = (subject: AggregationSubject) => string;

export interface Reducer {
  (values: readonly number[]): number | null;
  readonly name: string;
}

export interface RollupOptions {
  readonly withinEval?: Reducer;
  readonly acrossEvals?: Reducer;
  readonly unit?: string;
  readonly better?: MetricBetter;
  readonly bounds?: { readonly min?: number; readonly max?: number };
  readonly format?: MetricFormat;
}

export interface RollupCalculation {
  readonly kind: "rollup";
  readonly withinEval: Reducer;
  readonly acrossEvals: Reducer;
  readonly unit?: string;
  readonly better?: MetricBetter;
  readonly bounds?: { readonly min?: number; readonly max?: number };
  readonly format?: MetricFormat;
  readonly value: (attempt: ClassicAttemptHandle) => number | null | Promise<number | null>;
}

export interface ClassicCalculation {
  readonly id: string;
  readonly compute: (units: readonly ClassicEvalUnit[]) => MetricValue;
}

export type Calculation = ClassicCalculation | RollupCalculation;

export type AggregateRow<
  Groups extends Readonly<Record<string, GroupFunction>> = Readonly<Record<string, GroupFunction>>,
  Values extends Readonly<Record<string, Calculation>> = Readonly<Record<string, Calculation>>,
> = {
  readonly [Key in keyof Groups]: string;
} & {
  readonly [Key in keyof Values]: MetricValue;
};

function defineReducer(name: string, reduce: (values: readonly number[]) => number | null): Reducer {
  const fn = ((values: readonly number[]) => {
    if (values.length === 0) return null;
    return reduce(values);
  }) as Reducer;
  Object.defineProperty(fn, "name", { value: name });
  return fn;
}

export const mean: Reducer = defineReducer("mean", (values) => {
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
});

export function rollup(
  value: (attempt: ClassicAttemptHandle) => number | null | Promise<number | null>,
  options: RollupOptions = {},
): RollupCalculation {
  if (typeof value !== "function") {
    throw new TypeError("rollup requires a value(attempt) function");
  }
  return Object.freeze({
    kind: "rollup" as const,
    withinEval: options.withinEval ?? mean,
    acrossEvals: options.acrossEvals ?? mean,
    ...(options.unit === undefined ? {} : { unit: options.unit }),
    ...(options.better === undefined ? {} : { better: options.better }),
    ...(options.bounds === undefined ? {} : { bounds: options.bounds }),
    ...(options.format === undefined ? {} : { format: options.format }),
    value,
  });
}

const RESERVED_VALUE_KEY = "refs";

/**
 * Groups already-projected Eval units, then runs each named Calculation.
 * Grouping is Eval-equal: attempts are never a grouping grain.
 */
export async function aggregate<
  const Groups extends Readonly<Record<string, GroupFunction>>,
  const Values extends Readonly<Record<string, Calculation>>,
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
      row[key] = await computeCalculation(sample, calculation, group.units);
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

export const evalId: GroupFunction = (subject) => subject.evalId;
Object.defineProperty(evalId, "name", { value: "evalId" });

export const agent: GroupFunction = (subject) =>
  subject.run.agent
  ?? subject.run.experiment?.agent
  ?? "unknown";
Object.defineProperty(agent, "name", { value: "agent" });

export const durationMs: ClassicCalculation = Object.freeze({
  id: "durationMs",
  compute: (units: readonly ClassicEvalUnit[]): MetricValue =>
    meanMetric(units, "durationMs", { unit: "ms", better: "lower" }),
});

export const costUSD: ClassicCalculation = Object.freeze({
  id: "costUSD",
  compute: (units: readonly ClassicEvalUnit[]): MetricValue =>
    meanMetric(units, "costUSD", { unit: "$", better: "lower" }),
});

export const tokens: ClassicCalculation = Object.freeze({
  id: "tokens",
  compute: (units: readonly ClassicEvalUnit[]): MetricValue =>
    meanMetric(units, "tokens", { unit: "tokens", better: "lower" }),
});

export const passRate: ClassicCalculation = Object.freeze({
  id: "passRate",
  compute: (units: readonly ClassicEvalUnit[]): MetricValue => {
    const values: number[] = [];
    const refs: string[] = [];
    let total = 0;
    for (const unit of units) {
      if (unit.evaluationKind !== "pass") continue;
      total += 1;
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
      total,
      basis: "eval",
      unit: "%",
      better: "higher",
      bounds: { min: 0, max: 1 },
      refs,
    });
  },
});

/**
 * Score Eval primary reading: mean complete earned score within each Eval,
 * then sum those Eval readings across the scope. Partial, unavailable,
 * skipped, and errored Attempts are not comparable and stay out.
 */
export const totalScore: ClassicCalculation = Object.freeze({
  id: "totalScore",
  compute: (units: readonly ClassicEvalUnit[]): MetricValue => {
    const evalScores: number[] = [];
    const refs: string[] = [];
    let total = 0;
    for (const unit of units) {
      if (unit.evaluationKind !== "score") continue;
      total += 1;
      const attemptScores: number[] = [];
      for (const attempt of unit.attempts) {
        if (attempt.target !== undefined) refs.push(attempt.target.locator);
        if (scoreStatus(attempt) === "scored" && attempt.score?.state === "complete") {
          attemptScores.push(attempt.score.earned);
        }
      }
      if (attemptScores.length > 0) {
        evalScores.push(attemptScores.reduce((sum, score) => sum + score, 0) / attemptScores.length);
      }
    }
    return metricValue({
      value: evalScores.length === 0 ? null : evalScores.reduce((sum, score) => sum + score, 0),
      samples: evalScores.length,
      total,
      basis: "eval",
      better: "higher",
      refs,
    });
  },
});

export type ScoringComposition = "pass" | "score" | "mixed";
export type ScoreStatus = "scored" | "errored" | "skipped";

export function scoringComposition(units: readonly ClassicEvalUnit[]): ScoringComposition {
  const hasPass = units.some((unit) => unit.evaluationKind === "pass");
  const hasScore = units.some((unit) => unit.evaluationKind === "score");
  return hasPass && hasScore ? "mixed" : hasScore ? "score" : "pass";
}

export function scoreStatus(
  attempt: ClassicEvalUnit["attempts"][number],
): ScoreStatus | undefined {
  if (attempt.evaluationKind !== "score") return undefined;
  if (attempt.verdict === "skipped") return "skipped";
  if (attempt.verdict === "errored") return "errored";
  if (attempt.scoreEvidence.state !== "available") return undefined;
  if (attempt.score?.state === "complete") return "scored";
  return "errored";
}

/** Pass verdicts and Score-kind scored/errored Attempts. Skipped and missing stay out. */
export function resultBearingAttemptCount(
  attempts: readonly ClassicAttemptRow[],
): number {
  return attempts.filter((attempt) => {
    if (attempt.evaluationKind === "score") {
      const status = scoreStatus(attempt);
      return status === "scored" || status === "errored";
    }
    return attempt.verdict === "passed"
      || attempt.verdict === "failed"
      || attempt.verdict === "errored";
  }).length;
}

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
    basis: "attempt",
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
  value: Readonly<Record<string, Calculation>>,
  label: string,
): readonly (readonly [string, Calculation])[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`aggregate ${label} must be a plain object`);
  }
  const entries: Array<readonly [string, Calculation]> = [];
  for (const [key, candidate] of Object.entries(value)) {
    if (!isCalculation(candidate)) {
      throw new TypeError(`aggregate ${label}.${key} must be a classic Calculation`);
    }
    entries.push(Object.freeze([key, candidate]));
  }
  return Object.freeze(entries);
}

function isCalculation(value: unknown): value is Calculation {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Calculation;
  if ("compute" in candidate && typeof candidate.compute === "function") {
    return true;
  }
  return "kind" in candidate
    && candidate.kind === "rollup"
    && typeof candidate.value === "function";
}

async function computeCalculation(
  sample: Sample,
  calculation: Calculation,
  units: readonly ClassicEvalUnit[],
): Promise<MetricValue> {
  if (isRollupCalculation(calculation)) {
    return computeRollup(sample, calculation, units);
  }
  return calculation.compute(units);
}

function isRollupCalculation(value: Calculation): value is RollupCalculation {
  return "kind" in value && value.kind === "rollup";
}

async function computeRollup(
  sample: Sample,
  calculation: RollupCalculation,
  units: readonly ClassicEvalUnit[],
): Promise<MetricValue> {
  const evalValues: number[] = [];
  const refs: string[] = [];
  for (const unit of units) {
    const attemptValues: number[] = [];
    for (const attempt of unit.attempts) {
      const handle = classicAttemptHandleFromRow(sample, attempt);
      if (handle === undefined) {
        continue;
      }
      refs.push(handle.locator);
      const scored = await calculation.value(handle);
      if (scored !== null && Number.isFinite(scored)) {
        attemptValues.push(scored);
      }
    }
    const folded = calculation.withinEval(attemptValues);
    if (folded !== null && Number.isFinite(folded)) {
      evalValues.push(folded);
    }
  }
  return metricValue({
    value: calculation.acrossEvals(evalValues),
    samples: evalValues.length,
    total: units.length,
    basis: "eval",
    ...(calculation.unit === undefined ? {} : { unit: calculation.unit }),
    ...(calculation.format === undefined ? {} : { format: calculation.format }),
    ...(calculation.better === undefined ? {} : { better: calculation.better }),
    ...(calculation.bounds === undefined ? {} : { bounds: calculation.bounds }),
    refs,
  });
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
