// 计算函数:Selection → 一份组件数据。跑在 Node 侧,产物是算好的、可序列化的普通 JSON
// (终值 + 渲染提示,不含公式);渲染面(web/text)只做展示。
//
// 这些函数不做顶层导出,而是挂在对应组件上(MetricTable.data / Scoreboard.data …,
// 见 components.tsx):配对打点即发现,泛化名不占顶层导出。
//
// 共同约定(docs/feature/reports/architecture.md「指标聚合不变量」):
// - 第一参收 Selection | Snapshot[];收 Selection 时 warnings 随行进 OverviewData;
// - 聚合前按身份键去重(dedupeAttempts;missing-startedAt 不去重、如实保留、不透出警告);
// - null ≠ 0:缺数据不编数,覆盖率经 samples/total 如实暴露;
// - core 中立:只认 Metric / Dimension 接口,不出现具体 agent 名的分支。

import type {
  AttemptListItem,
  AttemptLocator,
  AxisInput,
  DeltaData,
  DimensionInput,
  EvalListItem,
  ExperimentListEvalRow,
  ExperimentListItem,
  GroupSummaryData,
  LineData,
  MatrixData,
  Metric,
  MetricCell,
  OverviewData,
  ScatterData,
  ScoreboardData,
  TableData,
  TableRowMeta,
} from "./types.ts";
import type { AssertionResult, AttemptError, DiagnosticRecord, EvalResult } from "../types.ts";
import type { AttemptHandle } from "../results/types.ts";
import { evalLevelStats, foldEvalVerdict } from "../shared/verdict.ts";
import {
  applyAggregator,
  assertUniqueMetricNames,
  axisValue,
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
  locatorOf,
  resolveInput,
  snapshotKeyOf,
  toColumn,
  type Item,
  type SnapshotsInput,
} from "./aggregate.ts";
import { attemptCostUSD, costUSD, durationMs, examScore, taskPassRate, tokens } from "./metrics.ts";
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

// 一组 Item 的 eval 全身份键:experimentId + eval id。单 experiment 场景(如 experimentRowMeta,
// 一组本就只有一个 experimentId)下退化为只按 eval id 折叠,与旧行为一致;多 experiment 场景
// (GroupSummary 的组可能跨多个 experiment)下避免两个 experiment 里同名 eval 被误合并成一道题。
// 分隔符是 NUL(同 aggregate.ts 的 KEY_SEP 手法):不会出现在 eval id / experimentId 里,拼接键不串味。
const GROUP_KEY_SEP = "\u0000";
function fullEvalKey(item: Item): string {
  return `${experimentIdOf(item)}${GROUP_KEY_SEP}${evalIdOf(item)}`;
}

/**
 * 一批 Item 的组级统计:eval 级折叠计票(evalLevelStats,与 view 榜单 / `TableRowMeta.verdicts`
 * 同一套 foldEvalVerdict 口径,按完整身份键折叠)、experiment/eval/attempt 数量、总成本
 * (null-safe 求和)、最后运行时间(组内快照 startedAt 的最大值)。`experimentRowMeta` 与
 * `groupSummaryData` 共用这一份实现,不各自拼装 evalLevelStats。
 *
 * 内部纯函数,不导出、不进 index.ts:对外只经 `experimentRowMeta`(挑 verdicts)与
 * `groupSummaryData`(挑全部字段,包成 `GroupSummaryData`)暴露,调用方拿不到 `Item[]`
 * 本身,所以这里也不用担心被越权复用。
 */
