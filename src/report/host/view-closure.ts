// The host-private ViewRevisionClosure pairs the English and Simplified
// Chinese executions produced from one frozen Record selection, Report,
// Config, and Theme closure. It is deliberately not exported through
// niceeval/report: browser hosts own the pairing, authors never see it.
//
// A closure is only ever created after an isomorphism check. Business
// payloads must be identical: report/page IDs, routes, selection identities,
// row keys and parents, entity targets, numbers, coverage, states, problems,
// downloads bytes. Only explicitly listed presentation slots (resolved
// localized copy and locale-formatted display strings) may differ.

import { Either } from "effect";
import type { ReportExecution } from "../execution/model.ts";
import type { ReportProblem } from "../execution/problems.ts";
import type { ReportBlock, ReportInline } from "../semantic/document.ts";

const viewRevisionClosureTypeId: unique symbol = Symbol(
  "@niceeval/report/ViewRevisionClosure",
);

/** Two isomorphic locale executions from the same frozen build inputs. */
export interface ViewRevisionClosure {
  readonly en: ReportExecution;
  readonly "zh-CN": ReportExecution;
  readonly [viewRevisionClosureTypeId]: () => void;
}

export interface ReportViewClosureInvalid {
  readonly code: "report-view-closure-invalid";
  readonly path: readonly string[];
  readonly reason: string;
}

export type ReportViewClosureError = ReportViewClosureInvalid;

const closures = new WeakMap<object, true>();

/**
 * Validates that two locale executions carry the same business payload and
 * semantic shape, then brands the frozen closure. Validation failure is a
 * typed host error: the caller must keep its last-good revision and never
 * publish a half-localized or mixed closure.
 */
export function makeViewRevisionClosure(input: {
  readonly en: ReportExecution;
  readonly "zh-CN": ReportExecution;
}): Either.Either<ViewRevisionClosure, ReportViewClosureInvalid> {
  const en = input.en;
  const zhCN = input["zh-CN"];
  try {
    if (en.locale !== "en" || zhCN.locale !== "zh-CN") {
      throw closureInvalid(["locale"], "a view closure must pair one English and one Simplified Chinese execution");
    }
    if (en.reportId !== zhCN.reportId) {
      throw closureInvalid(["reportId"], "the two executions must belong to the same Report");
    }
    compareExact(en.sample, zhCN.sample, ["sample"]);
    compareProjections(en, zhCN);
    compareCalculations(en, zhCN);
    compareFamilies(en, zhCN);
    comparePages(en, zhCN);
    compareNavigation(en, zhCN);
    compareDownloads(en, zhCN);
    compareProblemTables(en, zhCN);
    const closure = Object.freeze({
      en,
      "zh-CN": zhCN,
      [viewRevisionClosureTypeId]: (): void => undefined,
    }) as ViewRevisionClosure;
    closures.set(closure, true);
    return Either.right(closure);
  } catch (error) {
    if (error instanceof ClosureInvalidError) {
      return Either.left(error.value);
    }
    throw error;
  }
}

export function isViewRevisionClosure(value: unknown): value is ViewRevisionClosure {
  return typeof value === "object" && value !== null && closures.has(value);
}

/**
 * Exact structural comparison for business payloads: numbers, booleans,
 * strings, identities, keys, and byte arrays must match exactly.
 */
