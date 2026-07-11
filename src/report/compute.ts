// 计算函数:Selection → 一份组件数据。跑在 Node 侧,产物是算好的、可序列化的普通 JSON
// (终值 + 渲染提示,不含公式);渲染面(web/text)只做展示。
//
// 这些函数不做顶层导出,而是挂在对应组件上(MetricTable.data / Scoreboard.data …,
// 见 components.tsx):配对打点即发现,泛化名不占顶层导出。
//
// 共同约定(docs/reports.md「边界与不变量」):
// - 第一参收 Selection | Snapshot[];收 Selection 时 warnings 随行进 OverviewData;
// - 聚合前按身份键去重(dedupeAttempts;missing-startedAt 不去重、如实保留、不透出警告);
// - null ≠ 0:缺数据不编数,覆盖率经 samples/total 如实暴露;
// - core 中立:只认 Metric / Dimension 接口,不出现具体 agent 名的分支。

import type {
  CaseListData,
  DeltaData,
  DimensionInput,
  LineData,
  MatrixData,
  Metric,
  MetricCell,
  OverviewData,
  FlagRef,
  ScatterData,
  ScoreboardData,
  TableData,
} from "./types.ts";
import {
  applyAggregator,
  assertUniqueMetricNames,
  collectItems,
  computeCell,
  dimensionKey,
  dimensionName,
  displayValue,
  evalGroupOf,
  evalIdOf,
  evalPrefixPredicate,
  evaluateMetric,
  experimentIdOf,
  filterItems,
  groupItems,
  flagAxisValue,
  resolveInput,
  snapshotKeyOf,
  toColumn,
  type Item,
  type SnapshotsInput,
} from "./aggregate.ts";
import { attemptCostUSD, examScore } from "./metrics.ts";
import { formatMetricValue, formatPlainNumber } from "./format.ts";

// ───────────────────────── MetricTable.data ─────────────────────────

export interface TableDataOptions<M extends readonly Metric[]> {
  /** 行维度(内置 / 自定义 / flag())。 */
  rows: DimensionInput;
  /** 每列一个指标;列键 = metric.name 的字面量,拼错编译不过。 */
  columns: M;
  /** 构建时排序,方向随 better(higher 降序,「好」的一头在上);缺数据行沉底。两面同口径,预排即终排。 */
  sort?: Metric;
  /** eval id 前缀过滤,同 CLI 位置参数语义。 */
  evals?: string | string[];
}

export async function tableData<const M extends readonly Metric[]>(
  input: SnapshotsInput,
  opts: TableDataOptions<M>,
): Promise<TableData<M[number]["name"]>> {
  assertUniqueMetricNames(opts.columns, "MetricTable.data columns");
  const { snapshots } = resolveInput(input);
  const items = filterItems(collectItems(snapshots), opts.evals);
  const groups = groupItems(items, opts.rows);
  const rows: { key: string; cells: Record<string, MetricCell> }[] = [];
  const sortCells = new Map<string, MetricCell>();
  for (const [key, group] of groups) {
    const cells: Record<string, MetricCell> = {};
    for (const metric of opts.columns) cells[metric.name] = await computeCell(metric, group);
    if (opts.sort) {
      // sort 指标不在 columns 里时单独算一遍,只用于排序、不进输出
      sortCells.set(key, cells[opts.sort.name] ?? (await computeCell(opts.sort, group)));
    }
    rows.push({ key, cells });
  }
  if (opts.sort) {
    const better = opts.sort.better ?? "higher";
    rows.sort((a, b) => {
      const va = sortCells.get(a.key)?.value ?? null;
      const vb = sortCells.get(b.key)?.value ?? null;
      if (va === null && vb === null) return 0;
      if (va === null) return 1; // 缺数据沉底
      if (vb === null) return -1;
      return better === "lower" ? va - vb : vb - va;
    });
  }
  return {
    dimension: dimensionName(opts.rows),
    columns: opts.columns.map(toColumn),
    rows,
  } as TableData<M[number]["name"]>;
}

