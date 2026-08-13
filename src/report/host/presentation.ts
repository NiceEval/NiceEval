import { Context, Effect } from "effect";
import type { AnalysisSelectionSummary } from "../../analysis/index.ts";
import type {
  ReportCalculationExecutionResult,
  ReportDownloadResult,
  ReportPageFamilyResult,
  ReportPageResult,
  ReportProjectionSummary,
} from "../execution/results.ts";
import type { ReportExecution } from "../execution/model.ts";
import type { ReportProblem, ReportProblemTableEntry } from "../execution/problems.ts";
import type {
  ReportBlock,
  ReportCoverage,
  ReportDisplayValue,
  ReportDocument,
  ReportInline,
  ReportLinkTarget,
  ReportRankedBars,
  ReportScalar,
  ReportScatter,
  ReportTreeCell,
  ReportTreeTable,
} from "../semantic/document.ts";
import type { ReportRoute } from "../author/identity.ts";

/** Failure to write a completed Report presentation to its host console. */
export interface ReportConsoleError {
  readonly code: "report-console-write-failed";
  readonly operation: "write";
}

/** The only capability terminal presentation needs after execution is fixed. */
export interface ReportConsoleService {
  readonly write: (text: string) => Effect.Effect<void, ReportConsoleError>;
}

export class ReportConsole extends Context.Tag("@niceeval/report/ReportConsole")<
  ReportConsole,
  ReportConsoleService
>() {}

export interface ReportShowRenderError {
  readonly code: "report-show-render-failed";
  readonly operation: "render" | "page-selection";
}

export type ReportShowError = ReportConsoleError | ReportShowRenderError;

export interface ShowReportInput {
  readonly execution: ReportExecution;
  readonly format?: "text" | "json";
  readonly page?: ReportRoute;
}

/**
 * Presents one already-completed execution. It never reaches back into a
 * Record, invokes Report callbacks, or starts a private Effect runtime.
 */
export function showReport(
  input: ShowReportInput,
): Effect.Effect<void, ReportShowError, ReportConsole> {
  return Effect.gen(function* () {
    const output = input.format === "json"
      ? yield* renderReportExecutionJson(input)
      : yield* renderText(input);
    const console = yield* ReportConsole;
    yield* console.write(output);
  });
}

/** A deterministic text projection shared by terminal callers and Node views. */
export function renderReportExecutionText(input: ShowReportInput): string {
  const { execution } = input;
  const pages = selectedPages(execution.pages, input.page);
  if (isClassicDashboardPresentation(pages)) {
    const width = terminalColumns();
    const dashboard = pages
      .flatMap((page) => page.state === "rendered"
        ? [renderClassicDashboardDocument(page.document, width).join("\n")]
        : [])
      .join("\n\n");
    const problems = execution.problemTable.length === 0
      ? ""
      : `\n\n${problemLines(execution).join("\n")}`;
    return `${dashboard}${problems}\n`;
  }
  const lines = [
    `Report ${visibleText(execution.reportId)}`,
    `Sample: ${execution.sample.runs.length} run(s), ${execution.sample.denominator} slot(s)`,
  ];

  for (const page of pages) {
    lines.push("");
    lines.push(...renderPageText(page));
  }

  lines.push("");
  lines.push(...problemLines(execution));

  return `${lines.join("\n")}\n`;
}

/** A reserved host-owned surface; author pages cannot suppress these facts. */
export function renderReportExecutionProblemsText(execution: ReportExecution): string {
  return `${[
    `Report ${visibleText(execution.reportId)}`,
    "",
    ...problemLines(execution),
  ].join("\n")}\n`;
}

function renderText(input: ShowReportInput): Effect.Effect<string, ReportShowRenderError> {
  return Effect.try({
    try: () => renderReportExecutionText(input),
    catch: (error): ReportShowRenderError => ({
      code: "report-show-render-failed",
      operation: error instanceof PageSelectionError ? "page-selection" : "render",
    }),
  });
}

/**
 * The JSON envelope intentionally contains only execution-owned data. Download
 * bytes, reader capabilities, callbacks, and filesystem paths never cross it.
 */
export function renderReportExecutionJson(
  input: ShowReportInput,
): Effect.Effect<string, ReportShowRenderError> {
  return Effect.map(reportExecutionShowDocument(input), (document) => `${canonicalJson(document)}\n`);
}