function compareExact(en: unknown, zhCN: unknown, path: readonly string[]): void {
  if (en === zhCN) return;
  if (typeof en === "number" && typeof zhCN === "number") {
    if (en !== zhCN || !Number.isFinite(en)) {
      throw closureInvalid(path, "numeric business payloads must be identical finite numbers");
    }
    return;
  }
  if (typeof en === "string" && typeof zhCN === "string") {
    if (en !== zhCN) {
      throw closureInvalid(path, "non-localized strings must be identical");
    }
    return;
  }
  if (typeof en === "boolean" && typeof zhCN === "boolean") {
    if (en !== zhCN) {
      throw closureInvalid(path, "boolean values must be identical");
    }
    return;
  }
  if (ArrayBuffer.isView(en) && ArrayBuffer.isView(zhCN)) {
    const left = new Uint8Array(en.buffer, en.byteOffset, en.byteLength);
    const right = new Uint8Array(zhCN.buffer, zhCN.byteOffset, zhCN.byteLength);
    if (left.byteLength !== right.byteLength) {
      throw closureInvalid(path, "byte payloads must have identical length");
    }
    for (let index = 0; index < left.byteLength; index += 1) {
      if (left[index] !== right[index]) {
        throw closureInvalid(path, "byte payloads must be identical");
      }
    }
    return;
  }
  if (Array.isArray(en) && Array.isArray(zhCN)) {
    if (en.length !== zhCN.length) {
      throw closureInvalid(path, "arrays must have identical length");
    }
    for (let index = 0; index < en.length; index += 1) {
      compareExact(en[index], zhCN[index], [...path, String(index)]);
    }
    return;
  }
  if (isPlainDataObject(en) && isPlainDataObject(zhCN)) {
    const enKeys = Object.keys(en).sort();
    const zhCNKeys = Object.keys(zhCN).sort();
    if (enKeys.length !== zhCNKeys.length || enKeys.some((key, index) => key !== zhCNKeys[index])) {
      throw closureInvalid(path, "objects must have identical enumerable keys");
    }
    for (const key of enKeys) {
      compareExact(Reflect.get(en, key), Reflect.get(zhCN, key), [...path, key]);
    }
    return;
  }
  throw closureInvalid(path, "a business payload changed shape between locales");
}

/** A string slot that may legitimately carry resolved localized copy (or be absent in both). */
function compareLocalizedString(en: unknown, zhCN: unknown, path: readonly string[]): void {
  if (en === undefined && zhCN === undefined) return;
  if (typeof en === "string" && typeof zhCN === "string") return;
  throw closureInvalid(path, "a localized presentation slot must be a string in both locales");
}

function compareDisplayValue(en: unknown, zhCN: unknown, path: readonly string[]): void {
  if (!isPlainDataObject(en) || !isPlainDataObject(zhCN)) {
    throw closureInvalid(path, "a display value must be an object in both locales");
  }
  const enKeys = Object.keys(en).sort();
  const zhCNKeys = Object.keys(zhCN).sort();
  if (enKeys.length !== zhCNKeys.length || enKeys.some((key, index) => key !== zhCNKeys[index])) {
    throw closureInvalid(path, "display values must have identical enumerable keys");
  }
  for (const key of enKeys) {
    // Only the author-provided display string and summary labels are
    // localized slots; the raw scalar value, unit, and coverage receipt are
    // business payload and must match exactly.
    if (key === "display" || key === "label") {
      compareLocalizedString(Reflect.get(en, key), Reflect.get(zhCN, key), [...path, key]);
    } else {
      compareExact(Reflect.get(en, key), Reflect.get(zhCN, key), [...path, key]);
    }
  }
}

function compareTarget(en: unknown, zhCN: unknown, path: readonly string[]): void {
  if (en === undefined && zhCN === undefined) return;
  if (!isPlainDataObject(en) || !isPlainDataObject(zhCN)) {
    throw closureInvalid(path, "an entity target must be an object in both locales");
  }
  compareExact(en, zhCN, path);
}

function compareInlines(en: readonly ReportInline[], zhCN: readonly ReportInline[], path: readonly string[]): void {
  if (en.length !== zhCN.length) {
    throw closureInvalid(path, "inline content must have identical length");
  }
  for (let index = 0; index < en.length; index += 1) {
    const nodePath = [...path, String(index)];
    const left = en[index]!;
    const right = zhCN[index]!;
    if (left.type !== right.type) {
      throw closureInvalid(nodePath, "inline node kinds must match between locales");
    }
    switch (left.type) {
      case "text":
        compareLocalizedString(left.value, (right as typeof left).value, [...nodePath, "value"]);
        break;
      case "code":
        compareExact(left.value, (right as typeof left).value, [...nodePath, "value"]);
        break;
      case "emphasis":
        compareInlines(left.children, (right as typeof left).children, [...nodePath, "children"]);
        break;
      case "link": {
        const rightLink = right as typeof left;
        compareInlines(left.label, rightLink.label, [...nodePath, "label"]);
        compareTarget(left.target, rightLink.target, [...nodePath, "target"]);
        break;
      }
    }
  }
}

