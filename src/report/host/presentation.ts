import { Context, Effect } from "effect";
import type { LocalizedText } from "../../shared/types.ts";
import type {
  ClosedReportPage,
  ClosedReportTree,
  ReportExecution,
} from "../execution/model.ts";
import type {
  ReportProblemTableEntry,
} from "../execution/problems.ts";
import type {
  AnalysisIssue,
  EvidenceRef,
  MeasureFormat,
  MetricBasis,
  MetricState,
  MetricValue,
} from "../semantic/value.ts";

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
  /** Exact closed route. The renderer never discovers or executes another one. */
  readonly page?: string;
}

/**
 * Presents one already-closed execution. Rendering has no path back to Sample,
 * Record, author callbacks, or a private Effect runtime.
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

/** A deterministic terminal projection of one ClosedReportTree. */
export function renderReportExecutionText(input: ShowReportInput): string {
  const { execution } = input;
  const pages = selectedPages(execution.tree.pages, input.page);
  const reportTitle = localizedText(execution.report.title ?? execution.report.id);
  const coverage = execution.sample.coverage;
  const lines = [
    `Report ${visibleText(reportTitle)}`,
    `Sample: ${coverage.included} included / ${coverage.frameTotal} slot(s) · ${coverage.selected} selected`,
  ];

  for (const page of pages) {
    lines.push("");
    lines.push(...renderPageText(page));
  }

  lines.push("");
  lines.push(...problemLines(execution.tree));
  return `${lines.join("\n")}\n`;
}

