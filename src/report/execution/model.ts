import { Either } from "effect";
import type { AnalysisSample } from "../../analysis/index.ts";
import type { ProjectionCoverage } from "../../projection/coverage.ts";
import {
  isReportComponentId,
  isReportDownloadPath,
  isReportId,
  isReportRoute,
  reportStaticPathConflict,
  staticPathForReportDownload,
  staticPathForReportRoute,
  type ReportComponentId,
  type ReportDownloadPath,
  type ReportId,
  type ReportRoute,
} from "../author/identity.ts";
import type { ReportDataState, ReportDownloadFile } from "../author/model.ts";
import {
  freezeReportDocument,
  validateReportDocument,
} from "../semantic/document.ts";
import {
  isReportProblemId,
  isReportProblemTable,
  type ReportProblemId,
  type ReportProblemTable,
} from "./problems.ts";
import {
  isReportProjectionId,
  type ReportCalculationExecutionResult,
  type ReportDownloadResult,
  type ReportNavigationItem,
  type ReportPageFamilyResult,
  type ReportPageResult,
  type ReportProjectionSummary,
} from "./results.ts";

const reportExecutionTypeId: unique symbol = Symbol(
  "@niceeval/report/ReportExecution",
);

export const REPORT_PAGES_MAX = 20_000;
export const REPORT_DOWNLOAD_FILES_MAX = 1_000;
export const REPORT_DOWNLOAD_FILE_BYTES_MAX = 33_554_432;

export interface ReportLimitExceeded {
  readonly code: "report-limit-exceeded";
  readonly limit:
    | "pages"
    | "document-nodes"
    | "document-depth"
    | "download-files"
    | "download-file-bytes";
  readonly maximum: number;
  readonly observedAtLeast: number;
}

export interface ReportExecutionValueInvalid {
  readonly code: "report-execution-invalid";
  readonly path: readonly string[];
  readonly reason: string;
}

export type ReportExecutionValueError =
  | ReportLimitExceeded
  | ReportExecutionValueInvalid;

/** A completed, self-contained Report result with no reader, callback, or path capability. */
export interface ReportExecution {
  readonly reportId: ReportId;
  /** Host presentation locale; never persisted back into Record data. */
  readonly locale: "en" | "zh-CN";
  readonly sample: AnalysisSample;
  readonly projections: readonly ReportProjectionSummary[];
  readonly calculations: readonly ReportCalculationExecutionResult[];
  readonly families: readonly ReportPageFamilyResult[];
  readonly pages: readonly ReportPageResult[];
  readonly navigation: readonly ReportNavigationItem[];
  readonly downloads: readonly ReportDownloadResult[];
  readonly problemTable: ReportProblemTable;
  readonly [reportExecutionTypeId]: () => void;
}

const executions = new WeakMap<object, true>();
const encoder = new TextEncoder();

/**
 * Materializes an already-computed execution into canonical immutable values.
 * It does not read a Record, invoke author callbacks, render, or write files.
 */
