import type { AnalysisIssue } from "../../analysis/contracts.ts";
import type { ClosedReportProblem } from "../semantic/closed.ts";

/** Stable execution-local index into the renderer-safe problem table. */
export type ReportProblemId = number;

/** Analysis quality facts remain visible data, never callback failures. */
export interface ReportAnalysisIssueProblem {
  readonly category: "analysis-issue";
  readonly issue: AnalysisIssue;
  readonly pageId?: string;
}

/** Failures isolated at one callback, validation, or static closure boundary. */
export interface ReportExecutionProblem {
  readonly category: "execution";
  readonly code:
    | "page-params-invalid"
    | "page-load-failed"
    | "page-render-failed"
    | "component-compose-failed"
    | "component-resolve-failed"
    | "semantic-tree-invalid"
    | "route-conflict"
    | "download-conflict";
  readonly pageId?: string;
  readonly summary: string;
}

export type ReportProblem = ReportAnalysisIssueProblem | ReportExecutionProblem;
export type ReportProblemTableEntry = ClosedReportProblem;
export type ReportProblemTable = readonly ClosedReportProblem[];

export const REPORT_PROBLEM_TABLE_MAX = 20_000;

const idsByTable = new WeakMap<object, ReadonlyMap<string, ReportProblemId>>();

/**
 * Canonicalizes problems in UTF-8 order and assigns dense IDs after semantic
 * de-duplication.  The closed output deliberately exposes only code/summary;
 * no Error, Cause, reader, payload, or callback crosses this boundary.
 */
export function reportProblemTable(problems: readonly ReportProblem[]): ReportProblemTable {
  const byKey = new Map<string, ReportProblem>();
  for (const problem of problems) {
    const key = reportProblemKey(problem);
    if (!byKey.has(key)) byKey.set(key, problem);
  }
  const ordered = [...byKey.entries()].sort(([left], [right]) => compareUtf8(left, right));
  if (ordered.length > REPORT_PROBLEM_TABLE_MAX) {
    throw new RangeError(`Report problem table exceeds ${REPORT_PROBLEM_TABLE_MAX} entries`);
  }
  const ids = new Map<string, ReportProblemId>();
  const table = Object.freeze(ordered.map(([key, problem], id) => {
    ids.set(key, id);
    return Object.freeze({ id, code: problemCode(problem), summary: problemSummary(problem) });
  }));
  idsByTable.set(table, ids);
  return table;
}

export function reportProblemIdFor(
  table: ReportProblemTable,
  problem: ReportProblem,
): ReportProblemId | undefined {
  return idsByTable.get(table)?.get(reportProblemKey(problem));
}

export function isReportProblemId(value: unknown): value is ReportProblemId {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function reportProblemKey(problem: ReportProblem): string {
  if (problem.category === "execution") {
    return canonicalJson({
      category: problem.category,
      code: problem.code,
      pageId: problem.pageId ?? null,
      summary: problem.summary,
    });
  }
  return canonicalJson({
    category: problem.category,
    pageId: problem.pageId ?? null,
    issue: {
      code: problem.issue.code,
      message: problem.issue.message,
      refs: problem.issue.refs.map((reference) => reference.identity),
    },
  });
}

function problemCode(problem: ReportProblem): string {
  return problem.category === "execution" ? problem.code : `analysis-${problem.issue.code}`;
}

function problemSummary(problem: ReportProblem): string {
  if (problem.category === "execution") return problem.summary;
  return problem.issue.message;
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean" || typeof value === "number") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value).sort(([left], [right]) => compareUtf8(left, right));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(String(value));
}

function compareUtf8(left: string, right: string): number {
  if (left === right) return 0;
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    const delta = leftBytes[index]! - rightBytes[index]!;
    if (delta !== 0) return delta;
  }
  return leftBytes.length - rightBytes.length;
}