/** A reusable, closed data projection for JSON or a web shell. */
export function reportExecutionShowDocument(
  input: ShowReportInput,
): Effect.Effect<Readonly<Record<string, unknown>>, ReportShowRenderError> {
  return Effect.gen(function* () {
    const { execution } = input;
    const pages = yield* selectedPagesEffect(execution.pages, input.page);
    const downloads: Readonly<Record<string, unknown>>[] = [];
    for (const download of sortedDownloads(execution.downloads)) {
      downloads.push(yield* downloadShowValue(download));
    }
    return Object.freeze({
      format: "niceeval.report-show/v1",
      reportId: execution.reportId,
      pageSelection: input.page ?? null,
      sample: Object.freeze({
        selection: selectionShowValue(execution.sample.selection),
        runCount: execution.sample.runs.length,
        slotCount: execution.sample.slots.length,
        denominator: execution.sample.denominator,
      }),
      projections: sortedProjections(execution.projections).map((projection) =>
        Object.freeze({
          projectionId: projection.projectionId,
          inputKey: projection.inputKey,
          coverage: projection.coverage,
          problemIds: sortedProblemIds(projection.problemIds),
        })
      ),
      calculations: sortedCalculations(execution.calculations).map((calculation) =>
        Object.freeze({
          state: calculation.state,
          calculationId: calculation.calculationId,
          ...(calculation.state === "available"
            ? {
              inputState: calculation.inputState,
              value: calculation.value,
            }
            : {}),
          problemIds: sortedProblemIds(calculation.problemIds),
        })
      ),
      families: sortedFamilies(execution.families).map((family) =>
        Object.freeze({
          state: family.state,
          familyId: family.familyId,
          instanceCount: family.instanceCount,
          problemIds: sortedProblemIds(family.problemIds),
        })
      ),
      pages: pages.map((page) => pageShowValue(page)),
      downloads: Object.freeze(downloads),
      problemTable: [...execution.problemTable]
        .sort((left, right) => left.id - right.id)
        .map((entry) => problemShowValue(entry)),
    });
  });
}

function selectedPages(
  pages: readonly ReportPageResult[],
  page: ReportRoute | undefined,
): readonly ReportPageResult[] {
  if (page === undefined) {
    return Object.freeze([...pages].sort(comparePages));
  }
  const selected = pages.filter((candidate) => candidate.route === page);
  if (selected.length === 0) {
    throw new PageSelectionError();
  }
  return Object.freeze([...selected].sort(comparePages));
}

class PageSelectionError extends Error {}

function selectedPagesEffect(
  pages: readonly ReportPageResult[],
  page: ReportRoute | undefined,
): Effect.Effect<readonly ReportPageResult[], ReportShowRenderError> {
  return Effect.try({
    try: () => selectedPages(pages, page),
    catch: (error): ReportShowRenderError => ({
      code: "report-show-render-failed",
      operation: error instanceof PageSelectionError ? "page-selection" : "render",
    }),
  });
}

function pageShowValue(page: ReportPageResult): Readonly<Record<string, unknown>> {
  return Object.freeze({
    state: page.state,
    pageId: page.pageId,
    ...(page.route === undefined ? {} : { route: page.route }),
    ...(page.state === "rendered" ? { document: page.document } : {}),
    problemIds: sortedProblemIds(page.problemIds),
  });
}

function downloadShowValue(
  download: ReportDownloadResult,
): Effect.Effect<Readonly<Record<string, unknown>>, ReportShowRenderError> {
  return Effect.gen(function* () {
    const files: Readonly<Record<string, unknown>>[] = [];
    if (download.state === "built") {
      for (const file of [...download.files].sort((left, right) => compareUtf8(left.path, right.path))) {
        files.push(Object.freeze({
          path: file.path,
          mediaType: file.mediaType,
          byteLength: file.bytes.byteLength,
          sha256: yield* sha256Hex(file.bytes),
        }));
      }
    }
    return Object.freeze({
      state: download.state,
      downloadId: download.downloadId,
      ...(download.state === "built" ? { files: Object.freeze(files) } : {}),
      problemIds: sortedProblemIds(download.problemIds),
    });
  });
}

function problemShowValue(entry: ReportProblemTableEntry): Readonly<Record<string, unknown>> {
  return Object.freeze({ id: entry.id, problem: entry.problem });
}