// ───────────────────────── MetricMatrix.data(= MetricBars.data)─────────────────────────

export interface MatrixDataOptions {
  rows: DimensionInput;
  columns: DimensionInput;
  cell: Metric;
  /** eval id 前缀过滤,同 CLI 位置参数语义。 */
  evals?: string | string[];
}

export async function matrixData(input: SnapshotsInput, opts: MatrixDataOptions): Promise<MatrixData> {
  const { snapshots } = resolveInput(input);
  const items = filterItems(collectItems(snapshots), opts.evals);
  // 稀疏分组:只有真有 attempt 的 (row, column) 组合成格;没有样本的格子不出现
  const groups = new Map<string, { row: string; column: string; items: Item[] }>();
  for (const item of items) {
    const row = dimensionKey(opts.rows, item);
    const column = dimensionKey(opts.columns, item);
    const key = JSON.stringify([row, column]);
    const group = groups.get(key);
    if (group) group.items.push(item);
    else groups.set(key, { row, column, items: [item] });
  }
  const cells: MatrixData["cells"] = [];
  for (const group of groups.values()) {
    cells.push({ row: group.row, column: group.column, cell: await computeCell(opts.cell, group.items) });
  }
  return {
    rows: dimensionName(opts.rows),
    columns: dimensionName(opts.columns),
    metric: toColumn(opts.cell),
    cells,
  };
}

// ───────────────────────── Scoreboard.data ─────────────────────────

export interface ScoreboardDataOptions {
  /** 给谁打分(被打分的维度);维度槽与 MetricTable.data 统一叫 rows。 */
  rows: DimensionInput;
  /** 按什么分科;默认 "evalGroup"(考试里的「科目」)。 */
  subjects?: DimensionInput;
  /** eval id 前缀 → 每题分值;未列默认 1;前缀重叠时最长的生效。 */
  weights?: Record<string, number>;
  /** 折算满分;默认 100。 */
  fullMarks?: number;
  /** 每题得分指标;缺省即 examScore,可换自定义(如「答对但超预算扣分」)。 */
  score?: Metric;
  /** 选中范围:eval id 前缀过滤;题集(分母)只遍历这个范围。 */
  evals?: string | string[];
}

/**
 * 逐题分值制,分母对所有被打分者恒定:
 *   题分值 = 命中的权重(默认 1)   题得分 = score 指标的题级值(perEval 折叠后)
 *   总分   = fullMarks × Σ(题得分 × 题分值) / Σ(题分值)   Σ 遍历选中范围内全部题
 * 没跑到的题挣 0 分但留在分母里,missing 如实报 —— 这是显式的考试契约,不是「null ≠ 0」的例外。
 */