function compareBlocks(en: readonly ReportBlock[], zhCN: readonly ReportBlock[], path: readonly string[]): void {
  if (en.length !== zhCN.length) {
    throw closureInvalid(path, "block content must have identical length");
  }
  for (let index = 0; index < en.length; index += 1) {
    compareBlock(en[index]!, zhCN[index]!, [...path, String(index)]);
  }
}

function compareBlockList(
  en: readonly (readonly ReportBlock[])[],
  zhCN: readonly (readonly ReportBlock[])[],
  path: readonly string[],
): void {
  if (en.length !== zhCN.length) {
    throw closureInvalid(path, "list items must have identical length");
  }
  for (let index = 0; index < en.length; index += 1) {
    compareBlocks(en[index]!, zhCN[index]!, [...path, String(index)]);
  }
}

/**
 * Per-block-type allow-list comparison. Every slot not explicitly listed as
 * localized copy is compared exactly; identity keys, routes, targets, kinds,
 * and numbers can never differ between locales.
 */
function compareBlock(en: ReportBlock, zhCN: ReportBlock, path: readonly string[]): void {
  const enKeys = Object.keys(en).sort();
  const zhCNKeys = Object.keys(zhCN).sort();
  if (enKeys.length !== zhCNKeys.length || enKeys.some((key, index) => key !== zhCNKeys[index])) {
    throw closureInvalid(path, "semantic blocks must have identical enumerable keys");
  }
  if (en.type !== zhCN.type) {
    throw closureInvalid(path, "semantic block kinds must match between locales");
  }
  switch (en.type) {
    case "section": {
      const right = zhCN as typeof en;
      compareLocalizedString(en.heading, right.heading, [...path, "heading"]);
      compareLocalizedString(en.meta, right.meta, [...path, "meta"]);
      compareBlocks(en.children, right.children, [...path, "children"]);
      return;
    }
    case "paragraph": {
      const right = zhCN as typeof en;
      compareInlines(en.children, right.children, [...path, "children"]);
      return;
    }
    case "list": {
      const right = zhCN as typeof en;
      compareExact(en.ordered, right.ordered, [...path, "ordered"]);
      compareBlockList(en.items, right.items, [...path, "items"]);
      return;
    }
    case "table": {
      const right = zhCN as typeof en;
      compareLocalizedString(en.caption, right.caption, [...path, "caption"]);
      if (en.columns.length !== right.columns.length) {
        throw closureInvalid([...path, "columns"], "table columns must have identical length");
      }
      for (let index = 0; index < en.columns.length; index += 1) {
        const leftColumn = en.columns[index]!;
        const rightColumn = right.columns[index]!;
        compareExact(leftColumn.key, rightColumn.key, [...path, "columns", String(index), "key"]);
        compareLocalizedString(leftColumn.label, rightColumn.label, [...path, "columns", String(index), "label"]);
        compareExact(leftColumn.align, rightColumn.align, [...path, "columns", String(index), "align"]);
      }
      // Plain table rows carry business values; every cell must be exact.
      compareExact(en.rows, right.rows, [...path, "rows"]);
      return;
    }
    case "metric": {
      const right = zhCN as typeof en;
      compareLocalizedString(en.label, right.label, [...path, "label"]);
      compareExact(en.value, right.value, [...path, "value"]);
      compareExact(en.unit, right.unit, [...path, "unit"]);
      return;
    }
    case "status": {
      const right = zhCN as typeof en;
      compareExact(en.tone, right.tone, [...path, "tone"]);
      compareLocalizedString(en.label, right.label, [...path, "label"]);
      if (en.detail !== undefined && right.detail !== undefined) {
        compareInlines(en.detail, right.detail, [...path, "detail"]);
      } else if (en.detail !== right.detail) {
        throw closureInvalid([...path, "detail"], "status detail presence must match between locales");
      }
      return;
    }
    case "code-block": {
      const right = zhCN as typeof en;
      compareExact(en.value, right.value, [...path, "value"]);
      compareExact(en.language, right.language, [...path, "language"]);
      return;
    }
    case "chart": {
      const right = zhCN as typeof en;
      compareExact(en.chart, right.chart, [...path, "chart"]);
      compareLocalizedString(en.title, right.title, [...path, "title"]);
      compareLocalizedString(en.categoryLabel, right.categoryLabel, [...path, "categoryLabel"]);
      compareExact(en.categories, right.categories, [...path, "categories"]);
      if (en.series.length !== right.series.length) {
        throw closureInvalid([...path, "series"], "chart series must have identical length");
      }
      for (let index = 0; index < en.series.length; index += 1) {
        const leftSeries = en.series[index]!;
        const rightSeries = right.series[index]!;
        compareLocalizedString(leftSeries.label, rightSeries.label, [...path, "series", String(index), "label"]);
        compareExact(leftSeries.values, rightSeries.values, [...path, "series", String(index), "values"]);
      }
      return;
    }
    case "hero": {
      const right = zhCN as typeof en;
      compareLocalizedString(en.title, right.title, [...path, "title"]);
      if (en.logo !== undefined && right.logo !== undefined) {
        const leftKeys = Object.keys(en.logo).sort();
        const rightKeys = Object.keys(right.logo).sort();
        if (leftKeys.length !== rightKeys.length || leftKeys.some((key, index) => key !== rightKeys[index])) {
          throw closureInvalid([...path, "logo"], "hero logos must have identical enumerable keys");
        }
        compareExact(en.logo.src, right.logo.src, [...path, "logo", "src"]);
        compareLocalizedString(en.logo.alt, right.logo.alt, [...path, "logo", "alt"]);
      } else if (en.logo !== right.logo) {
        throw closureInvalid([...path, "logo"], "hero logo presence must match between locales");
      }
      compareLocalizedString(en.description, right.description, [...path, "description"]);
      if (en.links.length !== right.links.length) {
        throw closureInvalid([...path, "links"], "hero links must have identical length");
      }
      for (let index = 0; index < en.links.length; index += 1) {
        const leftLink = en.links[index]!;
        const rightLink = right.links[index]!;
        compareLocalizedString(leftLink.label, rightLink.label, [...path, "links", String(index), "label"]);
        compareExact(leftLink.target, rightLink.target, [...path, "links", String(index), "target"]);
      }
      return;
    }
    case "summary": {
      const right = zhCN as typeof en;
      compareExact(en.lastRunAt, right.lastRunAt, [...path, "lastRunAt"]);
      if (en.metrics.length !== right.metrics.length) {
        throw closureInvalid([...path, "metrics"], "summary metrics must have identical length");
      }
      for (let index = 0; index < en.metrics.length; index += 1) {
        const leftMetric = en.metrics[index]!;
        const rightMetric = right.metrics[index]!;
        compareExact(leftMetric.key, rightMetric.key, [...path, "metrics", String(index), "key"]);
        compareLocalizedString(leftMetric.label, rightMetric.label, [...path, "metrics", String(index), "label"]);
        compareDisplayValue(leftMetric, rightMetric, [...path, "metrics", String(index)]);
      }
      return;
    }
    case "ranked-bars": {
      const right = zhCN as typeof en;
      compareLocalizedString(en.title, right.title, [...path, "title"]);
      compareExact(en.layout, right.layout, [...path, "layout"]);
      compareExact(en.better, right.better, [...path, "better"]);
      if (en.points.length !== right.points.length) {
        throw closureInvalid([...path, "points"], "ranked-bar points must have identical length");
      }
      for (let index = 0; index < en.points.length; index += 1) {
        const pointPath = [...path, "points", String(index)];
        const leftPoint = en.points[index]!;
        const rightPoint = right.points[index]!;
        compareExact(leftPoint.key, rightPoint.key, [...pointPath, "key"]);
        compareLocalizedString(leftPoint.label, rightPoint.label, [...pointPath, "label"]);
        compareLocalizedString(leftPoint.series, rightPoint.series, [...pointPath, "series"]);
        compareExact(leftPoint.value, rightPoint.value, [...pointPath, "value"]);
        compareLocalizedString(leftPoint.display, rightPoint.display, [...pointPath, "display"]);
        compareExact(leftPoint.coverage, rightPoint.coverage, [...pointPath, "coverage"]);
      }
      return;
    }
    case "scatter": {
      const right = zhCN as typeof en;
      compareLocalizedString(en.title, right.title, [...path, "title"]);
      // Axis labels are metric identity (costUSD / passRate), not localized copy.
      compareExact(en.xLabel, right.xLabel, [...path, "xLabel"]);
      compareExact(en.yLabel, right.yLabel, [...path, "yLabel"]);
      compareExact(en.connect, right.connect, [...path, "connect"]);
      compareExact(
        Reflect.get(en, "xBetter"),
        Reflect.get(right, "xBetter"),
        [...path, "xBetter"],
      );
      compareExact(
        Reflect.get(en, "yBetter"),
        Reflect.get(right, "yBetter"),
        [...path, "yBetter"],
      );
      if (en.series.length !== right.series.length) {
        throw closureInvalid([...path, "series"], "scatter series must have identical length");
      }
      for (let index = 0; index < en.series.length; index += 1) {
        const seriesPath = [...path, "series", String(index)];
        const leftSeries = en.series[index]!;
        const rightSeries = right.series[index]!;
        compareLocalizedString(leftSeries.label, rightSeries.label, [...seriesPath, "label"]);
        if (leftSeries.points.length !== rightSeries.points.length) {
          throw closureInvalid([...seriesPath, "points"], "scatter points must have identical length");
        }
        for (let pointIndex = 0; pointIndex < leftSeries.points.length; pointIndex += 1) {
          const pointPath = [...seriesPath, "points", String(pointIndex)];
          const leftPoint = leftSeries.points[pointIndex]!;
          const rightPoint = rightSeries.points[pointIndex]!;
          compareExact(leftPoint.key, rightPoint.key, [...pointPath, "key"]);
          compareExact(leftPoint.x, rightPoint.x, [...pointPath, "x"]);
          compareExact(leftPoint.y, rightPoint.y, [...pointPath, "y"]);
          compareLocalizedString(leftPoint.xDisplay, rightPoint.xDisplay, [...pointPath, "xDisplay"]);
          compareLocalizedString(leftPoint.yDisplay, rightPoint.yDisplay, [...pointPath, "yDisplay"]);
          compareTarget(leftPoint.target, rightPoint.target, [...pointPath, "target"]);
        }
      }
      return;
    }
    case "tree-table": {
      const right = zhCN as typeof en;
      compareLocalizedString(en.caption, right.caption, [...path, "caption"]);
      if (en.columns.length !== right.columns.length) {
        throw closureInvalid([...path, "columns"], "tree-table columns must have identical length");
      }
      for (let index = 0; index < en.columns.length; index += 1) {
        const leftColumn = en.columns[index]!;
        const rightColumn = right.columns[index]!;
        compareExact(leftColumn.key, rightColumn.key, [...path, "columns", String(index), "key"]);
        compareLocalizedString(leftColumn.label, rightColumn.label, [...path, "columns", String(index), "label"]);
        compareExact(leftColumn.align, rightColumn.align, [...path, "columns", String(index), "align"]);
      }
      if (en.rows.length !== right.rows.length) {
        throw closureInvalid([...path, "rows"], "tree-table rows must have identical length");
      }
      for (let index = 0; index < en.rows.length; index += 1) {
        const rowPath = [...path, "rows", String(index)];
        const leftRow = en.rows[index]!;
        const rightRow = right.rows[index]!;
        compareExact(leftRow.key, rightRow.key, [...rowPath, "key"]);
        compareExact(leftRow.kind, rightRow.kind, [...rowPath, "kind"]);
        compareExact(leftRow.depth, rightRow.depth, [...rowPath, "depth"]);
        compareLocalizedString(leftRow.label, rightRow.label, [...rowPath, "label"]);
        compareTarget(leftRow.target, rightRow.target, [...rowPath, "target"]);
        const leftCells = leftRow.cells;
        const rightCells = rightRow.cells;
        const leftCellKeys = Object.keys(leftCells).sort();
        const rightCellKeys = Object.keys(rightCells).sort();
        if (leftCellKeys.length !== rightCellKeys.length || leftCellKeys.some((key, i) => key !== rightCellKeys[i])) {
          throw closureInvalid([...rowPath, "cells"], "tree-table cells must have identical keys");
        }
        for (const key of leftCellKeys) {
          const leftCell = leftCells[key]!;
          const rightCell = rightCells[key]!;
          if (isReportDisplayCell(leftCell) && isReportDisplayCell(rightCell)) {
            compareDisplayValue(leftCell, rightCell, [...rowPath, "cells", key]);
          } else {
            compareExact(leftCell, rightCell, [...rowPath, "cells", key]);
          }
        }
      }
      return;
    }
    case "grid": {
      const right = zhCN as typeof en;
      compareBlocks(en.cells, right.cells, [...path, "cells"]);
      return;
    }
    case "stat": {
      const right = zhCN as typeof en;
      compareLocalizedString(en.label, right.label, [...path, "label"]);
      compareLocalizedString(en.value, right.value, [...path, "value"]);
      compareExact(en.tone, right.tone, [...path, "tone"]);
      return;
    }
    case "cell-table": {
      const right = zhCN as typeof en;
      compareExact(en.hierarchy, right.hierarchy, [...path, "hierarchy"]);
      if (en.columns.length !== right.columns.length) {
        throw closureInvalid([...path, "columns"], "cell-table headings must have identical length");
      }
      for (let index = 0; index < en.columns.length; index += 1) {
        compareLocalizedString(en.columns[index], right.columns[index], [...path, "columns", String(index)]);
      }
      if (en.rows.length !== right.rows.length) {
        throw closureInvalid([...path, "rows"], "cell-table rows must have identical length");
      }
      for (let index = 0; index < en.rows.length; index += 1) {
        const rowPath = [...path, "rows", String(index)];
        const leftRow = en.rows[index]!;
        const rightRow = right.rows[index]!;
        compareExact(leftRow.key, rightRow.key, [...rowPath, "key"]);
        compareExact(leftRow.kind, rightRow.kind, [...rowPath, "kind"]);
        compareExact(leftRow.parentKey, rightRow.parentKey, [...rowPath, "parentKey"]);
        compareLocalizedString(leftRow.label, rightRow.label, [...rowPath, "label"]);
        compareTarget(leftRow.target, rightRow.target, [...rowPath, "target"]);
        // Cell strings are locale-formatted display values; identity is held
        // by key/parentKey/kind/target, which were compared exactly above.
        const leftCells = leftRow.cells;
        const rightCells = rightRow.cells;
        const leftCellKeys = Object.keys(leftCells).sort();
        const rightCellKeys = Object.keys(rightCells).sort();
        if (leftCellKeys.length !== rightCellKeys.length || leftCellKeys.some((key, i) => key !== rightCellKeys[i])) {
          throw closureInvalid([...rowPath, "cells"], "cell-table cells must have identical keys");
        }
        for (const key of leftCellKeys) {
          compareLocalizedString(leftCells[key], rightCells[key], [...rowPath, "cells", key]);
        }
      }
      return;
    }
    default:
      // Unknown block shapes fail closed: nothing may drift between locales.
      compareExact(en, zhCN, path);
  }
}