function problemLines(execution: ReportExecution): readonly string[] {
  if (execution.problemTable.length === 0) {
    return Object.freeze(["Problems", "  none"]);
  }
  return Object.freeze([
    "Problems",
    ...[...execution.problemTable]
      .sort((left, right) => left.id - right.id)
      .map((entry) => `  [${entry.id}] ${problemText(entry.problem)}`),
  ]);
}

function selectionShowValue(selection: AnalysisSelectionSummary): Readonly<Record<string, unknown>> {
  if (selection.policy === "explicit-runs") {
    return Object.freeze({
      policy: selection.policy,
      runIds: Object.freeze([...selection.runIds].sort(compareUtf8)),
    });
  }
  return Object.freeze({
    policy: selection.policy,
    experimentIds: selection.experimentIds === "all"
      ? "all"
      : Object.freeze([...selection.experimentIds].sort(compareUtf8)),
    selectedRunIds: Object.freeze([...selection.selectedRunIds].sort(compareUtf8)),
  });
}

function sortedProblemIds(ids: readonly number[]): readonly number[] {
  return Object.freeze([...ids].sort((left, right) => left - right));
}

function sortedDownloads(values: readonly ReportDownloadResult[]): readonly ReportDownloadResult[] {
  return Object.freeze([...values].sort((left, right) => compareUtf8(left.downloadId, right.downloadId)));
}

function sortedProjections(values: readonly ReportProjectionSummary[]): readonly ReportProjectionSummary[] {
  return Object.freeze([...values].sort((left, right) => left.projectionId - right.projectionId));
}

function sortedCalculations(
  values: readonly ReportCalculationExecutionResult[],
): readonly ReportCalculationExecutionResult[] {
  return Object.freeze([...values].sort((left, right) => compareUtf8(left.calculationId, right.calculationId)));
}

function sortedFamilies(values: readonly ReportPageFamilyResult[]): readonly ReportPageFamilyResult[] {
  return Object.freeze([...values].sort((left, right) => compareUtf8(left.familyId, right.familyId)));
}

function comparePages(left: ReportPageResult, right: ReportPageResult): number {
  if (left.route !== undefined && right.route !== undefined) {
    const routeComparison = compareUtf8(left.route, right.route);
    return routeComparison === 0 ? compareUtf8(left.pageId, right.pageId) : routeComparison;
  }
  if (left.route !== undefined) return -1;
  if (right.route !== undefined) return 1;
  return compareUtf8(left.pageId, right.pageId);
}

function renderPageText(page: ReportPageResult): string[] {
  const route = page.route === undefined ? "(no route)" : page.route;
  if (page.state !== "rendered") {
    return [
      `Page ${visibleText(route)} · ${page.state}`,
      `  problems: ${page.problemIds.join(", ")}`,
    ];
  }
  return [
    `Page ${visibleText(route)}`,
    ...renderDocumentText(page.document),
  ];
}

function renderDocumentText(document: ReportDocument): string[] {
  const lines = [`  ${visibleText(document.title)}`];
  for (const block of document.children) {
    lines.push(...renderBlockText(block, "  "));
  }
  return lines;
}

function isClassicDashboardPresentation(
  pages: readonly ReportPageResult[],
): boolean {
  return pages.length > 0
    && pages.every((page) => page.state === "rendered" && page.document.presentation === "classic-dashboard");
}

/** The classic surface deliberately contains no terminal control sequences, including when NO_COLOR is absent. */
function terminalColumns(): number {
  const raw = typeof process === "undefined" ? undefined : process.env.COLUMNS;
  if (raw === undefined || !/^[1-9][0-9]*$/.test(raw)) return 80;
  const columns = Number(raw);
  return Number.isSafeInteger(columns) ? Math.max(40, columns) : 80;
}

function renderClassicDashboardDocument(document: ReportDocument, width: number): string[] {
  const lines = [truncateTerminal(visibleText(document.title), width)];
  for (const block of document.children) {
    const rendered = renderClassicBlockText(block, width);
    if (rendered.length === 0) continue;
    lines.push("", ...rendered);
  }
  return lines;
}

function renderClassicBlockText(block: ReportBlock, width: number): string[] {
  switch (block.type) {
    case "hero":
      return [
        ...(block.title === undefined ? [] : wrapTerminal(visibleText(block.title), width)),
        ...wrapTerminal(visibleText(block.description), width),
        ...block.links.flatMap((link) =>
          wrapTerminal(
            `${visibleText(link.label)} (${linkTargetText(link.target)})`,
            width,
          )
        ),
      ];
    case "section":
      return [
        ...wrapTerminal(visibleText(block.heading), width),
        ...block.children.flatMap((child) => {
          const rendered = renderClassicBlockText(child, width);
          return rendered.length === 0 ? [] : ["", ...rendered];
        }),
      ];
    case "summary":
      return renderSummaryText(block, width);
    case "ranked-bars":
      return renderRankedBarsText(block, width);
    case "scatter":
      return renderScatterText(block, width);
    case "tree-table":
      return renderTreeTableText(block, width);
    default:
      return renderBlockText(block, "");
  }
}