function summarizeItems(items: Item[]): {
  experiments: number;
  evals: number;
  attempts: number;
  verdicts: { passed: number; failed: number; errored: number; skipped: number };
  /** 折叠后代表每个「已跑」(非 skipped)eval 的一条 attempt 引用,与 ran 同序同数。 */
  refs: AttemptLocator[];
  /** 计入通过率分母的 eval 数(passed + failed + errored,不含 skipped)。 */
  ran: number;
  totalCostUSD: number | null;
  lastRunAt: string | undefined;
} {
  const experimentIds = new Set<string>();
  for (const item of items) experimentIds.add(experimentIdOf(item));

  const byEval = new Map<string, Item[]>();
  for (const item of items) {
    const key = fullEvalKey(item);
    const list = byEval.get(key);
    if (list) list.push(item);
    else byEval.set(key, [item]);
  }
  const stats = evalLevelStats(
    items.map((item) => ({ verdict: item.attempt.result.verdict, key: fullEvalKey(item) })),
    (r) => r.key,
  );
  // 折叠代表 attempt:每个已跑的 eval 挑一条与折叠判定一致的 attempt 做证据引用,
  // skipped 的 eval 不进分母、不出证据。
  const refs: AttemptLocator[] = [];
  for (const group of byEval.values()) {
    const verdict = foldEvalVerdict(group.map((item) => item.attempt.result));
    if (verdict === "skipped") continue;
    const rep = group.find((item) => item.attempt.result.verdict === verdict) ?? group[0]!;
    refs.push(locatorOf(rep));
  }

  let totalCostUSD: number | null = null;
  for (const item of items) {
    const cost = attemptCostUSD(item.attempt.result);
    if (cost !== null) totalCostUSD = (totalCostUSD ?? 0) + cost;
  }

  let lastRunAt: string | undefined;
  for (const item of items) {
    const startedAt = item.snapshot.startedAt;
    if (lastRunAt === undefined || startedAt > lastRunAt) lastRunAt = startedAt;
  }

  return {
    experiments: experimentIds.size,
    evals: stats.evals,
    attempts: items.length,
    verdicts: { passed: stats.passed, failed: stats.failed, errored: stats.errored, skipped: stats.skipped },
    refs,
    ran: stats.passed + stats.failed + stats.errored,
    totalCostUSD,
    lastRunAt,
  };
}

/**
 * experiment 行的元信息:agent/model 身份(组内去重后拼接)+ eval 级折叠计票 + eval/attempt
 * 数量与最后运行时间(summarizeItems,即 view 榜单 / ExperimentList 的同一套 foldEvalVerdict
 * 口径)。其它行维度(agent/eval/自定义…)没有唯一身份,不携带。
 */
function experimentRowMeta(group: Item[]): TableRowMeta {
  const agents = new Set<string>();
  const models = new Set<string>();
  for (const item of group) {
    agents.add(item.attempt.result.agent);
    const model = item.attempt.result.model ?? item.snapshot.model;
    if (model !== undefined) models.add(model);
  }
  const stats = summarizeItems(group);
  return {
    ...(agents.size > 0 ? { agent: [...agents].join(", ") } : {}),
    ...(models.size > 0 ? { model: [...models].join(", ") } : {}),
    verdicts: stats.verdicts,
    evals: stats.evals,
    attempts: stats.attempts,
    ...(stats.lastRunAt !== undefined ? { lastRunAt: stats.lastRunAt } : {}),
  };
}

/**
 * 一次 attempt 未通过的 gate 断言,原始声明顺序不变;soft 断言不参与判定,不算「失败原因」,
 * 只影响得分,永不出现在这份列表里。`EvalList` / `ExperimentList` 的失败诊断与 `AttemptList`
 * 的断言列表共用这同一份材料,保证同一个 attempt 在各处给出同一个原因。
 */
export function failingGateAssertions(result: EvalResult): AssertionResult[] {
  return result.assertions.filter((a) => a.outcome === "failed" && a.severity === "gate");
}

/**
 * 一次 attempt 的失败原因文案,按优先级取第一个在场的:
 * `error` → `skipReason` → 未通过的 gate 断言(原始声明顺序,`name`,detail 在场则
 * `"name: detail"`,多条用「, 」连接)→ 都缺席则无原因(如某道题恰好没有失败信号)。
 * soft 断言永不进入这份原因文案,soft 得分是独立概念,不与 reason 混用同一个字段。
 */
export function reasonFor(result: EvalResult): string | undefined {
  if (result.error !== undefined) return result.error.message;
  if (result.skipReason !== undefined) return result.skipReason;
  const gates = failingGateAssertions(result);
  if (gates.length === 0) return undefined;
  return gates.map((a) => (a.detail ? `${a.name}: ${a.detail}` : a.name)).join(", ");
}

