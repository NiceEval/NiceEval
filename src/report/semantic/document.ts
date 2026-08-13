import {
  isReportDownloadPath,
  isReportRoute,
  type ReportDownloadPath,
  type ReportRoute,
} from "../author/identity.ts";
import { isPortableSegment } from "../../record/model/identifiers.ts";

export type ReportScalar = null | boolean | number | string;

/** Targets stay declarative: a renderer chooses a safe local URL without I/O. */
export type ReportLinkTarget =
  | { readonly kind: "route"; readonly route: ReportRoute }
  | { readonly kind: "download"; readonly path: ReportDownloadPath }
  | { readonly kind: "external"; readonly href: string }
  | { readonly kind: "attempt"; readonly locator: string };

/** A bounded coverage receipt attached to a visible aggregate, never inferred by a host. */
export interface ReportCoverage {
  readonly basis: "eval";
  readonly samples: number;
  readonly total: number;
}

/** A scalar with its author-provided display and optional availability receipt. */
export interface ReportDisplayValue {
  readonly value: ReportScalar;
  readonly display: string;
  readonly unit?: string;
  readonly coverage?: ReportCoverage;
}

export type ReportInline =
  | { readonly type: "text"; readonly value: string }
  | { readonly type: "code"; readonly value: string }
  | { readonly type: "emphasis"; readonly children: readonly ReportInline[] }
  | {
      readonly type: "link";
      readonly label: readonly ReportInline[];
      readonly target: ReportLinkTarget;
    };

export interface ReportDocument {
  readonly title: string;
  readonly children: readonly ReportBlock[];
  /** Host-owned presentation profile. Not a second data or render truth. */
  readonly presentation?: "classic-dashboard" | "evidence-text";
  /** States whether classic metadata came from the current declaration or a partial selection. */
  readonly metadataOrigin?: "current-declaration" | "partial";
}

export type ReportBlock =
  | ReportSection
  | ReportParagraph
  | ReportList
  | ReportTable
  | ReportMetric
  | ReportStatus
  | ReportCode
  | ReportChart
  | ReportHero
  | ReportSummary
  | ReportRankedBars
  | ReportScatter
  | ReportTreeTable
  | ReportGrid
  | ReportStat
  | ReportCellTable;

export interface ReportSection {
  readonly type: "section";
  readonly heading: string;
  readonly meta?: string;
  readonly children: readonly ReportBlock[];
}

export interface ReportGrid {
  readonly type: "grid";
  readonly cells: readonly ReportBlock[];
}

export interface ReportStat {
  readonly type: "stat";
  readonly label: string;
  readonly value: string;
  readonly tone?: "neutral" | "positive" | "negative" | "warning";
}

export interface ReportCellTable {
  readonly type: "cell-table";
  readonly columns: readonly string[];
  readonly rows: readonly {
    readonly key: string;
    readonly cells: Readonly<Record<string, string>>;
  }[];
}

export interface ReportParagraph {
  readonly type: "paragraph";
  readonly children: readonly ReportInline[];
}

export interface ReportList {
  readonly type: "list";
  readonly ordered: boolean;
  readonly items: readonly (readonly ReportBlock[])[];
}

export interface ReportTable {
  readonly type: "table";
  readonly caption: string;
  readonly columns: readonly {
    readonly key: string;
    readonly label: string;
    readonly align?: "start" | "end";
  }[];
  readonly rows: readonly Readonly<Record<string, ReportScalar>>[];
}

export interface ReportMetric {
  readonly type: "metric";
  readonly label: string;
  readonly value: ReportScalar;
  readonly unit?: string;
}

export interface ReportStatus {
  readonly type: "status";
  readonly tone: "neutral" | "positive" | "warning" | "negative";
  readonly label: string;
  readonly detail?: readonly ReportInline[];
}

export interface ReportCode {
  readonly type: "code-block";
  readonly value: string;
  readonly language?: string;
}

export interface ReportChart {
  readonly type: "chart";
  readonly chart: "bar" | "line";
  readonly title: string;
  readonly categoryLabel: string;
  readonly categories: readonly string[];
  readonly series: readonly {
    readonly label: string;
    readonly values: readonly (number | null)[];
  }[];
}

/** A declarative dashboard introduction. Its links are deliberately external-only. */
export interface ReportHero {
  readonly type: "hero";
  readonly title?: string;
  readonly logo?: {
    readonly src: string;
    readonly alt: string;
  };
  readonly description: string;
  readonly links: readonly {
    readonly label: string;
    readonly target: Extract<ReportLinkTarget, { readonly kind: "external" }>;
  }[];
  readonly lastRunAt?: number | null;
  readonly runCount?: number;
}

export interface ReportSummary {
  readonly type: "summary";
  readonly lastRunAt: number | null;
  readonly metrics: readonly ({
    readonly key: string;
    readonly label: string;
  } & ReportDisplayValue)[];
}

export interface ReportRankedBars {
  readonly type: "ranked-bars";
  readonly title: string;
  readonly layout: "horizontal";
  readonly points: readonly {
    readonly key: string;
    readonly label: string;
    readonly series: string;
    readonly value: number | null;
    readonly display: string;
    readonly coverage: ReportCoverage;
  }[];
  readonly better: "higher" | "lower";
}

export interface ReportScatter {
  readonly type: "scatter";
  readonly title: string;
  readonly xLabel: string;
  readonly yLabel: string;
  readonly connect: boolean;
  readonly series: readonly {
    readonly label: string;
    readonly points: readonly {
      readonly key: string;
      readonly x: number | null;
      readonly y: number | null;
      readonly xDisplay: string;
      readonly yDisplay: string;
      readonly target?: ReportLinkTarget;
    }[];
  }[];
}

export type ReportTreeRowKind = "experiment" | "eval" | "attempt";
export type ReportTreeCell = ReportScalar | ReportDisplayValue;

export interface ReportTreeTable {
  readonly type: "tree-table";
  readonly caption: string;
  readonly columns: readonly {
    readonly key: string;
    readonly label: string;
    readonly align?: "start" | "end";
  }[];
  readonly rows: readonly {
    readonly key: string;
    readonly kind: ReportTreeRowKind;
    readonly depth: 0 | 1 | 2;
    readonly label: string;
    readonly target?: ReportLinkTarget;
    readonly cells: Readonly<Record<string, ReportTreeCell>>;
  }[];
}

export const REPORT_DOCUMENT_NODES_MAX = 20_000;
export const REPORT_DOCUMENT_DEPTH_MAX = 32;

export interface ReportDocumentClosure {
  readonly routes?: ReadonlySet<ReportRoute>;
  readonly downloads?: ReadonlySet<ReportDownloadPath>;
}

export interface ReportDocumentIssue {
  readonly code:
    | "shape"
    | "unicode"
    | "number"
    | "table"
    | "chart"
    | "link"
    | "cycle"
    | "limit";
  readonly path: readonly (string | number)[];
  readonly reason: string;
}

export interface ReportDocumentValidation {
  readonly valid: boolean;
  readonly issues: readonly ReportDocumentIssue[];
  readonly nodeCount: number;
  readonly stringBytes: number;
}

const encoder = new TextEncoder();
const MAX_ISSUES = 64;

