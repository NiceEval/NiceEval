// 两级聚合引擎:去重 → 按维度分组 → 组内按 (eval × 快照) 折叠(perEval)→ 跨题折叠(across)→ MetricCell。
//
// 为什么是两级:earlyExit 默认开,失败的题天然比通过的题样本多;平铺求均值会把分数
// 和重试策略纠缠在一起(eval A=[1]、eval B=[0,0,0] 平铺 = 0.25,两级宏平均 = 0.5)。
// 自定义维度把同一道题的 attempt 分进不同组时,第一级折叠发生在各组内部。

import {
  dedupeAttempts,
  type AttemptHandle,
  type Selection,
  type SelectionWarning,
  type Snapshot,
} from "../results/index.ts";
import type {
  Aggregator,
  AttemptRef,
  DimensionInput,
  Metric,
  MetricCell,
  MetricColumn,
  FlagRef,
} from "./types.ts";
import { formatMetricValue } from "./format.ts";

// 复合键分隔符:NUL 不会出现在 eval id / experimentId / ISO 时间里,拼接键不会串味
const KEY_SEP = "\u0000";

/** flag 未声明时的组名:不猜,如实归一组。 */
export const FLAG_UNSET = "(unset)";

/** 计算函数的第一参:选集(warnings 随行)或手工挑的快照数组(没有挑选过程,自然无警告)。 */
export type SnapshotsInput = Selection | Snapshot[];

export function resolveInput(input: SnapshotsInput): {
  snapshots: Snapshot[];
  warnings: SelectionWarning[];
} {
  if (Array.isArray(input)) return { snapshots: input, warnings: [] };
  return { snapshots: input.snapshots, warnings: input.warnings };
}

/** 展平后的一条样本:attempt + 它所属的快照(维度解析与题级折叠都需要快照身份)。 */
export interface Item {
  snapshot: Snapshot;
  attempt: AttemptHandle;
}

export function experimentIdOf(item: Item): string {
  return item.attempt.experimentId || item.snapshot.experimentId;
}

export function evalIdOf(item: Item): string {
  return item.attempt.evalId || item.attempt.result.id;
}

/** 快照键:与 view Compare 同口径的 "<experimentId> @ <startedAt>"。 */
export function snapshotKeyOf(snapshot: Snapshot): string {
  return `${snapshot.experimentId} @ ${snapshot.startedAt}`;
}

/**
 * 展平 + 聚合前去重(niceeval/results 的 dedupeAttempts,身份键
 * (experimentId, evalId, attempt, startedAt))。missing-startedAt 的警告不透出:
 * 官方产出永不缺 startedAt,缺失只可能来自 legacy 落盘,「不去重、如实保留重复」即终稿。
 */
export function collectItems(snapshots: Snapshot[]): Item[] {
  const snapshotByAttempt = new Map<AttemptHandle, Snapshot>();
  const flattened: AttemptHandle[] = [];
  for (const snapshot of snapshots) {
    for (const attempt of snapshot.attempts) {
      // 同一 handle 对象出现在两个快照里时以首次归属为准(手工挑重叠快照的极端场景)
      if (!snapshotByAttempt.has(attempt)) snapshotByAttempt.set(attempt, snapshot);
      flattened.push(attempt);
    }
  }
  const { attempts } = dedupeAttempts(flattened);
  return attempts.map((attempt) => ({ attempt, snapshot: snapshotByAttempt.get(attempt)! }));
}

/**
 * eval id 前缀过滤,同 CLI 位置参数的分段语义(src/runner/discover.ts):
 * "algebra" 匹配自身与 "algebra/..." 子级,不误配 "algebra2";允许 "algebra/" 尾斜杠写法,等价。
 */
export function evalPrefixPredicate(evals?: string | string[]): (id: string) => boolean {
  if (evals === undefined) return () => true;
  const prefixes = (Array.isArray(evals) ? evals : [evals]).map((p) => p.replace(/\/+$/, ""));
  return (id) => prefixes.some((prefix) => id === prefix || id.startsWith(prefix + "/"));
}

export function filterItems(items: Item[], evals?: string | string[]): Item[] {
  if (evals === undefined) return items;
  const match = evalPrefixPredicate(evals);
  return items.filter((item) => match(evalIdOf(item)));
}

// ───────────────────────── 维度 ─────────────────────────

export function dimensionName(dimension: DimensionInput): string {
  return typeof dimension === "string" ? dimension : dimension.name;
}

/** eval id 的第一段:"algebra/quadratic" → "algebra";没有 "/" 时就是 id 本身。 */
export function evalGroupOf(id: string): string {
  const slash = id.indexOf("/");
  return slash === -1 ? id : id.slice(0, slash);
}

function isFlagRef(dimension: DimensionInput): dimension is FlagRef {
  return typeof dimension === "object" && "kind" in dimension && dimension.kind === "flag";
}

/** experiment 声明的 flags(经 runner 原样透传进持久化字段 ExperimentRunInfo.flags)。 */
function flagsOf(attempt: AttemptHandle): Record<string, unknown> | undefined {
  return attempt.result.experiment?.flags;
}

