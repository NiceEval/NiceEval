// 计算函数(*Data):ReportInput → 一份组件数据。跑在 Node 侧,产物是算好的、可序列化的
// 普通 JSON(终值 + 渲染提示,不含公式);渲染面(web/text)只做展示。指标图形族
// (MetricTable / MetricMatrix / MetricBars / Scoreboard / MetricScatter / MetricLine /
// DeltaTable)的 *Data 与配套 Options 都住在这里(docs/feature/reports/library/metric-views.md)。
//
// 共同约定(docs/feature/reports/architecture.md「指标聚合不变量」):
// - 第一参收 ReportInput = Scope | readonly Snapshot[];warnings 不进组件数据(宿主统一显示);
// - 聚合前按身份键去重(dedupeAttempts;missing-startedAt 不去重、如实保留、不透出警告);
// - null ≠ 0:缺数据不编数,覆盖率经 samples/total 如实暴露;
// - 显式传入的列表(questions / pairs / metrics)保留声明顺序,从数据发现的维度 domain
//   按稳定 key 字典序;
// - core 中立:只认 Metric / Dimension 接口,不出现具体 agent 名的分支。

import type {
  DeltaCell,
  DeltaData,
  DimensionInput,
  FlagConditions,
  LineData,
  MatrixData,
  Metric,
  MetricCell,
  NumericAxis,
  ReportInput,
  ScatterData,
  ScoreboardData,
  SeriesInput,
  StabilityMatrixData,
  TableData,
} from "../../model/types.ts";
import type { JsonValue, Verdict } from "../../../types.ts";
import type { AttemptLocator } from "../../../results/locator.ts";
import type { Snapshot } from "../../../results/types.ts";
import { comparabilityConfigOf, deepEqualJson } from "../../../results/select.ts";
import { foldEvalVerdict } from "../../../shared/verdict.ts";
import {
  assertUniqueMetricNames,
  axisValueOf,
  collectItems,
  computeCell,
  dimensionKey,
  dimensionName,
  evalGroupOf,
  evalIdOf,
  evaluateMetric,
  experimentIdOf,
  filterItems,
  fullEvalKey,
  groupItems,
  historicalOf,
  locatorOf,
  refDisplayKey,
  resolveInput,
  seriesKey,
  seriesName,
  toColumn,
  type Item,
} from "../../model/aggregate.ts";
import { costUSD as costUSDMetric, examScore, tokens as tokensMetric, totalScore as totalScoreMetric } from "../../model/metrics.ts";
import { formatMetricValue, formatPercent, formatPlainNumber, formatPoints, MISSING_TEXT } from "../../model/format.ts";
import type { LocalizedText } from "../../model/locale.ts";
import { selectedAttemptsOnly } from "../shared-compute.ts";

// ───────────────────────── metricTableData ─────────────────────────

export interface MetricTableOptions {
  /** 行维度(内置 / 自定义 / flag() / runConfig())。 */
  rows: DimensionInput;
  /** 每列一个指标;非空元组,元素是静态 import 的 Metric 实例。 */
  columns: readonly [Metric, ...Metric[]];
  /**
   * 初始行序:必须是 columns 中同一个 Metric 实例且声明了 better,方向随 better
   * (「好」的一头在上),缺数据行沉底;省略时按行 key 字典序。
   */
  sort?: Metric;
  /** eval id 前缀过滤,同 CLI 位置参数语义;在聚合之前收窄题集。 */
  evals?: string | readonly string[];
}

export async function metricTableData(input: ReportInput, options: MetricTableOptions): Promise<TableData> {
  assertUniqueMetricNames(options.columns, "metricTableData columns");
  if (options.sort !== undefined) {
    if (!options.columns.includes(options.sort)) {
      throw new Error(
        `metricTableData sort must be one of the Metric instances passed in columns (got "${options.sort.name}"). ` +
          "Pass the same imported instance in both places so the sorted column is visible in the table.",
      );
    }
    if (options.sort.better === undefined) {
      throw new Error(
        `metricTableData cannot sort by "${options.sort.name}": the metric declares no "better" direction, so there is no defined order. ` +
          'Declare better: "higher" | "lower" on the metric, or drop sort to keep the lexicographic row order.',
      );
    }
  }
  const { snapshots, attempts } = resolveInput(input);
  const items = filterItems(collectItems(snapshots, attempts), options.evals);
  const groups = groupItems(items, options.rows);
  const rows: TableData["rows"] = [];
  for (const [key, group] of groups) {
    const cells: Record<string, MetricCell> = {};
    for (const metric of options.columns) cells[metric.name] = await computeCell(metric, group);
    rows.push({ key, cells });
  }
  if (options.sort) {
    const better = options.sort.better ?? "higher";
    const name = options.sort.name;
    rows.sort((a, b) => {
      const va = a.cells[name]?.value ?? null;
      const vb = b.cells[name]?.value ?? null;
      if (va === null && vb === null) return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
      if (va === null) return 1; // 缺数据沉底
      if (vb === null) return -1;
      const diff = better === "lower" ? va - vb : vb - va;
      if (diff !== 0) return diff;
      return a.key < b.key ? -1 : a.key > b.key ? 1 : 0; // 稳定排序,同值以 key 收口
    });
  }
  return {
    rowDimension: dimensionName(options.rows),
    columns: options.columns.map(toColumn),
    rows,
  };
}