export function reportDocument(input: {
  readonly title: string;
  readonly children: readonly ReportBlock[];
  readonly presentation?: ReportDocument["presentation"];
  readonly metadataOrigin?: ReportDocument["metadataOrigin"];
}): ReportDocument {
  return Object.freeze({
    title: input.title,
    children: freezeArray(input.children),
    ...(input.presentation === undefined ? {} : { presentation: input.presentation }),
    ...(input.metadataOrigin === undefined ? {} : { metadataOrigin: input.metadataOrigin }),
  });
}

export function reportText(value: string): ReportInline {
  return Object.freeze({ type: "text" as const, value });
}

export function reportCode(value: string): ReportInline {
  return Object.freeze({ type: "code" as const, value });
}

export function reportEmphasis(
  children: readonly ReportInline[],
): ReportInline {
  return Object.freeze({ type: "emphasis" as const, children: freezeArray(children) });
}

export function reportLink(input: {
  readonly label: readonly ReportInline[];
  readonly target: ReportLinkTarget;
}): ReportInline {
  return Object.freeze({
    type: "link" as const,
    label: freezeArray(input.label),
    target: cloneLinkTarget(input.target),
  });
}

export function reportSection(input: {
  readonly heading: string;
  readonly meta?: string;
  readonly children: readonly ReportBlock[];
}): ReportSection {
  return Object.freeze({
    type: "section" as const,
    heading: input.heading,
    ...(input.meta === undefined ? {} : { meta: input.meta }),
    children: freezeArray(input.children),
  });
}

export function reportGrid(input: {
  readonly cells: readonly ReportBlock[];
}): ReportGrid {
  return Object.freeze({
    type: "grid" as const,
    cells: freezeArray(input.cells),
  });
}

export function reportStat(input: {
  readonly label: string;
  readonly value: string;
  readonly tone?: ReportStat["tone"];
}): ReportStat {
  return Object.freeze({
    type: "stat" as const,
    label: input.label,
    value: input.value,
    ...(input.tone === undefined ? {} : { tone: input.tone }),
  });
}

export function reportCellTable(input: {
  readonly columns: readonly string[];
  readonly rows: readonly {
    readonly key: string;
    readonly cells: Readonly<Record<string, string>>;
  }[];
}): ReportCellTable {
  return Object.freeze({
    type: "cell-table" as const,
    columns: freezeArray(input.columns),
    rows: Object.freeze(input.rows.map((row) => Object.freeze({
      key: row.key,
      cells: Object.freeze({ ...row.cells }),
    }))),
  });
}

export function reportParagraph(
  children: readonly ReportInline[],
): ReportParagraph {
  return Object.freeze({ type: "paragraph" as const, children: freezeArray(children) });
}

export function reportList(input: {
  readonly ordered: boolean;
  readonly items: readonly (readonly ReportBlock[])[];
}): ReportList {
  return Object.freeze({
    type: "list" as const,
    ordered: input.ordered,
    items: Object.freeze(input.items.map((item) => freezeArray(item))),
  });
}

export function reportTable(input: {
  readonly caption: string;
  readonly columns: readonly {
    readonly key: string;
    readonly label: string;
    readonly align?: "start" | "end";
  }[];
  readonly rows: readonly Readonly<Record<string, ReportScalar>>[];
}): ReportTable {
  return Object.freeze({
    type: "table" as const,
    caption: input.caption,
    columns: Object.freeze(
      input.columns.map((column) =>
        Object.freeze({
          key: column.key,
          label: column.label,
          ...(column.align === undefined ? {} : { align: column.align }),
        })
      ),
    ),
    rows: Object.freeze(input.rows.map(cloneRow)),
  });
}

export function reportMetric(input: {
  readonly label: string;
  readonly value: ReportScalar;
  readonly unit?: string;
}): ReportMetric {
  return Object.freeze({
    type: "metric" as const,
    label: input.label,
    value: input.value,
    ...(input.unit === undefined ? {} : { unit: input.unit }),
  });
}

export function reportStatus(input: {
  readonly tone: "neutral" | "positive" | "warning" | "negative";
  readonly label: string;
  readonly detail?: readonly ReportInline[];
}): ReportStatus {
  return Object.freeze({
    type: "status" as const,
    tone: input.tone,
    label: input.label,
    ...(input.detail === undefined ? {} : { detail: freezeArray(input.detail) }),
  });
}

export function reportCodeBlock(input: {
  readonly value: string;
  readonly language?: string;
}): ReportCode {
  return Object.freeze({
    type: "code-block" as const,
    value: input.value,
    ...(input.language === undefined ? {} : { language: input.language }),
  });
}

export function reportChart(input: {
  readonly chart: "bar" | "line";
  readonly title: string;
  readonly categoryLabel: string;
  readonly categories: readonly string[];
  readonly series: readonly {
    readonly label: string;
    readonly values: readonly (number | null)[];
  }[];
}): ReportChart {
  return Object.freeze({
    type: "chart" as const,
    chart: input.chart,
    title: input.title,
    categoryLabel: input.categoryLabel,
    categories: freezeArray(input.categories),
    series: Object.freeze(
      input.series.map((series) =>
        Object.freeze({ label: series.label, values: freezeArray(series.values) })
      ),
    ),
  });
}

export function reportHero(input: {
  readonly title?: string;
  readonly logo?: ReportHero["logo"];
  readonly description: string;
  readonly links: readonly ReportHero["links"][number][];
  readonly lastRunAt?: number | null;
  readonly runCount?: number;
}): ReportHero {
  return Object.freeze({
    type: "hero" as const,
    ...(input.title === undefined ? {} : { title: input.title }),
    ...(input.logo === undefined ? {} : { logo: Object.freeze({ src: input.logo.src, alt: input.logo.alt }) }),
    description: input.description,
    links: Object.freeze(input.links.map((link) => Object.freeze({
      label: link.label,
      target: Object.freeze({ kind: "external" as const, href: link.target.href }),
    }))),
    ...(input.lastRunAt === undefined ? {} : { lastRunAt: input.lastRunAt }),
    ...(input.runCount === undefined ? {} : { runCount: input.runCount }),
  });
}

export function reportSummary(input: {
  readonly lastRunAt: number | null;
  readonly metrics: readonly (ReportSummary["metrics"][number])[];
}): ReportSummary {
  return Object.freeze({
    type: "summary" as const,
    lastRunAt: input.lastRunAt,
    metrics: Object.freeze(input.metrics.map((metric) => Object.freeze({
      key: metric.key,
      label: metric.label,
      ...cloneDisplayValue(metric),
    }))),
  });
}

export function reportRankedBars(input: Omit<ReportRankedBars, "type">): ReportRankedBars {
  return Object.freeze({
    type: "ranked-bars" as const,
    title: input.title,
    layout: input.layout,
    points: Object.freeze(input.points.map((point) => Object.freeze({
      key: point.key,
      label: point.label,
      series: point.series,
      value: point.value,
      display: point.display,
      coverage: cloneCoverage(point.coverage),
    }))),
    better: input.better,
  });
}

export function reportScatter(input: Omit<ReportScatter, "type">): ReportScatter {
  return Object.freeze({
    type: "scatter" as const,
    title: input.title,
    xLabel: input.xLabel,
    yLabel: input.yLabel,
    connect: input.connect,
    series: Object.freeze(input.series.map((series) => Object.freeze({
      label: series.label,
      points: Object.freeze(series.points.map((point) => Object.freeze({
        key: point.key,
        x: point.x,
        y: point.y,
        xDisplay: point.xDisplay,
        yDisplay: point.yDisplay,
        ...(point.target === undefined ? {} : { target: cloneLinkTarget(point.target) }),
      }))),
    }))),
  });
}

