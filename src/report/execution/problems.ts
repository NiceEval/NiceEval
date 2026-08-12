import { Either } from "effect";
import type { RunId, SlotId } from "../../analysis/index.ts";
import {
  isReportComponentId,
  type ReportComponentId,
} from "../author/identity.ts";

const reportProblemIdTypeId: unique symbol = Symbol(
  "@niceeval/report/ReportProblemId",
);
const reportProblemTableTypeId: unique symbol = Symbol(
  "@niceeval/report/ReportProblemTable",
);

export type ReportProblemId = number & { readonly [reportProblemIdTypeId]: true };

export interface ReportRecordedDataProblem {
  readonly category: "recorded-data";
  readonly code:
    | "unavailable"
    | "migration-required"
    | "migration-unavailable"
    | "unsupported"
    | "invalid";
  readonly consumerId: ReportComponentId;
  readonly inputKey?: string;
  readonly slotId?: SlotId;
  readonly runId?: RunId;
}

export interface ReportExecutionProblem {
  readonly category: "execution";
  readonly code:
    | "projection-callback-defect"
    | "calculation-callback-defect"
    | "page-family-instances-defect"
    | "page-family-key-defect"
    | "page-family-key-conflict"
    | "page-execution-failed"
    | "download-execution-failed"
    | "semantic-document-invalid"
    | "route-conflict";
  readonly consumerId: ReportComponentId;
  readonly summary: string;
}

export type ReportProblem = ReportRecordedDataProblem | ReportExecutionProblem;

export interface ReportProblemTableEntry {
  readonly id: ReportProblemId;
  readonly problem: ReportProblem;
}

/** A host-owned, canonical table. Passing copied entries cannot forge it. */
export type ReportProblemTable = readonly ReportProblemTableEntry[] & {
  readonly [reportProblemTableTypeId]: () => void;
};

export interface ReportProblemTableInvalid {
  readonly code: "report-problem-table-invalid";
  readonly reason: string;
}

export interface ReportProblemTableLimit {
  readonly code: "report-problem-table-limit";
  readonly maximum: number;
  readonly observedAtLeast: number;
}

export type ReportProblemTableError =
  | ReportProblemTableInvalid
  | ReportProblemTableLimit;

/** The table is bounded independently of the number of logical entries. */
export const REPORT_PROBLEM_TABLE_MAX = 20_000;

const inputKeyPattern = /^[a-z][a-z0-9_-]*$/;
const executionCodes = new Set<ReportExecutionProblem["code"]>([
  "projection-callback-defect",
  "calculation-callback-defect",
  "page-family-instances-defect",
  "page-family-key-defect",
  "page-family-key-conflict",
  "page-execution-failed",
  "download-execution-failed",
  "semantic-document-invalid",
  "route-conflict",
]);
const dataCodes = new Set<ReportRecordedDataProblem["code"]>([
  "unavailable",
  "migration-required",
  "migration-unavailable",
  "unsupported",
  "invalid",
]);
const encoder = new TextEncoder();
const SUMMARY_BYTES_MAX = 1_024;

const idsByTable = new WeakMap<object, ReadonlyMap<object, ReportProblemId>>();

/**
 * Assigns zero-based IDs in supplied stable traversal order. Repeating the
 * exact same problem object reuses its ID; equal-but-distinct facts remain
 * distinct so a host keeps control over de-duplication boundaries.
 */
