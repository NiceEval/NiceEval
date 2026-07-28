// 实体列表 Table Content 投影(docs/feature/reports/components/entity-lists/)。

import type { Cell, TableContent, TableContentRow } from "../../definition/cell.ts";
import type {
  AttemptListItem,
  EvalListItem,
  ExperimentListEvalRow,
  ExperimentListItem,
} from "../../model/types.ts";
import { experimentListScoringComposition } from "../../model/format.ts";

function measureCell(value: ExperimentListItem["endToEndPassRate"]): Cell {
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
      durationMs: { kind: "text", text: String(item.durationMs) },
      costUSD: item.costUSD === null ? { kind: "notApplicable" } : { kind: "text", text: String(item.costUSD) },
      ...(scoring === "points" ? { score: { kind: "measure", measure: item.totalScore } } : {}),
    },
  };
}

function evalRow(row: ExperimentListEvalRow, scoring: "pass" | "points"): TableContentRow {
  return {
    key: row.evalId,
    cells: {
      entity: textCell(row.evalId),
      verdict: { kind: "verdict", verdict: row.verdict as "passed" | "failed" | "errored" | "skipped" },
      result: { kind: "notApplicable" },
      durationMs: measureCell(row.durationMs),
      costUSD: measureCell(row.costUSD),
      ...(scoring === "points" ? { score: measureCell(row.totalScore) } : {}),
    },
    subRows: row.attempts.map((a) => attemptRow(a, scoring)),
  };
}

function experimentRow(item: ExperimentListItem, composition: "pass" | "points" | "mixed"): TableContentRow {
  const subRows: TableContentRow[] = [
    ...item.evalRows.map((r) => evalRow(r, item.scoring)),
    ...item.missingEvalIds.map(
      (evalId): TableContentRow => ({
        key: `${item.experimentId}:${evalId}:missing`,
        variant: "placeholder",
        cells: {
          entity: textCell(evalId),
          verdict: { kind: "notApplicable" },
          result: textCell("No result for current config", `niceeval exp ${item.experimentId}`),
          durationMs: { kind: "notApplicable" },
          costUSD: { kind: "notApplicable" },
        },
      }),
    ),
  ];
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
    subRows,
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
        durationMs: { kind: "text", text: String(item.durationMs) },
        costUSD: item.costUSD === null ? { kind: "notApplicable" } : { kind: "text", text: String(item.costUSD) },
        score: { kind: "measure", measure: item.totalScore },
      },
    })),
  };
}