export async function scoreboardData(
  input: SnapshotsInput,
  opts: ScoreboardDataOptions,
): Promise<ScoreboardData> {
  const { snapshots } = resolveInput(input);
  const fullMarks = opts.fullMarks ?? 100;
  const scoreMetric = opts.score ?? examScore;
  const subjectsDim: DimensionInput = opts.subjects ?? "evalGroup";
  const match = evalPrefixPredicate(opts.evals);
  const items = filterItems(collectItems(snapshots), opts.evals);

  // 题集(固定分母):选中范围内、任一快照声明覆盖或实际出现过的全部题
  const universe = new Set<string>();
  for (const snapshot of snapshots) {
    for (const e of snapshot.evals) if (match(e.id)) universe.add(e.id);
    for (const id of snapshot.knownEvalIds ?? []) if (match(id)) universe.add(id);
  }
  for (const item of items) universe.add(evalIdOf(item));
  const sortedUniverse = [...universe].sort();

  // 每题的科目:先从任一 attempt 解析(自定义 subjects 维度也能算);
  // 全程无 attempt 的题按内置规则兜底,自定义维度无从计算时如实标 "(unknown)"
  const subjectByEval = new Map<string, string>();
  for (const item of items) {
    const id = evalIdOf(item);
    if (!subjectByEval.has(id)) subjectByEval.set(id, dimensionKey(subjectsDim, item));
  }
  const subjectOf = (id: string): string => {
    const known = subjectByEval.get(id);
    if (known !== undefined) return known;
    if (subjectsDim === "eval") return id;
    if (subjectsDim === "evalGroup") return evalGroupOf(id);
    return "(unknown)";
  };

  // 权重:最长前缀生效(排序后线性找第一个命中即最长)
  const weights = Object.entries(opts.weights ?? {})
    .map(([prefix, weight]) => ({ prefix, weight }))
    .sort((a, b) => b.prefix.length - a.prefix.length);
  const weightOf = (id: string): number => weights.find((w) => id.startsWith(w.prefix))?.weight ?? 1;

  const groups = groupItems(items, opts.rows);
  const rows: ScoreboardData["rows"] = [];
  for (const [key, group] of groups) {
    // 题得分:perEval 折叠(同 eval × 快照 内);同题出现在多个快照时取快照级值的均值
    const perSnapshot = new Map<string, Map<string, number[]>>(); // evalId → 快照键 → 原始值
    for (const item of group) {
      const value = await evaluateMetric(scoreMetric, item.attempt);
      if (value === null) continue; // 测不了的 attempt 不进题得分;整题无样本 → missing
      const id = evalIdOf(item);
      const snapKey = snapshotKeyOf(item.snapshot);
      let bySnap = perSnapshot.get(id);
      if (!bySnap) perSnapshot.set(id, (bySnap = new Map()));
      const bucket = bySnap.get(snapKey);
      if (bucket) bucket.push(value);
      else bySnap.set(snapKey, [value]);
    }
    const perEvalAgg = scoreMetric.aggregate?.perEval ?? "mean";
    const scoreByEval = new Map<string, number>();
    for (const [id, bySnap] of perSnapshot) {
      const snapValues = [...bySnap.values()].map((values) => applyAggregator(perEvalAgg, values));
      scoreByEval.set(id, snapValues.reduce((a, b) => a + b, 0) / snapValues.length);
    }

    // 科目累计:固定分母 —— 没跑的题 0 分挣、留在分母、计入 missing
    const subjects = new Map<
      string,
      { key: string; earned: number; possible: number; evals: number; missing: number }
    >();
    for (const id of sortedUniverse) {
      const subjectKey = subjectOf(id);
      let subject = subjects.get(subjectKey);
      if (!subject) {
        subjects.set(subjectKey, (subject = { key: subjectKey, earned: 0, possible: 0, evals: 0, missing: 0 }));
      }
      const weight = weightOf(id);
      const got = scoreByEval.get(id);
      subject.earned += (got ?? 0) * weight;
      subject.possible += weight;
      subject.evals += 1;
      if (got === undefined) subject.missing += 1;
    }
    let earned = 0;
    let possible = 0;
    for (const subject of subjects.values()) {
      earned += subject.earned;
      possible += subject.possible;
    }
    const value = possible === 0 ? 0 : (fullMarks * earned) / possible;
    rows.push({ key, total: { value, display: formatPlainNumber(value) }, subjects: [...subjects.values()] });
  }

  return { dimension: dimensionName(opts.rows), fullMarks, weights, rows };
}

// ───────────────────────── MetricScatter.data ─────────────────────────

export interface ScatterDataOptions {
  /** 点维度:每个点 = 该组 attempt 的聚合。 */
  points: DimensionInput;
  /** 可选:同系列的点连成线;省略 = 纯散点。 */
  series?: DimensionInput;
  x: Metric;
  y: Metric;
}