function renderBlockText(block: ReportBlock, indent: string): string[] {
  switch (block.type) {
    case "section": {
      const lines = [`${indent}${visibleText(block.heading)}`];
      for (const child of block.children) {
        lines.push(...renderBlockText(child, `${indent}  `));
      }
      return lines;
    }
    case "paragraph":
      return [`${indent}${renderInlineText(block.children)}`];
    case "list": {
      const lines: string[] = [];
      for (const [index, item] of block.items.entries()) {
        const marker = block.ordered ? `${index + 1}. ` : "- ";
        const rendered = item.flatMap((child) => renderBlockText(child, `${indent}  `));
        if (rendered.length === 0) {
          lines.push(`${indent}${marker}`);
        } else {
          lines.push(`${indent}${marker}${rendered[0]!.trimStart()}`);
          lines.push(...rendered.slice(1));
        }
      }
      return lines;
    }
    case "table": {
      const headings = block.columns.map((column) => visibleText(column.label)).join(" | ");
      const rows = block.rows.map((row) =>
        block.columns.map((column) => scalarText(row[column.key]!)).join(" | ")
      );
      return [
        `${indent}${visibleText(block.caption)}`,
        `${indent}${headings}`,
        ...rows.map((row) => `${indent}${row}`),
      ];
    }
    case "metric":
      return [
        `${indent}${visibleText(block.label)}: ${scalarText(block.value)}${
          block.unit === undefined ? "" : ` ${visibleText(block.unit)}`
        }`,
      ];
    case "status":
      return [
        `${indent}[${block.tone}] ${visibleText(block.label)}${
          block.detail === undefined ? "" : `: ${renderInlineText(block.detail)}`
        }`,
      ];
    case "code-block":
      return block.value.split("\n").map((line) => `${indent}${visibleText(line)}`);
    case "chart": {
      const lines = [`${indent}${visibleText(block.title)} (${visibleText(block.categoryLabel)})`];
      for (const series of block.series) {
        const values = block.categories.map((category, index) =>
          `${visibleText(category)}=${scalarText(series.values[index] ?? null)}`
        );
        lines.push(`${indent}${visibleText(series.label)}: ${values.join(", ")}`);
      }
      return lines;
    }
    case "hero":
    case "summary":
    case "ranked-bars":
    case "scatter":
    case "tree-table":
      return renderClassicBlockText(block, 80).map((line) => `${indent}${line}`);
  }
}

function renderSummaryText(
  block: Extract<ReportBlock, { readonly type: "summary" }>,
  width: number,
): string[] {
  return unicodeBox(
    "Summary",
    [
      `Last run: ${formatLastRunAt(block.lastRunAt)}`,
      ...block.metrics.map((metric) => `${visibleText(metric.label)}: ${formatDashboardDisplay(metric)}`),
    ],
    width,
  );
}

function renderRankedBarsText(block: ReportRankedBars, width: number): string[] {
  const points = [...block.points].sort((left, right) => compareRankedBarPoints(left, right, block.better));
  const labelWidth = Math.max(
    12,
    Math.min(
      30,
      points.reduce((maximum, point) => Math.max(maximum, terminalLength(barLabel(point))), 0),
    ),
  );
  const barWidth = Math.min(30, Math.max(10, width - labelWidth - 44));
  const scale = rankedBarScale(points.map((point) => point.value));
  const lines = [
    `${visibleText(block.title)} · ${block.better === "higher" ? "higher" : "lower"} is better`,
  ];
  for (const point of points) {
    const label = padTerminal(truncateTerminal(barLabel(point), labelWidth), labelWidth);
    const coverage = formatCoverage(point.coverage);
    if (point.value === null) {
      lines.push(`${label}  ${"░".repeat(barWidth)} ${visibleText(point.display)} · ${coverage}`);
      continue;
    }
    const percent = rankedBarPercent(point.value, scale);
    const filled = percent <= 0 ? 0 : Math.max(1, Math.round((barWidth * percent) / 100));
    const bar = `${"█".repeat(filled)}${"░".repeat(Math.max(0, barWidth - filled))}`;
    const displayed = visibleText(point.display);
    lines.push(`${label}  ${bar} ${displayed} · ${coverage}`);
  }
  return lines.map((line) => truncateTerminal(line, width));
}