export async function tableData<const M extends readonly Metric[]>(
  input: SnapshotsInput,
  opts: TableDataOptions<M>,
): Promise<TableData<M[number]["name"]>> {
  assertUniqueMetricNames(opts.columns, "MetricTable.data columns");
  const { snapshots } = resolveInput(input);
  const items = filterItems(collectItems(snapshots), opts.evals);
  const groups = groupItems(items, opts.rows);
  const rows: TableData["rows"] = [];
  const sortCells = new Map<string, MetricCell>();
  for (const [key, group] of groups) {
    const cells: Record<string, MetricCell> = {};
    for (const metric of opts.columns) cells[metric.name] = await computeCell(metric, group);
    if (opts.sort) {
      // sort 指标不在 columns 里时单独算一遍,只用于排序、不进输出
      sortCells.set(key, cells[opts.sort.name] ?? (await computeCell(opts.sort, group)));
    }
    const meta: TableRowMeta = opts.rows === "experiment" ? experimentRowMeta(group) : {};
    rows.push({
      key,
      cells,
      ...(Object.keys(meta).length > 0 ? { meta } : {}),
    });
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

// ───────────────────────── ExperimentList.data / EvalList.data / AttemptList.data ─────────────────────────
//
// 三个实体列表逐级下钻(experiment → experimentId × eval → attempt),固定展示实体事实,
// 没有列配置;过滤是报告作者对返回数组调用 .filter()/.slice() 的事,不进这里
// (docs/feature/reports/library.md「实体列表」)。AttemptListItem 是三者共用的叶子形状——
// ExperimentList / EvalList 的下钻数组直接复用它,不各自精简一份。

/** 自由文本(断言 detail / evidence)的展示层遮蔽钩子;身份字段(name/severity/loc)不经它。 */
function redactAssertions(assertions: AssertionResult[], redact: (text: string) => string): AssertionResult[] {
  if (assertions.length === 0) return assertions;
  return assertions.map((a) => ({
    ...a,
    ...(a.detail !== undefined ? { detail: redact(a.detail) } : {}),
    ...(a.outcome !== "unavailable" && a.evidence !== undefined ? { evidence: redact(a.evidence) } : {}),
    ...(a.outcome !== "unavailable" && a.expected !== undefined ? { expected: redact(a.expected) } : {}),
    ...(a.outcome !== "unavailable" && a.received !== undefined ? { received: redact(a.received) } : {}),
  }));
}

/**
 * 结构化 error 的遮蔽:message / stack / cause.message 是自由文本,经钩子;
 * code / operation / cause.name / cause.code 是分类与身份字段,原样保留
 * (与 copySnapshots({ redact }) 的改写范围约定一致)。
 */
function redactError(error: AttemptError, redact: (text: string) => string): AttemptError {
  return {
    ...error,
    message: redact(error.message),
    ...(error.stack !== undefined ? { stack: redact(error.stack) } : {}),
    ...(error.cause !== undefined ? { cause: { ...error.cause, message: redact(error.cause.message) } } : {}),
  };
}

/** JsonValue 树里逐个字符串值经钩子;结构与非字符串标量原样。 */
function redactJsonValue<T>(value: T, redact: (text: string) => string): T {
  if (typeof value === "string") return redact(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => redactJsonValue(v, redact)) as unknown as T;
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, redactJsonValue(v, redact)]),
    ) as unknown as T;
  }
  return value;
}

/** diagnostics 的遮蔽:message 与 data(自由内容)经钩子;code / operation / level / count 原样。 */
function redactDiagnostics(
  diagnostics: readonly DiagnosticRecord[],
  redact: (text: string) => string,
): DiagnosticRecord[] {
  return diagnostics.map((d) => ({
    ...d,
    message: redact(d.message),
    ...(d.data !== undefined ? { data: redactJsonValue(d.data, redact) } : {}),
  }));
}

/** AttemptList / ExperimentList / EvalList 共用的叶子构造:一个 Item → 一个 AttemptListItem。 */
function attemptListItemOf(item: Item, redact: (text: string) => string): AttemptListItem {
  const result = item.attempt.result;
  const cost = attemptCostUSD(result);
  return {
    evalId: evalIdOf(item),
    experimentId: experimentIdOf(item),
    attempt: result.attempt,
    agent: result.agent,
    verdict: result.verdict,
    ...(result.error !== undefined ? { error: redactError(result.error, redact) } : {}),
    ...(result.diagnostics !== undefined && result.diagnostics.length > 0
      ? { diagnostics: redactDiagnostics(result.diagnostics, redact) }
      : {}),
    assertions: redactAssertions(result.assertions, redact),
    durationMs: result.durationMs,
    ...(cost !== null ? { costUSD: cost } : {}),
    locator: locatorOf(item),
  };
}