// ───────────────────────── metricMatrixData(= MetricBars 的数据)─────────────────────────

export interface MetricMatrixOptions {
  rows: DimensionInput;
  columns: DimensionInput;
  cell: Metric;
  /** eval id 前缀过滤,同 CLI 位置参数语义。 */
  evals?: string | readonly string[];
}

export async function metricMatrixData(input: ReportInput, options: MetricMatrixOptions): Promise<MatrixData> {
  const { snapshots, attempts } = resolveInput(input);
  const items = filterItems(collectItems(snapshots, attempts), options.evals);
  // 稀疏分组:只有真有 attempt 的 (row, column) 组合成格;没有样本的格子不出现
  const groups = new Map<string, { row: string; column: string; items: Item[] }>();
  for (const item of items) {
    const row = dimensionKey(options.rows, item);
    const column = dimensionKey(options.columns, item);
    const key = JSON.stringify([row, column]);
    const group = groups.get(key);
    if (group) group.items.push(item);
    else groups.set(key, { row, column, items: [item] });
  }
  const ordered = [...groups.values()].sort(
    (a, b) => (a.row < b.row ? -1 : a.row > b.row ? 1 : a.column < b.column ? -1 : a.column > b.column ? 1 : 0),
  );
  const cells: MatrixData["cells"] = [];
  for (const group of ordered) {
    cells.push({ row: group.row, column: group.column, cell: await computeCell(options.cell, group.items) });
  }
  return {
    rowDimension: dimensionName(options.rows),
    columnDimension: dimensionName(options.columns),
    metric: toColumn(options.cell),
    cells,
  };
}

export interface ScoreboardOptions {
  rows: DimensionInput;
  /** 固定题集;eval id 必须唯一。元素引用运行时数据,类型放宽为普通数组,空数组在计算时报错。 */
  questions: readonly string[];
  /** 分科函数;默认与 evalGroup 维度同一条规则:取 eval id 的完整父路径,无 `/` 取完整 id。 */
  subject?: (evalId: string) => string;
  /** 权重按 eval id 前缀匹配,多个命中时最长前缀生效;默认 1。 */
  weights?: Readonly<Record<string, number>>;
  fullMarks?: number;
  score?: Metric;
}

/**
 * 固定题集分母:未跑题按 0 分计入 `notRun`,跑了但指标为 null 的题按 0 分计入 `unscorable`,
 * 两个计数不合并——成绩单能回答「这 0 分是没去考还是考了判不了」。组件不从已观测 attempt
 * 的并集猜分母;Scope 中题集之外的 eval 被忽略并计入 `ignoredEvals`。
 */
