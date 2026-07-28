// 实体列表 Table Content 投影(docs/feature/reports/components/entity-lists/)。
// Eval 分组层在这里从扁平 evalRows + missingEvalIds 投影成 TableContent.subRows
// (docs/feature/reports/components/sources/entity-experiments.md「Eval 分组层」)。

import type { Cell, TableContent, TableContentRow } from "../../definition/cell.ts";
import type {
  AttemptListItem,
  EvalListItem,
  ExperimentListEvalRow,
  ExperimentListItem,
  MeasureCell,
} from "../../model/types.ts";
import { experimentListScoringComposition, formatMetricValue, MISSING_TEXT } from "../../model/format.ts";
import type { AttemptLocator } from "../../../record/locator.ts";

function measureCell(value: MeasureCell): Cell {
  return { kind: "measure", measure: value };
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

function attemptMeasureCell(
  value: number | null,
  unit: "ms" | "$",
  locator: AttemptLocator,
): Cell {
  if (value === null) {
    return {
      kind: "measure",
      measure: { value: null, display: "—", samples: 0, total: 1, refs: [locator] },
    };
  }
  return {
    kind: "measure",
    measure: {
      value,
      display: formatMetricValue(value, unit),
      samples: 1,
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
      entity: { kind: "locator", locator: item.locator, staleSinceMs: item.historical ? 1 : undefined },
      verdict: { kind: "verdict", verdict: item.verdict as "passed" | "failed" | "errored" | "skipped" },
      result: summary,
      durationMs: attemptMeasureCell(item.durationMs, "ms", item.locator),
      costUSD: attemptMeasureCell(item.costUSD, "$", item.locator),
      ...(scoring === "points" ? { score: { kind: "measure", measure: item.totalScore } } : {}),
    },
  };
}

/** evalId 的目录前缀(第一个 `/` 之前);不含 `/` 时返回 null——不进假组。 */
function groupKeyOf(evalId: string): string | null {
  const slash = evalId.indexOf("/");
  return slash === -1 ? null : evalId.slice(0, slash);
}

/** 有父组时去掉前缀;整层收起时 label 就是完整 evalId。 */
function evalLabel(evalId: string, groupKey: string | null): string {
  if (groupKey === null) return evalId;
  const prefix = `${groupKey}/`;
  return evalId.startsWith(prefix) ? evalId.slice(prefix.length) : evalId;
}

function mean(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function mergeRefs(cells: readonly MeasureCell[]): AttemptLocator[] {
  return [...new Set(cells.flatMap((cell) => cell.refs))].sort();
}

/** acrossEvals mean:把各题已算好的 MeasureCell 再折一层。 */
function meanCells(cells: readonly MeasureCell[], unit?: string): MeasureCell {
  const total = cells.reduce((sum, cell) => sum + cell.total, 0);
  const samples = cells.reduce((sum, cell) => sum + cell.samples, 0);
  const values = cells.map((cell) => cell.value).filter((v): v is number => v !== null);
  const refs = mergeRefs(cells);
  if (values.length === 0) {
    return { value: null, display: "—", samples: 0, total, refs };
  }
  const value = mean(values);
  return {
    value,
    display: unit !== undefined ? formatMetricValue(value, unit) : String(value),
    samples,
    total,
    refs,
  };
}

/** acrossEvals sum(totalScore)。 */
function sumCells(cells: readonly MeasureCell[]): MeasureCell {
  const total = cells.reduce((sum, cell) => sum + cell.total, 0);
  const samples = cells.reduce((sum, cell) => sum + cell.samples, 0);
  const values = cells.map((cell) => cell.value).filter((v): v is number => v !== null);
  const refs = mergeRefs(cells);
  if (values.length === 0) {
    return { value: null, display: "—", samples: 0, total, refs };
  }
  const value = values.reduce((a, b) => a + b, 0);
  return { value, display: String(value), samples, total, refs };
}

/**
 * 组内通过率:与 endToEndPassRate 同口径——attempt 级 passed=1 / failed|errored=0 /
 * unreadable=null,先 perEval mean 再 acrossEvals mean;占位行不进分母。
 */
function groupPassRate(evalRows: readonly ExperimentListEvalRow[]): MeasureCell {
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
    return { value: null, display: "—", samples: 0, total, refs: [...new Set(refs)].sort() };
  }
  const value = mean(evalMeans);
  return {
    value,
    display: formatMetricValue(value, "%"),
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
function groupMeasureCell(evalRows: readonly ExperimentListEvalRow[], cell: MeasureCell): Cell {
  if (evalRows.length === 0) return { kind: "missing", code: MISSING_TEXT };
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

function groupPrimaryValue(
  evalRows: readonly ExperimentListEvalRow[],
  scoring: "pass" | "points",
): number | null {
  if (scoring === "points") {
    const cell = sumCells(evalRows.map((row) => row.totalScore));
    return cell.value;
  }
  return groupPassRate(evalRows).value;
}

function groupRow(
  groupKey: string,
  members: readonly LeafMember[],
  item: ExperimentListItem,
  composition: "pass" | "points" | "mixed",
): TableContentRow {
  const evalRows = members.filter((m): m is { kind: "eval"; row: ExperimentListEvalRow } => m.kind === "eval").map((m) => m.row);
  const knownEvals = members.length;
  const evals = evalRows.length;
  const attempts = evalRows.reduce((sum, row) => sum + row.attempts.length, 0);
  const scoring = item.scoring;
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
  const tokens = meanCells(evalRows.map((row) => row.tokens));
  const evalVerdicts = tallyEvalVerdicts(evalRows);

  const childRows = members
    .slice()
    .sort((a, b) => memberEvalId(a).localeCompare(memberEvalId(b)))
    .map((member) => {
      const id = memberEvalId(member);
      const label = evalLabel(id, groupKey);
      return member.kind === "eval"
        ? evalRow(member.row, scoring, label)
        : placeholderRow(item.experimentId, member.evalId, label);
    });

  return {
    key: `group:${groupKey}`,
    variant: "group",
    cells: {
      entity: textCell(groupKey, groupEntityDetail(evals, knownEvals, attempts)),
      model: { kind: "notApplicable" },
      agent: { kind: "notApplicable" },
      durationMs: groupMeasureCell(evalRows, durationMs),
      passRate: composition !== "points" ? groupMeasureCell(evalRows, passRate) : { kind: "notApplicable" },
      totalScore: composition !== "pass" ? groupMeasureCell(evalRows, totalScore) : { kind: "notApplicable" },
      tokens: groupMeasureCell(evalRows, tokens),
      costUSD: groupMeasureCell(evalRows, costUSD),
      record: evalRows.length === 0 ? { kind: "missing", code: MISSING_TEXT } : verdictCell(evalVerdicts),
    },
    subRows: childRows,
  };
}

/**
 * 把 experiment 的 evalRows + missingEvalIds 投影成 subRows。
 * 两条收起条件任一成立就不插分组层(docs「无信息时整层收起」)。
 */
function experimentSubRows(
  item: ExperimentListItem,
  composition: "pass" | "points" | "mixed",
): TableContentRow[] {
  const groups = new Map<string, LeafMember[]>();
  const ungrouped: LeafMember[] = [];

  for (const row of item.evalRows) {
    const key = groupKeyOf(row.evalId);
    if (key === null) ungrouped.push({ kind: "eval", row });
    else {
      const list = groups.get(key);
      if (list) list.push({ kind: "eval", row });
      else groups.set(key, [{ kind: "eval", row }]);
    }
  }
  for (const evalId of item.missingEvalIds) {
    const key = groupKeyOf(evalId);
    if (key === null) ungrouped.push({ kind: "missing", evalId });
    else {
      const list = groups.get(key);
      if (list) list.push({ kind: "missing", evalId });
      else groups.set(key, [{ kind: "missing", evalId }]);
    }
  }

  const collapse =
    groups.size === 0 ||
    (groups.size === 1 && ungrouped.length === 0) ||
    [...groups.values()].every((members) => members.length === 1);

  if (collapse) {
    const leaves: LeafMember[] = [
      ...item.evalRows.map((row): LeafMember => ({ kind: "eval", row })),
      ...item.missingEvalIds.map((evalId): LeafMember => ({ kind: "missing", evalId })),
    ];
    return leaves
      .slice()
      .sort((a, b) => memberEvalId(a).localeCompare(memberEvalId(b)))
      .map((member) => {
        const id = memberEvalId(member);
        return member.kind === "eval"
          ? evalRow(member.row, item.scoring, id)
          : placeholderRow(item.experimentId, member.evalId, id);
      });
  }

  const groupEntries = [...groups.entries()].map(([groupKey, members]) => {
    const evalRows = members
      .filter((m): m is { kind: "eval"; row: ExperimentListEvalRow } => m.kind === "eval")
      .map((m) => m.row);
    return {
      groupKey,
      members,
      primary: groupPrimaryValue(evalRows, item.scoring),
    };
  });
  groupEntries.sort((a, b) => {
    if (a.primary === null && b.primary === null) return a.groupKey.localeCompare(b.groupKey);
    if (a.primary === null) return 1;
    if (b.primary === null) return -1;
    return b.primary - a.primary || a.groupKey.localeCompare(b.groupKey);
  });

  const rows: TableContentRow[] = groupEntries.map((entry) =>
    groupRow(entry.groupKey, entry.members, item, composition),
  );
  const flat = ungrouped
    .slice()
    .sort((a, b) => memberEvalId(a).localeCompare(memberEvalId(b)))
    .map((member) => {
      const id = memberEvalId(member);
      return member.kind === "eval"
        ? evalRow(member.row, item.scoring, id)
        : placeholderRow(item.experimentId, member.evalId, id);
    });
  return [...rows, ...flat];
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
        entity: { kind: "locator", locator: item.locator },
        verdict: { kind: "verdict", verdict: item.verdict as "passed" | "failed" | "errored" | "skipped" },
        result:
          item.failureSummary !== null
            ? { kind: "summary", text: item.failureSummary, more: item.moreFailures }
            : { kind: "text", text: "—" },
        durationMs: attemptMeasureCell(item.durationMs, "ms", item.locator),
        costUSD: attemptMeasureCell(item.costUSD, "$", item.locator),
        score: { kind: "measure", measure: item.totalScore },
      },
    })),
  };
}