const identityRedact = (text: string): string => text;

export interface AttemptListDataOptions {
  /**
   * 展示层遮蔽:error 的 message/cause/stack、diagnostic 的 message/data、断言 detail 与
   * evidence 经这个钩子;experimentId、evalId、locator、error/diagnostic code 与 lifecycle
   * operation 等身份和分类字段不经它。只作用于这次计算产出的组件数据,不改盘上 artifact。
   */
  redact?: (text: string) => string;
}

/** `AttemptList.data(selection)`:每个 Attempt 一项,顺序取自 Selection 展平顺序(不重排)。 */
export async function attemptListData(
  input: SnapshotsInput,
  opts?: AttemptListDataOptions,
): Promise<AttemptListItem[]> {
  const { snapshots } = resolveInput(input);
  const redact = opts?.redact ?? identityRedact;
  const items = collectItems(snapshots);
  return items.map((item) => attemptListItemOf(item, redact));
}

/** `EvalList.data(selection)`:每个 `experimentId + evalId` 一项,按 evalId 再按 experimentId 升序。 */
export async function evalListData(input: SnapshotsInput): Promise<EvalListItem[]> {
  const { snapshots } = resolveInput(input);
  const items = collectItems(snapshots);
  const groups = new Map<string, Item[]>();
  for (const item of items) {
    const key = fullEvalKey(item);
    const list = groups.get(key);
    if (list) list.push(item);
    else groups.set(key, [item]);
  }
  const out: EvalListItem[] = [];
  for (const group of groups.values()) {
    const sorted = [...group].sort((a, b) => a.attempt.result.attempt - b.attempt.result.attempt);
    const verdict = foldEvalVerdict(sorted.map((item) => item.attempt.result));
    const representative = sorted.find((item) => item.attempt.result.verdict === verdict) ?? sorted[0]!;
    const attempts = sorted.map((item) => attemptListItemOf(item, identityRedact));
    out.push({
      evalId: evalIdOf(sorted[0]!),
      experimentId: experimentIdOf(sorted[0]!),
      verdict,
      reason: reasonFor(representative.attempt.result),
      score: await computeCell(examScore, sorted),
      duration: await computeCell(durationMs, sorted),
      cost: await computeCell(costUSD, sorted),
      attempts,
    });
  }
  out.sort((a, b) => a.evalId.localeCompare(b.evalId) || a.experimentId.localeCompare(b.experimentId));
  return out;
}

/** `ExperimentList.data(selection)`:每个 experiment 一项,按 experimentId 升序;展开到每道 Eval。 */
export async function experimentListData(input: SnapshotsInput): Promise<ExperimentListItem[]> {
  const { snapshots } = resolveInput(input);
  const items = collectItems(snapshots);
  const groups = groupItems(items, "experiment");
  const out: ExperimentListItem[] = [];
  for (const [experimentId, group] of groups) {
    const stats = summarizeItems(group);
    const newest = [...group].sort((a, b) => b.snapshot.startedAt.localeCompare(a.snapshot.startedAt))[0]!;
    const evalGroups = groupItems(group, "eval");
    const evalRows: ExperimentListEvalRow[] = [];
    for (const [evalId, evalItems] of evalGroups) {
      const sorted = [...evalItems].sort((a, b) => a.attempt.result.attempt - b.attempt.result.attempt);
      const verdict = foldEvalVerdict(sorted.map((item) => item.attempt.result));
      const representative = sorted.find((item) => item.attempt.result.verdict === verdict) ?? sorted[0]!;
      const attempts = sorted.map((item) => attemptListItemOf(item, identityRedact));
      evalRows.push({
        evalId,
        verdict,
        reason: reasonFor(representative.attempt.result),
        duration: await computeCell(durationMs, sorted),
        cost: await computeCell(costUSD, sorted),
        attempts,
      });
    }
    evalRows.sort((a, b) => a.evalId.localeCompare(b.evalId));
    const experiment = newest.snapshot.experiment ?? newest.attempt.result.experiment;
    out.push({
      experimentId,
      agent: newest.snapshot.agent,
      ...((newest.attempt.result.model ?? newest.snapshot.model) !== undefined
        ? { model: newest.attempt.result.model ?? newest.snapshot.model }
        : {}),
      ...(experiment?.flags ? { flags: experiment.flags } : {}),
      verdicts: stats.verdicts,
      passRate: await computeCell(taskPassRate, group),
      cost: await computeCell(costUSD, group),
      duration: await computeCell(durationMs, group),
      tokens: await computeCell(tokens, group),
      evals: stats.evals,
      attempts: stats.attempts,
      lastRunAt: stats.lastRunAt!,
      evalRows,
    });
  }
  // ExperimentList 是默认实验比较表:初始态按成功率(taskPassRate)从高到低,缺数据沉底;
  // 同分时按 experiment id 稳定排序。web 增强可临时重排,text 面沿用同一基准顺序。
  out.sort((a, b) => {
    if (a.passRate.value === null && b.passRate.value === null) return a.experimentId.localeCompare(b.experimentId);
    if (a.passRate.value === null) return 1;
    if (b.passRate.value === null) return -1;
    return b.passRate.value - a.passRate.value || a.experimentId.localeCompare(b.experimentId);
  });
  return out;
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
  /** x 轴:experiment 声明的 flag 或顶层运行配置 config()(要求数值),不解析 experiment 命名。 */
  x: AxisInput;
  y: Metric;
  /** 可选:每个系列一条线(flag / config 或普通维度);省略 = 单系列。 */
  series?: DimensionInput;
}

