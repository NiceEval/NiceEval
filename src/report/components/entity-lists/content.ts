// 实体列表 Table Content 投影(docs/feature/reports/components/entity-lists/)。
// Eval 分组层在这里从扁平 evalRows + missingEvalIds 投影成 TableContent.subRows
// (docs/feature/reports/library.md「Eval 分组层」)。

import type { Cell, ColumnSpec, TableContent, TableContentRow } from "../../definition/cell.ts";
import { localizedMessage, type LocalizedText } from "../../model/locale.ts";
import type {
  AttemptListItem,
  EvalListItem,
  ExperimentListEvalRow,
  ExperimentListItem,
  EvaluationKindComposition,
  StaleConclusionReference,
} from "../../model/types.ts";
import type { MetricValue } from "../../model/calculation.ts";
import { experimentListEvaluationKindComposition } from "../../model/format.ts";
import type { AttemptLocator } from "../../../record/locator.ts";

/** 组内零样本读数格的结构化原因码;renderer 经 missingText 映射文案。 */
const GROUP_NO_SAMPLES = "noSamples";
/** 覆盖缺口两档占位行共用的原因码——两档说的是同一个事实,`code` 相同。 */
const NO_CURRENT_RESULT = "noCurrentResult";
/** 覆盖构成四段的声明序:新执行 → 历史执行 → 过期结论 → 未跑到(段序即声明序)。 */
const COVERAGE_SEGMENT_KEYS = ["coverage.fresh", "coverage.historical", "coverage.stale", "coverage.notRun"] as const;

/** 三张实体表共用的列表头。文案单源在 locale 字典,这里只烤成随列走的 LocalizedText。 */
const HEADER = {
  entity: localizedMessage("experimentList.experiment"),
  model: localizedMessage("table.model"),
  agent: localizedMessage("table.agent"),
  durationMs: localizedMessage("experimentList.avgDuration"),
  passRate: localizedMessage("experimentList.passRate"),
  totalScore: localizedMessage("experimentList.totalScore"),
  tokens: localizedMessage("experimentList.tokens"),
  costUSD: localizedMessage("experimentList.cost"),
  record: localizedMessage("experimentList.result"),
  verdict: localizedMessage("experimentList.status"),
  result: localizedMessage("experimentList.result"),
  score: localizedMessage("experimentList.totalScore"),
};

/**
 * 一行的「格子原料」:这一行自己算得出的全部格子,与任何列集无关。
 * 同一个行构造被几种列集消费(层级表 / 平铺表),原料裁成行由 `projectCells` 做,
 * 不是一份格子四处塞——那样 key 与列集只能靠巧合对齐
 * (memory/cell-key-must-match-column-set.md)。
 */
type CellBag = Readonly<globalThis.Record<string, Cell>>;

/** 原料 → 行 cells:列集外的原料丢掉,原料没覆盖的列显式填 notApplicable。 */
function projectCells(bag: CellBag, columns: readonly ColumnSpec[]): globalThis.Record<string, Cell> {
  const cells: globalThis.Record<string, Cell> = {};
  for (const column of columns) {
    cells[column.key] = bag[column.key] ?? { kind: "notApplicable" };
  }
  return cells;
}

/** 层级表的一次投影:列集随 composition 动态,行按这一份列集裁。 */
interface HierarchyView {
  readonly columns: readonly ColumnSpec[];
  readonly composition: EvaluationKindComposition;
}

function measureCell(value: MetricValue): Cell {
  return { kind: "metric", metric: value };
}

function verdictCell(counts: ExperimentListItem["evalVerdicts"]): Cell {
  return {
    kind: "verdict",
    counts: { passed: counts.passed, failed: counts.failed, errored: counts.errored, skipped: counts.skipped },
  };
}

/** 一组判定 → 计票。experiment 行数题、Eval 行数 attempt,同一形态同一构造。 */
function tallyVerdicts(verdicts: readonly AttemptListItem["verdict"][]): ExperimentListItem["evalVerdicts"] {
  const counts = { passed: 0, failed: 0, errored: 0, skipped: 0 };
  for (const verdict of verdicts) {
    if (verdict === "passed") counts.passed += 1;
    else if (verdict === "failed") counts.failed += 1;
    else if (verdict === "errored") counts.errored += 1;
    else counts.skipped += 1;
  }
  return counts;
}