export async function scoreboardData(input: ReportInput, options: ScoreboardOptions): Promise<ScoreboardData> {
  const questions = options.questions;
  if (!Array.isArray(questions) || questions.length === 0) {
    throw new Error(
      "scoreboardData questions must be a non-empty list of eval ids: the fixed question set is the denominator, and an empty denominator makes no scoreboard. " +
        "Pass the eval ids to grade, or filter your source list before passing it.",
    );
  }
  const seen = new Set<string>();
  for (const q of questions) {
    if (seen.has(q)) {
      throw new Error(
        `scoreboardData questions contains "${q}" twice — each question is one denominator slot; remove the duplicate.`,
      );
    }
    seen.add(q);
  }
  const fullMarks = options.fullMarks ?? 100;
  if (!Number.isFinite(fullMarks) || fullMarks <= 0) {
    throw new Error(`scoreboardData fullMarks must be a positive finite number (got ${String(fullMarks)}).`);
  }
  const weightEntries = Object.entries(options.weights ?? {});
  for (const [prefix, weight] of weightEntries) {
    if (prefix.length === 0) {
      throw new Error('scoreboardData weights contains an empty prefix ""; weight prefixes must be non-empty eval id prefixes.');
    }
    if (!Number.isFinite(weight) || weight <= 0) {
      throw new Error(
        `scoreboardData weight for prefix "${prefix}" must be a positive finite number (got ${String(weight)}).`,
      );
    }
  }
  const scoreMetric = options.score ?? examScore;
  const subjectOf = options.subject ?? evalGroupOf;

  const { snapshots, attempts } = resolveInput(input);
  const allItems = collectItems(snapshots, attempts);
  const questionSet = new Set(questions);
  const items = allItems.filter((item) => questionSet.has(evalIdOf(item)));
  const ignored = new Set<string>();
  for (const item of allItems) {
    const id = evalIdOf(item);
    if (!questionSet.has(id)) ignored.add(id);
  }

  // 权重:最长前缀生效(排序后线性找第一个命中即最长)
  const weights = weightEntries
    .map(([prefix, weight]) => ({ prefix, weight }))
    .sort((a, b) => b.prefix.length - a.prefix.length);
  const weightOf = (id: string): number => weights.find((w) => id.startsWith(w.prefix))?.weight ?? 1;

  const subjectByQuestion = new Map<string, string>();
  for (const id of questions) {
    const subject = subjectOf(id);
    if (typeof subject !== "string" || subject.length === 0) {
      throw new Error(
        `scoreboardData subject("${id}") returned an empty value; every question must map to a non-empty subject name.`,
      );
    }
    subjectByQuestion.set(id, subject);
  }

  const groups = groupItems(items, options.rows);
  const rows: ScoreboardData["rows"] = [];
  for (const [key, group] of groups) {
    const byQuestion = new Map<string, Item[]>();
    for (const item of group) {
      const id = evalIdOf(item);
      const list = byQuestion.get(id);
      if (list) list.push(item);
      else byQuestion.set(id, [item]);
    }

    const subjects = new Map<
      string,
      {
        key: string;
        earned: number;
        possible: number;
        questions: number;
        notRun: number;
        unscorable: number;
        refs: Set<AttemptLocator>;
      }
    >();
    const totalRefs = new Set<AttemptLocator>();
    for (const id of questions) {
      const subjectKey = subjectByQuestion.get(id)!;
      let subject = subjects.get(subjectKey);
      if (!subject) {
        subjects.set(
          subjectKey,
          (subject = { key: subjectKey, earned: 0, possible: 0, questions: 0, notRun: 0, unscorable: 0, refs: new Set() }),
        );
      }
      const weight = weightOf(id);
      subject.possible += weight;
      subject.questions += 1;
      const questionItems = byQuestion.get(id);
      if (questionItems === undefined) {
        subject.notRun += 1;
        continue;
      }
      for (const item of questionItems) {
        const locator = locatorOf(item);
        subject.refs.add(locator);
        totalRefs.add(locator);
      }
      const cell = await computeCell(scoreMetric, questionItems);
      if (cell.value === null) {
        subject.unscorable += 1;
        continue;
      }
      if (cell.value < 0 || cell.value > 1) {
        throw new Error(
          `scoreboardData score metric "${scoreMetric.name}" produced ${cell.value} for eval "${id}" — scores must stay in [0, 1] so weighted totals stay auditable. Normalize the metric, or use a different score metric.`,
        );
      }
      subject.earned += cell.value * weight;
    }

    let earned = 0;
    let possible = 0;
    let notRun = 0;
    let unscorable = 0;
    for (const subject of subjects.values()) {
      earned += subject.earned;
      possible += subject.possible;
      notRun += subject.notRun;
      unscorable += subject.unscorable;
    }
    const value = possible === 0 ? 0 : (fullMarks * earned) / possible;
    rows.push({
      key,
      total: {
        value,
        display: formatPlainNumber(value),
        notRun,
        unscorable,
        refs: [...totalRefs].sort(),
      },
      subjects: [...subjects.values()].map((subject) => ({
        key: subject.key,
        earned: subject.earned,
        possible: subject.possible,
        questions: subject.questions,
        notRun: subject.notRun,
        unscorable: subject.unscorable,
        display: subjectDisplay(subject.earned, subject.possible),
        refs: [...subject.refs].sort(),
      })),
    });
  }

  return {
    rowDimension: dimensionName(options.rows),
    questions: [...questions],
    fullMarks,
    weights,
    ignoredEvals: ignored.size,
    rows,
  };
}

/** 分科显示:earned / possible 与同尺度百分比。 */
function subjectDisplay(earned: number, possible: number): LocalizedText {
  const ratio = possible === 0 ? 0 : earned / possible;
  return `${formatPlainNumber(earned)}/${formatPlainNumber(possible)} (${formatMetricValue(ratio, "%")})`;
}

export interface MetricScatterOptions {
  /** 点维度:每个点 = 该组 attempt 的聚合。 */
  points: DimensionInput;
  /** 决定颜色和图例归类,默认不连线(连线是呈现 prop `connect`);数组形态解析为复合维度。 */
  series?: SeriesInput;
  x: Metric;
  y: Metric;
  /** eval id 前缀过滤,同 CLI 位置参数语义。 */
  evals?: string | readonly string[];
}

export async function metricScatterData(input: ReportInput, options: MetricScatterOptions): Promise<ScatterData> {
  const { snapshots, attempts } = resolveInput(input);
  const items = filterItems(collectItems(snapshots, selectedAttemptsOnly(attempts)), options.evals);
  const groups = groupItems(items, options.points);
  const rows: ScatterData["rows"] = [];
  for (const [key, group] of groups) {
    rows.push({
      key,
      // 组内取第一条解析系列:点维度细于系列维度时(experiment ⊂ agent)天然一致
      ...(options.series ? { series: seriesKey(options.series, group[0]!) } : {}),
      x: await computeCell(options.x, group),
      y: await computeCell(options.y, group), // 任一轴 null 的点留在 rows 里:组件不画,但注脚要报的数就从这里数
    });
  }
  return {
    pointDimension: dimensionName(options.points),
    ...(options.series ? { seriesDimension: seriesName(options.series) } : {}),
    x: toColumn(options.x),
    y: toColumn(options.y),
    rows,
  };
}