export async function scatterData(input: SnapshotsInput, opts: ScatterDataOptions): Promise<ScatterData> {
  const { snapshots } = resolveInput(input);
  const items = collectItems(snapshots);
  const groups = groupItems(items, opts.points);
  const rows: ScatterData["rows"] = [];
  for (const [key, group] of groups) {
    rows.push({
      key,
      // 组内取第一条解析系列:点维度细于系列维度时(experiment ⊂ agent)天然一致
      series: opts.series ? dimensionKey(opts.series, group[0]) : undefined,
      x: await computeCell(opts.x, group),
      y: await computeCell(opts.y, group), // 任一轴 null 的点留在 rows 里:组件不画,但注脚要报的数就从这里数
    });
  }
  return {
    points: dimensionName(opts.points),
    series: opts.series ? dimensionName(opts.series) : undefined,
    x: toColumn(opts.x),
    y: toColumn(opts.y),
    rows,
  };
}

// ───────────────────────── MetricLine.data ─────────────────────────

export interface LineDataOptions {
  /** x 轴:experiment 声明的 flag(数值),不解析 experiment 命名。 */
  x: FlagRef;
  y: Metric;
  /** 可选:每个系列一条线(flag 或普通维度);省略 = 单系列。 */
  series?: DimensionInput;
}

/** 每个点 = 一个 experiment 的聚合;同系列的点按 x 排序连线(排序在组件面,数据保持分组序)。 */
export async function lineData(input: SnapshotsInput, opts: LineDataOptions): Promise<LineData> {
  const { snapshots } = resolveInput(input);
  const items = collectItems(snapshots);
  const groups = groupItems(items, "experiment");
  const rows: LineData["rows"] = [];
  for (const [key, group] of groups) {
    const x = flagAxisValue(opts.x, group[0]); // flag 是 experiment 级声明,组内一致
    rows.push({
      key,
      series: opts.series ? dimensionKey(opts.series, group[0]) : undefined,
      x,
      xDisplay: x === null ? "" : formatMetricValue(x, opts.x.unit),
      y: await computeCell(opts.y, group),
    });
  }
  return {
    x: {
      key: opts.x.name,
      label: typeof opts.x.label === "string" ? opts.x.label : opts.x.name,
      unit: opts.x.unit,
    },
    series: opts.series ? dimensionName(opts.series) : undefined,
    y: toColumn(opts.y),
    rows,
  };
}

// ───────────────────────── RunOverview.data ─────────────────────────

/** Selection 的 warnings 随行进 OverviewData,RunOverview 直接渲染 —— 诚实不靠使用者记得接线。 */
export async function overviewData(input: SnapshotsInput): Promise<OverviewData> {
  const { snapshots, warnings } = resolveInput(input);
  const items = collectItems(snapshots);
  const evalIds = new Set<string>();
  let passed = 0;
  let failed = 0;
  let errored = 0;
  let skipped = 0;
  let durationMs = 0;
  let costUSD: number | null = null; // 任一 attempt 报了成本才有;全缺 = null,不编 0
  for (const item of items) {
    const result = item.attempt.result;
    evalIds.add(evalIdOf(item));
    switch (result.verdict) {
      case "passed":
        passed += 1;
        break;
      case "failed":
        failed += 1;
        break;
      case "errored":
        errored += 1;
        break;
      case "skipped":
        skipped += 1;
        break;
    }
    durationMs += result.durationMs;
    const cost = attemptCostUSD(result);
    if (cost !== null) costUSD = (costUSD ?? 0) + cost;
  }
  return {
    snapshots: snapshots.map((s) => ({
      experimentId: s.experimentId,
      agent: s.agent,
      model: s.model,
      startedAt: s.startedAt,
    })),
    totals: { evals: evalIds.size, attempts: items.length, passed, failed, errored, skipped, costUSD, durationMs },
    warnings: [...warnings],
  };
}

// ───────────────────────── DeltaTable.data ─────────────────────────

export interface DeltaPair {
  /** 基线侧:experiment id,或快照键 "<experimentId> @ <startedAt>"(时间轴对比用手挑的快照数组)。 */
  a: string;
  /** 对比侧,同上。 */
  b: string;
  label?: string;
}