export function reportExecution(input: {
  readonly reportId: ReportId;
  readonly locale?: "en" | "zh-CN";
  readonly sample: AnalysisSample;
  readonly projections?: readonly ReportProjectionSummary[];
  readonly calculations?: readonly ReportCalculationExecutionResult[];
  readonly families?: readonly ReportPageFamilyResult[];
  readonly pages?: readonly ReportPageResult[];
  readonly navigation?: readonly ReportNavigationItem[];
  readonly downloads?: readonly ReportDownloadResult[];
  readonly problemTable: ReportProblemTable;
}): Either.Either<ReportExecution, ReportExecutionValueError> {
  try {
    if (!isReportId(input.reportId)) {
      throw invalid("reportId", "an execution must have a valid ReportId");
    }
    if (typeof input.sample !== "object" || input.sample === null) {
      throw invalid("sample", "an execution must have an AnalysisSample");
    }
    if (!isReportProblemTable(input.problemTable)) {
      throw invalid("problemTable", "an execution must use a host-owned problem table");
    }

    const projections = copyProjections(input.projections ?? [], input.problemTable);
    const calculations = copyCalculations(input.calculations ?? [], input.problemTable);
    const families = copyFamilies(input.families ?? [], input.problemTable);
    const downloads = copyDownloads(input.downloads ?? [], input.problemTable);
    const routes = routesFromPages(input.pages ?? []);
    assertStaticClosure(routes, downloads.paths);
    const pages = copyPages(input.pages ?? [], input.problemTable, routes, downloads.paths);
    const navigation = copyNavigation(input.navigation ?? [], pages);

    if (pages.length > REPORT_PAGES_MAX) {
      throw limit("pages", REPORT_PAGES_MAX, pages.length);
    }

    const execution = Object.freeze({
      reportId: input.reportId,
      locale: input.locale ?? "en",
      sample: freezeSample(input.sample),
      projections,
      calculations,
      families,
      pages,
      navigation,
      downloads: downloads.results,
      problemTable: input.problemTable,
      [reportExecutionTypeId]: (): void => undefined,
    }) as ReportExecution;
    executions.set(execution, true);
    return Either.right(execution);
  } catch (error) {
    if (error instanceof ExecutionValueError) {
      return Either.left(error.value);
    }
    throw error;
  }
}

export const makeReportExecution = reportExecution;

export function isReportExecution(value: unknown): value is ReportExecution {
  return typeof value === "object" && value !== null && executions.has(value);
}

function copyProjections(
  value: readonly ReportProjectionSummary[],
  table: ReportProblemTable,
): readonly ReportProjectionSummary[] {
  if (!Array.isArray(value)) {
    throw invalid("projections", "projections must be an array");
  }
  const copied = value.map((summary, index) => {
    if (typeof summary !== "object" || summary === null) {
      throw invalid(`projections.${index}`, "a projection summary must be an object");
    }
    if (!isReportProjectionId(summary.projectionId)) {
      throw invalid(`projections.${index}.projectionId`, "a projection ID must be a bounded uint32");
    }
    if (!isInputKey(summary.inputKey)) {
      throw invalid(`projections.${index}.inputKey`, "a projection input key is invalid");
    }
    return Object.freeze({
      projectionId: summary.projectionId,
      inputKey: summary.inputKey,
      coverage: copyCoverage(summary.coverage, `projections.${index}.coverage`),
      problemIds: problemIds(summary.problemIds, table, false, `projections.${index}.problemIds`),
    });
  });
  copied.sort((left, right) => left.projectionId - right.projectionId);
  copied.forEach((summary, index) => {
    if (summary.projectionId !== index) {
      throw invalid("projections", "projection IDs must be consecutive from zero in canonical order");
    }
  });
  return Object.freeze(copied);
}

function copyCalculations(
  value: readonly ReportCalculationExecutionResult[],
  table: ReportProblemTable,
): readonly ReportCalculationExecutionResult[] {
  if (!Array.isArray(value)) {
    throw invalid("calculations", "calculations must be an array");
  }
  const copied = value.map((result, index) => copyCalculation(result, table, `calculations.${index}`));
  copied.sort((left, right) => compareText(left.calculationId, right.calculationId));
  assertDistinctComponents(copied, "calculationId", "calculations");
  return Object.freeze(copied);
}

function copyCalculation(
  value: ReportCalculationExecutionResult,
  table: ReportProblemTable,
  path: string,
): ReportCalculationExecutionResult {
  if (typeof value !== "object" || value === null || !isReportComponentId(value.calculationId)) {
    throw invalid(path, "a Calculation result must name a ReportComponentId");
  }
  switch (value.state) {
    case "available":
      return Object.freeze({
        state: "available" as const,
        calculationId: value.calculationId,
        value: value.value,
        inputState: copyDataState(value.inputState, `${path}.inputState`),
        problemIds: problemIds(value.problemIds, table, false, `${path}.problemIds`),
      });
    case "data-unavailable":
    case "execution-failed":
      return Object.freeze({
        state: value.state,
        calculationId: value.calculationId,
        problemIds: problemIds(value.problemIds, table, true, `${path}.problemIds`),
      });
    default:
      throw invalid(`${path}.state`, "a Calculation result state is not recognized");
  }
}