export interface MetricLineOptions {
  /** x 轴:NumericAxis(numericFlag() / numericLabel() / numericRunConfig() 或自定义 of),不解析 experiment 命名。 */
  x: NumericAxis;
  /** 数组形态解析为复合维度。 */
  series?: SeriesInput;
  y: Metric;
  /** eval id 前缀过滤,同 CLI 位置参数语义。 */
  evals?: string | readonly string[];
}

/**
 * 点身份 = (series, x):落进同一桶的全部 attempt 先在各自 experiment × eval 内 perEval 聚合,
 * 再 acrossEvals 跨题折成该点唯一的 y——聚合顺序是 (series, x, experiment, eval),同一桶里有
 * 多个 experiment 时它们合成一个点,不画垂直来回线。前提是 x 在同一 experiment × eval 内恒定:
 * 自定义 NumericAxis.of() 对同一 experiment × eval 的不同 attempt 返回不同值时按完整用户反馈失败。
 * x 为 null 的 attempt 不伪造 x 值,归入该 series 的未绘制行,组件报告未绘制数量。
 */
export async function metricLineData(input: ReportInput, options: MetricLineOptions): Promise<LineData> {
  const { snapshots, attempts } = resolveInput(input);
  const items = filterItems(collectItems(snapshots, attempts), options.evals);

  // x 恒定性检查:同一 experiment × eval 内的全部 attempt 必须得到同一个 x。
  const xByEvalKey = new Map<string, { x: number | null; item: Item }>();
  const buckets = new Map<string, { series: string | undefined; x: number | null; items: Item[] }>();
  for (const item of items) {
    const x = axisValueOf(options.x, item.attempt);
    const evalKey = fullEvalKey(item);
    const existing = xByEvalKey.get(evalKey);
    if (existing === undefined) {
      xByEvalKey.set(evalKey, { x, item });
    } else if (!Object.is(existing.x, x)) {
      throw new Error(
        `Numeric axis "${options.x.name}" is not constant within experiment "${experimentIdOf(item)}" × eval "${evalIdOf(item)}" ` +
          `(got ${String(existing.x)} and ${String(x)} for different attempts). A parameter axis must describe the configuration, ` +
          "not vary per attempt — a per-attempt quantity is material for the y metric, not an x axis. " +
          "Fix of() to read experiment-level configuration (numericFlag()/numericRunConfig() do this by construction).",
      );
    }
    const series = options.series ? seriesKey(options.series, item) : undefined;
    const bucketKey = `${series ?? ""}\u0000${x === null ? "null" : String(x)}`;
    const bucket = buckets.get(bucketKey);
    if (bucket) bucket.items.push(item);
    else buckets.set(bucketKey, { series, x, items: [item] });
  }

  const ordered = [...buckets.values()].sort((a, b) => {
    const sa = a.series ?? "";
    const sb = b.series ?? "";
    if (sa !== sb) return sa < sb ? -1 : 1;
    if (a.x === null) return b.x === null ? 0 : 1;
    if (b.x === null) return -1;
    return a.x - b.x;
  });

  const rows: LineData["rows"] = [];
  for (const bucket of ordered) {
    rows.push({
      key: bucket.x === null ? "null" : String(bucket.x),
      ...(bucket.series !== undefined ? { series: bucket.series } : {}),
      x: bucket.x,
      xDisplay: bucket.x === null ? "—" : formatMetricValue(bucket.x, options.x.unit),
      y: await computeCell(options.y, bucket.items),
    });
  }

  return {
    x: {
      key: options.x.name,
      label: options.x.label ?? options.x.name,
      ...(options.x.unit !== undefined ? { unit: options.x.unit } : {}),
    },
    ...(options.series ? { seriesDimension: seriesName(options.series) } : {}),
    y: toColumn(options.y),
    rows,
  };
}

// ───────────────────────── deltaTableData 与 conditionsByFlag ─────────────────────────

/**
 * 按 flag 机械导出全部有序条件(docs/feature/reports/library/metric-views.md「DeltaTable」):
 * 条件域 = input Scope 内 `by: "experiment"` 的全部取值,删除该 flag 后必须可比性配置深相等
 * (不额外按 experiment id 的目录前缀分组——architecture.md「Scope 是默认报告的比较边界」同一条
 * 契约);基准取 `baseline` 声明的值(缺省 = 未声明该 flag),候选是该 flag 每个其它取值各一个
 * 条件,按显示键字典序排在基准之后。
 */
