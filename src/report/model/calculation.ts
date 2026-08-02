// 普通值计算内核：Reducer / MetricValue / rollup / aggregate / 官方分组。
// 契约见 docs/feature/reports/library.md 与 calculations.md。

import type { AttemptHandle, Sample, SampleCoverage, Run } from "../../record/types.ts";
import type { AttemptLocator } from "../../record/locator.ts";
import { encodeAttemptLocator } from "../../record/locator.ts";
import type { EvalResult } from "../../types.ts";

// ── AggregationSubject ──────────────────────────────────────────────

/** 题级单元（Experiment × Eval）的事实视图；不暴露 attempts。 */
export interface AggregationSubject {
  readonly experimentId: string;
  readonly evalId: string;
  /** 该 Experiment 的锚点 Run。 */
  readonly run: Run;
}

// ── Reducer ─────────────────────────────────────────────────────────

export interface Reducer {
  (values: readonly number[]): number | null;
  readonly name: string;
}

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
  for (const v of values) sum += v;
  return sum / values.length;
});

export const sum: Reducer = defineReducer("sum", (values) => {
  let total = 0;
  for (const v of values) total += v;
  return total;
});

export const min: Reducer = defineReducer("min", (values) => Math.min(...values));

export const max: Reducer = defineReducer("max", (values) => Math.max(...values));

/** 闭区间 [0, 1]；升序后 h = (n-1)×p，在 floor(h) 与 ceil(h) 间线性插值。 */
export function percentile(p: number): Reducer {
  if (!Number.isFinite(p) || p < 0 || p > 1) {
    throw new Error(`percentile(p) requires p in [0, 1], got ${String(p)}`);
  }
  return defineReducer(`percentile(${p})`, (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    const n = sorted.length;
    if (n === 1) return sorted[0]!;
    const h = (n - 1) * p;
    const lo = Math.floor(h);
    const hi = Math.ceil(h);
    if (lo === hi) return sorted[lo]!;
    const w = h - lo;
    return sorted[lo]! * (1 - w) + sorted[hi]! * w;
  });
}

// ── MetricValue / EvidenceRow ───────────────────────────────────────

export type MetricBasis = "attempt" | "eval" | "run" | "pair";

export type MetricFormat =
  | "number"
  | "percent"
  | "duration"
  | "currency"
  | { readonly kind: "custom"; readonly format: (value: number, locale: string) => string };

export interface MetricValue {
  readonly value: number | null;
  readonly unit?: string;
  readonly format?: MetricFormat;
  readonly better?: "higher" | "lower";
  readonly bounds?: { readonly min?: number; readonly max?: number };
  readonly samples: number;
  readonly total: number;
  readonly basis: MetricBasis;
  readonly refs: readonly AttemptLocator[];
}

export interface EvidenceRow {
  readonly refs: readonly AttemptLocator[];
}

/** 只用于把作者侧的静态契约错误留在调用点；不会出现在运行时结果里。 */
const CONTRACT_DIAGNOSTIC: unique symbol = Symbol("niceeval.report.contractDiagnostic");

type KeysMatching<Row, Value> = {
  [Key in keyof Row]-?: Row[Key] extends Value ? Key : never;
}[keyof Row];

type MetricKeys<Row> = KeysMatching<Row, MetricValue>;

type EvidenceNeedsMetric = {
  readonly [CONTRACT_DIAGNOSTIC]: "evidence row needs at least one MetricValue field";
};

type WithMetricField<Fields extends object> =
  [MetricKeys<Fields>] extends [never] ? EvidenceNeedsMetric : unknown;

function locatorOfEvidence(item: AttemptHandle | AttemptLocator): AttemptLocator {
  if (typeof item === "string") return item as AttemptLocator;
  if (item.locator) return item.locator;
  return encodeAttemptLocator({
    runId: item.run.runId,
    evalId: item.evalId,
    attempt: item.result.attempt,
  });
}

/** 稳定去重：按字符串序，保留首次出现。 */
export function dedupeLocators(locators: readonly AttemptLocator[]): AttemptLocator[] {
  const seen = new Set<string>();
  const out: AttemptLocator[] = [];
  for (const loc of locators) {
    if (seen.has(loc)) continue;
    seen.add(loc);
    out.push(loc);
  }
  return out;
}