function copyFamilies(
  value: readonly ReportPageFamilyResult[],
  table: ReportProblemTable,
): readonly ReportPageFamilyResult[] {
  if (!Array.isArray(value)) {
    throw invalid("families", "families must be an array");
  }
  const copied = value.map((result, index) => {
    const path = `families.${index}`;
    if (
      typeof result !== "object" ||
      result === null ||
      !isReportComponentId(result.familyId) ||
      !isCount(result.instanceCount)
    ) {
      throw invalid(path, "a PageFamily result is invalid");
    }
    if (result.state === "expanded") {
      return Object.freeze({
        state: "expanded" as const,
        familyId: result.familyId,
        instanceCount: result.instanceCount,
        problemIds: problemIds(result.problemIds, table, false, `${path}.problemIds`),
      });
    }
    if (result.state === "data-unavailable" || result.state === "execution-failed") {
      return Object.freeze({
        state: result.state,
        familyId: result.familyId,
        instanceCount: result.instanceCount,
        problemIds: problemIds(result.problemIds, table, true, `${path}.problemIds`),
      });
    }
    throw invalid(`${path}.state`, "a PageFamily result state is not recognized");
  });
  copied.sort((left, right) => compareText(left.familyId, right.familyId));
  assertDistinctComponents(copied, "familyId", "families");
  return Object.freeze(copied);
}

function routesFromPages(value: readonly ReportPageResult[]): ReadonlySet<ReportRoute> {
  if (!Array.isArray(value)) {
    throw invalid("pages", "pages must be an array");
  }
  const routes = new Set<ReportRoute>();
  value.forEach((page, index) => {
    if (typeof page !== "object" || page === null || !isReportComponentId(page.pageId)) {
      throw invalid(`pages.${index}`, "a Page result must name a ReportComponentId");
    }
    if (page.route !== undefined) {
      if (!isReportRoute(page.route)) {
        throw invalid(`pages.${index}.route`, "a Page route is invalid");
      }
    }
    if (page.state === "rendered" && page.route === undefined) {
      throw invalid(`pages.${index}.route`, "a rendered Page needs a route");
    }
    if (page.state === "rendered" && page.route !== undefined) {
      if (routes.has(page.route)) {
        throw invalid("pages", "two rendered pages cannot share a route");
      }
      routes.add(page.route);
    }
  });
  return routes;
}

function copyPages(
  value: readonly ReportPageResult[],
  table: ReportProblemTable,
  routes: ReadonlySet<ReportRoute>,
  downloads: ReadonlySet<ReportDownloadPath>,
): readonly ReportPageResult[] {
  const copied = value.map((result, index) => {
    const path = `pages.${index}`;
    if (typeof result !== "object" || result === null || !isReportComponentId(result.pageId)) {
      throw invalid(path, "a Page result must name a ReportComponentId");
    }
    switch (result.state) {
      case "rendered": {
        if (!isReportRoute(result.route)) {
          throw invalid(`${path}.route`, "a rendered Page needs a valid route");
        }
        const validation = validateReportDocument(result.document, { routes, downloads });
        if (!validation.valid) {
          throw invalid(`${path}.document`, "a rendered Page must contain a valid closed semantic document");
        }
        return Object.freeze({
          state: "rendered" as const,
          pageId: result.pageId,
          route: result.route,
          document: freezeReportDocument(result.document),
          problemIds: problemIds(result.problemIds, table, false, `${path}.problemIds`),
        });
      }
      case "data-unavailable":
      case "execution-failed":
        return Object.freeze({
          state: result.state,
          pageId: result.pageId,
          ...(result.route === undefined ? {} : { route: requireReportRoute(result.route, `${path}.route`) }),
          problemIds: problemIds(result.problemIds, table, true, `${path}.problemIds`),
        });
      default:
        throw invalid(`${path}.state`, "a Page result state is not recognized");
    }
  });
  return Object.freeze(copied);
}

