// site-components 的 *Data 结构校验(与旧专用件 data 形态同契约,供 validate.test 守护)。

import { arrayProblem, isObject, type Validator } from "../shared.ts";

export const validateHeroData: Validator = (data) => {
  if (!isObject(data)) return "expected an object";
  if (!(data.latestStartedAt === null || typeof data.latestStartedAt === "string")) {
    return '"latestStartedAt" must be a string or null';
  }
  if (typeof data.runs !== "number") return '"runs" must be a number';
  return null;
};

const UNREADABLE_SNAPSHOT_REASONS = ["incompatible", "malformed", "incomplete"];

function scopeWarningProblem(value: unknown, path: string): string | null {
  if (!isObject(value)) return `"${path}" must be a SampleIssue object`;
  if (typeof value.code !== "string") return `"${path}.code" must be a string`;
  switch (value.code) {
    case "unfinished-run":
      if (typeof value.experimentId !== "string") return `"${path}.experimentId" must be a string`;
      if (typeof value.startedAt !== "string") return `"${path}.startedAt" must be a string`;
      if (typeof value.dir !== "string") return `"${path}.dir" must be a string`;
      return null;
    case "dangling-evidence":
      if (typeof value.experimentId !== "string") return `"${path}.experimentId" must be a string`;
      if (typeof value.evalId !== "string") return `"${path}.evalId" must be a string`;
      if (typeof value.attempt !== "number") return `"${path}.attempt" must be a number`;
      if (typeof value.artifactBase !== "string") return `"${path}.artifactBase" must be a string`;
      if (!Array.isArray(value.artifacts) || !value.artifacts.every((artifact) => typeof artifact === "string")) {
        return `"${path}.artifacts" must be an array of strings`;
      }
      return null;
    case "unreadable-run":
      if (typeof value.dir !== "string") return `"${path}.dir" must be a string`;
      if (typeof value.reason !== "string" || !UNREADABLE_SNAPSHOT_REASONS.includes(value.reason)) {
        return `"${path}.reason" must be one of ${JSON.stringify(UNREADABLE_SNAPSHOT_REASONS)}`;
      }
      return null;
    default:
      return `"${path}.code" is not a supported SampleIssue code`;
  }
}

export const validateScopeWarningsData: Validator = (data) => arrayProblem(data, "data", scopeWarningProblem);

function diagnosticRecordProblem(value: unknown, path: string): string | null {
  if (!isObject(value)) return `"${path}" must be a DiagnosticRecord { code, level, message, phase }`;
  if (typeof value.code !== "string") return `"${path}.code" must be a string`;
  if (value.level !== "warning" && value.level !== "error") return `"${path}.level" must be "warning" or "error"`;
  if (typeof value.message !== "string") return `"${path}.message" must be a string`;
  if (typeof value.phase !== "string") return `"${path}.phase" must be a string`;
  return null;
}

function snapshotDiagnosticsItemProblem(value: unknown, path: string): string | null {
  if (!isObject(value)) return `"${path}" must be a SnapshotDiagnosticsItem { experimentId, startedAt, diagnostics }`;
  if (typeof value.experimentId !== "string") return `"${path}.experimentId" must be a string`;
  if (typeof value.startedAt !== "string") return `"${path}.startedAt" must be a string`;
  return arrayProblem(value.diagnostics, `${path}.diagnostics`, diagnosticRecordProblem);
}

export const validateSnapshotDiagnosticsData: Validator = (data) =>
  arrayProblem(data, "data", snapshotDiagnosticsItemProblem);

export const validateCopyFixPromptData: Validator = (data) => {
  if (!isObject(data)) return "expected an object";
  if (typeof data.prompt !== "string") return '"prompt" must be a string';
  if (typeof data.failures !== "number") return '"failures" must be a number';
  return null;
};

const TRACE_SPAN_KINDS = ["agent", "model", "tool", "other"];

function traceSpanSummaryProblem(value: unknown, path: string): string | null {
  if (!isObject(value)) return `"${path}" must be a TraceSpanSummary { name, kind, startOffsetMs, durationMs, failed }`;
  if (typeof value.name !== "string") return `"${path}.name" must be a string`;
  if (typeof value.kind !== "string" || !TRACE_SPAN_KINDS.includes(value.kind)) {
    return `"${path}.kind" must be one of ${JSON.stringify(TRACE_SPAN_KINDS)}`;
  }
  if (typeof value.startOffsetMs !== "number") return `"${path}.startOffsetMs" must be a number`;
  if (typeof value.durationMs !== "number") return `"${path}.durationMs" must be a number`;
  if (typeof value.failed !== "boolean") return `"${path}.failed" must be a boolean`;
  return null;
}

export const validateTraceWaterfallData: Validator = (data) =>
  arrayProblem(data, "data", (row, path) => {
    if (!isObject(row)) return `"${path}" must be an object`;
    if (typeof row.experimentId !== "string") return `"${path}.experimentId" must be a string`;
    if (typeof row.evalId !== "string") return `"${path}.evalId" must be a string`;
    if (typeof row.locator !== "string") return `"${path}.locator" must be a string`;
    if (!(row.durationMs === null || typeof row.durationMs === "number")) {
      return `"${path}.durationMs" must be a number or null`;
    }
    return arrayProblem(row.spans, `${path}.spans`, traceSpanSummaryProblem);
  });