export function metricValue(options: {
  value: number | null;
  samples: number;
  total: number;
  basis: MetricBasis;
  evidence: readonly (AttemptHandle | AttemptLocator)[];
  unit?: string;
  format?: MetricFormat;
  better?: "higher" | "lower";
  bounds?: { min?: number; max?: number };
}): MetricValue {
  const { value, samples, total, basis, evidence } = options;
  if (!Number.isInteger(samples) || !Number.isInteger(total) || samples < 0 || total < 0 || samples > total) {
    throw new Error(
      `metricValue requires 0 <= samples <= total (integers); got samples=${samples}, total=${total}`,
    );
  }
  if (value !== null && !Number.isFinite(value)) {
    throw new Error(`metricValue value must be finite or null, got ${String(value)}`);
  }
  return {
    value,
    ...(options.unit !== undefined ? { unit: options.unit } : {}),
    ...(options.format !== undefined ? { format: options.format } : {}),
    ...(options.better !== undefined ? { better: options.better } : {}),
    ...(options.bounds !== undefined ? { bounds: options.bounds } : {}),
    samples,
    total,
    basis,
    refs: dedupeLocators(evidence.map(locatorOfEvidence)),
  };
}

function isMetricFormat(value: unknown): value is MetricFormat {
  return (
    value === "number" ||
    value === "percent" ||
    value === "duration" ||
    value === "currency" ||
    (typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      (value as { kind?: unknown }).kind === "custom" &&
      typeof (value as { format?: unknown }).format === "function")
  );
}

export function isMetricValue(value: unknown): value is MetricValue {
  if (!value || typeof value !== "object") return false;
  const v = value as MetricValue;
  return (
    (v.value === null || (typeof v.value === "number" && Number.isFinite(v.value))) &&
    Number.isInteger(v.samples) &&
    Number.isInteger(v.total) &&
    v.samples >= 0 &&
    v.total >= 0 &&
    v.samples <= v.total &&
    (v.basis === "attempt" || v.basis === "eval" || v.basis === "run" || v.basis === "pair") &&
    Array.isArray(v.refs) &&
    v.refs.every((ref) => typeof ref === "string") &&
    (v.unit === undefined || typeof v.unit === "string") &&
    (v.format === undefined || isMetricFormat(v.format)) &&
    (v.better === undefined || v.better === "higher" || v.better === "lower") &&
    (v.bounds === undefined ||
      (typeof v.bounds === "object" &&
        v.bounds !== null &&
        !Array.isArray(v.bounds) &&
        (v.bounds.min === undefined || (typeof v.bounds.min === "number" && Number.isFinite(v.bounds.min))) &&
        (v.bounds.max === undefined || (typeof v.bounds.max === "number" && Number.isFinite(v.bounds.max)))))
  );
}

function buildEvidenceRow(fields: object): EvidenceRow {
  const metricFields = Object.values(fields).filter(isMetricValue);
  if (metricFields.length === 0) {
    throw new Error("evidenceRow requires at least one MetricValue field");
  }
  return { refs: dedupeLocators(metricFields.flatMap((metric) => metric.refs)) };
}

export function evidenceRow<const Fields extends object>(
  fields: Fields & WithMetricField<Fields>,
): Fields & EvidenceRow {
  return { ...fields, ...buildEvidenceRow(fields) };
}

function valueDescription(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function isEvidenceDimension(value: unknown): value is string | number | boolean | null {
  return value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value));
}

/**
 * 外部 JSON / 数据库行的显式运行时入口。字面量仍应使用 evidenceRow()，以保住字段级推断与
 * “至少一个 MetricValue” 的编译期证明；未知值则在这里逐字段完成同一份结构证明。
 */
export function parseEvidenceRow(value: unknown): EvidenceRow {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`parseEvidenceRow: row must be an object, got ${valueDescription(value)}`);
  }
  const fields = value as globalThis.Record<string, unknown>;
  const metricNames: string[] = [];
  const dimensionNames: string[] = [];

  for (const [name, field] of Object.entries(fields)) {
    if (isMetricValue(field)) {
      metricNames.push(name);
      continue;
    }
    if (isEvidenceDimension(field)) {
      dimensionNames.push(name);
      continue;
    }
    throw new Error(
      `parseEvidenceRow: field ${JSON.stringify(name)} must be a MetricValue ({ value, unit? }), got ${valueDescription(field)}`,
    );
  }

  if (metricNames.length === 0) {
    throw new Error(
      `parseEvidenceRow: row needs at least one MetricValue field, got only dimensions (${dimensionNames.join(", ")})`,
    );
  }
  return { ...fields, ...buildEvidenceRow(fields) };
}