function copyNavigation(
  value: readonly ReportNavigationItem[],
  pages: readonly ReportPageResult[],
): readonly ReportNavigationItem[] {
  if (!Array.isArray(value)) {
    throw invalid("navigation", "navigation must be an array");
  }
  const pageIds = new Set<ReportComponentId>();
  const routes = new Set<ReportRoute>();
  const orders = new Set<number>();
  const copied = value.map((item, index) => {
    const path = `navigation.${index}`;
    if (typeof item !== "object" || item === null || item.kind !== "fixed-page") {
      throw invalid(path, "a navigation item must identify a fixed Page");
    }
    if (!isReportComponentId(item.pageId) || !isReportRoute(item.route)) {
      throw invalid(path, "a navigation item must use valid Page identity and route values");
    }
    if (!Number.isSafeInteger(item.order) || item.order < 0) {
      throw invalid(`${path}.order`, "navigation order must be a non-negative safe integer");
    }
    if (typeof item.title !== "string" || item.title.length === 0 || !hasOnlyUnicodeScalars(item.title)) {
      throw invalid(`${path}.title`, "a navigation title must be a non-empty Unicode string");
    }
    if (typeof item.visible !== "boolean") {
      throw invalid(`${path}.visible`, "navigation visibility must be a boolean");
    }
    if (item.state !== "rendered" && item.state !== "data-unavailable" && item.state !== "execution-failed") {
      throw invalid(`${path}.state`, "a navigation state is not recognized");
    }
    const page = pages.find((candidate) => candidate.pageId === item.pageId && candidate.route === item.route);
    if (page === undefined || page.state !== item.state) {
      throw invalid(path, "a navigation item must reference the matching fixed Page result");
    }
    if (pageIds.has(item.pageId) || routes.has(item.route) || orders.has(item.order)) {
      throw invalid("navigation", "fixed Page navigation identities, routes, and orders must be unique");
    }
    pageIds.add(item.pageId);
    routes.add(item.route);
    orders.add(item.order);
    return Object.freeze({
      kind: "fixed-page" as const,
      pageId: item.pageId,
      order: item.order,
      title: item.title,
      route: item.route,
      visible: item.visible,
      state: item.state,
    });
  });
  copied.sort((left, right) => left.order - right.order);
  return Object.freeze(copied);
}

function copyDownloads(
  value: readonly ReportDownloadResult[],
  table: ReportProblemTable,
): { readonly results: readonly ReportDownloadResult[]; readonly paths: ReadonlySet<ReportDownloadPath> } {
  if (!Array.isArray(value)) {
    throw invalid("downloads", "downloads must be an array");
  }
  const paths = new Set<ReportDownloadPath>();
  let fileCount = 0;
  const copied = value.map((result, index) => {
    const path = `downloads.${index}`;
    if (typeof result !== "object" || result === null || !isReportComponentId(result.downloadId)) {
      throw invalid(path, "a Download result must name a ReportComponentId");
    }
    if (result.state === "built") {
      const inputFiles: readonly ReportDownloadFile[] = result.files;
      if (!Array.isArray(inputFiles)) {
        throw invalid(`${path}.files`, "a built Download must contain files");
      }
      const files = inputFiles.map((file: ReportDownloadFile, fileIndex: number) => {
        fileCount += 1;
        if (fileCount > REPORT_DOWNLOAD_FILES_MAX) {
          throw limit("download-files", REPORT_DOWNLOAD_FILES_MAX, fileCount);
        }
        const filePath = `${path}.files.${fileIndex}`;
        const copiedFile = copyDownloadFile(file, filePath);
        if (paths.has(copiedFile.path)) {
          throw invalid("downloads", "download file paths must be unique across an execution");
        }
        paths.add(copiedFile.path);
        return copiedFile;
      });
      return Object.freeze({
        state: "built" as const,
        downloadId: result.downloadId,
        files: Object.freeze(files),
        problemIds: problemIds(result.problemIds, table, false, `${path}.problemIds`),
      });
    }
    if (result.state === "data-unavailable" || result.state === "execution-failed") {
      return Object.freeze({
        state: result.state,
        downloadId: result.downloadId,
        problemIds: problemIds(result.problemIds, table, true, `${path}.problemIds`),
      });
    }
    throw invalid(`${path}.state`, "a Download result state is not recognized");
  });
  copied.sort((left, right) => compareText(left.downloadId, right.downloadId));
  assertDistinctComponents(copied, "downloadId", "downloads");
  return Object.freeze({ results: Object.freeze(copied), paths });
}