export function conditionsByFlag(name: string, options?: { baseline?: JsonValue }): FlagConditions {
  if (typeof name !== "string" || name.length === 0) {
    throw new Error("conditionsByFlag: name must be a non-empty string (the key declared in the experiment's flags).");
  }
  return {
    kind: "flagConditions",
    flag: name,
    ...(options?.baseline !== undefined ? { baseline: options.baseline } : {}),
  };
}

export interface DeltaTableOptions {
  /** 显式维度,必填——"baseline" 不会被猜成 experiment、agent、flag 或 snapshot 中的某一种。 */
  by: DimensionInput;
  /** 有序条件值,取自 by 维度;长度 ≥ 2,首个是基准。空数组、单元素或重复值在计算时按完整用户反馈报错。 */
  conditions: readonly [string, string, ...string[]] | FlagConditions;
  /** eval id 前缀过滤,同 CLI 位置参数语义。 */
  evals?: string | readonly string[];
}

function isFlagConditions(conditions: DeltaTableOptions["conditions"]): conditions is FlagConditions {
  return (
    typeof conditions === "object" &&
    conditions !== null &&
    !Array.isArray(conditions) &&
    (conditions as FlagConditions).kind === "flagConditions"
  );
}

/** 对象键递归排序(派生条件的可比性配置比较键用;undefined 字段剔除)。 */
function sortedJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedJson);
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = sortedJson(v);
    }
    return out;
  }
  return value;
}

/**
 * 派生有序条件:input Scope 内全部实验删除该 flag 后必须落在同一个可比性配置桶——它们是同一组
 * 配置的不同 flag 取值,不是互不相关的两批实验;不满足时按完整用户反馈报错,提示按 evals 或
 * 输入范围收窄成单一组。返回条件值列表(首个是基准)、配对域实验数,与 experimentId → 条件值
 * 的映射(供 deltaTableData 按 experiment 成员关系而非字面维度键取回 items——同一条件值可能
 * 对应多个 experiment)。
 */
function deriveConditionsByFlag(
  snapshots: readonly Snapshot[],
  spec: FlagConditions,
): { conditions: string[]; experiments: number; experimentToCondition: Map<string, string> } {
  // 每个 experiment 取最新快照的配置(current() Scope 天然一实验一快照)。
  const byExperiment = new Map<string, Snapshot>();
  for (const snapshot of snapshots) {
    const existing = byExperiment.get(snapshot.experimentId);
    if (existing === undefined || snapshot.startedAt > existing.startedAt) {
      byExperiment.set(snapshot.experimentId, snapshot);
    }
  }
  interface Entry {
    id: string;
    flagValue: JsonValue | undefined;
    reducedKey: string;
    displayKey: string;
  }
  const entries: Entry[] = [];
  for (const [id, snapshot] of byExperiment) {
    const config = comparabilityConfigOf(snapshot) as { flags?: Record<string, JsonValue> };
    const flagValue = config.flags?.[spec.flag];
    const reduced = { ...config, flags: { ...config.flags } };
    delete reduced.flags[spec.flag];
    entries.push({ id, flagValue, reducedKey: JSON.stringify(sortedJson(reduced)), displayKey: refDisplayKey(flagValue)[0] });
  }

  const reducedKeys = new Set(entries.map((e) => e.reducedKey));
  if (entries.length > 0 && reducedKeys.size > 1) {
    throw new Error(
      `deltaTableData conditionsByFlag("${spec.flag}") found experiments whose configuration differs beyond "${spec.flag}" — ` +
        "derived conditions only make sense when every candidate experiment shares the same configuration with just this flag toggled. " +
        "Narrow to a single configuration group with `evals` or the input Scope, or write literal conditions instead.",
    );
  }

  const baselineDisplayKey = refDisplayKey(spec.baseline)[0];
  const experimentToCondition = new Map<string, string>();
  const candidateKeys = new Set<string>();
  for (const entry of entries) {
    const isBaseline = deepEqualJson(entry.flagValue, spec.baseline);
    experimentToCondition.set(entry.id, isBaseline ? baselineDisplayKey : entry.displayKey);
    if (!isBaseline) candidateKeys.add(entry.displayKey);
  }
  // 候选按显示键字典序排在基准之后;0 候选不是错误(空态由调用方按 experiments 报数)。
  const conditions = [baselineDisplayKey, ...[...candidateKeys].sort()];
  return { conditions, experiments: byExperiment.size, experimentToCondition };
}