function compareRankedBarPoints(
  left: ReportRankedBars["points"][number],
  right: ReportRankedBars["points"][number],
  better: ReportRankedBars["better"],
): number {
  if (left.value === null && right.value === null) return compareUtf8(left.key, right.key);
  if (left.value === null) return 1;
  if (right.value === null) return -1;
  const order = better === "higher" ? right.value - left.value : left.value - right.value;
  return order === 0 ? compareUtf8(left.key, right.key) : order;
}

function barLabel(point: ReportRankedBars["points"][number]): string {
  return point.series.length === 0
    ? visibleText(point.label)
    : `${visibleText(point.label)} · ${visibleText(point.series)}`;
}

interface RankedBarScale {
  readonly mode: "fraction" | "percent" | "relative";
  readonly maximum: number;
  readonly minimum: number;
}

function rankedBarScale(values: readonly (number | null)[]): RankedBarScale {
  const numbers = values.filter((value): value is number => value !== null);
  const maximum = numbers.length === 0 ? 1 : Math.max(...numbers);
  const minimum = numbers.length === 0 ? 0 : Math.min(...numbers);
  if (minimum >= 0 && maximum <= 1) return { mode: "fraction", maximum: 1, minimum: 0 };
  if (minimum >= 0 && maximum <= 100) return { mode: "percent", maximum: 100, minimum: 0 };
  return { mode: "relative", maximum, minimum };
}

function rankedBarPercent(value: number, scale: RankedBarScale): number {
  if (scale.mode === "fraction") return clamp(value * 100, 0, 100);
  if (scale.mode === "percent") return clamp(value, 0, 100);
  if (scale.maximum === scale.minimum) return 100;
  return clamp(((value - scale.minimum) / (scale.maximum - scale.minimum)) * 100, 0, 100);
}

function renderScatterText(block: ReportScatter, width: number): string[] {
  const plotWidth = Math.max(24, Math.min(64, width - 12));
  const plotHeight = 10;
  const plotted = block.series.flatMap((series, seriesIndex) =>
    series.points
      .filter((point) => point.x !== null && point.y !== null)
      .map((point) => ({
        point,
        seriesIndex,
        symbol: scatterSymbol(seriesIndex),
      }))
  );
  const xValues = plotted.map(({ point }) => point.x!);
  const yValues = plotted.map(({ point }) => point.y!);
  const xRange = numericRange(xValues);
  const yRange = numericRange(yValues);
  const grid = Array.from({ length: plotHeight }, () => Array.from({ length: plotWidth }, () => " "));

  if (block.connect) {
    block.series.forEach((series, seriesIndex) => {
      const coordinates = series.points
        .filter((point) => point.x !== null && point.y !== null)
        .map((point) => scatterCoordinate(point.x!, point.y!, xRange, yRange, plotWidth, plotHeight));
      for (let index = 1; index < coordinates.length; index += 1) {
        const previous = coordinates[index - 1];
        const current = coordinates[index];
        if (previous !== undefined && current !== undefined) drawAsciiLine(grid, previous, current);
      }
      void seriesIndex;
    });
  }

  for (const entry of plotted) {
    const coordinate = scatterCoordinate(entry.point.x!, entry.point.y!, xRange, yRange, plotWidth, plotHeight);
    grid[coordinate.y]![coordinate.x] = entry.symbol;
  }

  const yAxisWidth = Math.max(8, terminalLength(formatAxisNumber(yRange.maximum)));
  const lines = [
    visibleText(block.title),
    `x: ${visibleText(block.xLabel)} · y: ${visibleText(block.yLabel)}${block.connect ? " · connected" : ""}`,
  ];
  for (let row = 0; row < plotHeight; row += 1) {
    const value = yRange.maximum - ((yRange.maximum - yRange.minimum) * row) / Math.max(1, plotHeight - 1);
    const label = row === 0 || row === plotHeight - 1 || row === Math.floor(plotHeight / 2)
      ? padTerminal(formatAxisNumber(value), yAxisWidth, "start")
      : " ".repeat(yAxisWidth);
    lines.push(`${label} │${grid[row]!.join("")}│`);
  }
  lines.push(`${" ".repeat(yAxisWidth)} └${"─".repeat(plotWidth)}┘`);
  lines.push(
    `${" ".repeat(yAxisWidth + 2)}${formatAxisNumber(xRange.minimum)} ${visibleText(block.xLabel)} ${formatAxisNumber(xRange.maximum)}`,
  );
  lines.push(`Key: ${block.series.map((series, index) => `${scatterSymbol(index)}=${visibleText(series.label)}`).join(", ")}`);
  for (const [seriesIndex, series] of block.series.entries()) {
    for (const point of series.points) {
      const target = point.target === undefined ? "" : ` → ${linkTargetText(point.target)}`;
      lines.push(
        `  ${scatterSymbol(seriesIndex)} ${visibleText(point.key)}: x=${visibleText(point.xDisplay)}, y=${visibleText(point.yDisplay)}${target}`,
      );
    }
  }
  return lines.map((line) => truncateTerminal(line, width));
}