function copyDownloadFile(value: ReportDownloadFile, path: string): ReportDownloadFile {
  if (typeof value !== "object" || value === null || !isReportDownloadPath(value.path)) {
    throw invalid(path, "a Download file must use a valid ReportDownloadPath");
  }
  if (
    typeof value.mediaType !== "string" ||
    value.mediaType.length === 0 ||
    !hasOnlyUnicodeScalars(value.mediaType)
  ) {
    throw invalid(`${path}.mediaType`, "a Download media type must be a non-empty Unicode string");
  }
  if (!(value.bytes instanceof Uint8Array)) {
    throw invalid(`${path}.bytes`, "Download bytes must be a Uint8Array");
  }
  if (value.bytes.byteLength > REPORT_DOWNLOAD_FILE_BYTES_MAX) {
    throw limit("download-file-bytes", REPORT_DOWNLOAD_FILE_BYTES_MAX, value.bytes.byteLength);
  }
  return Object.freeze({
    path: value.path,
    mediaType: value.mediaType,
    bytes: new Uint8Array(value.bytes),
  });
}

function assertStaticClosure(
  routes: ReadonlySet<ReportRoute>,
  downloads: ReadonlySet<ReportDownloadPath>,
): void {
  const paths = [
    ...[...routes].map(staticPathForReportRoute),
    ...[...downloads].map(staticPathForReportDownload),
  ];
  for (let left = 0; left < paths.length; left += 1) {
    for (let right = left + 1; right < paths.length; right += 1) {
      if (reportStaticPathConflict(paths[left], paths[right]) !== undefined) {
        throw invalid("closure", "route and download outputs cannot collide on supported filesystems");
      }
    }
  }
}

function copyCoverage(value: ProjectionCoverage, path: string): ProjectionCoverage {
  if (typeof value !== "object" || value === null) {
    throw invalid(path, "a projection summary needs coverage");
  }
  const sample = value.sample;
  const entries = value.entries;
  const attachments = value.attachments;
  if (
    !countRecord(sample, ["denominator", "totalSlots", "included", "notRecorded", "coreInvalid", "excluded"]) ||
    !countRecord(entries, ["total", "attachmentResult", "notRecorded", "coreInvalid", "excluded"]) ||
    !countRecord(attachments, ["available", "unavailable", "migrationRequired", "migrationUnavailable", "unsupported", "invalid"])
  ) {
    throw invalid(path, "projection coverage must contain non-negative finite counts");
  }
  return Object.freeze({
    sample: Object.freeze({
      denominator: sample.denominator,
      totalSlots: sample.totalSlots,
      included: sample.included,
      notRecorded: sample.notRecorded,
      coreInvalid: sample.coreInvalid,
      excluded: sample.excluded,
    }),
    entries: Object.freeze({
      total: entries.total,
      attachmentResult: entries.attachmentResult,
      notRecorded: entries.notRecorded,
      coreInvalid: entries.coreInvalid,
      excluded: entries.excluded,
    }),
    attachments: Object.freeze({
      available: attachments.available,
      unavailable: attachments.unavailable,
      migrationRequired: attachments.migrationRequired,
      migrationUnavailable: attachments.migrationUnavailable,
      unsupported: attachments.unsupported,
      invalid: attachments.invalid,
    }),
  });
}

