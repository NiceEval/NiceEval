import {
  foldEvalVerdict,
  meanMetric,
  passRate,
  scoreStatus,
  scoringComposition,
  tokens,
  totalScore,
  type ClassicCalculation,
  type ScoreStatus,
  type ScoringComposition,
} from "./aggregate.ts";
import { formatCellText, type Cell } from "./cell.ts";
import type { MetricValue } from "./metric.ts";
import type { ClassicEvalUnit, Sample } from "./sample.ts";

export interface ExperimentTableColumn {
  readonly key: string;
  readonly header: string;
  readonly align?: "left" | "right";
}

export interface ExperimentTableRow {
  readonly key: string;
  readonly depth: number;
  readonly cells: Readonly<Record<string, string>>;
}

export interface ExperimentTableContent {
  readonly columns: readonly ExperimentTableColumn[];
  readonly rows: readonly ExperimentTableRow[];
}

interface ColumnSpec {
  readonly key: string;
  readonly header: string;
  readonly better?: "higher" | "lower";
}

interface TableContentRow {
  readonly key: string;
  readonly cells: Readonly<Record<string, Cell>>;
  readonly variant?: string;
  readonly subRows?: readonly TableContentRow[];
}

interface AttemptItem {
  readonly locator: string;
  readonly evaluationKind: "pass" | "score";
  readonly verdict: "passed" | "failed" | "errored" | "skipped";
  readonly score: MetricValue;
  readonly scoreStatus?: ScoreStatus;
  readonly durationMs: MetricValue;
  readonly costUSD: MetricValue;
  readonly historical: boolean;
}

interface EvalRow {
  readonly evalId: string;
  readonly evaluationKind: "pass" | "score";
  readonly verdict: "passed" | "failed" | "errored" | "skipped";
  readonly endToEndPassRate: MetricValue;
  readonly totalScore: MetricValue;
  readonly durationMs: MetricValue;
  readonly costUSD: MetricValue;
  readonly tokens: MetricValue;
  readonly attempts: readonly AttemptItem[];
}

interface ExperimentItem {
  readonly experimentId: string;
  readonly agent: string;
  readonly model?: string;
  readonly scoring: ScoringComposition;
  readonly evalVerdicts: { passed: number; failed: number; errored: number; skipped: number };
  readonly endToEndPassRate: MetricValue;
  readonly totalScore: MetricValue;
  readonly durationMs: MetricValue;
  readonly costUSD: MetricValue;
  readonly tokens: MetricValue;
  readonly evalRows: readonly EvalRow[];
}

const HEADER = {
  entity: "Experiment",
  model: "Model",
  agent: "Agent",
  durationMs: "Avg. time",
  passRate: "Pass rate",
  totalScore: "Total score",
  tokens: "Tokens",
  costUSD: "Cost",
  record: "Record",
} as const;

function measureCell(value: MetricValue): Cell {
  return { kind: "metric", metric: value };
}

function textCell(text: string, detail?: string): Cell {
  return detail === undefined ? { kind: "text", text } : { kind: "text", text, detail };
}

function identityCell(name: string, metadata: string): Cell {
  return textCell(`${name} (${metadata})`);
}

function verdictCell(counts: ExperimentItem["evalVerdicts"]): Cell {
  return {
    kind: "verdict",
    counts: {
      passed: counts.passed,
      failed: counts.failed,
      errored: counts.errored,
      skipped: counts.skipped,
    },
  };
}

function tallyVerdicts(verdicts: readonly AttemptItem["verdict"][]): ExperimentItem["evalVerdicts"] {
  const counts = { passed: 0, failed: 0, errored: 0, skipped: 0 };
  for (const verdict of verdicts) {
    if (verdict === "passed") counts.passed += 1;
    else if (verdict === "failed") counts.failed += 1;
    else if (verdict === "errored") counts.errored += 1;
    else counts.skipped += 1;
  }
  return counts;
}

function projectCells(bag: Readonly<Record<string, Cell>>, columns: readonly ColumnSpec[]): Record<string, Cell> {
  const cells: Record<string, Cell> = {};
  for (const column of columns) {
    cells[column.key] = bag[column.key] ?? { kind: "notApplicable" };
  }
  return cells;
}