interface NumericRange {
  readonly minimum: number;
  readonly maximum: number;
}

function numericRange(values: readonly number[]): NumericRange {
  if (values.length === 0) return { minimum: 0, maximum: 1 };
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  if (minimum === maximum) {
    const delta = minimum === 0 ? 1 : Math.abs(minimum) * 0.1;
    return { minimum: minimum - delta, maximum: maximum + delta };
  }
  return { minimum, maximum };
}

function scatterCoordinate(
  x: number,
  y: number,
  xRange: NumericRange,
  yRange: NumericRange,
  width: number,
  height: number,
): { readonly x: number; readonly y: number } {
  return {
    x: clamp(Math.round(((x - xRange.minimum) / (xRange.maximum - xRange.minimum)) * (width - 1)), 0, width - 1),
    y: clamp(Math.round(((yRange.maximum - y) / (yRange.maximum - yRange.minimum)) * (height - 1)), 0, height - 1),
  };
}

function drawAsciiLine(
  grid: string[][],
  from: { readonly x: number; readonly y: number },
  to: { readonly x: number; readonly y: number },
): void {
  let x = from.x;
  let y = from.y;
  const deltaX = Math.abs(to.x - from.x);
  const deltaY = -Math.abs(to.y - from.y);
  const directionX = from.x < to.x ? 1 : -1;
  const directionY = from.y < to.y ? 1 : -1;
  let error = deltaX + deltaY;
  while (true) {
    if (grid[y]![x] === " ") grid[y]![x] = ".";
    if (x === to.x && y === to.y) return;
    const doubled = 2 * error;
    if (doubled >= deltaY) {
      error += deltaY;
      x += directionX;
    }
    if (doubled <= deltaX) {
      error += deltaX;
      y += directionY;
    }
  }
}

function scatterSymbol(index: number): string {
  const symbols = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  return symbols[index] ?? "*";
}

function formatAxisNumber(value: number): string {
  const absolute = Math.abs(value);
  if (absolute >= 1_000 || (absolute > 0 && absolute < 0.01)) return value.toExponential(2);
  return value.toFixed(absolute < 10 ? 2 : 1).replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
}

function renderTreeTableText(block: ReportTreeTable, width: number): string[] {
  if (width < 120) {
    return renderNarrowTreeTableText(block, width);
  }
  const headers = ["Hierarchy", ...block.columns.map((column) => visibleText(column.label))];
  const rows = block.rows.map((row) => [
    treeRowLabel(row),
    ...block.columns.map((column) => formatTreeCell(row.cells[column.key]!)),
  ]);
  const alignments = ["start" as const, ...block.columns.map((column) => column.align ?? "start")];
  return [visibleText(block.caption), ...unicodeTable(headers, rows, alignments, width)];
}

function renderNarrowTreeTableText(block: ReportTreeTable, width: number): string[] {
  const lines = [visibleText(block.caption)];
  for (const [index, row] of block.rows.entries()) {
    if (index > 0) lines.push("");
    lines.push(...wrapTerminal(treeRowLabel(row), width));
    for (const column of block.columns) {
      lines.push(...wrapTerminal(
        `  ${visibleText(column.label)}: ${formatTreeCell(row.cells[column.key]!)}`,
        width,
      ));
    }
  }
  return lines;
}

function treeRowLabel(row: ReportTreeTable["rows"][number]): string {
  const kind = row.kind === "experiment" ? "Experiment" : row.kind === "eval" ? "Eval" : "Attempt";
  return `${"  ".repeat(row.depth)}${kind} · ${visibleText(row.label)}`;
}