/** 单格折叠:同一条件值 × eval 的全部 attempt 折成一个 DeltaCell。 */
async function buildDeltaCell(items: readonly Item[]): Promise<DeltaCell> {
  const scoring: "pass" | "points" = items[0]!.attempt.result.scoring === "points" ? "points" : "pass";
  const verdict: Verdict = foldEvalVerdict(items.map((item) => ({ verdict: item.attempt.result.verdict })));
  const refs = new Set<AttemptLocator>();
  let historical = false;
  let scoreSum = 0;
  let scoreCount = 0;
  let tokensSum = 0;
  let tokensCount = 0;
  let costSum = 0;
  let costCount = 0;
  for (const item of items) {
    refs.add(locatorOf(item));
    if (historicalOf(item)) historical = true;
    if (scoring === "points") {
      const value = await evaluateMetric(totalScoreMetric, item.attempt);
      if (value !== null) {
        scoreSum += value;
        scoreCount += 1;
      }
    }
    const tokensValue = await evaluateMetric(tokensMetric, item.attempt);
    if (tokensValue !== null) {
      tokensSum += tokensValue;
      tokensCount += 1;
    }
    const costValue = await evaluateMetric(costUSDMetric, item.attempt);
    if (costValue !== null) {
      costSum += costValue;
      costCount += 1;
    }
  }
  return {
    scoring,
    verdict,
    // totalScore 是题目级挣分(各 attempt 均值,与榜单 totalScore 指标同一套 perEval 聚合);
    // totalTokens / totalCostUSD 是该题在该条件下全部 attempt 的合计,不是均值。
    ...(scoreCount > 0 ? { totalScore: scoreSum / scoreCount } : {}),
    attempts: [...refs].sort(),
    ...(tokensCount > 0 ? { totalTokens: tokensSum } : {}),
    ...(costCount > 0 ? { totalCostUSD: costSum } : {}),
    historical,
  };
}