export function parseEvidenceRows(value: unknown): readonly EvidenceRow[] {
  if (!Array.isArray(value)) {
    throw new Error(`parseEvidenceRows: expected an array of rows, got ${valueDescription(value)}`);
  }
  return value.map((row, index) => {
    try {
      return parseEvidenceRow(row);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`parseEvidenceRows: row ${index}: ${message}`);
    }
  });
}

// ── Calculation / rollup ────────────────────────────────────────────

const CALCULATION_BRAND = Symbol.for("niceeval.report.Calculation");

export interface RollupOptions {
  withinEval?: Reducer;
  acrossEvals?: Reducer;
  unit?: string;
  better?: "higher" | "lower";
  bounds?: { min?: number; max?: number };
  format?: MetricFormat;
}

export interface Calculation {
  readonly [CALCULATION_BRAND]: true;
  readonly name?: string;
  readonly unit?: string;
  readonly better?: "higher" | "lower";
  readonly bounds?: { min?: number; max?: number };
  readonly format?: MetricFormat;
  readonly withinEval: Reducer;
  readonly acrossEvals: Reducer;
  value(attempt: AttemptHandle): number | null | Promise<number | null>;
}

export function isCalculation(value: unknown): value is Calculation {
  return typeof value === "function"
    ? false
    : Boolean(value && typeof value === "object" && (value as Calculation)[CALCULATION_BRAND] === true);
}

export function rollup(
  value: (attempt: AttemptHandle) => number | null | Promise<number | null>,
  options: RollupOptions = {},
): Calculation {
  if (typeof value !== "function") {
    throw new Error("rollup requires a value(attempt) function");
  }
  const withinEval = options.withinEval ?? mean;
  const acrossEvals = options.acrossEvals ?? mean;
  return {
    [CALCULATION_BRAND]: true,
    ...(options.unit !== undefined ? { unit: options.unit } : {}),
    ...(options.better !== undefined ? { better: options.better } : {}),
    ...(options.bounds !== undefined ? { bounds: options.bounds } : {}),
    ...(options.format !== undefined ? { format: options.format } : {}),
    withinEval,
    acrossEvals,
    value,
  };
}

// ── 官方分组 ────────────────────────────────────────────────────────

export type GroupFunction = (subject: AggregationSubject) => string;

export const experiment: GroupFunction = (subject) => subject.experimentId;
Object.defineProperty(experiment, "name", { value: "experiment" });

export const evalId: GroupFunction = (subject) => subject.evalId;
Object.defineProperty(evalId, "name", { value: "evalId" });

export const agent: GroupFunction = (subject) => subject.run.agent;
Object.defineProperty(agent, "name", { value: "agent" });

export const model: GroupFunction = (subject) => subject.run.model ?? "";
Object.defineProperty(model, "name", { value: "model" });

/** Attempt 成本：网关实测优先于估算；都缺 → null。 */
export function attemptCostUSD(result: EvalResult): number | null {
  return result.usage?.costUSD ?? result.estimatedCostUSD ?? null;
}

// ── 官方 Calculation ────────────────────────────────────────────────

export const passRate = rollup(
  (attempt) => {
    switch (attempt.result.verdict) {
      case "passed":
        return 1;
      case "failed":
      case "errored":
        return 0;
      case "skipped":
        return null;
      default:
        return null;
    }
  },
  {
    withinEval: mean,
    acrossEvals: mean,
    unit: "%",
    better: "higher",
    bounds: { min: 0, max: 1 },
  },
);

export const durationMs = rollup(
  (attempt) => {
    if (attempt.result.verdict === "skipped") return null;
    if (attempt.result.verdict === "errored" && attempt.result.error?.code === "timeout") return null;
    return attempt.result.durationMs ?? null;
  },
  {
    withinEval: mean,
    acrossEvals: mean,
    unit: "ms",
    better: "lower",
    bounds: { min: 0 },
  },
);

