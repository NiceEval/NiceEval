// 两级聚合引擎:去重 → 按维度分组 → 组内按 (experiment × eval) 折叠(perEval)→ 跨题折叠
// (acrossEvals)→ MetricCell(docs/feature/reports/architecture.md「指标聚合不变量」、
// docs/feature/reports/library/metrics.md「公开计算模型」)。
//
// 为什么是两级:earlyExit 默认开,失败的题天然比通过的题样本多;平铺求均值会把分数
// 和重试策略纠缠在一起(eval A=[1]、eval B=[0,0,0] 平铺 = 0.25,两级宏平均 = 0.5)。
// 自定义维度把同一道题的 attempt 分进不同组时,第一级折叠发生在各组内部。

import { dedupeAttempts } from "../../results/select.ts";
import type { AttemptHandle, Scope, ScopeCoverage, ScopeWarning, Snapshot } from "../../results/types.ts";
import { encodeAttemptLocator, type AttemptLocator } from "../../results/locator.ts";
import type {
  Aggregator,
  DimensionInput,
  DimensionRef,
  Metric,
  MetricCell,
  MetricColumn,
  NumericAxis,
  ReportInput,
  SeriesInput,
} from "./types.ts";
import { flagValueOf, labelValueOf, runConfigValueOf } from "./flag.ts";
import { formatMetricValue, localizedDisplay } from "./format.ts";
import { localeText, type LocalizedText } from "./locale.ts";
import { evalPrefixPredicate } from "../../shared/aggregate.ts";

// 复合键分隔符:NUL 不会出现在 eval id / experimentId / ISO 时间里,拼接键不会串味
const KEY_SEP = "\u0000";