/** A reserved host-owned surface; authored pages cannot suppress these facts. */
export function renderReportExecutionProblemsText(execution: ReportExecution): string {
  const reportTitle = localizedText(execution.report.title ?? execution.report.id);
  return `${[
    `Report ${visibleText(reportTitle)}`,
    "",
    ...problemLines(execution.tree),
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
 * JSON is a deterministic, download-byte-free projection of the same closed
 * tree. It deliberately carries no execution callbacks, Sample capability,
 * reader, filesystem target, or raw download bytes.
 */
export function renderReportExecutionJson(
  input: ShowReportInput,
): Effect.Effect<string, ReportShowRenderError> {
  return Effect.map(reportExecutionShowDocument(input), (document) => `${canonicalJson(document)}\n`);
}

/** A reusable deterministic JSON value for the CLI and static host-data file. */
export function reportExecutionShowDocument(
  input: ShowReportInput,
): Effect.Effect<Readonly<Record<string, unknown>>, ReportShowRenderError> {
  return Effect.gen(function* () {
    const pages = yield* selectedPagesEffect(input.execution.tree.pages, input.page);
    const downloads: Readonly<Record<string, unknown>>[] = [];
    for (const download of [...input.execution.tree.downloads].sort((left, right) =>
      compareUtf8(closedDownloadPath(left), closedDownloadPath(right)) || compareUtf8(left.id, right.id)
    )) {
      downloads.push(yield* downloadShowValue(download));
    }
    return Object.freeze({
      format: "niceeval.report-show/v1",
      report: Object.freeze({
        id: input.execution.report.id,
        ...(input.execution.report.title === undefined
          ? {}
          : { title: jsonLocalizedText(input.execution.report.title) }),
      }),
      sample: Object.freeze({
        identity: jsonValue(input.execution.sample.identity),
        selection: jsonValue(input.execution.sample.selection),
        coverage: jsonValue(input.execution.sample.coverage),
        runCount: input.execution.sample.runCount,
        slotCount: input.execution.sample.slotCount,
        denominator: input.execution.sample.denominator,
      }),
      target: jsonValue(input.execution.target),
      pageSelection: input.page ?? null,
      pageSummaries: Object.freeze(
        [...input.execution.pageSummaries]
          .sort((left, right) => compareUtf8(left.path, right.path) || compareUtf8(left.pageId, right.pageId))
          .map((summary) => Object.freeze({
            pageId: summary.pageId,
            path: summary.path,
            kind: summary.kind,
            navigation: summary.navigation,
            instanceCount: summary.instanceCount,
          })),
      ),
      tree: Object.freeze({
        pages: Object.freeze(
          [...pages]
            .sort(comparePages)
            .map(pageShowValue),
        ),
        downloads: Object.freeze(downloads),
        problemTable: Object.freeze(
          [...input.execution.tree.problemTable]
            .sort((left, right) => Number(left.id) - Number(right.id))
            .map(problemShowValue),
        ),
      }),
    });
  });
}

function pageShowValue(page: ClosedReportPage): Readonly<Record<string, unknown>> {
  return Object.freeze({
    pageId: page.pageId,
    route: page.route,
    title: jsonLocalizedText(page.title),
    navigation: page.navigation,
    head: jsonValue(page.head),
    node: jsonValue(page.node),
    problemIds: sortedProblemIds(page.problemIds),
  });
}

function downloadShowValue(
  download: ReportExecution["tree"]["downloads"][number],
): Effect.Effect<Readonly<Record<string, unknown>>, ReportShowRenderError> {
  return Effect.map(sha256Hex(download.bytes), (sha256) => Object.freeze({
    id: download.id,
    path: closedDownloadPath(download),
    mediaType: download.mediaType,
    byteLength: download.bytes.byteLength,
    sha256,
  }));
}

function problemShowValue(entry: ReportProblemTableEntry): Readonly<Record<string, unknown>> {
  return Object.freeze({
    id: Number(entry.id),
    code: entry.code,
    summary: entry.summary,
  });
}

function selectedPages(
  pages: readonly ClosedReportPage[],
  route: string | undefined,
): readonly ClosedReportPage[] {
  if (route === undefined) return Object.freeze([...pages].sort(comparePages));
  const selected = pages.filter((candidate) => candidate.route === route);
  if (selected.length === 0) throw new PageSelectionError();
  return Object.freeze([...selected].sort(comparePages));
}

class PageSelectionError extends Error {}

function selectedPagesEffect(
  pages: readonly ClosedReportPage[],
  route: string | undefined,
): Effect.Effect<readonly ClosedReportPage[], ReportShowRenderError> {
  return Effect.try({
    try: () => selectedPages(pages, route),
    catch: (error): ReportShowRenderError => ({
      code: "report-show-render-failed",
      operation: error instanceof PageSelectionError ? "page-selection" : "render",
    }),
  });
}

function comparePages(left: ClosedReportPage, right: ClosedReportPage): number {
  return compareUtf8(left.route, right.route) || compareUtf8(left.pageId, right.pageId);
}

function sortedProblemIds(ids: readonly number[]): readonly number[] {
  return Object.freeze([...ids].map(Number).sort((left, right) => left - right));
}

function renderPageText(page: ClosedReportPage): readonly string[] {
  const title = visibleText(localizedText(page.title));
  const lines = [
    `Page ${visibleText(page.route)}`,
    `  ${title}`,
  ];
  if (page.problemIds.length > 0) {
    lines.push(`  problems: ${sortedProblemIds(page.problemIds).map((id) => `#${id}`).join(", ")}`);
  }
  for (const metadata of page.head.metadata) {
    lines.push(`  ${metadata.tag} ${visibleText(canonicalJson(metadata.attrs))}`);
  }
  lines.push(...renderNodeText(page.node, "  ", "text"));
  return lines;
}

type RenderFace = "text" | "web";

/**
 * Text and HTML call this same closed-node reader. An invalid or unknown node
 * cannot acquire authority at rendering time; it is made visible as unsupported.
 */
export function renderNodeText(
  value: unknown,
  indent = "",
  face: RenderFace = "text",
): readonly string[] {
  const node = dataRecord(value);
  if (node === undefined || typeof node.type !== "string") {
    return Object.freeze([`${indent}[unsupported Report node]`]);
  }
  switch (node.type) {
    case "text":
      return Object.freeze([`${indent}${visibleText(stringValue(node.value))}`]);
    case "stack":
    case "grid":
      return renderChildrenText(node.children, indent, face);
    case "callout": {
      const tone = knownTone(node.tone);
      const title = node.title === undefined ? "" : ` ${visibleText(localizedUnknownText(node.title))}`;
      return Object.freeze([
        `${indent}[${tone}]${title}`,
        ...renderChildrenText(node.children, `${indent}  `, face),
      ]);
    }
    case "table":
      return renderTableText(node, indent);
    case "bars":
    case "line":
    case "scatter":
      return renderChartText(node, indent);
    case "stat":
      return renderStatText(node, indent);
    case "download":
      return renderDownloadText(node, indent, face);
    case "element":
      return renderElementText(node, indent, face);
    case "link":
      return renderLinkText(node, indent, face);
    case "primitive": {
      const selected = face === "text" ? node.text : node.web;
      return renderNodeText(selected, indent, face);
    }
    default:
      return Object.freeze([`${indent}[unsupported Report node: ${visibleText(node.type)}]`]);
  }
}

function renderElementText(
  node: Readonly<Record<string, unknown>>,
  indent: string,
  face: RenderFace,
): readonly string[] {
  const tag = typeof node.tag === "string" ? node.tag : "element";
  const children = renderChildrenText(node.children, indent, face);
  if (/^h[1-6]$/.test(tag)) {
    return Object.freeze([`${indent}${"#".repeat(Number(tag.slice(1)))} ${children.map((line) => line.trim()).join(" ")}`]);
  }
  if (tag === "li") return Object.freeze(children.map((line, index) => index === 0 ? `${indent}- ${line.trimStart()}` : line));
  return children;
}

function renderLinkText(
  node: Readonly<Record<string, unknown>>,
  indent: string,
  face: RenderFace,
): readonly string[] {
  const children = renderChildrenText(node.children, indent, face);
  const href = typeof node.href === "string" ? visibleText(node.href) : "[unsupported link]";
  return Object.freeze([...children, `${indent}  → ${href}`]);
}

function renderChildrenText(value: unknown, indent: string, face: RenderFace): readonly string[] {
  if (!Array.isArray(value)) return Object.freeze([`${indent}[unsupported Report children]`]);
  return Object.freeze(value.flatMap((child) => renderNodeText(child, indent, face)));
}

function renderTableText(node: Readonly<Record<string, unknown>>, indent: string): readonly string[] {
  const columns = tableColumns(node.columns);
  const caption = node.caption === undefined ? "Table" : localizedUnknownText(node.caption);
  const lines = [`${indent}${visibleText(caption)}`];
  if (columns.length === 0) {
    lines.push(`${indent}  [unsupported table columns]`);
    return Object.freeze(lines);
  }
  lines.push(`${indent}  ${columns.map((column) => visibleText(column.label)).join(" | ")}`);
  const rows = Array.isArray(node.rows) ? node.rows : [];
  for (const row of rows) {
    const record = dataRecord(row);
    if (record === undefined) {
      lines.push(`${indent}  [unsupported table row]`);
      continue;
    }
    lines.push(`${indent}  ${columns.map((column) => visibleText(reportClosedValueText(record[column.key]))).join(" | ")}`);
  }
  const issues = analysisIssues(node.issues);
  if (issues.length > 0) {
    lines.push(`${indent}  row issues: ${issues.map(analysisIssueText).map(visibleText).join("; ")}`);
  }
  return Object.freeze(lines);
}

function renderChartText(node: Readonly<Record<string, unknown>>, indent: string): readonly string[] {
  const type = node.type === "bars" ? "Bars" : node.type === "line" ? "Line" : "Scatter";
  const title = node.title === undefined ? type : localizedUnknownText(node.title);
  const points = Array.isArray(node.points) ? node.points : [];
  const preferred = [node.x, node.y, node.color, node.series]
    .filter((value): value is string => typeof value === "string" && value.length > 0);
  const fields = orderedPointFields(points, preferred);
  const lines = [`${indent}${visibleText(title)} (${type})`];
  if (fields.length === 0) {
    lines.push(`${indent}  [no text-equivalent points]`);
    return Object.freeze(lines);
  }
  lines.push(`${indent}  ${fields.map(visibleText).join(" | ")}`);
  for (const point of points) {
    const record = dataRecord(point);
    if (record === undefined) {
      lines.push(`${indent}  [unsupported chart point]`);
      continue;
    }
    lines.push(`${indent}  ${fields.map((field) => visibleText(reportClosedValueText(record[field]))).join(" | ")}`);
  }
  const issues = analysisIssues(node.issues);
  if (issues.length > 0) {
    lines.push(`${indent}  point issues: ${issues.map(analysisIssueText).map(visibleText).join("; ")}`);
  }
  return Object.freeze(lines);
}

function renderStatText(node: Readonly<Record<string, unknown>>, indent: string): readonly string[] {
  const label = localizedUnknownText(node.label);
  const metric = metricValue(node.value);
  if (metric === undefined) return Object.freeze([`${indent}${visibleText(label)}: [unsupported metric]`]);
  return Object.freeze([
    `${indent}${visibleText(label)}: ${visibleText(reportMetricText(metric))}`,
    ...metricSupplementText(metric, `${indent}  `),
  ]);
}

function renderDownloadText(
  node: Readonly<Record<string, unknown>>,
  indent: string,
  face: RenderFace,
): readonly string[] {
  const id = typeof node.id === "string" ? node.id : "[unsupported download]";
  return Object.freeze([
    `${indent}Download: ${visibleText(id)}`,
    ...renderChildrenText(node.children, `${indent}  `, face),
  ]);
}

function metricSupplementText(metric: MetricValue, indent: string): readonly string[] {
  const lines: string[] = [];
  if (metric.issues.length > 0) {
    lines.push(`${indent}issues: ${metric.issues.map(analysisIssueText).map(visibleText).join("; ")}`);
  }
  if (metric.refs.length > 0) {
    lines.push(`${indent}evidence: ${metric.refs.map(evidenceRefText).map(visibleText).join(", ")}`);
  }
  return Object.freeze(lines);
}

function problemLines(tree: ClosedReportTree): readonly string[] {
  if (tree.problemTable.length === 0) return Object.freeze(["Problems", "  none"]);
  return Object.freeze([
    "Problems",
    ...[...tree.problemTable]
      .sort((left, right) => Number(left.id) - Number(right.id))
      .map((entry) => `  [${Number(entry.id)}] ${visibleText(reportProblemText(entry))}`),
  ]);
}

/** A stable human-readable description shared by terminal and no-JS HTML. */
export function reportProblemText(problem: ReportProblemTableEntry): string {
  return `${problem.code}: ${problem.summary}`;
}

/** A closed download ID is the portable path name beneath `downloads/`. */
export function closedDownloadPath(download: { readonly id: string }): string {
  return download.id;
}

/** Unknown problem codes fail closed as well; only analysis facts are publishable. */
export function isExecutionReportProblem(problem: ReportProblemTableEntry): boolean {
  return !problem.code.startsWith("analysis-");
}

/** Metric output always retains value, denominator, state, issues, and refs. */
export function reportMetricText(metric: MetricValue): string {
  const number = metric.value === null ? "—" : String(metric.value);
  const unit = metric.unit === undefined || metric.unit === "" ? "" : ` ${metric.unit}`;
  const format = metric.format === undefined ? "" : ` · format ${reportClosedValueText(metric.format)}`;
  return `${number}${unit} · ${metric.samples} / ${metric.total} ${metric.basis} · ${metric.state}${format}`;
}

/** Renders scalars and verified closed values without inventing a new metric. */
export function reportClosedValueText(value: unknown): string {
  const metric = metricValue(value);
  if (metric !== undefined) {
    const issues = metric.issues.length === 0 ? "" : ` · issues: ${metric.issues.map(analysisIssueText).join("; ")}`;
    const refs = metric.refs.length === 0 ? "" : ` · evidence: ${metric.refs.map(evidenceRefText).join(", ")}`;
    return `${reportMetricText(metric)}${issues}${refs}`;
  }
  if (value === null) return "—";
  switch (typeof value) {
    case "boolean":
    case "number":
    case "string":
      return String(value);
    default:
      return canonicalJson(value);
  }
}

export function analysisIssueText(issue: AnalysisIssue): string {
  const refs = issue.refs.length === 0 ? "" : ` (${issue.refs.map(evidenceRefText).join(", ")})`;
  return `${issue.code}: ${issue.message}${refs}`;
}

export function evidenceRefText(reference: EvidenceRef): string {
  return canonicalJson(reference.identity);
}

/** Localized values resolve deterministically: requested English, then UTF-8-first locale. */
export function localizedText(value: LocalizedText, locale = "en"): string {
  if (typeof value === "string") return value;
  const direct = value[locale] ?? value.en;
  if (direct !== undefined) return direct;
  const first = Object.keys(value).sort(compareUtf8)[0];
  return first === undefined ? "" : value[first] ?? "";
}

export function localizedUnknownText(value: unknown, locale = "en"): string {
  if (typeof value === "string") return value;
  const record = dataRecord(value);
  if (record === undefined) return "[unsupported text]";
  const direct = typeof record[locale] === "string"
    ? record[locale]
    : typeof record.en === "string"
      ? record.en
      : undefined;
  if (direct !== undefined) return direct;
  const key = Object.keys(record).sort(compareUtf8)[0];
  return key === undefined || typeof record[key] !== "string" ? "[unsupported text]" : record[key] as string;
}

/** Renderer-only guard: a validated tree already owns the actual metric contract. */
export function metricValue(value: unknown): MetricValue | undefined {
  return isMetricValue(value) ? value : undefined;
}

function isMetricValue(value: unknown): value is MetricValue {
  const record = dataRecord(value);
  return record !== undefined &&
    (record.value === null || isFiniteNumber(record.value)) &&
    isMetricState(record.state) &&
    isNonNegativeInteger(record.samples) &&
    isNonNegativeInteger(record.total) &&
    isMetricBasis(record.basis) &&
    Array.isArray(record.issues) && record.issues.every(isAnalysisIssue) &&
    Array.isArray(record.refs) && record.refs.every(isEvidenceRef) &&
    (record.unit === undefined || typeof record.unit === "string") &&
    (record.format === undefined || isMeasureFormat(record.format)) &&
    (record.better === undefined || isMetricBetter(record.better)) &&
    (record.bounds === undefined || isMetricBounds(record.bounds));
}

function tableColumns(value: unknown): readonly { readonly key: string; readonly label: string }[] {
  if (!Array.isArray(value)) return Object.freeze([]);
  const columns: Array<{ readonly key: string; readonly label: string }> = [];
  for (const candidate of value) {
    const record = dataRecord(candidate);
    if (record === undefined || typeof record.key !== "string" || record.key.length === 0) continue;
    columns.push(Object.freeze({ key: record.key, label: localizedUnknownText(record.label) }));
  }
  return Object.freeze(columns);
}

function orderedPointFields(points: readonly unknown[], preferred: readonly string[]): readonly string[] {
  const fields = new Set<string>(preferred);
  for (const point of points) {
    const record = dataRecord(point);
    if (record === undefined) continue;
    for (const key of Object.keys(record)) fields.add(key);
  }
  const rest = [...fields].filter((field) => !preferred.includes(field)).sort(compareUtf8);
  return Object.freeze([...preferred, ...rest]);
}

function analysisIssues(value: unknown): readonly AnalysisIssue[] {
  if (!Array.isArray(value)) return Object.freeze([]);
  return Object.freeze(value.filter(isAnalysisIssue));
}

function isAnalysisIssue(value: unknown): value is AnalysisIssue {
  const record = dataRecord(value);
  return record !== undefined && isAnalysisIssueCode(record.code) &&
    typeof record.message === "string" && Array.isArray(record.refs) &&
    record.refs.every(isEvidenceRef);
}

function isEvidenceRef(value: unknown): value is EvidenceRef {
  const reference = dataRecord(value);
  if (reference === undefined) return false;
  const identity = dataRecord(reference.identity);
  return identity !== undefined && identity.kind === "attempt" && typeof identity.locator === "string";
}

function isAnalysisIssueCode(value: unknown): boolean {
  return value === "missing" || value === "unsupported" || value === "producer-incompatible" ||
    value === "input-invalid" || value === "reduction-failed" || value === "relation-unmatched";
}

function isMetricState(value: unknown): value is MetricState {
  return value === "available" || value === "partial" || value === "empty" ||
    value === "unsupported" || value === "failed";
}

function isMetricBasis(value: unknown): value is MetricBasis {
  return value === "attempt" || value === "eval" || value === "run" || value === "pair" || value === "slot";
}

function isMetricBetter(value: unknown): value is "higher" | "lower" | "neutral" {
  return value === "higher" || value === "lower" || value === "neutral";
}

function isMetricBounds(value: unknown): boolean {
  const bounds = dataRecord(value);
  return bounds !== undefined &&
    (bounds.min === undefined || isFiniteNumber(bounds.min)) &&
    (bounds.max === undefined || isFiniteNumber(bounds.max));
}

function isMeasureFormat(value: unknown): value is MeasureFormat {
  if (typeof value === "string") return true;
  const format = dataRecord(value);
  return format !== undefined && typeof format.kind === "string" && format.kind.length > 0 &&
    (format.options === undefined || isClosedJsonValue(format.options));
}

function isClosedJsonValue(value: unknown, ancestors: Set<object> = new Set()): boolean {
  if (value === null || typeof value === "boolean" || typeof value === "string") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || value === null || ancestors.has(value)) return false;
  ancestors.add(value);
  try {
    if (Array.isArray(value)) return value.every((entry) => isClosedJsonValue(entry, ancestors));
    const record = dataRecord(value);
    return record !== undefined && Object.values(record).every((entry) => isClosedJsonValue(entry, ancestors));
  } finally {
    ancestors.delete(value);
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function knownTone(value: unknown): string {
  return value === "positive" || value === "warning" || value === "negative" ? value : "neutral";
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "[unsupported text]";
}

function jsonLocalizedText(value: LocalizedText): unknown {
  if (typeof value === "string") return value;
  return Object.freeze(Object.fromEntries(Object.entries(value).sort(([left], [right]) => compareUtf8(left, right))));
}

/** Makes a JSON-compatible, data-only clone with deterministically ordered keys. */
export function jsonValue(value: unknown): unknown {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : "[non-finite number]";
  if (Array.isArray(value)) return Object.freeze(value.map(jsonValue));
  const record = dataRecord(value);
  if (record === undefined) return "[unsupported closed value]";
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(record).sort(compareUtf8)) result[key] = jsonValue(record[key]);
  return Object.freeze(result);
}

/** Canonical JSON is used for CLI output, evidence identity text, and static manifests. */
export function canonicalJson(value: unknown): string {
  return writeJson(value, new Set<object>());
}

/**
 * Download metadata is deterministic without exposing the raw byte payload.
 * Keeping this in Effect preserves interruption and typed render failures.
 */
function sha256Hex(bytes: Uint8Array): Effect.Effect<string, ReportShowRenderError> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined) {
    return Effect.fail({
      code: "report-show-render-failed",
      operation: "render",
    });
  }
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
    (digest) => Array.from(
      new Uint8Array(digest),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join(""),
  );
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
      return JSON.stringify("[unsupported closed value]");
    case "object":
      break;
  }
  if (stack.has(value)) return JSON.stringify("[cyclic closed value]");
  stack.add(value);
  try {
    if (Array.isArray(value)) return `[${value.map((entry) => writeJson(entry, stack)).join(",")}]`;
    const record = dataRecord(value);
    if (record === undefined) return JSON.stringify("[unsupported closed value]");
    const keys = Object.keys(record).sort(compareUtf8);
    return `{${keys.map((key) => `${JSON.stringify(key)}:${writeJson(record[key], stack)}`).join(",")}}`;
  } finally {
    stack.delete(value);
  }
}

function dataRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value) || value instanceof Uint8Array) {
    return undefined;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor)) return undefined;
  }
  return value as Readonly<Record<string, unknown>>;
}

const textEncoder = new TextEncoder();

export function compareUtf8(left: string, right: string): number {
  if (left === right) return 0;
  const leftBytes = textEncoder.encode(left);
  const rightBytes = textEncoder.encode(right);
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    const difference = leftBytes[index]! - rightBytes[index]!;
    if (difference !== 0) return difference;
  }
  return leftBytes.length - rightBytes.length;
}

/** Terminal controls remain visible instead of affecting the user's terminal. */
export function visibleText(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, (character) =>
    `\\u${character.codePointAt(0)!.toString(16).padStart(4, "0")}`
  );
}