function formatTreeCell(value: ReportTreeCell): string {
  if (typeof value !== "object" || value === null) {
    return value === null ? "—" : scalarText(value);
  }
  return formatDashboardDisplay(value);
}

function unicodeTable(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
  alignments: readonly ("start" | "end")[],
  width: number,
): string[] {
  if (headers.length === 0) return [];
  const structuralWidth = headers.length * 3 + 1;
  const available = Math.max(headers.length * 4, width - structuralWidth);
  const widths = headers.map((header, index) => {
    const content = rows.reduce((maximum, row) => Math.max(maximum, terminalLength(row[index] ?? "")), terminalLength(header));
    const maximum = header === "Record" ? 37 : index === 0 ? 32 : 28;
    const minimum = header === "Record"
      ? 37
      : index === 0
      ? 26
      : header === "Model" || header === "Agent"
      ? 6
      : header === "Pass rate"
      ? 7
      : header === "Tokens"
      ? 3
      : header === "Cost"
      ? 6
      : 4;
    return Math.min(maximum, Math.max(minimum, content));
  });
  const minima = headers.map((header, index) => header === "Record"
    ? 37
    : index === 0
    ? 26
    : header === "Model" || header === "Agent"
    ? 6
    : header === "Pass rate"
    ? 7
    : header === "Tokens"
    ? 3
    : header === "Cost"
    ? 6
    : 4);
  while (widths.reduce((sum, value) => sum + value, 0) > available) {
    let candidate = -1;
    for (let index = 0; index < widths.length; index += 1) {
      if (widths[index]! > minima[index]! && (candidate === -1 || widths[index]! > widths[candidate]!)) {
        candidate = index;
      }
    }
    if (candidate === -1) break;
    widths[candidate] = widths[candidate]! - 1;
  }
  const border = (left: string, join: string, right: string) =>
    `${left}${widths.map((columnWidth) => "─".repeat(columnWidth + 2)).join(join)}${right}`;
  const rowLine = (values: readonly string[]) =>
    `│${values.map((value, index) => ` ${padTerminal(truncateTerminal(value ?? "", widths[index]!), widths[index]!, alignments[index] ?? "start")} `).join("│")}│`;
  return [
    border("┌", "┬", "┐"),
    rowLine(headers),
    border("├", "┼", "┤"),
    ...rows.flatMap((row, index) => index === 0 ? [rowLine(row)] : [border("├", "┼", "┤"), rowLine(row)]),
    border("└", "┴", "┘"),
  ];
}

function unicodeBox(title: string, content: readonly string[], width: number): string[] {
  const innerWidth = Math.max(20, width - 2);
  const label = truncateTerminal(` ${visibleText(title)} `, innerWidth);
  return [
    `┌${label}${"─".repeat(Math.max(0, innerWidth - terminalLength(label)))}┐`,
    ...content.map((line) => `│${padTerminal(truncateTerminal(line, innerWidth), innerWidth)}│`),
    `└${"─".repeat(innerWidth)}┘`,
  ];
}

function formatLastRunAt(value: number | null): string {
  if (value === null) return "—";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "—" : date.toISOString();
}

function formatDashboardDisplay(value: ReportDisplayValue): string {
  const display = visibleText(value.display);
  const coverage = value.coverage === undefined ? "" : ` · ${formatCoverage(value.coverage)}`;
  return `${display}${coverage}`;
}

function formatCoverage(coverage: ReportCoverage): string {
  return `coverage ${coverage.samples}/${coverage.total} ${coverage.basis}`;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function terminalLength(value: string): number {
  return Array.from(value).length;
}

function truncateTerminal(value: string, width: number): string {
  if (terminalLength(value) <= width) return value;
  if (width <= 1) return "…";
  return `${Array.from(value).slice(0, Math.max(0, width - 1)).join("")}…`;
}

function padTerminal(value: string, width: number, align: "start" | "end" = "start"): string {
  const padding = Math.max(0, width - terminalLength(value));
  return align === "end" ? `${" ".repeat(padding)}${value}` : `${value}${" ".repeat(padding)}`;
}

function wrapTerminal(value: string, width: number): string[] {
  if (value.length === 0) return [""];
  const words = value.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (terminalLength(word) > width) {
      if (line.length > 0) lines.push(line);
      lines.push(truncateTerminal(word, width));
      line = "";
      continue;
    }
    const next = line.length === 0 ? word : `${line} ${word}`;
    if (terminalLength(next) > width && line.length > 0) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line.length > 0) lines.push(line);
  return lines;
}