export function resolveInput(input: ReportInput): {
  snapshots: readonly Snapshot[];
  warnings: readonly ScopeWarning[];
  coverage: readonly ScopeCoverage[];
} {
  if (Array.isArray(input)) return { snapshots: input as readonly Snapshot[], warnings: [], coverage: [] };
  const scope = input as Scope;
  return { snapshots: scope.snapshots, warnings: scope.warnings, coverage: scope.coverage };
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

/**
 * 历史执行判定(docs/feature/results/library.md「时效:新执行与历史执行」):携带条目,或
 * 所属快照(`attempt.snapshot`,attempt 自己的反向引用,真实落盘)早于该实验在 Scope 中
 * 最新快照(`item.snapshot`,`collectItems` 归属的容器快照——latest() 口径下二者是同一个
 * 对象,比较恒假,只剩 carried 生效;current() 口径下容器快照是合成的最新水位)。
 */
export function historicalOf(item: Item): boolean {
  return item.attempt.carried || item.attempt.snapshot.startedAt < item.snapshot.startedAt;
}

/** 快照键:"<experimentId> @ <startedAt>"("snapshot" 维度与手挑快照数组的对比用)。 */
export function snapshotKeyOf(snapshot: Snapshot): string {
  return `${snapshot.experimentId} @ ${snapshot.startedAt}`;
}

/** 一组 Item 的 eval 全身份键:experimentId + eval id(聚合中的题级身份始终是这一对)。 */
export function fullEvalKey(item: Item): string {
  return `${experimentIdOf(item)}${KEY_SEP}${evalIdOf(item)}`;
}

/**
 * 一条 Item 的 AttemptLocator:真实读取路径(openResults() 产出的 handle)恒有
 * `attempt.locator`;手工构造的测试 fixture 若省略它,按当前身份元组兜底算一份。
 */
export function locatorOf(item: Item): AttemptLocator {
  return (
    item.attempt.locator ??
    encodeAttemptLocator({
      experimentId: experimentIdOf(item),
      snapshotStartedAt: item.snapshot.startedAt,
      evalId: evalIdOf(item),
      attempt: item.attempt.result.attempt,
    })
  );
}

/**
 * 展平 + 聚合前去重(niceeval/results 的 dedupeAttempts,身份键
 * (experimentId, evalId, attempt, startedAt))。missing-startedAt 的警告不透出:
 * 官方产出永不缺 startedAt,缺失只可能来自 legacy 落盘,「不去重、如实保留重复」即终稿。
 */
export function collectItems(snapshots: readonly Snapshot[]): Item[] {
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

export { evalPrefixPredicate };

export function filterItems(items: Item[], evals?: string | readonly string[]): Item[] {
  if (evals === undefined) return items;
  const match = evalPrefixPredicate(Array.isArray(evals) ? [...evals] : (evals as string));
  return items.filter((item) => match(evalIdOf(item)));
}

// ───────────────────────── 维度 ─────────────────────────

export function dimensionName(dimension: DimensionInput): string {
  return typeof dimension === "string" ? dimension : dimension.name;
}

/** eval id 的完整父路径:"a/b/c" → "a/b";没有 "/" 时取完整 id(与可比组同一条派生规则)。 */
export function evalGroupOf(id: string): string {
  const slash = id.lastIndexOf("/");
  return slash === -1 ? id : id.slice(0, slash);
}

function isDimensionRef(dimension: DimensionInput): dimension is DimensionRef {
  return (
    typeof dimension === "object" &&
    "kind" in dimension &&
    ((dimension as DimensionRef).kind === "flag" ||
      (dimension as DimensionRef).kind === "runConfig" ||
      (dimension as DimensionRef).kind === "label")
  );
}

/** flag / runConfig 未声明时的显示键:内置文案,en / zh-CN 同形。 */
export const MISSING_GROUP_KEY = localeText("en", "cell.missingValue");

/** 对象键递归排序后的稳定 JSON(分组显示键与冲突检测共用)。 */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * flag / runConfig 声明值 → 分组显示键(稳定 JSON 规则):字符串直接显示,其它值用对象键
 * 递归排序后的 JSON,缺失值显示内置文案 `(missing)`。返回 [显示键, 冲突检测用的规范形]。
 */
export function refDisplayKey(value: unknown): [display: string, canonical: string] {
  if (value === undefined) return [MISSING_GROUP_KEY, "undefined"];
  if (typeof value === "string") return [value, `string:${value}`];
  return [canonicalJson(value), `json:${canonicalJson(value)}`];
}

function refValueOf(ref: DimensionRef, item: Item): unknown {
  if (ref.kind === "flag") return flagValueOf(item.attempt, ref.name);
  if (ref.kind === "label") return labelValueOf(item.attempt, ref.name);
  return runConfigValueOf(item.attempt, ref.name as Parameters<typeof runConfigValueOf>[1]);
}

export function dimensionKey(dimension: DimensionInput, item: Item): string {
  if (typeof dimension !== "string") {
    if (isDimensionRef(dimension)) return refDisplayKey(refValueOf(dimension, item))[0];
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

/**
 * series 类选项(SeriesInput)的复合维度解析:数组形态的维度 name 依声明顺序以 ` × ` 连接,
 * 每个 attempt 的维度值为各成员显示键以 ` · ` 连接(缺失成员沿用 `(missing)` 显示键参与
 * 连接,与单维度缺失同一条规则)。单维度形态与 dimensionName / dimensionKey 严格等价。
 */
export function seriesMembers(series: SeriesInput): readonly DimensionInput[] {
  return Array.isArray(series) ? (series as readonly DimensionInput[]) : [series as DimensionInput];
}

export function seriesName(series: SeriesInput): string {
  return seriesMembers(series).map(dimensionName).join(" × ");
}

export function seriesKey(series: SeriesInput, item: Item): string {
  return seriesMembers(series)
    .map((member) => dimensionKey(member, item))
    .join(" · ");
}

/**
 * 按维度分组;维度 domain 按稳定 key 字典序(Unicode)排列,不让文件扫描顺序渗进报告。
 * flag / runConfig 维度做显示键冲突检测:不同原始值生成同一显示键时报错并要求改用
 * CustomDimension,绝不静默合组。
 */
export function groupItems(items: Item[], dimension: DimensionInput): Map<string, Item[]> {
  const groups = new Map<string, Item[]>();
  const canonicalByDisplay = new Map<string, string>();
  const checkConflicts = typeof dimension !== "string" && isDimensionRef(dimension);
  for (const item of items) {
    let key: string;
    if (checkConflicts) {
      const [display, canonical] = refDisplayKey(refValueOf(dimension as DimensionRef, item));
      const existing = canonicalByDisplay.get(display);
      if (existing === undefined) canonicalByDisplay.set(display, canonical);
      else if (existing !== canonical) {
        throw new Error(
          `Dimension "${dimensionName(dimension)}" maps two different raw values to the same display key "${display}" ` +
            `(e.g. the string "5" and the number 5). Grouping them silently would merge distinct configurations; ` +
            `use a CustomDimension ({ name, of(attempt) }) to define an unambiguous key.`,
        );
      }
      key = display;
    } else {
      key = dimensionKey(dimension, item);
    }
    const list = groups.get(key);
    if (list) list.push(item);
    else groups.set(key, [item]);
  }
  return new Map([...groups.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

// ───────────────────────── 聚合 ─────────────────────────

export function applyAggregator(aggregator: Aggregator, values: readonly number[]): number {
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

function metricError(metric: Metric, step: string, cause: unknown, locator?: AttemptLocator): Error {
  const at = locator === undefined ? "" : ` at attempt ${locator}`;
  return new Error(
    `Metric "${metric.name}" ${step} failed${at}: ${cause instanceof Error ? cause.message : String(cause)}. ` +
      "Computation errors are not disguised as missing data — fix the metric (return null for expected gaps), then re-run.",
    { cause },
  );
}

/** where 不满足 → null,语义等价于 value 开头 return null;抛错与非有限数按完整用户反馈失败。 */
export async function evaluateMetric(metric: Metric, attempt: AttemptHandle): Promise<number | null> {
  const locator = attempt.locator;
  if (metric.where) {
    let pass: boolean;
    try {
      pass = metric.where(attempt);
    } catch (e) {
      throw metricError(metric, "where()", e, locator);
    }
    if (!pass) return null;
  }
  let value: number | null;
  try {
    value = await metric.value(attempt);
  } catch (e) {
    throw metricError(metric, "value()", e, locator);
  }
  if (value !== null && !Number.isFinite(value)) {
    throw metricError(metric, "value()", `returned a non-finite number (${String(value)}); return null for "not measurable"`, locator);
  }
  return value;
}

/** 单值 → LocalizedText display:metric.display 覆盖内置 unit 格式化;null 的兜底归渲染面。 */
export function displayValue(metric: Metric, value: number | null): LocalizedText {
  // null 的纯文本兜底;组件把 null 渲染成「缺数据」,绝不画 0
  if (value === null) return "—";
  if (metric.display) {
    const display = metric.display;
    return localizedDisplay((locale) => {
      try {
        return display(value, locale);
      } catch (e) {
        throw metricError(metric, "display()", e);
      }
    });
  }
  return formatMetricValue(value, metric.unit);
}

function foldAggregator(metric: Metric, step: "perEval" | "acrossEvals", values: readonly number[]): number {
  const aggregator = metric.aggregate?.[step] ?? "mean";
  let folded: number;
  try {
    folded = applyAggregator(aggregator, values);
  } catch (e) {
    throw metricError(metric, `${step} aggregator`, e);
  }
  if (!Number.isFinite(folded)) {
    throw metricError(metric, `${step} aggregator`, `returned a non-finite number (${String(folded)})`);
  }
  return folded;
}

/**
 * 一个格子:组内 attempt → 两级聚合 → 终值。
 * null 值不进聚合但计入 total(覆盖率经 samples/total 如实暴露);全 null → value null。
 * refs 跟随覆盖范围(含值为 null 的 attempt),去重后按 locator 字典序。
 */
export async function computeCell(metric: Metric, items: Item[]): Promise<MetricCell> {
  // 第一级桶:同一 (experiment × eval × 快照) 的 attempt 折成一个题级值
  const buckets = new Map<string, number[]>();
  const refs = new Set<AttemptLocator>();
  let samples = 0;
  for (const item of items) {
    refs.add(locatorOf(item));
    const value = await evaluateMetric(metric, item.attempt);
    if (value === null) continue;
    samples += 1;
    const bucketKey = `${fullEvalKey(item)}${KEY_SEP}${snapshotKeyOf(item.snapshot)}`;
    const bucket = buckets.get(bucketKey);
    if (bucket) bucket.push(value);
    else buckets.set(bucketKey, [value]);
  }
  const evalValues = [...buckets.values()].map((values) => foldAggregator(metric, "perEval", values));
  const value = evalValues.length === 0 ? null : foldAggregator(metric, "acrossEvals", evalValues);
  return {
    value,
    display: displayValue(metric, value),
    samples,
    total: items.length,
    refs: [...refs].sort(),
  };
}

export function toColumn(metric: Metric): MetricColumn {
  return {
    key: metric.name,
    label: metric.label ?? metric.name,
    ...(metric.description !== undefined ? { description: metric.description } : {}),
    ...(metric.unit !== undefined ? { unit: metric.unit } : {}),
    ...(metric.better !== undefined ? { better: metric.better } : {}),
    ...(metric.bounds !== undefined ? { bounds: metric.bounds } : {}),
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

/** NumericAxis 的取值,带完整反馈的非法值检查(NaN / Infinity 一律报错,不静默当缺失)。 */
export function axisValueOf(axis: NumericAxis, attempt: AttemptHandle): number | null {
  let value: number | null;
  try {
    value = axis.of(attempt);
  } catch (e) {
    throw new Error(
      `Numeric axis "${axis.name}" of() failed${attempt.locator ? ` at attempt ${attempt.locator}` : ""}: ${
        e instanceof Error ? e.message : String(e)
      }`,
      { cause: e },
    );
  }
  if (value !== null && !Number.isFinite(value)) {
    throw new Error(
      `Numeric axis "${axis.name}" of() returned a non-finite number (${String(value)}); return null for attempts without a plottable x value.`,
    );
  }
  return value;
}
