// 实体列表 Table Content 投影(docs/feature/reports/library.md)。
// Experiment 层级在这里从闭合 ExperimentListItem + 组读数投影成 TableContent.subRows;
// 组件本体是中立 Table 原语,不知道 experiment / Eval / Attempt 语义。

import type {
  Cell,
  ColumnSpec,
  TableContent,
  TableContentRow,
} from "../../definition/cell.ts";
import { localizedMessage } from "../../model/locale.ts";
import type { Verdict } from "../../../shared/types.ts";
import type { MetricValue } from "../../../analysis/index.ts";
import { experimentListEvaluationKindComposition } from "../../model/format.ts";
import {
  experimentEvalLayout,
  relativeEvalLabel,
  type AttemptListItem,
  type ExperimentListEvalRow,
  type ExperimentListItem,
  type ExperimentMetrics,
  type EvalLayoutNode,
} from "./compute.ts";

/** 覆盖缺口占位行共用的原因码;missingText(code) 经 locale 键给出文案。 */
const NO_CURRENT_RESULT = "noCurrentResult";
/** 组内零样本读数格的结构化原因码。 */
const GROUP_NO_SAMPLES = "noSamples";
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
};

/**
 * 一行的「格子原料」:这一行自己算得出的全部格子,与任何列集无关。
 * 原料裁成行由 `projectCells` 做——列集外的原料丢掉,原料没覆盖的列显式填
 * notApplicable,不靠缺格回落成 "—"(memory/cell-key-must-match-column-set.md)。
 */
type CellBag = Readonly<globalThis.Record<string, Cell>>;

function projectCells(bag: CellBag, columns: readonly ColumnSpec[]): globalThis.Record<string, Cell> {
  const cells: globalThis.Record<string, Cell> = {};
  for (const column of columns) {
    cells[column.key] = bag[column.key] ?? { kind: "notApplicable" };
  }
  return cells;
}

function measureCell(value: MetricValue): Cell {
  return {
    kind: "metric",
    metric: value,
    // A complete denominator adds no actionable information to every text
    // cell. Keep partial and exceptional states explicit; the MetricValue
    // itself remains intact for both renderers and machine output.
    showCoverage: value.state !== "available",
  };
}

/** 一组判定 → 计票。experiment / 组行数题、Eval 行数 attempt,同一形态同一构造。 */
function tallyVerdicts(attempts: readonly AttemptListItem[]): {
  readonly passed: number;
  readonly failed: number;
  readonly errored: number;
  readonly skipped: number;
} {
  const counts = { passed: 0, failed: 0, errored: 0, skipped: 0 };
  for (const attempt of attempts) {
    if (attempt.verdict === null) continue;
    counts[attempt.verdict] += 1;
  }
  return counts;
}

function verdictCountsCell(attempts: readonly AttemptListItem[]): Cell {
  return { kind: "verdict", counts: tallyVerdicts(attempts) };
}

function evalVerdictCell(attempts: readonly AttemptListItem[]): Cell {
  const only = attempts.length === 1 ? attempts[0]?.verdict : null;
  return only === null || only === undefined ? verdictCountsCell(attempts) : verdictCell(only);
}

function verdictCell(verdict: Verdict | null): Cell {
  if (verdict === null) return { kind: "notApplicable" };
  return { kind: "verdict", verdict };
}

function locatorCell(attempt: AttemptListItem): Cell {
  return {
    kind: "locator",
    locator: attempt.locator,
    ...(attempt.verdict === null ? {} : { verdict: attempt.verdict }),
  };
}

function textCell(text: string, detail?: string): Cell {
  return detail ? { kind: "text", text, detail } : { kind: "text", text };
}

/** 失败摘要格:closed 摘录缺失时如实显示 "—",不发明文案。 */
function resultCell(attempt: AttemptListItem): Cell {
  return attempt.failureSummary === null
    ? { kind: "text", text: "—" }
    : { kind: "summary", text: attempt.failureSummary };
}