function compareDocumentShape(en: unknown, zhCN: unknown, path: readonly string[]): void {
  if (!isPlainDataObject(en) || !isPlainDataObject(zhCN)) {
    throw closureInvalid(path, "a document must be an object in both locales");
  }
  const enPresentation = Reflect.get(en, "presentation");
  const zhCNPresentation = Reflect.get(zhCN, "presentation");
  compareExact(enPresentation, zhCNPresentation, [...path, "presentation"]);
  const enTitle = Reflect.get(en, "title");
  const zhCNTitle = Reflect.get(zhCN, "title");
  compareLocalizedString(enTitle, zhCNTitle, [...path, "title"]);
  const enChildren = Reflect.get(en, "children");
  const zhCNChildren = Reflect.get(zhCN, "children");
  if (!Array.isArray(enChildren) || !Array.isArray(zhCNChildren)) {
    throw closureInvalid([...path, "children"], "a document must carry block children in both locales");
  }
  compareBlocks(enChildren as ReportBlock[], zhCNChildren as ReportBlock[], [...path, "children"]);
}

function compareProjections(en: ReportExecution, zhCN: ReportExecution): void {
  if (en.projections.length !== zhCN.projections.length) {
    throw closureInvalid(["projections"], "projection summaries must have identical length");
  }
  for (let index = 0; index < en.projections.length; index += 1) {
    const path = ["projections", String(index)];
    const left = en.projections[index]!;
    const right = zhCN.projections[index]!;
    if (left.projectionId !== right.projectionId || left.inputKey !== right.inputKey) {
      throw closureInvalid(path, "projection identity must match between locales");
    }
    compareExact(left.coverage, right.coverage, [...path, "coverage"]);
    compareExact(left.problemIds, right.problemIds, [...path, "problemIds"]);
  }
}