function textCell(text: string, detail?: string): Cell {
  return detail ? { kind: "text", text, detail } : { kind: "text", text };
}

/** 层级实体的计数属于身份说明，必须留在同一个首格而不是渲染成续行。 */
function identityCell(name: string, metadata: string): Cell {
  return textCell(`${name} (${metadata})`);
}

function attemptMetricValue(
  value: number | null,
  unit: "ms" | "$",
  locator: AttemptLocator,
): Cell {
  return {
    kind: "metric",
    metric: {
      value,
      unit,
      basis: "eval",
      samples: value === null ? 0 : 1,
      total: 1,
      refs: [locator],
    },
  };
}

/**
 * attempt 行的格子原料。层级表取 entity / record / durationMs / costUSD,
 * 平铺表取 entity / verdict / result / durationMs / costUSD / score;
 * 两张表各自裁自这一份,不各写一份构造。
 */
function attemptCells(item: AttemptListItem): CellBag {
  const verdict = item.verdict as "passed" | "failed" | "errored" | "skipped";
  const summary =
    item.failureSummary !== null
      ? { kind: "summary" as const, text: item.failureSummary, more: item.moreFailures > 0 ? item.moreFailures : undefined }
      : { kind: "text" as const, text: "—" };
  return {
    entity: {
      kind: "locator",
      locator: item.locator,
      staleSinceMs: item.staleSinceMs,
      verdict,
    },
    verdict: { kind: "verdict", verdict },
    result: summary,
    // 层级表(experimentListContent)的判定构成列:该次判定,与 verdict 格同值。
    record: { kind: "verdict", verdict },
    durationMs: attemptMetricValue(item.durationMs, "ms", item.locator),
    costUSD: attemptMetricValue(item.costUSD, "$", item.locator),
    ...(item.evaluationKind === "points" ? { score: { kind: "metric" as const, metric: item.totalScore } } : {}),
  };
}

function attemptRow(
  item: AttemptListItem,
  columns: readonly ColumnSpec[],
): TableContentRow {
  return {
    key: item.locator,
    cells: projectCells(attemptCells(item), columns),
  };
}

/** 相对已表达前缀的剩余路径;无前缀时是完整 evalId。 */
function relativeLabel(evalId: string, labelPrefix: string): string {
  if (!labelPrefix) return evalId;
  const prefix = `${labelPrefix}/`;
  return evalId.startsWith(prefix) ? evalId.slice(prefix.length) : evalId;
}

function joinPath(prefix: string, segment: string): string {
  return prefix ? `${prefix}/${segment}` : segment;
}