export function reportTreeTable(input: Omit<ReportTreeTable, "type">): ReportTreeTable {
  return Object.freeze({
    type: "tree-table" as const,
    caption: input.caption,
    columns: Object.freeze(input.columns.map((column) => Object.freeze({
      key: column.key,
      label: column.label,
      ...(column.align === undefined ? {} : { align: column.align }),
    }))),
    rows: Object.freeze(input.rows.map((row) => Object.freeze({
      key: row.key,
      kind: row.kind,
      depth: row.depth,
      label: row.label,
      ...(row.target === undefined ? {} : { target: cloneLinkTarget(row.target) }),
      cells: cloneTreeCells(row.cells),
    }))),
  });
}

/**
 * Performs exact-shape and relational checks without rendering or evaluating
 * author callbacks. Supplying a closure additionally verifies semantic links.
 */
export function validateReportDocument(
  document: unknown,
  closure: ReportDocumentClosure = {},
): ReportDocumentValidation {
  const state: ValidationState = {
    closure,
    issues: [],
    nodeCount: 0,
    stringBytes: 0,
    active: new Set<object>(),
  };
  validateDocument(document, state, [], 0);
  return Object.freeze({
    valid: state.issues.length === 0,
    issues: Object.freeze(state.issues),
    nodeCount: state.nodeCount,
    stringBytes: state.stringBytes,
  });
}

/** Copies a validated document into a frozen, self-contained semantic tree. */
export function freezeReportDocument(document: ReportDocument): ReportDocument {
  const validation = validateReportDocument(document);
  if (!validation.valid) {
    throw new TypeError("a Report document must satisfy the closed semantic tree shape");
  }
  return cloneDocument(document);
}

interface ValidationState {
  readonly closure: ReportDocumentClosure;
  readonly issues: ReportDocumentIssue[];
  nodeCount: number;
  stringBytes: number;
  readonly active: Set<object>;
}

function validateDocument(
  value: unknown,
  state: ValidationState,
  path: readonly (string | number)[],
  depth: number,
): void {
  const record = enterNode(value, state, path, depth);
  if (record === undefined) {
    return;
  }
  try {
    exactFields(record, ["title", "children", "presentation", "metadataOrigin"], state, path, [
      "presentation",
      "metadataOrigin",
    ]);
    validateString(field(record, "title"), state, pathFor(path, "title"));
    if (
      hasField(record, "presentation")
      && field(record, "presentation") !== "classic-dashboard"
      && field(record, "presentation") !== "evidence-text"
    ) {
      issue(state, "shape", pathFor(path, "presentation"), "the document presentation is not recognized");
    }
    if (
      hasField(record, "metadataOrigin") &&
      field(record, "metadataOrigin") !== "current-declaration" &&
      field(record, "metadataOrigin") !== "partial"
    ) {
      issue(state, "shape", pathFor(path, "metadataOrigin"), "the document metadata origin is not recognized");
    }
    forEachArray(field(record, "children"), state, pathFor(path, "children"), (child, index) =>
      validateBlock(child, state, pathFor(pathFor(path, "children"), index), depth + 1)
    );
  } finally {
    state.active.delete(record);
  }
}

function validateBlock(
  value: unknown,
  state: ValidationState,
  path: readonly (string | number)[],
  depth: number,
): void {
  const record = enterNode(value, state, path, depth);
  if (record === undefined) {
    return;
  }
  try {
    const type = field(record, "type");
    switch (type) {
      case "section":
        exactFields(record, ["type", "heading", "meta", "children"], state, path, ["meta"]);
        validateString(field(record, "heading"), state, pathFor(path, "heading"));
        optionalString(record, "meta", state, path);
        forEachArray(field(record, "children"), state, pathFor(path, "children"), (child, index) =>
          validateBlock(child, state, pathFor(pathFor(path, "children"), index), depth + 1)
        );
        break;
      case "grid":
        exactFields(record, ["type", "cells"], state, path);
        forEachArray(field(record, "cells"), state, pathFor(path, "cells"), (child, index) =>
          validateBlock(child, state, pathFor(pathFor(path, "cells"), index), depth + 1)
        );
        break;
      case "stat":
        exactFields(record, ["type", "label", "value", "tone"], state, path, ["tone"]);
        validateString(field(record, "label"), state, pathFor(path, "label"));
        validateString(field(record, "value"), state, pathFor(path, "value"));
        if (hasField(record, "tone") && !isTone(field(record, "tone"))) {
          issue(state, "shape", pathFor(path, "tone"), "stat tone is not recognized");
        }
        break;
      case "cell-table":
        validateCellTable(record, state, path);
        break;
      case "paragraph":
        exactFields(record, ["type", "children"], state, path);
        forEachArray(field(record, "children"), state, pathFor(path, "children"), (child, index) =>
          validateInline(child, state, pathFor(pathFor(path, "children"), index), depth + 1)
        );
        break;
      case "list":
        exactFields(record, ["type", "ordered", "items"], state, path);
        if (typeof field(record, "ordered") !== "boolean") {
          issue(state, "shape", pathFor(path, "ordered"), "list ordered must be a boolean");
        }
        forEachArray(field(record, "items"), state, pathFor(path, "items"), (item, itemIndex) => {
          forEachArray(item, state, pathFor(pathFor(path, "items"), itemIndex), (child, childIndex) =>
            validateBlock(
              child,
              state,
              pathFor(pathFor(pathFor(path, "items"), itemIndex), childIndex),
              depth + 1,
            )
          );
        });
        break;
      case "table":
        validateTable(record, state, path);
        break;
      case "metric":
        exactFields(record, ["type", "label", "value", "unit"], state, path, ["unit"]);
        validateString(field(record, "label"), state, pathFor(path, "label"));
        validateScalar(field(record, "value"), state, pathFor(path, "value"));
        optionalString(record, "unit", state, path);
        break;
      case "status":
        exactFields(record, ["type", "tone", "label", "detail"], state, path, ["detail"]);
        if (!isTone(field(record, "tone"))) {
          issue(state, "shape", pathFor(path, "tone"), "status tone is not recognized");
        }
        validateString(field(record, "label"), state, pathFor(path, "label"));
        if (hasField(record, "detail")) {
          forEachArray(field(record, "detail"), state, pathFor(path, "detail"), (child, index) =>
            validateInline(child, state, pathFor(pathFor(path, "detail"), index), depth + 1)
          );
        }
        break;
      case "code-block":
        exactFields(record, ["type", "value", "language"], state, path, ["language"]);
        validateString(field(record, "value"), state, pathFor(path, "value"));
        optionalString(record, "language", state, path);
        break;
      case "chart":
        validateChart(record, state, path);
        break;
      case "hero":
        validateHero(record, state, path);
        break;
      case "summary":
        validateSummary(record, state, path);
        break;
      case "ranked-bars":
        validateRankedBars(record, state, path);
        break;
      case "scatter":
        validateScatter(record, state, path);
        break;
      case "tree-table":
        validateTreeTable(record, state, path);
        break;
      default:
        issue(state, "shape", pathFor(path, "type"), "the block type is not part of ReportDocument");
        break;
    }
  } finally {
    state.active.delete(record);
  }
}