function attemptMetricValue(value: number | null, unit: "ms" | "$"): MetricValue {
  return {
    value,
    unit,
    basis: "eval",
    samples: value === null ? 0 : 1,
    total: 1,
    refs: [],
    better: "lower",
  };
}

function attemptCells(item: AttemptItem): Record<string, Cell> {
  if (item.evaluationKind === "score") {
    return {
      entity: { kind: "locator", locator: item.locator },
      totalScore: measureCell(item.score),
      record: textCell(item.scoreStatus ?? "errored"),
      durationMs: measureCell(item.durationMs),
      costUSD: measureCell(item.costUSD),
    };
  }
  return {
    entity: {
      kind: "locator",
      locator: item.locator,
      verdict: item.verdict,
    },
    verdict: { kind: "verdict", verdict: item.verdict },
    record: { kind: "verdict", verdict: item.verdict },
    durationMs: measureCell(item.durationMs),
    costUSD: measureCell(item.costUSD),
  };
}

function scoreStatusCell(attempts: readonly AttemptItem[]): Cell {
  const counts = { scored: 0, errored: 0, skipped: 0 };
  for (const attempt of attempts) {
    const status = attempt.scoreStatus;
    if (status !== undefined) counts[status] += 1;
  }
  return {
    kind: "composition",
    segments: [
      { label: "scored", count: counts.scored },
      { label: "errored", count: counts.errored },
      { label: "skipped", count: counts.skipped },
    ],
  };
}

function attemptRow(item: AttemptItem, columns: readonly ColumnSpec[]): TableContentRow {
  return {
    key: item.locator,
    cells: projectCells(attemptCells(item), columns),
  };
}

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

function meanCells(cells: readonly MetricValue[], unit?: string): MetricValue {
  const total = cells.reduce((sum, cell) => sum + cell.total, 0);
  const samples = cells.reduce((sum, cell) => sum + cell.samples, 0);
  const values = cells.map((cell) => cell.value).filter((v): v is number => v !== null);
  if (values.length === 0) {
    return { value: null, basis: "eval", samples: 0, total, refs: [], ...(unit === undefined ? {} : { unit }) };
  }
  return {
    value: mean(values),
    basis: "eval",
    samples,
    total,
    refs: [],
    ...(unit === undefined ? {} : { unit }),
  };
}

function sumCells(cells: readonly MetricValue[]): MetricValue {
  const total = cells.reduce((sum, cell) => sum + cell.total, 0);
  const samples = cells.reduce((sum, cell) => sum + cell.samples, 0);
  const values = cells.map((cell) => cell.value).filter((value): value is number => value !== null);
  return {
    value: values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0),
    basis: "eval",
    samples,
    total,
    refs: cells.flatMap((cell) => cell.refs),
    better: "higher",
  };
}

function groupPassRate(evalRows: readonly EvalRow[]): MetricValue {
  const evalMeans: number[] = [];
  let samples = 0;
  let total = 0;
  for (const row of evalRows) {
    if (row.evaluationKind !== "pass") continue;
    total += row.endToEndPassRate.total;
    samples += row.endToEndPassRate.samples;
    if (row.endToEndPassRate.value !== null) evalMeans.push(row.endToEndPassRate.value);
  }
  if (evalMeans.length === 0) {
    return {
      value: null,
      unit: "%",
      better: "higher",
      bounds: { min: 0, max: 1 },
      basis: "eval",
      samples: 0,
      total,
      refs: [],
    };
  }
  return {
    value: mean(evalMeans),
    unit: "%",
    better: "higher",
    bounds: { min: 0, max: 1 },
    basis: "eval",
    samples,
    total,
    refs: [],
  };
}

function groupEntityDetail(evals: number): string {
  return `${evals} evals`;
}

function groupMetricValue(evalRows: readonly EvalRow[], cell: MetricValue): Cell {
  if (evalRows.length === 0) return { kind: "missing", code: "noSamples" };
  return measureCell(cell);
}