function compareCalculations(en: ReportExecution, zhCN: ReportExecution): void {
  if (en.calculations.length !== zhCN.calculations.length) {
    throw closureInvalid(["calculations"], "calculation results must have identical length");
  }
  for (let index = 0; index < en.calculations.length; index += 1) {
    const path = ["calculations", String(index)];
    const left = en.calculations[index]!;
    const right = zhCN.calculations[index]!;
    if (left.state !== right.state || left.calculationId !== right.calculationId) {
      throw closureInvalid(path, "calculation identity and state must match between locales");
    }
    compareExact(left.problemIds, right.problemIds, [...path, "problemIds"]);
    if (left.state === "available" && right.state === "available") {
      compareExact(left.inputState, right.inputState, [...path, "inputState"]);
      // A Calculation value is business payload: it must be byte-identical
      // across locales. Any locale-dependent fork fails the closure.
      compareExact(left.value, right.value, [...path, "value"]);
    }
  }
}

function compareFamilies(en: ReportExecution, zhCN: ReportExecution): void {
  if (en.families.length !== zhCN.families.length) {
    throw closureInvalid(["families"], "PageFamily results must have identical length");
  }
  for (let index = 0; index < en.families.length; index += 1) {
    const path = ["families", String(index)];
    const left = en.families[index]!;
    const right = zhCN.families[index]!;
    if (
      left.familyId !== right.familyId
      || left.state !== right.state
      || left.instanceCount !== right.instanceCount
    ) {
      throw closureInvalid(path, "PageFamily identity, state, and instance count must match between locales");
    }
    compareExact(left.problemIds, right.problemIds, [...path, "problemIds"]);
  }
}