function countRecord(value: unknown, keys: readonly string[]): value is Record<string, number> {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return keys.every((key) => isCount(record[key]));
}

function copyDataState(value: ReportDataState, path: string): ReportDataState {
  if (typeof value !== "object" || value === null || (value.state !== "complete" && value.state !== "partial")) {
    throw invalid(path, "a Calculation input state must be complete or partial");
  }
  return Object.freeze({ state: value.state });
}

function problemIds(
  value: readonly ReportProblemId[],
  table: ReportProblemTable,
  required: false,
  path: string,
): readonly ReportProblemId[];
function problemIds(
  value: readonly ReportProblemId[],
  table: ReportProblemTable,
  required: true,
  path: string,
): readonly [ReportProblemId, ...ReportProblemId[]];
function problemIds(
  value: readonly ReportProblemId[],
  table: ReportProblemTable,
  required: boolean,
  path: string,
): readonly ReportProblemId[] {
  if (!Array.isArray(value) || (required && value.length === 0)) {
    throw invalid(path, required ? "this result requires at least one problem ID" : "problem IDs must be an array");
  }
  const copied: ReportProblemId[] = [];
  const seen = new Set<number>();
  for (const id of value) {
    if (!isReportProblemId(id) || table[id] === undefined || table[id].id !== id) {
      throw invalid(path, "every problem ID must reference the execution problem table");
    }
    if (seen.has(id)) {
      throw invalid(path, "a result cannot repeat a problem ID");
    }
    seen.add(id);
    copied.push(id);
  }
  return Object.freeze(copied);
}

function requireReportRoute(value: unknown, path: string): ReportRoute {
  if (!isReportRoute(value)) {
    throw invalid(path, "a route is invalid");
  }
  return value;
}

function assertDistinctComponents<
  Value extends Record<Key, ReportComponentId>,
  Key extends string,
>(values: readonly Value[], key: Key, path: string): void {
  const ids = new Set<string>();
  for (const value of values) {
    if (ids.has(value[key])) {
      throw invalid(path, "component result IDs must be unique in canonical result tables");
    }
    ids.add(value[key]);
  }
}

function compareText(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

function isInputKey(value: unknown): value is string {
  return typeof value === "string" &&
    /^[a-z][a-z0-9_-]*$/.test(value) &&
    encoder.encode(value).byteLength <= 64;
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
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

function freezeSample(sample: AnalysisSample): AnalysisSample {
  try {
    return deepFreeze(structuredClone(sample));
  } catch {
    throw invalid("sample", "an AnalysisSample must be a cloneable pure value");
  }
}

function deepFreeze<Value>(value: Value, seen: Set<object> = new Set()): Value {
  if (typeof value !== "object" || value === null || seen.has(value)) {
    return value;
  }
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor !== undefined && "value" in descriptor) {
      deepFreeze(descriptor.value, seen);
    }
  }
  Object.freeze(value);
  return value;
}

class ExecutionValueError extends Error {
  readonly value: ReportExecutionValueError;

  constructor(value: ReportExecutionValueError) {
    super(value.code);
    this.value = value;
  }
}

function invalid(path: string, reason: string): ExecutionValueError {
  return new ExecutionValueError(
    Object.freeze({
      code: "report-execution-invalid" as const,
      path: Object.freeze(path.split(".")),
      reason,
    }),
  );
}

function limit(
  limitName: ReportLimitExceeded["limit"],
  maximum: number,
  observedAtLeast: number,
): ExecutionValueError {
  return new ExecutionValueError(
    Object.freeze({
      code: "report-limit-exceeded" as const,
      limit: limitName,
      maximum,
      observedAtLeast,
    }),
  );
}