export const tokens = rollup(
  (attempt) => {
    if (attempt.result.verdict === "skipped") return null;
    const usage = attempt.result.usage;
    if (!usage || usage.inputTokens === undefined || usage.outputTokens === undefined) return null;
    return usage.inputTokens + usage.outputTokens;
  },
  {
    withinEval: mean,
    acrossEvals: mean,
    unit: "tokens",
    better: "lower",
    bounds: { min: 0 },
  },
);

export const totalScore = rollup(
  (attempt) => {
    if (attempt.result.evaluationKind !== "points") return null;
    if (attempt.result.verdict === "errored" || attempt.result.verdict === "skipped") return null;
    let points = 0;
    for (const assertion of attempt.result.assertions) {
      if (assertion.outcome !== "unavailable" && typeof assertion.points === "number") points += assertion.points;
    }
    for (const entry of attempt.result.scoreEntries ?? []) points += entry.points;
    return points;
  },
  {
    withinEval: mean,
    acrossEvals: sum,
    better: "higher",
    bounds: { min: 0 },
  },
);

export const costUSD = rollup(
  (attempt) => (attempt.result.verdict === "skipped" ? null : attemptCostUSD(attempt.result)),
  {
    withinEval: mean,
    acrossEvals: mean,
    unit: "$",
    better: "lower",
    bounds: { min: 0 },
  },
);

// ── Units from coverage + attempts ──────────────────────────────────

interface EvalUnit {
  subject: AggregationSubject;
  attempts: AttemptHandle[];
}

function buildEvalUnits(sample: Sample): EvalUnit[] {
  const byKey = new Map<string, EvalUnit>();

  for (const coverage of sample.coverage) {
    for (const evalId of coverage.knownEvalIds) {
      const key = `${coverage.experimentId}\0${evalId}`;
      byKey.set(key, {
        subject: {
          experimentId: coverage.experimentId,
          evalId,
          run: coverage.run,
        },
        attempts: [],
      });
    }
  }

  for (const attempt of sample.attempts) {
    const key = `${attempt.experimentId}\0${attempt.evalId}`;
    let unit = byKey.get(key);
    if (!unit) {
      // attempts 出现但 coverage 未声明：仍建单元，锚点取 attempt.run。
      unit = {
        subject: {
          experimentId: attempt.experimentId,
          evalId: attempt.evalId,
          run: attempt.run,
        },
        attempts: [],
      };
      byKey.set(key, unit);
    }
    unit.attempts.push(attempt);
  }

  return [...byKey.values()].sort((a, b) => {
    const exp = a.subject.experimentId.localeCompare(b.subject.experimentId);
    if (exp !== 0) return exp;
    return a.subject.evalId.localeCompare(b.subject.evalId);
  });
}

async function foldWithinEval(
  calc: Calculation,
  attempts: readonly AttemptHandle[],
): Promise<{ value: number | null; refs: AttemptLocator[] }> {
  const values: number[] = [];
  const refs: AttemptLocator[] = [];
  for (const attempt of attempts) {
    refs.push(locatorOfEvidence(attempt));
    const raw = await calc.value(attempt);
    if (raw === null || raw === undefined) continue;
    if (!Number.isFinite(raw)) {
      throw new Error(`Calculation produced non-finite value: ${String(raw)}`);
    }
    values.push(raw);
  }
  return {
    value: values.length === 0 ? null : calc.withinEval(values),
    refs: dedupeLocators(refs),
  };
}

async function applyCalculation(
  calc: Calculation,
  units: readonly EvalUnit[],
): Promise<MetricValue> {
  const evalValues: number[] = [];
  const allRefs: AttemptLocator[] = [];
  let samples = 0;
  const total = units.length;

  for (const unit of units) {
    const folded = await foldWithinEval(calc, unit.attempts);
    allRefs.push(...folded.refs);
    if (folded.value === null) continue;
    evalValues.push(folded.value);
    samples += 1;
  }

  return metricValue({
    value: evalValues.length === 0 ? null : calc.acrossEvals(evalValues),
    samples,
    total,
    basis: "eval",
    evidence: allRefs,
    ...(calc.unit !== undefined ? { unit: calc.unit } : {}),
    ...(calc.better !== undefined ? { better: calc.better } : {}),
    ...(calc.bounds !== undefined ? { bounds: calc.bounds } : {}),
    ...(calc.format !== undefined ? { format: calc.format } : {}),
  });
}

// ── aggregate ───────────────────────────────────────────────────────