/** flag 声明值 → 组标签:label 函数优先,其余 String();未声明 → FLAG_UNSET。 */
export function flagGroupKey(ref: FlagRef, item: Item): string {
  const value = flagsOf(item.attempt)?.[ref.name];
  if (value === undefined) return FLAG_UNSET;
  // 持久化字段是 Record<string, unknown>;声明侧的合法值就是这三种标量
  if (typeof ref.label === "function") return ref.label(value as string | number | boolean);
  return String(value);
}

/** flag 作轴:要求数值;未声明或非数值 → null(点不画,注脚报数)。 */
export function flagAxisValue(ref: FlagRef, item: Item): number | null {
  const value = flagsOf(item.attempt)?.[ref.name];
  return typeof value === "number" ? value : null;
}

export function dimensionKey(dimension: DimensionInput, item: Item): string {
  if (typeof dimension !== "string") {
    if (isFlagRef(dimension)) return flagGroupKey(dimension, item);
    return dimension.of(item.attempt);
  }
  const result = item.attempt.result;
  switch (dimension) {
    case "agent":
      return result.agent;
    case "model":
      return result.model ?? item.snapshot.model ?? "(none)";
    case "experiment":
      return experimentIdOf(item);
    case "eval":
      return evalIdOf(item);
    case "evalGroup":
      return evalGroupOf(evalIdOf(item));
    case "snapshot":
      return snapshotKeyOf(item.snapshot);
    default: {
      // 穷尽检查:新增内置维度而漏改这里时编译期报错
      const exhausted: never = dimension;
      throw new Error(`Unknown dimension: ${String(exhausted)}`);
    }
  }
}

/** 按维度分组,保持首次出现顺序(无 sort 时表格行序即此序)。 */
export function groupItems(items: Item[], dimension: DimensionInput): Map<string, Item[]> {
  const groups = new Map<string, Item[]>();
  for (const item of items) {
    const key = dimensionKey(dimension, item);
    const list = groups.get(key);
    if (list) list.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}

// ───────────────────────── 聚合 ─────────────────────────

export function applyAggregator(aggregator: Aggregator, values: number[]): number {
  if (typeof aggregator === "function") return aggregator(values);
  switch (aggregator) {
    case "mean":
      return values.reduce((a, b) => a + b, 0) / values.length;
    case "sum":
      return values.reduce((a, b) => a + b, 0);
    case "min":
      return Math.min(...values);
    case "max":
      return Math.max(...values);
  }
}

/** where 不满足 → null,语义等价于 value 开头 return null。 */
export async function evaluateMetric(metric: Metric, attempt: AttemptHandle): Promise<number | null> {
  if (metric.where && !metric.where(attempt)) return null;
  return metric.value(attempt);
}

export function displayValue(metric: Metric, value: number | null): string {
  // null 的纯文本兜底;组件把 null 渲染成「缺数据」,绝不画 0
  if (value === null) return "—";
  return metric.display ? metric.display(value) : formatMetricValue(value, metric.unit);
}

/**
 * 一个格子:组内 attempt → 两级聚合 → 终值。
 * null 值不进聚合但计入 total(覆盖率经 samples/total 如实暴露);全 null → value null。
 */
export async function computeCell(metric: Metric, items: Item[]): Promise<MetricCell> {
  // 第一级桶:同一 (eval × 快照) 的 attempt 折成一个题级值
  const buckets = new Map<string, number[]>();
  const refs: AttemptRef[] = [];
  let samples = 0;
  for (const item of items) {
    const value = await evaluateMetric(metric, item.attempt);
    if (value === null) continue;
    samples += 1;
    refs.push(item.attempt.ref); // 证据引用由句柄直供,不反查下标
    const bucketKey = `${evalIdOf(item)}${KEY_SEP}${snapshotKeyOf(item.snapshot)}`;
    const bucket = buckets.get(bucketKey);
    if (bucket) bucket.push(value);
    else buckets.set(bucketKey, [value]);
  }
  const perEval = metric.aggregate?.perEval ?? "mean";
  const across = metric.aggregate?.across ?? "mean";
  const evalValues = [...buckets.values()].map((values) => applyAggregator(perEval, values));
  const value = evalValues.length === 0 ? null : applyAggregator(across, evalValues);
  return { value, display: displayValue(metric, value), samples, total: items.length, refs };
}

export function toColumn(metric: Metric): MetricColumn {
  return {
    key: metric.name,
    label: metric.label ?? metric.name,
    unit: metric.unit,
    better: metric.better,
  };
}

export function assertUniqueMetricNames(metrics: readonly Metric[], where: string): void {
  const seen = new Set<string>();
  for (const metric of metrics) {
    if (seen.has(metric.name)) {
      throw new Error(
        `Duplicate metric name "${metric.name}" in ${where}. Metric names must be unique within one computation; rename one via defineMetric.`,
      );
    }
    seen.add(metric.name);
  }
}