function renderInlineText(children: readonly ReportInline[]): string {
  return children.map((child) => {
    switch (child.type) {
      case "text":
        return visibleText(child.value);
      case "code":
        return `\`${visibleText(child.value)}\``;
      case "emphasis":
        return `*${renderInlineText(child.children)}*`;
      case "link":
        return `${renderInlineText(child.label)} (${linkTargetText(child.target)})`;
    }
  }).join("");
}

function linkTargetText(target: ReportLinkTarget): string {
  switch (target.kind) {
    case "route":
      return visibleText(target.route);
    case "download":
      return visibleText(target.path);
    case "external":
      return visibleText(target.href);
    case "attempt":
      return visibleText(target.locator);
  }
}

function scalarText(value: ReportScalar): string {
  return typeof value === "string" ? visibleText(value) : String(value);
}

function problemText(problem: ReportProblem): string {
  if (problem.category === "execution") {
    return `${problem.code} in ${visibleText(problem.consumerId)}: ${visibleText(problem.summary)}`;
  }
  const owner = problem.slotId ?? problem.runId;
  const input = problem.inputKey === undefined ? "" : ` input ${visibleText(problem.inputKey)}`;
  const target = owner === undefined ? "" : ` (${visibleText(owner)})`;
  if (problem.code === "migration-required") {
    return `${problem.code}${input}${target}; run niceeval migrate`;
  }
  return `${problem.code}${input}${target}`;
}

/**
 * Hashing stays in the Effect graph so callers never need an ad-hoc Promise
 * runtime just to render show JSON. Web Crypto keeps this host projection
 * platform-neutral while emitting the required lowercase hexadecimal digest.
 */
function sha256Hex(bytes: Uint8Array): Effect.Effect<string, ReportShowRenderError> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined) {
    return Effect.fail({
      code: "report-show-render-failed",
      operation: "render",
    });
  }
  // Copy into an owned ArrayBuffer-backed view: a Report file may originate
  // from a wider ArrayBufferLike view, while Web Crypto accepts BufferSource.
  const input = new Uint8Array(bytes.byteLength);
  input.set(bytes);
  return Effect.map(
    Effect.tryPromise({
      try: () => subtle.digest("SHA-256", input),
      catch: (): ReportShowRenderError => ({
        code: "report-show-render-failed",
        operation: "render",
      }),
    }),
    (digest) => Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""),
  );
}

/** Terminal controls remain visible instead of affecting the user's terminal. */
function visibleText(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, (character) =>
    `\\u${character.codePointAt(0)!.toString(16).padStart(4, "0")}`
  );
}

/**
 * Canonical JSON avoids object iteration order and declines values that cannot
 * be represented in JSON. A Calculation is intentionally allowed to carry an
 * arbitrary in-process value, so non-JSON values are represented explicitly
 * rather than changing the execution or throwing during a normal show.
 */
function canonicalJson(value: unknown): string {
  return writeJson(value, new Set<object>());
}

function writeJson(value: unknown, stack: Set<object>): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "string":
      return JSON.stringify(value);
    case "number":
      return Number.isFinite(value) ? JSON.stringify(value) : JSON.stringify("[non-finite number]");
    case "undefined":
    case "bigint":
    case "symbol":
    case "function":
      return JSON.stringify("[non-json value]");
    case "object":
      break;
  }

  if (stack.has(value)) return JSON.stringify("[cyclic value]");
  stack.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((entry) => writeJson(entry, stack)).join(",")}]`;
    }
    if (!isPlainDataObject(value)) return JSON.stringify("[non-json value]");
    const keys = Object.keys(value).sort(compareUtf8);
    return `{${keys.map((key) => `${JSON.stringify(key)}:${writeJson(value[key], stack)}`).join(",")}}`;
  } finally {
    stack.delete(value);
  }
}

function isPlainDataObject(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor)) return false;
  }
  return true;
}

const textEncoder = new TextEncoder();

function compareUtf8(left: string, right: string): number {
  const leftBytes = textEncoder.encode(left);
  const rightBytes = textEncoder.encode(right);
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    const difference = leftBytes[index]! - rightBytes[index]!;
    if (difference !== 0) return difference;
  }
  return leftBytes.length - rightBytes.length;
}