function comparePages(en: ReportExecution, zhCN: ReportExecution): void {
  if (en.pages.length !== zhCN.pages.length) {
    throw closureInvalid(["pages"], "page results must have identical length");
  }
  for (let index = 0; index < en.pages.length; index += 1) {
    const path = ["pages", String(index)];
    const left = en.pages[index]!;
    const right = zhCN.pages[index]!;
    if (left.state !== right.state || left.pageId !== right.pageId) {
      throw closureInvalid(path, "page identity and state must match between locales");
    }
    if (left.route !== right.route) {
      throw closureInvalid([...path, "route"], "page routes must match between locales");
    }
    compareExact(left.problemIds, right.problemIds, [...path, "problemIds"]);
    if (left.state === "rendered" && right.state === "rendered") {
      compareDocumentShape(left.document, right.document, [...path, "document"]);
    }
  }
}

function compareNavigation(en: ReportExecution, zhCN: ReportExecution): void {
  if (en.navigation.length !== zhCN.navigation.length) {
    throw closureInvalid(["navigation"], "navigation must have identical length");
  }
  for (let index = 0; index < en.navigation.length; index += 1) {
    const path = ["navigation", String(index)];
    const left = en.navigation[index]!;
    const right = zhCN.navigation[index]!;
    if (
      left.kind !== right.kind
      || left.pageId !== right.pageId
      || left.order !== right.order
      || left.route !== right.route
      || left.visible !== right.visible
      || left.state !== right.state
    ) {
      throw closureInvalid(path, "navigation identity, order, route, visibility, and state must match between locales");
    }
    // The navigation title is resolved localized text; it may differ.
  }
}