function mean(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function mergeRefs(cells: readonly MetricValue[]): AttemptLocator[] {
  return [...new Set(cells.flatMap((cell) => cell.refs))].sort();
}

/** acrossEvals mean:把各题已算好的 MetricValue 再折一层。 */
function meanCells(cells: readonly MetricValue[], unit?: string): MetricValue {
  const total = cells.reduce((sum, cell) => sum + cell.total, 0);
  const samples = cells.reduce((sum, cell) => sum + cell.samples, 0);
  const values = cells.map((cell) => cell.value).filter((v): v is number => v !== null);
  const refs = mergeRefs(cells);
  if (values.length === 0) {
    return { value: null, basis: "eval", samples: 0, total, refs };
  }
  const value = mean(values);
  return {
    value,
    basis: "eval",
    samples,
    total,
    refs,
    ...(unit !== undefined ? { unit } : {}),
  };
}

/** acrossEvals sum(totalScore)。 */
function sumCells(cells: readonly MetricValue[]): MetricValue {
  const total = cells.reduce((sum, cell) => sum + cell.total, 0);
  const samples = cells.reduce((sum, cell) => sum + cell.samples, 0);
  const values = cells.map((cell) => cell.value).filter((v): v is number => v !== null);
  const refs = mergeRefs(cells);
  if (values.length === 0) {
    return { value: null, basis: "eval", samples: 0, total, refs };
  }
  const value = values.reduce((a, b) => a + b, 0);
  return { value, basis: "eval", samples, total, refs };
}

/**
 * 组内通过率:与 endToEndPassRate 同口径——attempt 级 passed=1 / failed|errored=0 /
 * skipped=null,先 perEval mean 再 acrossEvals mean;占位行不进分母。
 *
 * 注:这里手写聚合而非 computeCell——ExperimentListEvalRow 只有投影后的
 * AttemptListItem,拿不到按 (eval, snapshot) 分桶的原始 Item。metric 定义或分桶
 * 规则一改,组行会与 experiment 行静默漂移;更干净的做法是在 compute.ts 用
 * computeCell 算好组级 cell 再投影。
 */
function groupPassRate(evalRows: readonly ExperimentListEvalRow[]): MetricValue {
  const evalMeans: number[] = [];
  let samples = 0;
  let total = 0;
  const refs: AttemptLocator[] = [];
  for (const row of evalRows) {
    if (row.evaluationKind === "points") continue;
    total += row.endToEndPassRate.total;
    samples += row.endToEndPassRate.samples;
    refs.push(...row.endToEndPassRate.refs);
    if (row.endToEndPassRate.value !== null) evalMeans.push(row.endToEndPassRate.value);
  }
  if (evalMeans.length === 0) {
    return { value: null, unit: "%", better: "higher", bounds: { min: 0, max: 1 }, basis: "eval", samples: 0, total, refs: [...new Set(refs)].sort() };
  }
  const value = mean(evalMeans);
  return {
    value,
    unit: "%",
    better: "higher",
    bounds: { min: 0, max: 1 },
    basis: "eval",
    samples,
    total,
    refs: [...new Set(refs)].sort(),
  };
}

function tallyEvalVerdicts(evalRows: readonly ExperimentListEvalRow[]): ExperimentListItem["evalVerdicts"] {
  return tallyVerdicts(evalRows.map((row) => row.verdict));
}

function groupEntityDetail(evals: number, knownEvals: number): string {
  return knownEvals > evals ? `${evals}/${knownEvals} evals` : `${evals} evals`;
}

/** 组内零样本读数格是 missing(本该有却没跑到),不是 —(对这一行没有意义)。 */
function groupMetricValue(evalRows: readonly ExperimentListEvalRow[], cell: MetricValue): Cell {
  if (evalRows.length === 0) return { kind: "missing", code: GROUP_NO_SAMPLES };
  return measureCell(cell);
}

function evalRow(
  row: ExperimentListEvalRow,
  view: HierarchyView,
  label: string,
): TableContentRow {
  const bag: CellBag = {
    entity: textCell(label),
    verdict: { kind: "verdict", verdict: row.verdict as "passed" | "failed" | "errored" | "skipped" },
    // 判定构成列:该题 attempts 的计票,与 experiment 行数题的计票同一形态。
    record: verdictCell(tallyVerdicts(row.attempts.map((attempt) => attempt.verdict))),
    durationMs: measureCell(row.durationMs),
    costUSD: measureCell(row.costUSD),
  };
  return {
    key: row.evalId,
    cells: projectCells(bag, view.columns),
    subRows: row.attempts.map((a) => attemptRow(a, view.columns)),
  };
}

/**
 * 覆盖缺口的两档占位行(docs/feature/reports/components/summaries/experiment-table.md
 * 「覆盖缺口的两档占位行」):`code` 与补跑命令两档相同——都是「当前配置下没有结果」这同一个
 * 事实;差别只在有没有 `reference`,带参考时它替代原因文案,不把同一句话说两遍。
 */
function placeholderRow(
  experimentId: string,
  evalId: string,
  label: string,
  columns: readonly ColumnSpec[],
  reference: StaleConclusionReference | undefined,
): TableContentRow {
  const bag: CellBag = {
    entity: textCell(label),
    record: {
      kind: "missing",
      code: NO_CURRENT_RESULT,
      detail: `niceeval exp ${experimentId}`,
      ...(reference ? { reference } : {}),
    },
  };
  return {
    key: `${experimentId}:${evalId}:missing`,
    variant: "placeholder",
    cells: projectCells(bag, columns),
  };
}

type LeafMember =
  | { kind: "eval"; row: ExperimentListEvalRow }
  | { kind: "missing"; evalId: string };

function memberEvalId(member: LeafMember): string {
  return member.kind === "eval" ? member.row.evalId : member.evalId;
}

function memberEvalRows(members: readonly LeafMember[]): ExperimentListEvalRow[] {
  return members
    .filter((m): m is { kind: "eval"; row: ExperimentListEvalRow } => m.kind === "eval")
    .map((m) => m.row);
}

function groupPrimaryValue(
  evalRows: readonly ExperimentListEvalRow[],
): number | null {
  const evaluationKind = evalRowsEvaluationKindComposition(evalRows);
  if (evaluationKind === "mixed") return null;
  if (evaluationKind === "points") {
    return sumCells(evalRows.map((row) => row.totalScore)).value;
  }
  return groupPassRate(evalRows).value;
}

function evalRowsEvaluationKindComposition(evalRows: readonly ExperimentListEvalRow[]): EvaluationKindComposition {
  const hasPass = evalRows.some((row) => row.evaluationKind !== "points");
  const hasPoints = evalRows.some((row) => row.evaluationKind !== "pass");
  return hasPass && hasPoints ? "mixed" : hasPoints ? "points" : "pass";
}

function leafTableRow(
  member: LeafMember,
  label: string,
  item: ExperimentListItem,
  view: HierarchyView,
): TableContentRow {
  return member.kind === "eval"
    ? evalRow(member.row, view, label)
    : placeholderRow(item.experimentId, member.evalId, label, view.columns, item.staleReferences[member.evalId]);
}

function groupTableRow(
  /** 组行显示的这一段(不带祖先前缀)。 */
  segment: string,
  /** 完整路径前缀,作行 key 与子孙 labelPrefix。 */
  pathKey: string,
  members: readonly LeafMember[],
  childRows: readonly TableContentRow[],
  view: HierarchyView,
): TableContentRow {
  const evalRows = memberEvalRows(members);
  const knownEvals = members.length;
  const evals = evalRows.length;
  const passRate = groupPassRate(evalRows);
  const totalScore = sumCells(evalRows.map((row) => row.totalScore));
  const durationMs = meanCells(
    evalRows.map((row) => row.durationMs),
    "ms",
  );
  const costUSD = meanCells(
    evalRows.map((row) => row.costUSD),
    "$",
  );
  const tokens = meanCells(evalRows.map((row) => row.tokens), "tokens");
  const evalVerdicts = tallyEvalVerdicts(evalRows);

  const bag: CellBag = {
    entity: identityCell(segment, groupEntityDetail(evals, knownEvals)),
    durationMs: groupMetricValue(evalRows, durationMs),
    passRate: groupMetricValue(evalRows, passRate),
    totalScore: groupMetricValue(evalRows, totalScore),
    tokens: groupMetricValue(evalRows, tokens),
    costUSD: groupMetricValue(evalRows, costUSD),
    record: evalRows.length === 0 ? { kind: "missing", code: GROUP_NO_SAMPLES } : verdictCell(evalVerdicts),
  };
  return {
    key: `group:${pathKey}`,
    variant: "group",
    cells: projectCells(bag, view.columns),
    subRows: childRows,
  };
}

/**
 * 按路径段递归嵌套。
 * - `dirPrefix`:已消费的目录前缀(含剥掉未展示的壳),决定本层 remaining。
 * - `labelPrefix`:已由祖先组行表达的前缀,决定叶子/组标签相对哪一段。
 * 两条收起条件在每一层兄弟之间各自判定。
 */
function nestLevel(
  members: readonly LeafMember[],
  dirPrefix: string,
  labelPrefix: string,
  item: ExperimentListItem,
  view: HierarchyView,
): TableContentRow[] {
  if (members.length === 0) return [];

  const leaves: LeafMember[] = [];
  const groups = new Map<string, LeafMember[]>();

  for (const member of members) {
    const remaining = relativeLabel(memberEvalId(member), dirPrefix).split("/").filter(Boolean);
    if (remaining.length <= 1) {
      leaves.push(member);
      continue;
    }
    const head = remaining[0]!;
    const list = groups.get(head);
    if (list) list.push(member);
    else groups.set(head, [member]);
  }

  const collapse =
    groups.size === 0 ||
    (groups.size === 1 && leaves.length === 0) ||
    [...groups.values()].every((group) => group.length === 1);

  if (collapse) {
    if (groups.size === 1 && leaves.length === 0) {
      const head = [...groups.keys()][0]!;
      // 剥壳不插组行:dir 前进、label 不动,子孙标签仍带上被剥的段。
      return nestLevel(members, joinPath(dirPrefix, head), labelPrefix, item, view);
    }
    return members
      .slice()
      .sort((a, b) => memberEvalId(a).localeCompare(memberEvalId(b)))
      .map((member) => leafTableRow(member, relativeLabel(memberEvalId(member), labelPrefix), item, view));
  }

  const groupEntries = [...groups.entries()].map(([segment, groupMembers]) => ({
    segment,
    groupMembers,
    primary: groupPrimaryValue(memberEvalRows(groupMembers)),
  }));
  groupEntries.sort((a, b) => {
    if (a.primary === null && b.primary === null) return a.segment.localeCompare(b.segment);
    if (a.primary === null) return 1;
    if (b.primary === null) return -1;
    return b.primary - a.primary || a.segment.localeCompare(b.segment);
  });

  const rows: TableContentRow[] = groupEntries.map((entry) => {
    const pathKey = joinPath(dirPrefix, entry.segment);
    // 子级的 labelPrefix 跟 dir 走完整路径(含祖先剥掉的壳),组行自己只显示这一段。
    const childRows = nestLevel(entry.groupMembers, pathKey, pathKey, item, view);
    return groupTableRow(entry.segment, pathKey, entry.groupMembers, childRows, view);
  });

  const flat = leaves
    .slice()
    .sort((a, b) => memberEvalId(a).localeCompare(memberEvalId(b)))
    .map((member) => leafTableRow(member, relativeLabel(memberEvalId(member), labelPrefix), item, view));

  return [...rows, ...flat];
}

/**
 * 覆盖构成的四段计数(docs/feature/reports/components/summaries/experiment-table.md「覆盖构成」):
 * 新执行 / 历史执行 = 有 attempt 的题按其中是否有非历史(新执行)划分;过期结论 = 缺口题里
 * `staleReferences` 命中的那些;未跑到 = 缺口题里剩下的那些。四段互斥且合计等于已知题数。
 */
function coverageSegments(item: ExperimentListItem): { label: LocalizedText; count: number }[] {
  let fresh = 0;
  for (const row of item.evalRows) {
    if (row.attempts.some((a) => !a.historical)) fresh += 1;
  }
  const historical = item.evalRows.length - fresh;
  const stale = Object.keys(item.staleReferences).length;
  const notRun = item.missingEvalIds.length - stale;
  return COVERAGE_SEGMENT_KEYS.map((key, i) => ({
    label: localizedMessage(key),
    count: [fresh, historical, stale, notRun][i]!,
  }));
}

/** 覆盖构成副行的 key 前缀;测试与消费方靠它把这一行从 Eval / 组行里筛出去。 */
export const COVERAGE_ROW_PREFIX = "coverage:";

/**
 * 覆盖构成副行(docs/feature/reports/components/summaries/experiment-table.md「覆盖构成」):
 * experiment 行 subRows 的最后一条,把已知题按结论出身分成四段互斥的构成格,交给中立的
 * `composition` 格——渲染在同一个 `record` 列位置(与 Eval / Attempt 行的判定构成、占位行的
 * missing 格同一个槽位,三种形态各自对应不同的行语义,不是同一行的三种读法)。
 * 它不是 Eval / 组行,没有身份(entity 是 notApplicable),不参与嵌套排序或收起判定。
 */
function coverageRow(item: ExperimentListItem, view: HierarchyView): TableContentRow {
  const bag: CellBag = {
    entity: { kind: "notApplicable" },
    record: { kind: "composition", segments: coverageSegments(item) },
  };
  return {
    key: `${COVERAGE_ROW_PREFIX}${item.experimentId}`,
    cells: projectCells(bag, view.columns),
  };
}

/** experiment 的 evalRows + missingEvalIds → 递归嵌套的 subRows,末尾追加覆盖构成副行。 */
function experimentSubRows(item: ExperimentListItem, view: HierarchyView): TableContentRow[] {
  const members: LeafMember[] = [
    ...item.evalRows.map((row): LeafMember => ({ kind: "eval", row })),
    ...item.missingEvalIds.map((evalId): LeafMember => ({ kind: "missing", evalId })),
  ];
  const nested = nestLevel(members, "", "", item, view);
  return members.length > 0 ? [...nested, coverageRow(item, view)] : nested;
}

function experimentRow(item: ExperimentListItem, view: HierarchyView): TableContentRow {
  const bag: CellBag = {
    entity: textCell(item.experimentId),
    model: item.model ? textCell(item.model) : { kind: "notApplicable" },
    agent: textCell(item.agent),
    durationMs: measureCell(item.durationMs),
    passRate: measureCell(item.endToEndPassRate),
    totalScore: measureCell(item.totalScore),
    tokens: measureCell(item.tokens),
    costUSD: measureCell(item.costUSD),
    record: verdictCell(item.evalVerdicts),
  };
  return {
    key: item.experimentId,
    cells: projectCells(bag, view.columns),
    subRows: experimentSubRows(item, view),
  };
}

/** 层级表列集:主读数列随题型构成在场,其余固定。 */
function experimentColumns(composition: EvaluationKindComposition): ColumnSpec[] {
  return [
    { key: "entity", header: HEADER.entity },
    { key: "model", header: HEADER.model },
    { key: "agent", header: HEADER.agent },
    { key: "durationMs", better: "lower", header: HEADER.durationMs },
    ...(composition !== "points" ? [{ key: "passRate", better: "higher" as const, header: HEADER.passRate }] : []),
    ...(composition !== "pass" ? [{ key: "totalScore", better: "higher" as const, header: HEADER.totalScore }] : []),
    { key: "tokens", better: "lower", header: HEADER.tokens },
    { key: "costUSD", better: "lower", header: HEADER.costUSD },
    { key: "record", header: HEADER.record },
  ];
}

/** Eval / Attempt 平铺表的列集(两张表同一份)。 */
const FLAT_ENTITY_COLUMNS: readonly ColumnSpec[] = [
  { key: "entity", header: HEADER.entity },
  { key: "verdict", header: HEADER.verdict },
  { key: "result", header: HEADER.result },
  { key: "durationMs", better: "lower", header: HEADER.durationMs },
  { key: "costUSD", better: "lower", header: HEADER.costUSD },
  { key: "score", better: "higher", header: HEADER.score },
];

export function experimentListContent(items: readonly ExperimentListItem[]): TableContent {
  const composition = experimentListEvaluationKindComposition(items);
  const view: HierarchyView = { columns: experimentColumns(composition), composition };
  return {
    columns: view.columns,
    rows: items.map((item) => experimentRow(item, view)),
  };
}

export function evalListContent(items: readonly EvalListItem[]): TableContent {
  return {
    columns: FLAT_ENTITY_COLUMNS,
    rows: items.map((item) => ({
      key: `${item.experimentId}:${item.evalId}`,
      cells: projectCells(
        {
          entity: textCell(`${item.experimentId} / ${item.evalId}`),
          verdict: { kind: "verdict", verdict: item.verdict as "passed" | "failed" | "errored" | "skipped" },
          durationMs: measureCell(item.durationMs),
          costUSD: measureCell(item.costUSD),
          score: measureCell(item.totalScore),
        },
        FLAT_ENTITY_COLUMNS,
      ),
      subRows: item.attempts.map((a) => attemptRow(a, FLAT_ENTITY_COLUMNS)),
    })),
  };
}

export function attemptListContent(items: readonly AttemptListItem[]): TableContent {
  return {
    columns: FLAT_ENTITY_COLUMNS,
    // 与层级表里的 attempt 行同一份格子原料,只是裁到平铺列集。
    rows: items.map((item) => attemptRow(item, FLAT_ENTITY_COLUMNS)),
  };
}