function validateInline(
  value: unknown,
  state: ValidationState,
  path: readonly (string | number)[],
  depth: number,
): void {
  const record = enterNode(value, state, path, depth);
  if (record === undefined) {
    return;
  }
  try {
    const type = field(record, "type");
    switch (type) {
      case "text":
      case "code":
        exactFields(record, ["type", "value"], state, path);
        validateString(field(record, "value"), state, pathFor(path, "value"));
        break;
      case "emphasis":
        exactFields(record, ["type", "children"], state, path);
        forEachArray(field(record, "children"), state, pathFor(path, "children"), (child, index) =>
          validateInline(child, state, pathFor(pathFor(path, "children"), index), depth + 1)
        );
        break;
      case "link":
        exactFields(record, ["type", "label", "target"], state, path);
        forEachArray(field(record, "label"), state, pathFor(path, "label"), (child, index) =>
          validateInline(child, state, pathFor(pathFor(path, "label"), index), depth + 1)
        );
        validateLinkTarget(field(record, "target"), state, pathFor(path, "target"));
        break;
      default:
        issue(state, "shape", pathFor(path, "type"), "the inline type is not part of ReportDocument");
        break;
    }
  } finally {
    state.active.delete(record);
  }
}

function validateCellTable(
  record: Record<string, unknown>,
  state: ValidationState,
  path: readonly (string | number)[],
): void {
  exactFields(record, ["type", "columns", "rows"], state, path);
  const columns = arrayValue(field(record, "columns"), state, pathFor(path, "columns"));
  const keys = new Set<string>();
  if (columns !== undefined) {
    columns.forEach((column, index) => {
      if (typeof column !== "string" || column.length === 0) {
        issue(state, "table", pathFor(pathFor(path, "columns"), index), "a cell-table column must be a non-empty string");
        return;
      }
      if (keys.has(column)) {
        issue(state, "table", pathFor(pathFor(path, "columns"), index), "cell-table columns must be unique");
        return;
      }
      keys.add(column);
      validateString(column, state, pathFor(pathFor(path, "columns"), index));
    });
  }
  forEachArray(field(record, "rows"), state, pathFor(path, "rows"), (row, index) => {
    const rowPath = pathFor(pathFor(path, "rows"), index);
    const rowRecord = plainRecord(row, state, rowPath);
    if (rowRecord === undefined) return;
    exactFields(rowRecord, ["key", "cells"], state, rowPath);
    validateString(field(rowRecord, "key"), state, pathFor(rowPath, "key"));
    const cells = plainRecord(field(rowRecord, "cells"), state, pathFor(rowPath, "cells"));
    if (cells === undefined) return;
    for (const key of Object.keys(cells)) {
      validateString(field(cells, key), state, pathFor(pathFor(rowPath, "cells"), key));
    }
  });
}

function validateTable(
  record: Record<string, unknown>,
  state: ValidationState,
  path: readonly (string | number)[],
): void {
  exactFields(record, ["type", "caption", "columns", "rows"], state, path);
  validateString(field(record, "caption"), state, pathFor(path, "caption"));
  const keys = new Set<string>();
  forEachArray(field(record, "columns"), state, pathFor(path, "columns"), (column, index) => {
    const columnPath = pathFor(pathFor(path, "columns"), index);
    const columnRecord = plainRecord(column, state, columnPath);
    if (columnRecord === undefined) {
      return;
    }
    exactFields(columnRecord, ["key", "label", "align"], state, columnPath, ["align"]);
    const key = field(columnRecord, "key");
    if (typeof key !== "string" || key.length === 0) {
      issue(state, "table", pathFor(columnPath, "key"), "a table column key must be a non-empty string");
    } else if (keys.has(key)) {
      issue(state, "table", pathFor(columnPath, "key"), "table column keys must be unique");
    } else {
      keys.add(key);
      validateString(key, state, pathFor(columnPath, "key"));
    }
    validateString(field(columnRecord, "label"), state, pathFor(columnPath, "label"));
    if (hasField(columnRecord, "align") && field(columnRecord, "align") !== "start" && field(columnRecord, "align") !== "end") {
      issue(state, "table", pathFor(columnPath, "align"), "a table column alignment must be start or end");
    }
  });
  forEachArray(field(record, "rows"), state, pathFor(path, "rows"), (row, index) => {
    const rowPath = pathFor(pathFor(path, "rows"), index);
    const rowRecord = plainRecord(row, state, rowPath);
    if (rowRecord === undefined) {
      return;
    }
    const rowKeys = Object.keys(rowRecord);
    if (rowKeys.length !== keys.size || rowKeys.some((key) => !keys.has(key))) {
      issue(state, "table", rowPath, "row keys must exactly match the table columns");
    }
    for (const key of rowKeys) {
      validateScalar(field(rowRecord, key), state, pathFor(rowPath, key));
    }
  });
}

function validateChart(
  record: Record<string, unknown>,
  state: ValidationState,
  path: readonly (string | number)[],
): void {
  exactFields(
    record,
    ["type", "chart", "title", "categoryLabel", "categories", "series"],
    state,
    path,
  );
  if (field(record, "chart") !== "bar" && field(record, "chart") !== "line") {
    issue(state, "chart", pathFor(path, "chart"), "chart kind must be bar or line");
  }
  validateString(field(record, "title"), state, pathFor(path, "title"));
  validateString(field(record, "categoryLabel"), state, pathFor(path, "categoryLabel"));
  const categories = arrayValue(field(record, "categories"), state, pathFor(path, "categories"));
  if (categories !== undefined) {
    categories.forEach((category, index) =>
      validateString(category, state, pathFor(pathFor(path, "categories"), index))
    );
  }
  forEachArray(field(record, "series"), state, pathFor(path, "series"), (series, index) => {
    const seriesPath = pathFor(pathFor(path, "series"), index);
    const seriesRecord = plainRecord(series, state, seriesPath);
    if (seriesRecord === undefined) {
      return;
    }
    exactFields(seriesRecord, ["label", "values"], state, seriesPath);
    validateString(field(seriesRecord, "label"), state, pathFor(seriesPath, "label"));
    const values = arrayValue(field(seriesRecord, "values"), state, pathFor(seriesPath, "values"));
    if (values === undefined) {
      return;
    }
    if (categories !== undefined && values.length !== categories.length) {
      issue(state, "chart", pathFor(seriesPath, "values"), "chart series length must match categories");
    }
    values.forEach((point, pointIndex) => {
      if (point !== null && (typeof point !== "number" || !Number.isFinite(point))) {
        issue(state, "number", pathFor(pathFor(seriesPath, "values"), pointIndex), "chart values must be finite numbers or null");
      }
    });
  });
}

function validateHero(
  record: Record<string, unknown>,
  state: ValidationState,
  path: readonly (string | number)[],
): void {
  exactFields(record, ["type", "title", "logo", "description", "links", "lastRunAt", "runCount"], state, path, ["title", "logo", "lastRunAt", "runCount"]);
  if (hasField(record, "title")) {
    validateString(field(record, "title"), state, pathFor(path, "title"));
  }
  if (hasField(record, "logo")) {
    validateHeroLogo(field(record, "logo"), state, pathFor(path, "logo"));
  }
  validateString(field(record, "description"), state, pathFor(path, "description"));
  forEachArray(field(record, "links"), state, pathFor(path, "links"), (link, index) => {
    const linkPath = pathFor(pathFor(path, "links"), index);
    const linkRecord = plainRecord(link, state, linkPath);
    if (linkRecord === undefined) return;
    exactFields(linkRecord, ["label", "target"], state, linkPath);
    validateString(field(linkRecord, "label"), state, pathFor(linkPath, "label"));
    validateExternalTarget(field(linkRecord, "target"), state, pathFor(linkPath, "target"));
  });
}