function evalRow(row: EvalRow, columns: readonly ColumnSpec[], label: string): TableContentRow {
  const bag: Record<string, Cell> = {
    entity: textCell(label),
    ...(row.evaluationKind === "pass"
      ? {
        verdict: { kind: "verdict" as const, verdict: row.verdict },
        record: verdictCell(tallyVerdicts(row.attempts.map((attempt) => attempt.verdict))),
      }
      : {
        totalScore: measureCell(row.totalScore),
        record: scoreStatusCell(row.attempts),
      }),
    durationMs: measureCell(row.durationMs),
    costUSD: measureCell(row.costUSD),
  };
  return {
    key: row.evalId,
    cells: projectCells(bag, columns),
    subRows: row.attempts.map((a) => attemptRow(a, columns)),
  };
}

type LeafMember = { kind: "eval"; row: EvalRow };

function memberEvalId(member: LeafMember): string {
  return member.row.evalId;
}

function groupPrimaryValue(evalRows: readonly EvalRow[]): number | null {
  const composition = evalRowsComposition(evalRows);
  if (composition === "mixed") return null;
  return composition === "score"
    ? sumCells(evalRows.map((row) => row.totalScore)).value
    : groupPassRate(evalRows).value;
}

function evalRowsComposition(evalRows: readonly EvalRow[]): ScoringComposition {
  const hasPass = evalRows.some((row) => row.evaluationKind === "pass");
  const hasScore = evalRows.some((row) => row.evaluationKind === "score");
  return hasPass && hasScore ? "mixed" : hasScore ? "score" : "pass";
}

function groupTableRow(
  segment: string,
  pathKey: string,
  members: readonly LeafMember[],
  childRows: readonly TableContentRow[],
  columns: readonly ColumnSpec[],
): TableContentRow {
  const evalRows = members.map((member) => member.row);
  const composition = evalRowsComposition(evalRows);
  const bag: Record<string, Cell> = {
    entity: identityCell(segment, groupEntityDetail(evalRows.length)),
    durationMs: groupMetricValue(evalRows, meanCells(evalRows.map((row) => row.durationMs), "ms")),
    ...(composition === "score" ? {} : { passRate: groupMetricValue(evalRows, groupPassRate(evalRows)) }),
    ...(composition === "pass"
      ? {}
      : { totalScore: groupMetricValue(evalRows, sumCells(evalRows.map((row) => row.totalScore))) }),
    tokens: groupMetricValue(evalRows, meanCells(evalRows.map((row) => row.tokens), "tokens")),
    costUSD: groupMetricValue(evalRows, meanCells(evalRows.map((row) => row.costUSD), "$")),
    record: evalRows.length === 0
      ? { kind: "missing", code: "noSamples" }
      : composition === "score"
        ? scoreStatusCell(evalRows.flatMap((row) => row.attempts))
        : verdictCell(tallyVerdicts(
          evalRows.filter((row) => row.evaluationKind === "pass")
            .flatMap((row) => row.attempts.map((attempt) => attempt.verdict)),
        )),
  };
  return {
    key: `group:${pathKey}`,
    variant: "group",
    cells: projectCells(bag, columns),
    subRows: childRows,
  };
}

function nestLevel(
  members: readonly LeafMember[],
  dirPrefix: string,
  labelPrefix: string,
  columns: readonly ColumnSpec[],
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
    groups.size === 0
    || (groups.size === 1 && leaves.length === 0)
    || [...groups.values()].every((group) => group.length === 1);

  if (collapse) {
    if (groups.size === 1 && leaves.length === 0) {
      const head = [...groups.keys()][0]!;
      return nestLevel(members, joinPath(dirPrefix, head), labelPrefix, columns);
    }
    return members
      .slice()
      .sort((a, b) => memberEvalId(a).localeCompare(memberEvalId(b)))
      .map((member) => evalRow(member.row, columns, relativeLabel(memberEvalId(member), labelPrefix)));
  }

  const groupEntries = [...groups.entries()].map(([segment, groupMembers]) => ({
    segment,
    groupMembers,
    primary: groupPrimaryValue(groupMembers.map((member) => member.row)),
  }));
  groupEntries.sort((a, b) => {
    if (a.primary === null && b.primary === null) return a.segment.localeCompare(b.segment);
    if (a.primary === null) return 1;
    if (b.primary === null) return -1;
    return b.primary - a.primary || a.segment.localeCompare(b.segment);
  });

  const rows: TableContentRow[] = groupEntries.map((entry) => {
    const pathKey = joinPath(dirPrefix, entry.segment);
    const childRows = nestLevel(entry.groupMembers, pathKey, pathKey, columns);
    return groupTableRow(entry.segment, pathKey, entry.groupMembers, childRows, columns);
  });

  const flat = leaves
    .slice()
    .sort((a, b) => memberEvalId(a).localeCompare(memberEvalId(b)))
    .map((member) => evalRow(member.row, columns, relativeLabel(memberEvalId(member), labelPrefix)));

  return [...rows, ...flat];
}