export function reportProblemTable(
  problems: readonly ReportProblem[],
): Either.Either<ReportProblemTable, ReportProblemTableError> {
  if (!Array.isArray(problems)) {
    return Either.left(invalid("a problem table must be created from an array"));
  }

  const entries: ReportProblemTableEntry[] = [];
  const ids = new Map<object, ReportProblemId>();
  for (const candidate of problems) {
    if (typeof candidate !== "object" || candidate === null) {
      return Either.left(invalid("every problem must be an object"));
    }
    const existing = ids.get(candidate);
    if (existing !== undefined) {
      continue;
    }
    if (entries.length >= REPORT_PROBLEM_TABLE_MAX) {
      return Either.left(
        Object.freeze({
          code: "report-problem-table-limit" as const,
          maximum: REPORT_PROBLEM_TABLE_MAX,
          observedAtLeast: entries.length + 1,
        }),
      );
    }
    const normalized = normalizeProblem(candidate);
    if (normalized._tag === "invalid") {
      return Either.left(normalized.error);
    }
    const id = mintProblemId(entries.length);
    const entry = Object.freeze({ id, problem: normalized.problem });
    entries.push(entry);
    ids.set(candidate, id);
    ids.set(normalized.problem, id);
  }

  const table = entries as unknown as ReportProblemTable;
  Object.defineProperty(table, reportProblemTableTypeId, {
    value: (): void => undefined,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  Object.freeze(table);
  idsByTable.set(table, ids);
  return Either.right(table);
}

export function isReportProblemTable(value: unknown): value is ReportProblemTable {
  return typeof value === "object" && value !== null && idsByTable.has(value);
}

/** Hosts can turn a canonical problem object into its stable table ID. */
export function reportProblemIdFor(
  table: ReportProblemTable,
  problem: ReportProblem,
): ReportProblemId | undefined {
  return idsByTable.get(table)?.get(problem);
}

export function isReportProblemId(value: unknown): value is ReportProblemId {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 0xffff_ffff;
}

function normalizeProblem(value: object):
  | { readonly _tag: "problem"; readonly problem: ReportProblem }
  | { readonly _tag: "invalid"; readonly error: ReportProblemTableInvalid } {
  const record = ownDataRecord(value);
  if (record === undefined) {
    return { _tag: "invalid", error: invalid("a problem must be a plain data object") };
  }
  if (record.category === "recorded-data") {
    return normalizeDataProblem(record);
  }
  if (record.category === "execution") {
    return normalizeExecutionProblem(record);
  }
  return { _tag: "invalid", error: invalid("a problem category must be recorded-data or execution") };
}

function normalizeDataProblem(record: Record<string, unknown>):
  | { readonly _tag: "problem"; readonly problem: ReportRecordedDataProblem }
  | { readonly _tag: "invalid"; readonly error: ReportProblemTableInvalid } {
  if (!hasExactKeys(record, ["category", "code", "consumerId", "inputKey", "slotId", "runId"])) {
    return { _tag: "invalid", error: invalid("a recorded-data problem has an unknown field") };
  }
  if (!dataCodes.has(record.code as ReportRecordedDataProblem["code"])) {
    return { _tag: "invalid", error: invalid("a recorded-data problem code is not recognized") };
  }
  if (!isReportComponentId(record.consumerId)) {
    return { _tag: "invalid", error: invalid("a recorded-data problem needs a ReportComponentId") };
  }
  if (record.inputKey !== undefined && (typeof record.inputKey !== "string" || !inputKeyPattern.test(record.inputKey))) {
    return { _tag: "invalid", error: invalid("a recorded-data input key is invalid") };
  }
  if (record.slotId !== undefined && (typeof record.slotId !== "string" || record.slotId.length === 0)) {
    return { _tag: "invalid", error: invalid("a recorded-data slot ID is invalid") };
  }
  if (record.runId !== undefined && (typeof record.runId !== "string" || record.runId.length === 0)) {
    return { _tag: "invalid", error: invalid("a recorded-data run ID is invalid") };
  }
  return {
    _tag: "problem",
    problem: Object.freeze({
      category: "recorded-data" as const,
      code: record.code as ReportRecordedDataProblem["code"],
      consumerId: record.consumerId,
      ...(record.inputKey === undefined ? {} : { inputKey: record.inputKey }),
      ...(record.slotId === undefined ? {} : { slotId: record.slotId as SlotId }),
      ...(record.runId === undefined ? {} : { runId: record.runId as RunId }),
    }),
  };
}

function normalizeExecutionProblem(record: Record<string, unknown>):
  | { readonly _tag: "problem"; readonly problem: ReportExecutionProblem }
  | { readonly _tag: "invalid"; readonly error: ReportProblemTableInvalid } {
  if (!hasExactKeys(record, ["category", "code", "consumerId", "summary"])) {
    return { _tag: "invalid", error: invalid("an execution problem has an unknown field") };
  }
  if (!executionCodes.has(record.code as ReportExecutionProblem["code"])) {
    return { _tag: "invalid", error: invalid("an execution problem code is not recognized") };
  }
  if (!isReportComponentId(record.consumerId)) {
    return { _tag: "invalid", error: invalid("an execution problem needs a ReportComponentId") };
  }
  if (
    typeof record.summary !== "string" ||
    !hasOnlyUnicodeScalars(record.summary) ||
    encoder.encode(record.summary).byteLength > SUMMARY_BYTES_MAX
  ) {
    return { _tag: "invalid", error: invalid("an execution problem summary is invalid or unbounded") };
  }
  return {
    _tag: "problem",
    problem: Object.freeze({
      category: "execution" as const,
      code: record.code as ReportExecutionProblem["code"],
      consumerId: record.consumerId,
      summary: record.summary,
    }),
  };
}

function ownDataRecord(value: object): Record<string, unknown> | undefined {
  if (Array.isArray(value)) {
    return undefined;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return undefined;
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") {
      return undefined;
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
      return undefined;
    }
  }
  return value as Record<string, unknown>;
}

function hasExactKeys(record: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(record).every((key) => allowedKeys.has(key));
}

function hasOnlyUnicodeScalars(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) {
        return false;
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function mintProblemId(value: number): ReportProblemId {
  return value as ReportProblemId;
}

function invalid(reason: string): ReportProblemTableInvalid {
  return Object.freeze({ code: "report-problem-table-invalid", reason });
}