function validateHeroLogo(
  value: unknown,
  state: ValidationState,
  path: readonly (string | number)[],
): void {
  const record = plainRecord(value, state, path);
  if (record === undefined) {
    return;
  }
  exactFields(record, ["src", "alt"], state, path);
  const src = field(record, "src");
  if (typeof src !== "string" || !isAllowedHeroLogoSrc(src)) {
    issue(state, "shape", pathFor(path, "src"), "hero logo src must be an absolute https URL or a data:image payload");
    return;
  }
  validateString(src, state, pathFor(path, "src"));
  validateString(field(record, "alt"), state, pathFor(path, "alt"));
}

function isAllowedHeroLogoSrc(src: string): boolean {
  if (/^data:image\/[a-z0-9.+-]+[;,]/i.test(src)) {
    return true;
  }
  try {
    const url = new URL(src);
    return url.protocol === "https:" && url.hostname.length > 0;
  } catch {
    return false;
  }
}

function validateSummary(
  record: Record<string, unknown>,
  state: ValidationState,
  path: readonly (string | number)[],
): void {
  exactFields(record, ["type", "lastRunAt", "metrics"], state, path);
  validateEpochMillisOrNull(field(record, "lastRunAt"), state, pathFor(path, "lastRunAt"));
  const keys = new Set<string>();
  forEachArray(field(record, "metrics"), state, pathFor(path, "metrics"), (metric, index) => {
    const metricPath = pathFor(pathFor(path, "metrics"), index);
    const metricRecord = plainRecord(metric, state, metricPath);
    if (metricRecord === undefined) return;
    exactFields(
      metricRecord,
      ["key", "label", "value", "display", "unit", "coverage"],
      state,
      metricPath,
      ["unit", "coverage"],
    );
    const key = field(metricRecord, "key");
    if (typeof key !== "string" || key.length === 0) {
      issue(state, "shape", pathFor(metricPath, "key"), "a summary metric key must be a non-empty string");
    } else if (keys.has(key)) {
      issue(state, "shape", pathFor(metricPath, "key"), "summary metric keys must be unique");
    } else {
      keys.add(key);
      validateString(key, state, pathFor(metricPath, "key"));
    }
    validateString(field(metricRecord, "label"), state, pathFor(metricPath, "label"));
    validateDisplayValue(metricRecord, state, metricPath);
  });
}

function validateRankedBars(
  record: Record<string, unknown>,
  state: ValidationState,
  path: readonly (string | number)[],
): void {
  exactFields(record, ["type", "title", "layout", "points", "better"], state, path);
  validateString(field(record, "title"), state, pathFor(path, "title"));
  if (field(record, "layout") !== "horizontal") {
    issue(state, "chart", pathFor(path, "layout"), "ranked bars require horizontal layout");
  }
  if (field(record, "better") !== "higher" && field(record, "better") !== "lower") {
    issue(state, "chart", pathFor(path, "better"), "ranked bars better must be higher or lower");
  }
  const keys = new Set<string>();
  forEachArray(field(record, "points"), state, pathFor(path, "points"), (point, index) => {
    const pointPath = pathFor(pathFor(path, "points"), index);
    const pointRecord = plainRecord(point, state, pointPath);
    if (pointRecord === undefined) return;
    exactFields(
      pointRecord,
      ["key", "label", "series", "value", "display", "coverage"],
      state,
      pointPath,
    );
    const key = field(pointRecord, "key");
    if (typeof key !== "string" || key.length === 0) {
      issue(state, "chart", pathFor(pointPath, "key"), "a ranked-bar point key must be a non-empty string");
    } else if (keys.has(key)) {
      issue(state, "chart", pathFor(pointPath, "key"), "ranked-bar point keys must be unique");
    } else {
      keys.add(key);
      validateString(key, state, pathFor(pointPath, "key"));
    }
    validateString(field(pointRecord, "label"), state, pathFor(pointPath, "label"));
    validateString(field(pointRecord, "series"), state, pathFor(pointPath, "series"));
    validateNullableFiniteNumber(field(pointRecord, "value"), state, pathFor(pointPath, "value"));
    validateString(field(pointRecord, "display"), state, pathFor(pointPath, "display"));
    validateCoverage(field(pointRecord, "coverage"), state, pathFor(pointPath, "coverage"));
  });
}

function validateScatter(
  record: Record<string, unknown>,
  state: ValidationState,
  path: readonly (string | number)[],
): void {
  exactFields(record, ["type", "title", "xLabel", "yLabel", "connect", "series"], state, path);
  validateString(field(record, "title"), state, pathFor(path, "title"));
  validateString(field(record, "xLabel"), state, pathFor(path, "xLabel"));
  validateString(field(record, "yLabel"), state, pathFor(path, "yLabel"));
  if (typeof field(record, "connect") !== "boolean") {
    issue(state, "chart", pathFor(path, "connect"), "scatter connect must be a boolean");
  }
  const seriesLabels = new Set<string>();
  forEachArray(field(record, "series"), state, pathFor(path, "series"), (series, index) => {
    const seriesPath = pathFor(pathFor(path, "series"), index);
    const seriesRecord = plainRecord(series, state, seriesPath);
    if (seriesRecord === undefined) return;
    exactFields(seriesRecord, ["label", "points"], state, seriesPath);
    const label = field(seriesRecord, "label");
    if (typeof label !== "string" || label.length === 0) {
      issue(state, "chart", pathFor(seriesPath, "label"), "a scatter series label must be a non-empty string");
    } else if (seriesLabels.has(label)) {
      issue(state, "chart", pathFor(seriesPath, "label"), "scatter series labels must be unique");
    } else {
      seriesLabels.add(label);
      validateString(label, state, pathFor(seriesPath, "label"));
    }
    const pointKeys = new Set<string>();
    forEachArray(field(seriesRecord, "points"), state, pathFor(seriesPath, "points"), (point, pointIndex) => {
      const pointPath = pathFor(pathFor(seriesPath, "points"), pointIndex);
      const pointRecord = plainRecord(point, state, pointPath);
      if (pointRecord === undefined) return;
      exactFields(
        pointRecord,
        ["key", "x", "y", "xDisplay", "yDisplay", "target"],
        state,
        pointPath,
        ["target"],
      );
      const key = field(pointRecord, "key");
      if (typeof key !== "string" || key.length === 0) {
        issue(state, "chart", pathFor(pointPath, "key"), "a scatter point key must be a non-empty string");
      } else if (pointKeys.has(key)) {
        issue(state, "chart", pathFor(pointPath, "key"), "scatter point keys must be unique within a series");
      } else {
        pointKeys.add(key);
        validateString(key, state, pathFor(pointPath, "key"));
      }
      validateNullableFiniteNumber(field(pointRecord, "x"), state, pathFor(pointPath, "x"));
      validateNullableFiniteNumber(field(pointRecord, "y"), state, pathFor(pointPath, "y"));
      validateString(field(pointRecord, "xDisplay"), state, pathFor(pointPath, "xDisplay"));
      validateString(field(pointRecord, "yDisplay"), state, pathFor(pointPath, "yDisplay"));
      if (hasField(pointRecord, "target")) {
        validateLinkTarget(field(pointRecord, "target"), state, pathFor(pointPath, "target"));
      }
    });
  });
}