function coverageRow(item: ExperimentItem, columns: readonly ColumnSpec[]): TableContentRow {
  let fresh = 0;
  for (const row of item.evalRows) {
    if (row.attempts.some((a) => !a.historical)) fresh += 1;
  }
  const bag: Record<string, Cell> = {
    entity: { kind: "notApplicable" },
    record: {
      kind: "composition",
      segments: [
        { label: "fresh", count: fresh },
        { label: "historical", count: item.evalRows.length - fresh },
      ],
    },
  };
  return {
    key: `coverage:${item.experimentId}`,
    cells: projectCells(bag, columns),
  };
}

function experimentRow(item: ExperimentItem, columns: readonly ColumnSpec[]): TableContentRow {
  const members: LeafMember[] = item.evalRows.map((row) => ({ kind: "eval" as const, row }));
  const nested = nestLevel(members, "", "", columns);
  const bag: Record<string, Cell> = {
    entity: textCell(item.experimentId),
    model: item.model ? textCell(item.model) : { kind: "notApplicable" },
    agent: textCell(item.agent),
    durationMs: measureCell(item.durationMs),
    ...(item.scoring === "score" ? {} : { passRate: measureCell(item.endToEndPassRate) }),
    ...(item.scoring === "pass" ? {} : { totalScore: measureCell(item.totalScore) }),
    tokens: measureCell(item.tokens),
    costUSD: measureCell(item.costUSD),
    record: item.scoring === "score"
      ? scoreStatusCell(item.evalRows.flatMap((row) => row.attempts))
      : verdictCell(item.evalVerdicts),
  };
  return {
    key: item.experimentId,
    cells: projectCells(bag, columns),
    subRows: members.length > 0 ? [...nested, coverageRow(item, columns)] : nested,
  };
}

function experimentColumns(composition: ScoringComposition): ColumnSpec[] {
  return [
    { key: "entity", header: HEADER.entity },
    { key: "model", header: HEADER.model },
    { key: "agent", header: HEADER.agent },
    { key: "durationMs", better: "lower", header: HEADER.durationMs },
    ...(composition === "score"
      ? []
      : [{ key: "passRate", better: "higher" as const, header: HEADER.passRate }]),
    ...(composition === "pass"
      ? []
      : [{ key: "totalScore", better: "higher" as const, header: HEADER.totalScore }]),
    { key: "tokens", better: "lower", header: HEADER.tokens },
    { key: "costUSD", better: "lower", header: HEADER.costUSD },
    { key: "record", header: HEADER.record },
  ];
}

function computeOn(units: readonly ClassicEvalUnit[], calculation: ClassicCalculation): MetricValue {
  return calculation.compute(units);
}

function attemptItem(unit: ClassicEvalUnit, attempt: ClassicEvalUnit["attempts"][number]): AttemptItem | undefined {
  const locator = attempt.target?.locator ?? attempt.attemptId;
  if (locator === undefined) return undefined;
  return {
    locator,
    evaluationKind: unit.evaluationKind,
    verdict: attempt.verdict ?? "skipped",
    score: {
      value: attempt.score?.state === "complete" && scoreStatus(attempt) === "scored"
        ? attempt.score.earned
        : null,
      basis: "eval",
      samples: attempt.score?.state === "complete" && scoreStatus(attempt) === "scored" ? 1 : 0,
      total: unit.evaluationKind === "score" ? 1 : 0,
      refs: [locator],
      better: "higher",
    },
    ...(unit.evaluationKind === "score" ? { scoreStatus: scoreStatus(attempt) ?? "errored" } : {}),
    durationMs: attemptMetricValue(attempt.durationMs, "ms"),
    costUSD: attemptMetricValue(attempt.costUSD, "$"),
    historical: false,
  };
}