/** 每个点 = 一个 experiment 的聚合;同系列的点按 x 排序连线(排序在组件面,数据保持分组序)。 */
export async function lineData(input: SnapshotsInput, opts: LineDataOptions): Promise<LineData> {
  const { snapshots } = resolveInput(input);
  const items = collectItems(snapshots);
  const groups = groupItems(items, "experiment");
  const rows: LineData["rows"] = [];
  for (const [key, group] of groups) {
    const x = axisValue(opts.x, group[0]); // flag / config 都是 experiment 级声明,组内一致
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
  // 通过率的唯一官方口径:taskPassRate 的两级聚合(computeCell),不是从上面四个 verdict
  // 计票现场重算——一道题内 attempt 部分通过要算部分 credit,不是二元投票;errored 记 null
  // 不进分母(基建故障不伪装成答错),errored 的存在经上面的 verdict 计票如实呈现。
  const passRateCell = await computeCell(taskPassRate, items);
  return {
    snapshots: snapshots.map((s) => ({
      experimentId: s.experimentId,
      agent: s.agent,
      model: s.model,
      startedAt: s.startedAt,
    })),
    totals: {
      evals: evalIds.size,
      attempts: items.length,
      passed,
      failed,
      errored,
      skipped,
      passRate: passRateCell,
      costUSD,
      durationMs,
    },
    warnings: [...warnings],
  };
}

// ───────────────────────── GroupSummary.data ─────────────────────────

/**
 * 一组 experiment 的摘要:experiment/eval/attempt 数量、eval 级折叠计票、通过率(旧
 * `GroupSelector` 卡片口径,见 summarizeItems)、总成本(null-safe 求和)、最后运行时间
 * (组内快照 startedAt 最大值)。`input` 就是调用方已经收窄好的组 Selection(如自定义报告
 * 按 experiment 组前缀 filter 出来的那份)——本函数不再自己分组。
 */
export async function groupSummaryData(input: SnapshotsInput): Promise<GroupSummaryData> {
  const { snapshots } = resolveInput(input);
  const items = collectItems(snapshots);
  const summary = summarizeItems(items);
  const ratio = summary.ran > 0 ? summary.verdicts.passed / summary.ran : null; // 分母为 0 → 缺数据,不编 0%
  const passRateCell: MetricCell = {
    value: ratio,
    display: ratio === null ? "—" : formatMetricValue(ratio, "%"),
    samples: summary.ran,
    total: summary.evals,
    refs: summary.refs,
  };
  return {
    experiments: summary.experiments,
    evals: summary.evals,
    attempts: summary.attempts,
    verdicts: summary.verdicts,
    passRate: passRateCell,
    totalCostUSD: summary.totalCostUSD,
    ...(summary.lastRunAt !== undefined ? { lastRunAt: summary.lastRunAt } : {}),
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