function validateTreeTable(
  record: Record<string, unknown>,
  state: ValidationState,
  path: readonly (string | number)[],
): void {
  exactFields(record, ["type", "caption", "columns", "rows"], state, path);
  validateString(field(record, "caption"), state, pathFor(path, "caption"));
  const columnKeys = validateTreeColumns(field(record, "columns"), state, pathFor(path, "columns"));
  const rowKeys = new Set<string>();
  let hasExperiment = false;
  let hasEval = false;
  forEachArray(field(record, "rows"), state, pathFor(path, "rows"), (row, index) => {
    const rowPath = pathFor(pathFor(path, "rows"), index);
    const rowRecord = plainRecord(row, state, rowPath);
    if (rowRecord === undefined) return;
    exactFields(
      rowRecord,
      ["key", "kind", "depth", "label", "target", "cells"],
      state,
      rowPath,
      ["target"],
    );
    const key = field(rowRecord, "key");
    if (typeof key !== "string" || key.length === 0) {
      issue(state, "table", pathFor(rowPath, "key"), "a tree-table row key must be a non-empty string");
    } else if (rowKeys.has(key)) {
      issue(state, "table", pathFor(rowPath, "key"), "tree-table row keys must be unique");
    } else {
      rowKeys.add(key);
      validateString(key, state, pathFor(rowPath, "key"));
    }
    const kind = field(rowRecord, "kind");
    const depth = field(rowRecord, "depth");
    if (!isTreeRowKind(kind)) {
      issue(state, "table", pathFor(rowPath, "kind"), "a tree-table row kind is not recognized");
    }
    if (depth !== 0 && depth !== 1 && depth !== 2) {
      issue(state, "table", pathFor(rowPath, "depth"), "a tree-table row depth must be 0, 1, or 2");
    }
    if (isTreeRowKind(kind) && (depth === 0 || depth === 1 || depth === 2) && treeDepthForKind(kind) !== depth) {
      issue(state, "table", rowPath, "tree-table row kind and depth must describe Experiment, Eval, or Attempt hierarchy");
    }
    if (depth === 0) {
      hasExperiment = true;
      hasEval = false;
    } else if (depth === 1) {
      if (!hasExperiment) {
        issue(state, "table", rowPath, "an Eval row must follow an Experiment row");
      }
      hasEval = true;
    } else if (depth === 2 && !hasEval) {
      issue(state, "table", rowPath, "an Attempt row must follow an Eval row");
    }
    validateString(field(rowRecord, "label"), state, pathFor(rowPath, "label"));
    if (hasField(rowRecord, "target")) {
      validateLinkTarget(field(rowRecord, "target"), state, pathFor(rowPath, "target"));
    }
    validateTreeCells(field(rowRecord, "cells"), columnKeys, state, pathFor(rowPath, "cells"));
  });
}

function validateTreeColumns(
  value: unknown,
  state: ValidationState,
  path: readonly (string | number)[],
): ReadonlySet<string> {
  const keys = new Set<string>();
  forEachArray(value, state, path, (column, index) => {
    const columnPath = pathFor(path, index);
    const columnRecord = plainRecord(column, state, columnPath);
    if (columnRecord === undefined) return;
    exactFields(columnRecord, ["key", "label", "align"], state, columnPath, ["align"]);
    const key = field(columnRecord, "key");
    if (typeof key !== "string" || key.length === 0) {
      issue(state, "table", pathFor(columnPath, "key"), "a tree-table column key must be a non-empty string");
    } else if (keys.has(key)) {
      issue(state, "table", pathFor(columnPath, "key"), "tree-table column keys must be unique");
    } else {
      keys.add(key);
      validateString(key, state, pathFor(columnPath, "key"));
    }
    validateString(field(columnRecord, "label"), state, pathFor(columnPath, "label"));
    if (hasField(columnRecord, "align") && field(columnRecord, "align") !== "start" && field(columnRecord, "align") !== "end") {
      issue(state, "table", pathFor(columnPath, "align"), "a tree-table column alignment must be start or end");
    }
  });
  return keys;
}

function validateTreeCells(
  value: unknown,
  columnKeys: ReadonlySet<string>,
  state: ValidationState,
  path: readonly (string | number)[],
): void {
  const cells = plainRecord(value, state, path);
  if (cells === undefined) return;
  const keys = Object.keys(cells);
  if (keys.length !== columnKeys.size || keys.some((key) => !columnKeys.has(key))) {
    issue(state, "table", path, "tree-table row cells must exactly match the columns");
  }
  for (const key of keys) {
    validateTreeCell(field(cells, key), state, pathFor(path, key));
  }
}

function validateTreeCell(
  value: unknown,
  state: ValidationState,
  path: readonly (string | number)[],
): void {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    validateScalar(value, state, path);
    return;
  }
  const record = plainRecord(value, state, path);
  if (record === undefined) return;
  exactFields(record, ["value", "display", "unit", "coverage"], state, path, ["unit", "coverage"]);
  validateDisplayValue(record, state, path);
}

function validateDisplayValue(
  record: Record<string, unknown>,
  state: ValidationState,
  path: readonly (string | number)[],
): void {
  validateScalar(field(record, "value"), state, pathFor(path, "value"));
  validateString(field(record, "display"), state, pathFor(path, "display"));
  optionalString(record, "unit", state, path);
  if (hasField(record, "coverage")) {
    validateCoverage(field(record, "coverage"), state, pathFor(path, "coverage"));
  }
}

function validateCoverage(
  value: unknown,
  state: ValidationState,
  path: readonly (string | number)[],
): void {
  const record = plainRecord(value, state, path);
  if (record === undefined) return;
  exactFields(record, ["basis", "samples", "total"], state, path);
  if (field(record, "basis") !== "eval") {
    issue(state, "shape", pathFor(path, "basis"), "coverage basis must be eval");
  }
  const samples = field(record, "samples");
  const total = field(record, "total");
  validateCount(samples, state, pathFor(path, "samples"));
  validateCount(total, state, pathFor(path, "total"));
  if (isCount(samples) && isCount(total) && samples > total) {
    issue(state, "shape", path, "coverage samples cannot exceed total");
  }
}

function validateNullableFiniteNumber(
  value: unknown,
  state: ValidationState,
  path: readonly (string | number)[],
): void {
  if (value === null) return;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    issue(state, "number", path, "this semantic field must be a finite number or null");
  }
}

function validateEpochMillisOrNull(
  value: unknown,
  state: ValidationState,
  path: readonly (string | number)[],
): void {
  if (value === null) return;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    issue(state, "number", path, "lastRunAt must be a non-negative safe Unix-epoch millisecond value or null");
  }
}

