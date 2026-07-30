// 实体列表 Table Content 投影(docs/feature/reports/components/entity-lists/)。
// Eval 分组层在这里从扁平 evalRows + missingEvalIds 投影成 TableContent.subRows
// (docs/feature/reports/library.md「Eval 分组层」)。

import type { Cell, TableContent, TableContentRow } from "../../definition/cell.ts";
import type {
  AttemptListItem,
  EvalListItem,
  ExperimentListEvalRow,
  ExperimentListItem,
} from "../../model/types.ts";
import type { MetricValue } from "../../model/calculation.ts";
import { experimentListScoringComposition } from "../../model/format.ts";
import type { AttemptLocator } from "../../../record/locator.ts";

/** 组内零样本读数格的结构化原因码;renderer 经 missingText 映射文案。 */
const GROUP_NO_SAMPLES = "noSamples";

function measureCell(value: MetricValue): Cell {
  return { kind: "metric", metric: value };
}

function verdictCell(counts: ExperimentListItem["evalVerdicts"]): Cell {
  return {
    kind: "verdict",
    counts: { passed: counts.passed, failed: counts.failed, errored: counts.errored, skipped: counts.unreadable },
  };
}

function textCell(text: string, detail?: string): Cell {
  return detail ? { kind: "text", text, detail } : { kind: "text", text };
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

function attemptRow(item: AttemptListItem, scoring: "pass" | "points"): TableContentRow {
  const summary =
    item.failureSummary !== null
      ? { kind: "summary" as const, text: item.failureSummary, more: item.moreFailures > 0 ? item.moreFailures : undefined }
      : { kind: "text" as const, text: "—" };
  return {
    key: item.locator,
    cells: {
      entity: {
        kind: "locator",
        locator: item.locator,
        staleSinceMs: item.historical ? 1 : undefined,
        verdict: item.verdict as "passed" | "failed" | "errored" | "skipped",
      },
      verdict: { kind: "verdict", verdict: item.verdict as "passed" | "failed" | "errored" | "skipped" },
      result: summary,
      durationMs: attemptMetricValue(item.durationMs, "ms", item.locator),
      costUSD: attemptMetricValue(item.costUSD, "$", item.locator),
      ...(scoring === "points" ? { score: { kind: "metric", metric: item.totalScore } } : {}),
    },
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
 * unreadable=null,先 perEval mean 再 acrossEvals mean;占位行不进分母。
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
    const scores: number[] = [];
    for (const attempt of row.attempts) {
      total += 1;
      refs.push(attempt.locator);
      if (attempt.verdict === "unreadable") continue;
      samples += 1;
      scores.push(attempt.verdict === "passed" ? 1 : 0);
    }
    if (scores.length > 0) evalMeans.push(mean(scores));
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
  const counts = { passed: 0, failed: 0, errored: 0, unreadable: 0 };
  for (const row of evalRows) {
    if (row.verdict === "passed") counts.passed += 1;
    else if (row.verdict === "failed") counts.failed += 1;
    else if (row.verdict === "errored") counts.errored += 1;
    else counts.unreadable += 1;
  }
  return counts;
}

function groupEntityDetail(evals: number, knownEvals: number, attempts: number): string {
  const evalPart = knownEvals > evals ? `${evals}/${knownEvals} evals` : `${evals} evals`;
  return attempts > evals ? `${evalPart} · ${attempts} attempts` : evalPart;
}

/** 组内零样本读数格是 missing(本该有却没跑到),不是 —(对这一行没有意义)。 */
function groupMetricValue(evalRows: readonly ExperimentListEvalRow[], cell: MetricValue): Cell {
  if (evalRows.length === 0) return { kind: "missing", code: GROUP_NO_SAMPLES };
  return measureCell(cell);
}

function evalRow(
  row: ExperimentListEvalRow,
  scoring: "pass" | "points",
  label: string,
): TableContentRow {
  return {
    key: row.evalId,
    cells: {
      entity: textCell(label),
      verdict: { kind: "verdict", verdict: row.verdict as "passed" | "failed" | "errored" | "skipped" },
      result: { kind: "notApplicable" },
      durationMs: measureCell(row.durationMs),
      costUSD: measureCell(row.costUSD),
      ...(scoring === "points" ? { score: measureCell(row.totalScore) } : {}),
    },
    subRows: row.attempts.map((a) => attemptRow(a, scoring)),
  };
}

function placeholderRow(experimentId: string, evalId: string, label: string): TableContentRow {
  return {
    key: `${experimentId}:${evalId}:missing`,
    variant: "placeholder",
    cells: {
      entity: textCell(label),
      verdict: { kind: "notApplicable" },
      result: textCell("No result for current config", `niceeval exp ${experimentId}`),
      durationMs: { kind: "notApplicable" },
      costUSD: { kind: "notApplicable" },
    },
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
  scoring: "pass" | "points",
): number | null {
  if (scoring === "points") {
    return sumCells(evalRows.map((row) => row.totalScore)).value;
  }
  return groupPassRate(evalRows).value;
}

function leafTableRow(
  member: LeafMember,
  label: string,
  item: ExperimentListItem,
): TableContentRow {
  return member.kind === "eval"
    ? evalRow(member.row, item.scoring, label)
    : placeholderRow(item.experimentId, member.evalId, label);
}

function groupTableRow(
  /** 组行显示的这一段(不带祖先前缀)。 */
  segment: string,
  /** 完整路径前缀,作行 key 与子孙 labelPrefix。 */
  pathKey: string,
  members: readonly LeafMember[],
  childRows: readonly TableContentRow[],
  item: ExperimentListItem,
  composition: "pass" | "points" | "mixed",
): TableContentRow {
  const evalRows = memberEvalRows(members);
  const knownEvals = members.length;
  const evals = evalRows.length;
  const attempts = evalRows.reduce((sum, row) => sum + row.attempts.length, 0);
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

  return {
    key: `group:${pathKey}`,
    variant: "group",
    cells: {
      entity: textCell(segment, groupEntityDetail(evals, knownEvals, attempts)),
      model: { kind: "notApplicable" },
      agent: { kind: "notApplicable" },
      durationMs: groupMetricValue(evalRows, durationMs),
      passRate: composition !== "points" ? groupMetricValue(evalRows, passRate) : { kind: "notApplicable" },
      totalScore: composition !== "pass" ? groupMetricValue(evalRows, totalScore) : { kind: "notApplicable" },
      tokens: groupMetricValue(evalRows, tokens),
      costUSD: groupMetricValue(evalRows, costUSD),
      record: evalRows.length === 0 ? { kind: "missing", code: GROUP_NO_SAMPLES } : verdictCell(evalVerdicts),
    },
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
  composition: "pass" | "points" | "mixed",
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
      return nestLevel(members, joinPath(dirPrefix, head), labelPrefix, item, composition);
    }
    return members
      .slice()
      .sort((a, b) => memberEvalId(a).localeCompare(memberEvalId(b)))
      .map((member) => leafTableRow(member, relativeLabel(memberEvalId(member), labelPrefix), item));
  }

  const groupEntries = [...groups.entries()].map(([segment, groupMembers]) => ({
    segment,
    groupMembers,
    primary: groupPrimaryValue(memberEvalRows(groupMembers), item.scoring),
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
    const childRows = nestLevel(entry.groupMembers, pathKey, pathKey, item, composition);
    return groupTableRow(entry.segment, pathKey, entry.groupMembers, childRows, item, composition);
  });

  const flat = leaves
    .slice()
    .sort((a, b) => memberEvalId(a).localeCompare(memberEvalId(b)))
    .map((member) => leafTableRow(member, relativeLabel(memberEvalId(member), labelPrefix), item));

  return [...rows, ...flat];
}

/** experiment 的 evalRows + missingEvalIds → 递归嵌套的 subRows。 */
function experimentSubRows(
  item: ExperimentListItem,
  composition: "pass" | "points" | "mixed",
): TableContentRow[] {
  const members: LeafMember[] = [
    ...item.evalRows.map((row): LeafMember => ({ kind: "eval", row })),
    ...item.missingEvalIds.map((evalId): LeafMember => ({ kind: "missing", evalId })),
  ];
  return nestLevel(members, "", "", item, composition);
}

function experimentRow(item: ExperimentListItem, composition: "pass" | "points" | "mixed"): TableContentRow {
  return {
    key: item.experimentId,
    cells: {
      entity: textCell(item.experimentId, `${item.evals} evals · ${item.attempts} attempts`),
      model: item.model ? textCell(item.model) : { kind: "notApplicable" },
      agent: textCell(item.agent),
      durationMs: measureCell(item.durationMs),
      passRate: composition !== "points" ? measureCell(item.endToEndPassRate) : { kind: "notApplicable" },
      totalScore: composition !== "pass" ? measureCell(item.totalScore) : { kind: "notApplicable" },
      tokens: measureCell(item.tokens),
      costUSD: measureCell(item.costUSD),
      record: verdictCell(item.evalVerdicts),
    },
    subRows: experimentSubRows(item, composition),
  };
}

const EXPERIMENT_BASE_COLUMNS = [
  { key: "entity" },
  { key: "model" },
  { key: "agent" },
  { key: "durationMs", better: "lower" as const },
];

export function experimentListContent(items: readonly ExperimentListItem[]): TableContent {
  const composition = experimentListScoringComposition(items);
  return {
    columns: [
      ...EXPERIMENT_BASE_COLUMNS,
      ...(composition !== "points" ? [{ key: "passRate", better: "higher" as const }] : []),
      ...(composition !== "pass" ? [{ key: "totalScore", better: "higher" as const }] : []),
      { key: "tokens", better: "lower" },
      { key: "costUSD", better: "lower" },
      { key: "record" },
    ],
    rows: items.map((item) => experimentRow(item, composition)),
  };
}

export function evalListContent(items: readonly EvalListItem[]): TableContent {
  return {
    columns: [
      { key: "entity" },
      { key: "verdict" },
      { key: "result" },
      { key: "durationMs", better: "lower" },
      { key: "costUSD", better: "lower" },
      { key: "score", better: "higher" },
    ],
    rows: items.map((item) => ({
      key: `${item.experimentId}:${item.evalId}`,
      cells: {
        entity: textCell(`${item.experimentId} / ${item.evalId}`),
        verdict: { kind: "verdict", verdict: item.verdict as "passed" | "failed" | "errored" | "skipped" },
        result: { kind: "notApplicable" },
        durationMs: measureCell(item.durationMs),
        costUSD: measureCell(item.costUSD),
        score: measureCell(item.totalScore),
      },
      subRows: item.attempts.map((a) => attemptRow(a, "points")),
    })),
  };
}

export function attemptListContent(items: readonly AttemptListItem[]): TableContent {
  return {
    columns: [
      { key: "entity" },
      { key: "verdict" },
      { key: "result" },
      { key: "durationMs", better: "lower" },
      { key: "costUSD", better: "lower" },
      { key: "score", better: "higher" },
    ],
    rows: items.map((item) => ({
      key: item.locator,
      cells: {
        entity: {
          kind: "locator",
          locator: item.locator,
          verdict: item.verdict as "passed" | "failed" | "errored" | "skipped",
        },
        verdict: { kind: "verdict", verdict: item.verdict as "passed" | "failed" | "errored" | "skipped" },
        result:
          item.failureSummary !== null
            ? { kind: "summary", text: item.failureSummary, more: item.moreFailures }
            : { kind: "text", text: "—" },
        durationMs: attemptMetricValue(item.durationMs, "ms", item.locator),
        costUSD: attemptMetricValue(item.costUSD, "$", item.locator),
        score: { kind: "metric", metric: item.totalScore },
      },
    })),
  };
}