/**
 * attempt 行的格子原料。层级表取 entity / record / durationMs / tokens / costUSD,
 * 平铺表取 entity / verdict / result / durationMs / costUSD;
 * 两张表各自裁自这一份,不各写一份构造。
 */
function attemptCells(attempt: AttemptListItem): CellBag {
  return {
    entity: locatorCell(attempt),
    verdict: verdictCell(attempt.verdict),
    result: resultCell(attempt),
    // locator 已携带这次判定；末列不重复同一个状态。
    record: { kind: "notApplicable" },
    durationMs: measureCell(attempt.durationMs),
    tokens: measureCell(attempt.tokens),
    ...(attempt.totalScore === undefined ? {} : { totalScore: { kind: "score", earned: attempt.totalScore } as const }),
    ...(attempt.costUSD === undefined ? {} : { costUSD: measureCell(attempt.costUSD) }),
  };
}

const HIERARCHY_COLUMNS_PREFIX: readonly ColumnSpec[] = [
  { key: "entity", header: HEADER.entity },
  { key: "model", header: HEADER.model },
  { key: "agent", header: HEADER.agent },
  { key: "durationMs", better: "lower", header: HEADER.durationMs },
];

const HIERARCHY_COLUMNS_SUFFIX: readonly ColumnSpec[] = [
  { key: "tokens", better: "lower", header: HEADER.tokens },
  { key: "record", header: HEADER.record },
];

function hierarchyColumns(items: readonly ExperimentListItem[]): readonly ColumnSpec[] {
  const composition = experimentListEvaluationKindComposition(
    items.map((item) => ({ evaluationKind: item.evaluationKind, attempts: item.evalRows.length })),
  );
  const primary: ColumnSpec[] = [];
  if (composition !== "points") primary.push({ key: "passRate", better: "higher", header: HEADER.passRate });
  if (composition !== "pass") primary.push({ key: "totalScore", better: "higher", header: HEADER.totalScore });
  return [...HIERARCHY_COLUMNS_PREFIX, ...primary, ...HIERARCHY_COLUMNS_SUFFIX];
}

const COST_COLUMN: ColumnSpec = { key: "costUSD", better: "lower", header: HEADER.costUSD };

/** Attempt 平铺表的列集(AttemptList / FailureList 同一份)。 */
const FLAT_ENTITY_COLUMNS: readonly ColumnSpec[] = [
  { key: "entity", header: HEADER.entity },
  { key: "verdict", header: HEADER.verdict },
  { key: "result", header: HEADER.result },
  { key: "durationMs", better: "lower", header: HEADER.durationMs },
];

function columnsWithCost(columns: readonly ColumnSpec[], includeCost: boolean): readonly ColumnSpec[] {
  if (!includeCost) return columns;
  const recordIndex = columns.findIndex((column) => column.key === "record");
  if (recordIndex < 0) return [...columns, COST_COLUMN];
  return [...columns.slice(0, recordIndex), COST_COLUMN, ...columns.slice(recordIndex)];
}

/** 层级实体的计数属于身份说明,必须留在同一个首格而不是渲染成续行。 */
function identityCell(name: string, metadata: string): Cell {
  return textCell(`${name} (${metadata})`);
}

/** 组内题数与已知题数:"3/4 evals" 只在有缺口时出现。 */
function groupEntityDetail(evals: number, knownEvals: number): string {
  return knownEvals > evals ? `${evals}/${knownEvals} evals` : `${evals} evals`;
}

/**
 * 组行读数格:直接用 Analysis-owned 组 MetricValue;组前缀聚合缺失时才是
 * missing(本该有却没跑到),不是 "—"(对这一行没有意义)。
 */
function groupMetricValue(metrics: ExperimentMetrics | undefined, key: keyof ExperimentMetrics): Cell {
  const metric = metrics?.[key];
  return metric === undefined ? { kind: "missing", code: GROUP_NO_SAMPLES } : measureCell(metric);
}