export async function deltaTableData(input: ReportInput, options: DeltaTableOptions): Promise<DeltaData> {
  const { snapshots, attempts } = resolveInput(input);
  const items = filterItems(collectItems(snapshots, attempts), options.evals);

  let conditions: string[];
  let experiments: number | undefined;
  let itemsByCondition: Map<string, Item[]>;

  if (isFlagConditions(options.conditions)) {
    if (options.by !== "experiment") {
      throw new Error(
        `deltaTableData conditions came from conditionsByFlag("${options.conditions.flag}"), which derives experiment conditions — ` +
          `it only works with by: "experiment" (got by: ${JSON.stringify(dimensionName(options.by))}). ` +
          'Set by: "experiment", or write literal conditions for other dimensions.',
      );
    }
    const derived = deriveConditionsByFlag(snapshots, options.conditions);
    conditions = derived.conditions;
    experiments = derived.experiments;
    if (derived.conditions.length < 2) {
      // 0 候选不是错误:明确空态,experiments 报配对域实验数。
      return { byDimension: dimensionName(options.by), conditions, experiments, rows: [], totals: {}, pairedDelta: {} };
    }
    itemsByCondition = new Map(conditions.map((c) => [c, [] as Item[]]));
    for (const item of items) {
      const condition = derived.experimentToCondition.get(experimentIdOf(item));
      if (condition !== undefined) itemsByCondition.get(condition)!.push(item);
    }
  } else {
    const literal = options.conditions;
    if (!Array.isArray(literal) || literal.length < 2) {
      throw new Error(
        "deltaTableData conditions must be an ordered list of at least 2 values (the first is the baseline), " +
          "or a conditionsByFlag(...) declaration.",
      );
    }
    const seen = new Set<string>();
    for (const condition of literal) {
      if (typeof condition !== "string" || condition.length === 0) {
        throw new Error(`deltaTableData conditions must be non-empty strings (got ${JSON.stringify(condition)}).`);
      }
      if (seen.has(condition)) {
        throw new Error(`deltaTableData conditions contains "${condition}" twice — each condition is a distinct column group; remove the duplicate.`);
      }
      seen.add(condition);
    }
    conditions = [...literal];
    // 精确匹配分组后的维度 key,不做前缀或模糊匹配;未命中的条件保留在 conditions 里,对应格子缺失。
    const groups = groupItems(items, options.by);
    itemsByCondition = new Map(conditions.map((c) => [c, groups.get(c) ?? []]));
  }

  // 配对身份是 eval id:同一 eval id 在各条件下的结果进同一行。
  const byConditionByEval = new Map<string, Map<string, Item[]>>();
  for (const condition of conditions) {
    const byEval = new Map<string, Item[]>();
    for (const item of itemsByCondition.get(condition) ?? []) {
      const evalId = evalIdOf(item);
      const list = byEval.get(evalId);
      if (list) list.push(item);
      else byEval.set(evalId, [item]);
    }
    byConditionByEval.set(condition, byEval);
  }
  const evalIdsSet = new Set<string>();
  for (const byEval of byConditionByEval.values()) for (const evalId of byEval.keys()) evalIdsSet.add(evalId);
  const evalIds = [...evalIdsSet].sort();

  const baseline = conditions[0];
  const rows: DeltaData["rows"] = [];
  for (const evalId of evalIds) {
    const cells: DeltaData["rows"][number]["cells"] = {};
    for (const condition of conditions) {
      const conditionItems = byConditionByEval.get(condition)?.get(evalId);
      if (conditionItems && conditionItems.length > 0) cells[condition] = await buildDeltaCell(conditionItems);
    }
    const verdicts = new Set(conditions.map((c) => cells[c]?.verdict).filter((v): v is Verdict => v !== undefined));
    // 翻转标记只在各条件判定不一致时为真;全部一致(含只有一个条件有结果)的行不加噪声。
    const flipped = verdicts.size > 1;

    let delta: DeltaData["rows"][number]["delta"] | undefined;
    const baseCell = baseline !== undefined ? cells[baseline] : undefined;
    if (baseCell) {
      for (const condition of conditions.slice(1)) {
        const cell = cells[condition];
        if (!cell) continue; // 任一侧缺数据:delta 不把缺失当 0
        const entry: { score?: number; tokens?: number; costUSD?: number } = {};
        if (cell.totalScore !== undefined && baseCell.totalScore !== undefined) entry.score = cell.totalScore - baseCell.totalScore;
        if (cell.totalTokens !== undefined && baseCell.totalTokens !== undefined) entry.tokens = cell.totalTokens - baseCell.totalTokens;
        if (cell.totalCostUSD !== undefined && baseCell.totalCostUSD !== undefined) entry.costUSD = cell.totalCostUSD - baseCell.totalCostUSD;
        if (Object.keys(entry).length > 0) {
          delta ??= {};
          delta[condition] = entry;
        }
      }
    }
    rows.push({ key: evalId, flipped, cells, ...(delta ? { delta } : {}) });
  }

  // 各条件自身覆盖面:分母是该条件有结果的 eval 数,不看其它条件是否也覆盖了这道题。
  const totals: DeltaData["totals"] = {};
  for (const condition of conditions) {
    const coveredRows = rows.filter((r) => r.cells[condition] !== undefined);
    const passRows = coveredRows.filter((r) => r.cells[condition]!.scoring === "pass");
    const pointsRows = coveredRows.filter((r) => r.cells[condition]!.scoring === "points");
    const scoringComposition: "pass" | "points" | "mixed" =
      passRows.length > 0 && pointsRows.length > 0 ? "mixed" : pointsRows.length > 0 ? "points" : "pass";
    const entry: DeltaData["totals"][string] = { scoringComposition };
    if (passRows.length > 0) {
      entry.passed = passRows.filter((r) => r.cells[condition]!.verdict === "passed").length;
      entry.denominator = passRows.length;
    }
    if (pointsRows.length > 0) {
      let sum = 0;
      let count = 0;
      for (const row of pointsRows) {
        const score = row.cells[condition]!.totalScore;
        if (score !== undefined) {
          sum += score;
          count += 1;
        }
      }
      if (count > 0) entry.totalScore = sum;
    }
    let tokensSum = 0;
    let tokensCount = 0;
    let costSum = 0;
    let costCount = 0;
    for (const row of coveredRows) {
      const cell = row.cells[condition]!;
      if (cell.totalTokens !== undefined) {
        tokensSum += cell.totalTokens;
        tokensCount += 1;
      }
      if (cell.totalCostUSD !== undefined) {
        costSum += cell.totalCostUSD;
        costCount += 1;
      }
    }
    if (tokensCount > 0) entry.totalTokens = tokensSum;
    if (costCount > 0) entry.totalCostUSD = costSum;
    totals[condition] = entry;
  }

  // 共同题 paired delta:只在该条件与基准都存在结果的 eval 交集上计算,先在同一题上配对,
  // 再分别聚合判定与用量;totals 的分母不同,不能互相替代(见 metric-views.md「DeltaTable」)。
  const pairedDelta: DeltaData["pairedDelta"] = {};
  if (baseline !== undefined) {
    for (const condition of conditions.slice(1)) {
      const commonRows = rows.filter((r) => r.cells[baseline] !== undefined && r.cells[condition] !== undefined);
      const entry: DeltaData["pairedDelta"][string] = { commonEvalIds: commonRows.map((r) => r.key) };

      const passRows = commonRows.filter((r) => r.cells[baseline]!.scoring === "pass");
      if (passRows.length > 0) {
        const passedBase = passRows.filter((r) => r.cells[baseline]!.verdict === "passed").length;
        const passedCond = passRows.filter((r) => r.cells[condition]!.verdict === "passed").length;
        entry.pass = {
          evalIds: passRows.map((r) => r.key),
          passRatePoints: (passedCond / passRows.length - passedBase / passRows.length) * 100,
        };
      }

      const pointsRows = commonRows.filter(
        (r) =>
          r.cells[baseline]!.scoring === "points" &&
          r.cells[baseline]!.totalScore !== undefined &&
          r.cells[condition]!.totalScore !== undefined,
      );
      if (pointsRows.length > 0) {
        let sumBase = 0;
        let sumCond = 0;
        for (const row of pointsRows) {
          sumBase += row.cells[baseline]!.totalScore!;
          sumCond += row.cells[condition]!.totalScore!;
        }
        entry.points = { evalIds: pointsRows.map((r) => r.key), totalScore: sumCond - sumBase };
      }

      let tokensBase = 0;
      let tokensCond = 0;
      let tokensN = 0;
      let costBase = 0;
      let costCond = 0;
      let costN = 0;
      for (const row of commonRows) {
        const b = row.cells[baseline]!;
        const c = row.cells[condition]!;
        if (b.totalTokens !== undefined && c.totalTokens !== undefined) {
          tokensBase += b.totalTokens;
          tokensCond += c.totalTokens;
          tokensN += 1;
        }
        if (b.totalCostUSD !== undefined && c.totalCostUSD !== undefined) {
          costBase += b.totalCostUSD;
          costCond += c.totalCostUSD;
          costN += 1;
        }
      }
      if (tokensN > 0) entry.tokens = tokensCond - tokensBase;
      if (costN > 0) entry.costUSD = costCond - costBase;

      pairedDelta[condition] = entry;
    }
  }

  return {
    byDimension: dimensionName(options.by),
    conditions,
    ...(experiments !== undefined ? { experiments } : {}),
    rows,
    totals,
    pairedDelta,
  };
}