function validateCount(
  value: unknown,
  state: ValidationState,
  path: readonly (string | number)[],
): void {
  if (!isCount(value)) {
    issue(state, "number", path, "a coverage count must be a non-negative safe integer");
  }
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isTreeRowKind(value: unknown): value is ReportTreeRowKind {
  return value === "experiment" || value === "eval" || value === "attempt";
}

function treeDepthForKind(kind: ReportTreeRowKind): 0 | 1 | 2 {
  switch (kind) {
    case "experiment":
      return 0;
    case "eval":
      return 1;
    case "attempt":
      return 2;
  }
}

function validateLinkTarget(
  value: unknown,
  state: ValidationState,
  path: readonly (string | number)[],
): void {
  const record = plainRecord(value, state, path);
  if (record === undefined) {
    return;
  }
  const kind = field(record, "kind");
  if (kind === "route") {
    exactFields(record, ["kind", "route"], state, path);
    const target = field(record, "route");
    if (!isReportRoute(target)) {
      issue(state, "link", pathFor(path, "route"), "a route link must use a valid ReportRoute");
    } else if (state.closure.routes !== undefined && !state.closure.routes.has(target)) {
      issue(state, "link", pathFor(path, "route"), "the route link is absent from this execution");
    }
    return;
  }
  if (kind === "download") {
    exactFields(record, ["kind", "path"], state, path);
    const target = field(record, "path");
    if (!isReportDownloadPath(target)) {
      issue(state, "link", pathFor(path, "path"), "a download link must use a valid ReportDownloadPath");
    } else if (state.closure.downloads !== undefined && !state.closure.downloads.has(target)) {
      issue(state, "link", pathFor(path, "path"), "the download link is absent from this execution");
    }
    return;
  }
  if (kind === "external") {
    validateExternalTargetRecord(record, state, path);
    return;
  }
  if (kind === "attempt") {
    exactFields(record, ["kind", "locator"], state, path);
    const locator = field(record, "locator");
    if (!isAttemptLocator(locator)) {
      issue(
        state,
        "link",
        pathFor(path, "locator"),
        "an attempt link must use the exact @<AttemptId> locator form",
      );
    } else {
      validateString(locator, state, pathFor(path, "locator"));
    }
    return;
  }
  issue(
    state,
    "link",
    pathFor(path, "kind"),
    "a link target must be a route, download, external https URL, or attempt",
  );
}

function validateExternalTarget(
  value: unknown,
  state: ValidationState,
  path: readonly (string | number)[],
): void {
  const record = plainRecord(value, state, path);
  if (record === undefined) return;
  if (field(record, "kind") !== "external") {
    issue(state, "link", pathFor(path, "kind"), "a hero link target must be an external https URL");
    return;
  }
  validateExternalTargetRecord(record, state, path);
}

function validateExternalTargetRecord(
  record: Record<string, unknown>,
  state: ValidationState,
  path: readonly (string | number)[],
): void {
  exactFields(record, ["kind", "href"], state, path);
  const href = field(record, "href");
  if (!isExternalHttpsHref(href)) {
    issue(
      state,
      "link",
      pathFor(path, "href"),
      "an external link must be an absolute https URL",
    );
    return;
  }
  validateString(href, state, pathFor(path, "href"));
}

function isExternalHttpsHref(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || /[\s\u0000-\u001f\u007f-\u009f]/.test(value)) {
    return false;
  }
  if (!/^https:\/\//i.test(value)) {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.length > 0;
  } catch {
    return false;
  }
}

function isAttemptLocator(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("@") && isPortableSegment(value.slice(1));
}

function enterNode(
  value: unknown,
  state: ValidationState,
  path: readonly (string | number)[],
  depth: number,
): Record<string, unknown> | undefined {
  if (depth > REPORT_DOCUMENT_DEPTH_MAX) {
    issue(state, "limit", path, `a document may be at most ${REPORT_DOCUMENT_DEPTH_MAX} nodes deep`);
    return undefined;
  }
  const record = plainRecord(value, state, path);
  if (record === undefined) {
    return undefined;
  }
  if (state.active.has(record)) {
    issue(state, "cycle", path, "a semantic document cannot contain a cycle");
    return undefined;
  }
  state.nodeCount += 1;
  if (state.nodeCount > REPORT_DOCUMENT_NODES_MAX) {
    issue(state, "limit", path, `a document may contain at most ${REPORT_DOCUMENT_NODES_MAX} nodes`);
    return undefined;
  }
  state.active.add(record);
  return record;
}

function plainRecord(
  value: unknown,
  state: ValidationState,
  path: readonly (string | number)[],
): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    issue(state, "shape", path, "a semantic node must be a plain object");
    return undefined;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    issue(state, "shape", path, "a semantic node must be a plain object");
    return undefined;
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") {
      issue(state, "shape", path, "semantic nodes cannot contain symbol fields");
      return undefined;
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
      issue(state, "shape", pathFor(path, key), "semantic nodes cannot contain accessors or hidden fields");
      return undefined;
    }
  }
  return value as Record<string, unknown>;
}

function exactFields(
  record: Record<string, unknown>,
  allowed: readonly string[],
  state: ValidationState,
  path: readonly (string | number)[],
  optional: readonly string[] = [],
): void {
  const allowedFields = new Set(allowed);
  const optionalFields = new Set(optional);
  for (const key of Object.keys(record)) {
    if (!allowedFields.has(key)) {
      issue(state, "shape", pathFor(path, key), "this field is not part of ReportDocument");
    }
  }
  for (const key of allowed) {
    if (!hasField(record, key) && !optionalFields.has(key)) {
      issue(state, "shape", pathFor(path, key), "a required semantic field is missing");
    }
  }
}

function field(record: Record<string, unknown>, key: string): unknown {
  return Object.getOwnPropertyDescriptor(record, key)?.value;
}

function hasField(record: Record<string, unknown>, key: string): boolean {
  return Object.hasOwn(record, key);
}

function optionalString(
  record: Record<string, unknown>,
  key: string,
  state: ValidationState,
  path: readonly (string | number)[],
): void {
  if (hasField(record, key)) {
    validateString(field(record, key), state, pathFor(path, key));
  }
}

function validateScalar(
  value: unknown,
  state: ValidationState,
  path: readonly (string | number)[],
): void {
  if (value === null || typeof value === "boolean") {
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      issue(state, "number", path, "numbers in a semantic document must be finite");
    }
    return;
  }
  validateString(value, state, path);
}

function validateString(
  value: unknown,
  state: ValidationState,
  path: readonly (string | number)[],
): void {
  if (typeof value !== "string") {
    issue(state, "shape", path, "this semantic field must be a string");
    return;
  }
  if (!hasOnlyUnicodeScalars(value)) {
    issue(state, "unicode", path, "strings in a semantic document must contain Unicode scalar values");
    return;
  }
  state.stringBytes += encoder.encode(value).byteLength;
}

function forEachArray(
  value: unknown,
  state: ValidationState,
  path: readonly (string | number)[],
  visit: (item: unknown, index: number) => void,
): void {
  const values = arrayValue(value, state, path);
  values?.forEach(visit);
}

function arrayValue(
  value: unknown,
  state: ValidationState,
  path: readonly (string | number)[],
): readonly unknown[] | undefined {
  if (!Array.isArray(value)) {
    issue(state, "shape", path, "this semantic field must be an array");
    return undefined;
  }
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !("value" in descriptor)) {
      issue(state, "shape", pathFor(path, index), "semantic arrays cannot contain holes or accessors");
      return undefined;
    }
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === "symbol" || (key !== "length" && !isArrayIndex(key))) {
      issue(state, "shape", path, "semantic arrays cannot contain custom fields");
      return undefined;
    }
  }
  return value;
}