/** 覆盖缺口占位行:code 与补跑命令同行——都是「当前配置下没有结果」这一个事实。 */
function placeholderRow(
  experimentId: string,
  evalId: string,
  label: string,
  columns: readonly ColumnSpec[],
): TableContentRow {
  const bag: CellBag = {
    entity: textCell(label),
    record: {
      kind: "missing",
      code: NO_CURRENT_RESULT,
      detail: `niceeval exp ${experimentId}`,
    },
  };
  return {
    key: `${experimentId}:${evalId}:missing`,
    variant: "placeholder",
    cells: projectCells(bag, columns),
  };
}

interface HierarchyView {
  readonly columns: readonly ColumnSpec[];
  readonly item: ExperimentListItem;
  readonly labelPrefix: string;
}

function attemptRow(attempt: AttemptListItem, columns: readonly ColumnSpec[]): TableContentRow {
  return {
    key: attempt.locator,
    cells: projectCells(attemptCells(attempt), columns),
  };
}

function evalRow(
  row: ExperimentListEvalRow,
  label: string,
  view: HierarchyView,
): TableContentRow {
  const bag: CellBag = {
    entity: textCell(label),
    // 单 Attempt Eval 直接显示判定；重复运行后才升级成计票摘要。
    record: evalVerdictCell(row.attempts),
    durationMs: measureCell(row.durationMs),
    ...(row.evaluationKind === "pass" && row.attempts.length > 1
      ? { passRate: measureCell(row.endToEndPassRate) }
      : {}),
    ...(row.totalScore === undefined ? {} : { totalScore: { kind: "score", earned: row.totalScore } as const }),
    ...(row.costUSD === undefined ? {} : { costUSD: measureCell(row.costUSD) }),
  };
  return {
    key: row.evalId,
    cells: projectCells(bag, view.columns),
    subRows: row.attempts.map((attempt) => attemptRow(attempt, view.columns)),
  };
}

function leafTableRow(node: Extract<EvalLayoutNode, { readonly kind: "leaf" }>, view: HierarchyView): TableContentRow {
  const label = relativeEvalLabel(node.evalId, view.labelPrefix);
  const row = view.item.evalRows.find((candidate) => candidate.evalId === node.evalId);
  return row === undefined
    ? placeholderRow(view.item.experimentId, node.evalId, label, view.columns)
    : evalRow(row, label, view);
}

/** 组行的成员 attempt 列表(用于判定计票)。 */
function attemptsUnder(
  node: EvalLayoutNode,
  evalRows: readonly ExperimentListEvalRow[],
): readonly AttemptListItem[] {
  const members = new Set<string>();
  const collect = (list: readonly EvalLayoutNode[]): void => {
    for (const entry of list) {
      if (entry.kind === "leaf") members.add(entry.evalId);
      else collect(entry.children);
    }
  };
  collect([node]);
  return evalRows
    .filter((row) => members.has(row.evalId))
    .flatMap((row) => row.attempts);
}

function groupTableRow(
  node: Extract<EvalLayoutNode, { readonly kind: "group" }>,
  item: ExperimentListItem,
  view: HierarchyView,
): TableContentRow {
  const evalIds = new Set<string>();
  const collect = (list: readonly EvalLayoutNode[]): void => {
    for (const entry of list) {
      if (entry.kind === "leaf") evalIds.add(entry.evalId);
      else collect(entry.children);
    }
  };
  collect([node]);
  const evalRows = item.evalRows.filter((row) => evalIds.has(row.evalId));
  const knownEvals = evalIds.size;
  const evals = evalRows.length;
  const metrics = item.groupMetrics.get(node.prefix);
  const attempts = attemptsUnder(node, item.evalRows);

  const bag: CellBag = {
    entity: identityCell(node.segment, groupEntityDetail(evals, knownEvals)),
    durationMs: groupMetricValue(metrics, "durationMs"),
    ...(evalRows.every((row) => row.evaluationKind === "pass")
      ? { passRate: groupMetricValue(metrics, "passRate") }
      : {}),
    ...(evalRows.some((row) => row.totalScore !== undefined)
      ? {
          totalScore: {
            kind: "score",
            earned: evalRows.reduce((sum, row) => sum + (row.totalScore ?? 0), 0),
          } as const,
        }
      : {}),
    tokens: groupMetricValue(metrics, "tokens"),
    ...(metrics?.costUSD === undefined ? {} : { costUSD: measureCell(metrics.costUSD) }),
    record: evals === 0
      ? { kind: "missing", code: GROUP_NO_SAMPLES }
      : verdictCountsCell(attempts),
  };
  return {
    key: `group:${node.prefix}`,
    variant: "group",
    cells: projectCells(bag, view.columns),
    subRows: groupChildren(node.children, { ...view, labelPrefix: node.prefix }),
  };
}