export interface DeltaDataOptions<M extends readonly Metric[]> {
  /** 每行一对:B 相对 A。 */
  pairs: DeltaPair[];
  metrics: M;
}

export async function deltaData<const M extends readonly Metric[]>(
  input: SnapshotsInput,
  opts: DeltaDataOptions<M>,
): Promise<DeltaData<M[number]["name"]>> {
  assertUniqueMetricNames(opts.metrics, "DeltaTable.data metrics");
  const { snapshots } = resolveInput(input);
  const items = collectItems(snapshots);
  // 一侧的键既匹配 experiment id 也匹配快照键 —— 与 "snapshot" 维度同一格式,不另造对比语义
  const sideItems = (key: string) =>
    items.filter((item) => experimentIdOf(item) === key || snapshotKeyOf(item.snapshot) === key);
  const rows: DeltaData["rows"] = [];
  for (const pair of opts.pairs) {
    const aItems = sideItems(pair.a);
    const bItems = sideItems(pair.b);
    const cells: Record<string, DeltaData["rows"][number]["cells"][string]> = {};
    for (const metric of opts.metrics) {
      const a = await computeCell(metric, aItems);
      const b = await computeCell(metric, bItems);
      const d = a.value === null || b.value === null ? null : b.value - a.value;
      cells[metric.name] = { a, b, delta: d, display: deltaDisplay(metric, d) };
    }
    rows.push({
      key: pair.label ?? `${pair.a} vs ${pair.b}`,
      a: { experimentId: pair.a },
      b: { experimentId: pair.b },
      cells,
    });
  }
  return { columns: opts.metrics.map(toColumn), rows } as DeltaData<M[number]["name"]>;
}

function deltaDisplay(metric: Metric, delta: number | null): string {
  if (delta === null) return "—"; // 任一侧缺数据:Δ 显示为缺,不硬算
  if (delta === 0) return "±0";
  const text = displayValue(metric, delta); // 负号由格式化自带
  return delta > 0 ? `+${text}` : text;
}

// ───────────────────────── CaseList.data ─────────────────────────

export interface CaseListDataOptions {
  /** 要列出的判定;默认 failed + errored。 */
  verdicts?: ("failed" | "errored")[];
  /** 超出如实报 truncated,不静默截断。 */
  limit?: number;
  /** 自由文本(error / 断言 detail / judge evidence)的发布消毒钩子;身份字段不经它。 */
  redact?: (text: string) => string;
}

export async function caseListData(input: SnapshotsInput, opts?: CaseListDataOptions): Promise<CaseListData> {
  const { snapshots } = resolveInput(input);
  const wanted = new Set<"failed" | "errored">(opts?.verdicts ?? ["failed", "errored"]);
  const redact = opts?.redact ?? ((text: string) => text);
  const selected = collectItems(snapshots).filter((item) => {
    const verdict = item.attempt.result.verdict;
    return (verdict === "failed" || verdict === "errored") && wanted.has(verdict);
  });
  const shown = opts?.limit === undefined ? selected : selected.slice(0, opts.limit);
  const rows: CaseListData["rows"] = shown.map((item) => {
    const result = item.attempt.result;
    const cost = attemptCostUSD(result);
    return {
      eval: evalIdOf(item),
      experimentId: experimentIdOf(item),
      agent: result.agent,
      verdict: result.verdict as "failed" | "errored",
      error: result.error === undefined ? undefined : redact(result.error),
      failedAssertions: result.assertions
        .filter((assertion) => !assertion.passed)
        .map((assertion) => ({
          name: assertion.name,
          score: assertion.score,
          detail: assertion.detail === undefined ? undefined : redact(assertion.detail),
          evidence: assertion.evidence === undefined ? undefined : redact(assertion.evidence),
        })),
      durationMs: result.durationMs,
      costUSD: cost ?? undefined,
      ref: item.attempt.ref,
    };
  });
  return { rows, truncated: selected.length - shown.length };
}