function compareDownloads(en: ReportExecution, zhCN: ReportExecution): void {
  if (en.downloads.length !== zhCN.downloads.length) {
    throw closureInvalid(["downloads"], "download results must have identical length");
  }
  for (let index = 0; index < en.downloads.length; index += 1) {
    const path = ["downloads", String(index)];
    const left = en.downloads[index]!;
    const right = zhCN.downloads[index]!;
    if (left.state !== right.state || left.downloadId !== right.downloadId) {
      throw closureInvalid(path, "download identity and state must match between locales");
    }
    compareExact(left.problemIds, right.problemIds, [...path, "problemIds"]);
    if (left.state === "built" && right.state === "built") {
      if (left.files.length !== right.files.length) {
        throw closureInvalid([...path, "files"], "download files must have identical length");
      }
      for (let fileIndex = 0; fileIndex < left.files.length; fileIndex += 1) {
        const filePath = [...path, "files", String(fileIndex)];
        const leftFile = left.files[fileIndex]!;
        const rightFile = right.files[fileIndex]!;
        if (leftFile.path !== rightFile.path || leftFile.mediaType !== rightFile.mediaType) {
          throw closureInvalid(filePath, "download file path and media type must match between locales");
        }
        compareExact(leftFile.bytes, rightFile.bytes, [...filePath, "bytes"]);
      }
    }
  }
}