/** 同一层的组行按主读数降序(缺数据沉底,同值按段名收口),叶子恒在组行之后。 */
function groupChildren(
  nodes: readonly EvalLayoutNode[],
  view: HierarchyView,
): TableContentRow[] {
  const groups = nodes
    .filter((node): node is Extract<EvalLayoutNode, { readonly kind: "group" }> => node.kind === "group")
    .slice()
    .sort((left, right) => {
      const leftPrimary = view.item.groupMetrics.get(left.prefix)?.passRate.value ?? null;
      const rightPrimary = view.item.groupMetrics.get(right.prefix)?.passRate.value ?? null;
      if (leftPrimary === null && rightPrimary === null) return left.segment.localeCompare(right.segment);
      if (leftPrimary === null) return 1;
      if (rightPrimary === null) return -1;
      return rightPrimary - leftPrimary || left.segment.localeCompare(right.segment);
    });
  const leaves = nodes.filter((node): node is Extract<EvalLayoutNode, { readonly kind: "leaf" }> =>
    node.kind === "leaf");
  return [
    ...groups.map((node) => groupTableRow(node, view.item, view)),
    ...leaves.map((node) => leafTableRow(node, view)),
  ];
}

function experimentRow(item: ExperimentListItem, view: HierarchyView): TableContentRow {
  const evalIds = new Set(item.evalRows.map((row) => row.evalId));
  const members: readonly EvalLayoutNode[] = experimentEvalLayout([...new Set([...evalIds, ...item.missingEvalIds])]);
  const attempts = item.evalRows.flatMap((row) => row.attempts);
  const bag: CellBag = {
    entity: textCell(item.experimentId),
    model: item.model === null ? { kind: "notApplicable" } : textCell(item.model),
    agent: item.agent === null ? { kind: "notApplicable" } : textCell(item.agent),
    durationMs: measureCell(item.durationMs),
    ...(item.evaluationKind === "pass" ? { passRate: measureCell(item.endToEndPassRate) } : {}),
    ...(item.totalScore === undefined ? {} : { totalScore: { kind: "score", earned: item.totalScore } as const }),
    tokens: measureCell(item.tokens),
    ...(item.costUSD === undefined ? {} : { costUSD: measureCell(item.costUSD) }),
    record: verdictCountsCell(attempts),
  };
  return {
    key: item.experimentId,
    cells: projectCells(bag, view.columns),
    subRows: members.length > 0 ? groupChildren(members, view) : [],
  };
}

export function experimentListContent(items: readonly ExperimentListItem[]): TableContent {
  const columns = columnsWithCost(hierarchyColumns(items), items.some((item) => item.costUSD !== undefined));
  return {
    columns,
    rows: items.map((item) =>
      experimentRow(item, { columns, item, labelPrefix: "" })),
  };
}

export function attemptListContent(items: readonly AttemptListItem[]): TableContent {
  const columns = columnsWithCost(FLAT_ENTITY_COLUMNS, items.some((item) => item.costUSD !== undefined));
  return {
    columns,
    // 与层级表里的 attempt 行同一份格子原料,只是裁到平铺列集。
    rows: items.map((item) => attemptRow(item, columns)),
  };
}