function evalItem(unit: ClassicEvalUnit): EvalRow {
  const folded = foldEvalVerdict(unit);
  return {
    evalId: unit.evalId,
    evaluationKind: unit.evaluationKind,
    verdict: folded ?? "skipped",
    endToEndPassRate: passRate.compute([unit]),
    totalScore: totalScore.compute([unit]),
    durationMs: meanMetric([unit], "durationMs", { unit: "ms", better: "lower" }),
    costUSD: meanMetric([unit], "costUSD", { unit: "$", better: "lower" }),
    tokens: computeOn([unit], tokens),
    attempts: unit.attempts.flatMap((attempt) => {
      const item = attemptItem(unit, attempt);
      return item === undefined ? [] : [item];
    }),
  };
}

function experimentItems(sample: Sample): ExperimentItem[] {
  const groups = new Map<string, ClassicEvalUnit[]>();
  for (const unit of sample.units) {
    const existing = groups.get(unit.experimentId);
    if (existing === undefined) groups.set(unit.experimentId, [unit]);
    else existing.push(unit);
  }
  const items: ExperimentItem[] = [];
  for (const [experimentId, units] of groups) {
    const profile = sample.profiles[experimentId] ?? units[0]?.subject.run.experiment;
    const evalRows = units.map(evalItem);
    items.push({
      experimentId,
      agent: profile?.agent && profile.agent.length > 0 ? profile.agent : "unknown",
      ...(profile?.model === undefined || profile.model.length === 0 ? {} : { model: profile.model }),
      scoring: scoringComposition(units),
      evalVerdicts: tallyVerdicts(
        evalRows.filter((row) => row.evaluationKind === "pass")
          .flatMap((row) => row.attempts.map((attempt) => attempt.verdict)),
      ),
      endToEndPassRate: passRate.compute(units),
      totalScore: totalScore.compute(units),
      durationMs: meanMetric(units, "durationMs", { unit: "ms", better: "lower" }),
      costUSD: meanMetric(units, "costUSD", { unit: "$", better: "lower" }),
      tokens: computeOn(units, tokens),
      evalRows,
    });
  }
  items.sort((a, b) => {
    const composition = scoringComposition(sample.units);
    if (composition === "mixed") return a.experimentId.localeCompare(b.experimentId);
    const left = composition === "score" ? a.totalScore.value : a.endToEndPassRate.value;
    const right = composition === "score" ? b.totalScore.value : b.endToEndPassRate.value;
    if (left === null && right === null) return a.experimentId.localeCompare(b.experimentId);
    if (left === null) return 1;
    if (right === null) return -1;
    return right - left || a.experimentId.localeCompare(b.experimentId);
  });
  return items;
}

function flattenRows(
  row: TableContentRow,
  columns: readonly ColumnSpec[],
  depth: number,
): ExperimentTableRow[] {
  const cells: Record<string, string> = {};
  for (const column of columns) {
    let text = formatCellText(row.cells[column.key]);
    if (depth > 0 && column === columns[0] && text !== "—") {
      text = `${"  ".repeat(depth)}${text}`;
    }
    cells[column.key] = text;
  }
  return [
    { key: row.key, depth, cells },
    ...(row.subRows ?? []).flatMap((child) => flattenRows(child, columns, depth + 1)),
  ];
}

export function experimentTableContent(sample: Sample): ExperimentTableContent {
  const columns = experimentColumns(scoringComposition(sample.units));
  const items = experimentItems(sample);
  return {
    columns: columns.map((column) => ({
      key: column.key,
      header: column.header,
      align: column.better === undefined ? "left" : "right",
    })),
    rows: items.flatMap((item) => flattenRows(experimentRow(item, columns), columns, 0)),
  };
}