function compareProblemTables(en: ReportExecution, zhCN: ReportExecution): void {
  if (en.problemTable.length !== zhCN.problemTable.length) {
    throw closureInvalid(["problemTable"], "problem tables must have identical length");
  }
  for (let index = 0; index < en.problemTable.length; index += 1) {
    const path = ["problemTable", String(index)];
    const left = en.problemTable[index]!;
    const right = zhCN.problemTable[index]!;
    if (left.id !== right.id) {
      throw closureInvalid(path, "problem IDs must match between locales");
    }
    compareProblem(left.problem, right.problem, [...path, "problem"]);
  }
}

function compareProblem(en: ReportProblem, zhCN: ReportProblem, path: readonly string[]): void {
  if (en.category !== zhCN.category) {
    throw closureInvalid(path, "problem categories must match between locales");
  }
  if (en.category === "execution") {
    if (en.code !== zhCN.code || en.consumerId !== zhCN.consumerId) {
      throw closureInvalid(path, "execution problem code and consumer must match between locales");
    }
    // `summary` is package-owned copy; it may differ per locale.
    return;
  }
  if (
    en.code !== zhCN.code
    || en.consumerId !== zhCN.consumerId
    || en.inputKey !== zhCN.inputKey
    || en.slotId !== zhCN.slotId
    || en.runId !== zhCN.runId
  ) {
    throw closureInvalid(path, "recorded-data problem identity must match between locales");
  }
}

function isReportDisplayCell(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && "display" in value;
}

function isPlainDataObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor)) return false;
  }
  return true;
}

function closureInvalid(path: readonly string[], reason: string): ClosureInvalidError {
  return new ClosureInvalidError(
    Object.freeze({
      code: "report-view-closure-invalid" as const,
      path: Object.freeze(path),
      reason,
    }),
  );
}

class ClosureInvalidError extends Error {
  readonly value: ReportViewClosureInvalid;

  constructor(value: ReportViewClosureInvalid) {
    super(value.code);
    this.value = value;
  }
}