function issue(
  state: ValidationState,
  code: ReportDocumentIssue["code"],
  path: readonly (string | number)[],
  reason: string,
): void {
  if (state.issues.length >= MAX_ISSUES) {
    return;
  }
  state.issues.push(Object.freeze({ code, path: Object.freeze([...path]), reason }));
}

function pathFor(
  path: readonly (string | number)[],
  segment: string | number,
): readonly (string | number)[] {
  return [...path, segment];
}

function isArrayIndex(value: string): boolean {
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) {
    return false;
  }
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 && number < 2 ** 32 - 1;
}

function isTone(value: unknown): value is ReportStatus["tone"] {
  return value === "neutral" || value === "positive" || value === "warning" || value === "negative";
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

function freezeArray<Value>(values: readonly Value[]): readonly Value[] {
  return Object.freeze([...values]);
}

function cloneDocument(document: ReportDocument): ReportDocument {
  return Object.freeze({
    title: document.title,
    children: Object.freeze(document.children.map(cloneBlock)),
    ...(document.presentation === undefined ? {} : { presentation: document.presentation }),
    ...(document.metadataOrigin === undefined ? {} : { metadataOrigin: document.metadataOrigin }),
  });
}

function cloneBlock(block: ReportBlock): ReportBlock {
  switch (block.type) {
    case "section":
      return Object.freeze({
        type: "section" as const,
        heading: block.heading,
        ...(block.meta === undefined ? {} : { meta: block.meta }),
        children: Object.freeze(block.children.map(cloneBlock)),
      });
    case "grid":
      return Object.freeze({
        type: "grid" as const,
        cells: Object.freeze(block.cells.map(cloneBlock)),
      });
    case "stat":
      return Object.freeze({
        type: "stat" as const,
        label: block.label,
        value: block.value,
        ...(block.tone === undefined ? {} : { tone: block.tone }),
      });
    case "cell-table":
      return Object.freeze({
        type: "cell-table" as const,
        columns: freezeArray(block.columns),
        rows: Object.freeze(block.rows.map((row) => Object.freeze({
          key: row.key,
          cells: Object.freeze({ ...row.cells }),
        }))),
      });
    case "paragraph":
      return Object.freeze({
        type: "paragraph" as const,
        children: Object.freeze(block.children.map(cloneInline)),
      });
    case "list":
      return Object.freeze({
        type: "list" as const,
        ordered: block.ordered,
        items: Object.freeze(block.items.map((item) => Object.freeze(item.map(cloneBlock)))),
      });
    case "table":
      return Object.freeze({
        type: "table" as const,
        caption: block.caption,
        columns: Object.freeze(block.columns.map((column) => Object.freeze({ ...column }))),
        rows: Object.freeze(block.rows.map(cloneRow)),
      });
    case "metric":
      return Object.freeze({
        type: "metric" as const,
        label: block.label,
        value: block.value,
        ...(block.unit === undefined ? {} : { unit: block.unit }),
      });
    case "status":
      return Object.freeze({
        type: "status" as const,
        tone: block.tone,
        label: block.label,
        ...(block.detail === undefined
          ? {}
          : { detail: Object.freeze(block.detail.map(cloneInline)) }),
      });
    case "code-block":
      return Object.freeze({
        type: "code-block" as const,
        value: block.value,
        ...(block.language === undefined ? {} : { language: block.language }),
      });
    case "chart":
      return Object.freeze({
        type: "chart" as const,
        chart: block.chart,
        title: block.title,
        categoryLabel: block.categoryLabel,
        categories: freezeArray(block.categories),
        series: Object.freeze(
          block.series.map((series) =>
            Object.freeze({ label: series.label, values: freezeArray(series.values) })
          ),
        ),
      });
    case "hero":
      return reportHero({
        ...(block.title === undefined ? {} : { title: block.title }),
        ...(block.logo === undefined ? {} : { logo: block.logo }),
        description: block.description,
        links: block.links,
        ...(block.lastRunAt === undefined ? {} : { lastRunAt: block.lastRunAt }),
        ...(block.runCount === undefined ? {} : { runCount: block.runCount }),
      });
    case "summary":
      return reportSummary({ lastRunAt: block.lastRunAt, metrics: block.metrics });
    case "ranked-bars":
      return reportRankedBars({
        title: block.title,
        layout: block.layout,
        points: block.points,
        better: block.better,
      });
    case "scatter":
      return reportScatter({
        title: block.title,
        xLabel: block.xLabel,
        yLabel: block.yLabel,
        connect: block.connect,
        series: block.series,
      });
    case "tree-table":
      return reportTreeTable({
        caption: block.caption,
        columns: block.columns,
        rows: block.rows,
      });
  }
}

function cloneInline(inline: ReportInline): ReportInline {
  switch (inline.type) {
    case "text":
    case "code":
      return Object.freeze({ type: inline.type, value: inline.value });
    case "emphasis":
      return Object.freeze({
        type: "emphasis" as const,
        children: Object.freeze(inline.children.map(cloneInline)),
      });
    case "link":
      return Object.freeze({
        type: "link" as const,
        label: Object.freeze(inline.label.map(cloneInline)),
        target: cloneLinkTarget(inline.target),
      });
  }
}

function cloneLinkTarget(target: ReportLinkTarget): ReportLinkTarget {
  switch (target.kind) {
    case "route":
      return Object.freeze({ kind: "route" as const, route: target.route });
    case "download":
      return Object.freeze({ kind: "download" as const, path: target.path });
    case "external":
      return Object.freeze({ kind: "external" as const, href: target.href });
    case "attempt":
      return Object.freeze({ kind: "attempt" as const, locator: target.locator });
  }
}

function cloneCoverage(coverage: ReportCoverage): ReportCoverage {
  return Object.freeze({
    basis: coverage.basis,
    samples: coverage.samples,
    total: coverage.total,
  });
}

function cloneDisplayValue(value: ReportDisplayValue): ReportDisplayValue {
  return Object.freeze({
    value: value.value,
    display: value.display,
    ...(value.unit === undefined ? {} : { unit: value.unit }),
    ...(value.coverage === undefined ? {} : { coverage: cloneCoverage(value.coverage) }),
  });
}

function cloneTreeCells(
  cells: Readonly<Record<string, ReportTreeCell>>,
): Readonly<Record<string, ReportTreeCell>> {
  const copy: Record<string, ReportTreeCell> = Object.create(null) as Record<string, ReportTreeCell>;
  for (const key of Object.keys(cells)) {
    const cell = cells[key]!;
    copy[key] = isReportDisplayValue(cell) ? cloneDisplayValue(cell) : cell;
  }
  return Object.freeze(copy);
}

function isReportDisplayValue(value: ReportTreeCell): value is ReportDisplayValue {
  return typeof value === "object" && value !== null;
}

function cloneRow(
  row: Readonly<Record<string, ReportScalar>>,
): Readonly<Record<string, ReportScalar>> {
  const copy: Record<string, ReportScalar> = Object.create(null) as Record<
    string,
    ReportScalar
  >;
  for (const key of Object.keys(row)) {
    copy[key] = row[key];
  }
  return Object.freeze(copy);
}