type GroupFunctions = globalThis.Record<string, GroupFunction>;
type CalculationFunctions = globalThis.Record<string, Calculation>;

/** 带 string index signature 的动态对象无法在编译期知道实际键；保留运行时校验。 */
type KnownKeys<T> = string extends keyof T ? never : keyof T;

type AggregateKeyConflict<Groups, Values> =
  | Extract<KnownKeys<Groups>, KnownKeys<Values>>
  | Extract<KnownKeys<Groups> | KnownKeys<Values>, "refs">;

type AggregateKeyDiagnostic<Key extends PropertyKey> = {
  readonly [CONTRACT_DIAGNOSTIC]: `aggregate key conflict: ${Extract<Key, string>}`;
};

type NoAggregateKeyConflict<Groups, Values> =
  [AggregateKeyConflict<Groups, Values>] extends [never]
    ? unknown
    : AggregateKeyDiagnostic<AggregateKeyConflict<Groups, Values>>;

export type AggregateRow<
  Groups extends GroupFunctions,
  Values extends CalculationFunctions,
> = {
  readonly [K in keyof Groups]: string;
} & {
  readonly [K in keyof Values]: MetricValue;
} & EvidenceRow;

function assertNoKeyCollision(
  by: GroupFunctions,
  values: CalculationFunctions,
): void {
  const byKeys = new Set(Object.keys(by));
  for (const key of Object.keys(values)) {
    if (key === "refs") {
      throw new Error(`aggregate values must not use reserved key "refs"`);
    }
    if (byKeys.has(key)) {
      throw new Error(`aggregate key "${key}" appears in both by and values`);
    }
  }
  for (const key of Object.keys(by)) {
    if (key === "refs") {
      throw new Error(`aggregate by must not use reserved key "refs"`);
    }
  }
}

export async function aggregate<
  const Groups extends GroupFunctions,
  const Values extends CalculationFunctions,
>(
  sample: Sample,
  options: { by: Groups; values: Values } & NoAggregateKeyConflict<Groups, Values>,
): Promise<readonly AggregateRow<Groups, Values>[]> {
  const { by, values } = options;
  assertNoKeyCollision(by, values);

  for (const [name, calc] of Object.entries(values)) {
    if (!isCalculation(calc)) {
      throw new Error(
        `aggregate values.${name} must be a Calculation from rollup(); plain functions are not accepted`,
      );
    }
  }

  const units = buildEvalUnits(sample);
  const groups = new Map<string, { keys: globalThis.Record<string, string>; units: EvalUnit[] }>();

  for (const unit of units) {
    const keys: globalThis.Record<string, string> = {};
    for (const [field, fn] of Object.entries(by)) {
      try {
        const key = fn(unit.subject);
        if (typeof key !== "string") {
          throw new Error(`group function must return a string, got ${typeof key}`);
        }
        keys[field] = key;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          `aggregate() 的分组 "${field}" 在 ${unit.subject.experimentId} × ${unit.subject.evalId} 上抛错。\n原因：${message}`,
        );
      }
    }
    // 分组函数允许返回任意字符串，不能用 NUL / "=" 自制分隔协议：合法值本身可含这些字符，
    // 两组不同坐标会因此静默撞成一行。排序后的 tuple JSON 是无歧义身份。
    const groupKey = JSON.stringify(
      Object.keys(keys)
        .sort()
        .map((field) => [field, keys[field]]),
    );
    let group = groups.get(groupKey);
    if (!group) {
      group = { keys, units: [] };
      groups.set(groupKey, group);
    }
    group.units.push(unit);
  }

  const rows: AggregateRow<Groups, Values>[] = [];
  const sortedGroups = [...groups.values()].sort((a, b) => {
    for (const field of Object.keys(by).sort()) {
      const cmp = (a.keys[field] ?? "").localeCompare(b.keys[field] ?? "");
      if (cmp !== 0) return cmp;
    }
    return 0;
  });

  for (const group of sortedGroups) {
    const valueFields: globalThis.Record<string, MetricValue> = {};
    for (const [name, calc] of Object.entries(values)) {
      valueFields[name] = await applyCalculation(calc, group.units);
    }
    rows.push({ ...group.keys, ...valueFields, ...buildEvidenceRow(valueFields) } as AggregateRow<Groups, Values>);
  }

  return rows;
}

export type { SampleCoverage };