// ───────────────────────── stabilityMatrixData ─────────────────────────

export interface StabilityMatrixOptions {
  /** 列维度(通常是 "experiment");必填。 */
  by: DimensionInput;
  /** eval id 前缀过滤,同 CLI 位置参数语义。 */
  evals?: string | readonly string[];
}

/**
 * 历史全执行的稳定性矩阵:行是 eval,列是 by 维度上的取值,格是该组合全部历史执行(跨快照按
 * 身份键去重、不设可比性门槛)的判定计数(docs/feature/reports/library/metric-views.md
 * 「StabilityMatrix」)。消费的是调用方传入的 input 本身——传 current() Scope 只看得到现刻
 * 水位,要看完整历史需由调用方从 ctx.results 显式选择 Snapshot[] 传入。
 */
export async function stabilityMatrixData(
  input: ReportInput,
  options?: StabilityMatrixOptions,
): Promise<StabilityMatrixData> {
  if (!options || options.by === undefined) {
    throw new Error('stabilityMatrixData requires options.by (the dimension whose values become matrix columns, e.g. "experiment").');
  }
  const { snapshots, attempts } = resolveInput(input);
  const items = filterItems(collectItems(snapshots, attempts), options.evals);

  const cellsByKey = new Map<string, { row: string; column: string; passed: number; failed: number; errored: number }>();
  for (const item of items) {
    const evalId = evalIdOf(item);
    const column = dimensionKey(options.by, item);
    const key = JSON.stringify([evalId, column]);
    let cell = cellsByKey.get(key);
    if (!cell) cellsByKey.set(key, (cell = { row: evalId, column, passed: 0, failed: 0, errored: 0 }));
    const verdict = item.attempt.result.verdict;
    if (verdict === "passed") cell.passed += 1;
    else if (verdict === "failed") cell.failed += 1;
    else if (verdict === "errored") cell.errored += 1;
    // skipped 不计入任何列
  }

  // 稀疏格子:全 skipped(没有任何历史执行)的组合不生成格子,不编三个 0 冒充跑过。
  const realCells = [...cellsByKey.values()].filter((c) => c.passed + c.failed + c.errored > 0);

  const columnsSet = new Set<string>();
  const statsByEval = new Map<string, { passed: number; total: number }>();
  const bestRateByEval = new Map<string, number>();
  for (const c of realCells) {
    columnsSet.add(c.column);
    const executions = c.passed + c.failed + c.errored;
    const stats = statsByEval.get(c.row) ?? { passed: 0, total: 0 };
    stats.passed += c.passed;
    stats.total += executions;
    statsByEval.set(c.row, stats);
    const rate = c.passed / executions;
    if (!bestRateByEval.has(c.row) || rate > bestRateByEval.get(c.row)!) bestRateByEval.set(c.row, rate);
  }

  // 行按历史最高通过率(各列分别算通过率,取最高值)升序排列,零通过的题排最前;
  // 同序值再按 evalId 字典序收口。
  const evalIds = [...statsByEval.keys()].sort((a, b) => {
    const ra = bestRateByEval.get(a) ?? 0;
    const rb = bestRateByEval.get(b) ?? 0;
    if (ra !== rb) return ra - rb;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  const rows: StabilityMatrixData["rows"] = evalIds.map((evalId) => {
    const stats = statsByEval.get(evalId)!;
    return { evalId, neverPassed: stats.passed === 0 && stats.total > 0 };
  });

  const cells: StabilityMatrixData["cells"] = realCells.map((c) => ({
    row: c.row,
    column: c.column,
    cell: { passed: c.passed, failed: c.failed, errored: c.errored, executions: c.passed + c.failed + c.errored },
  }));

  const totals: StabilityMatrixData["totals"] = {};
  for (const column of columnsSet) {
    let passed = 0;
    let failed = 0;
    let errored = 0;
    for (const c of realCells) {
      if (c.column !== column) continue;
      passed += c.passed;
      failed += c.failed;
      errored += c.errored;
    }
    totals[column] = { passed, failed, errored, executions: passed + failed + errored };
  }

  return {
    rowDimension: "eval",
    columnDimension: dimensionName(options.by),
    rows,
    columns: [...columnsSet].sort(),
    cells,
    totals,
  };
}
