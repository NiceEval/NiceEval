import type {
  AnalysisIssue,
  EvidenceRef,
  MetricValue,
} from "../../analysis/index.ts";
import {
  closedRowsMetadata,
  isClosedRows,
  makeClosedRows,
} from "../../analysis/contracts.ts";
import type { LocalizedText } from "../../shared/types.ts";
import {
  reportElement,
  type AuthorReportNode,
} from "../author/element.ts";
import {
  Bars as coreBars,
  Callout as coreCallout,
  Grid as coreGrid,
  Line as coreLine,
  Scatter as coreScatter,
  Stack as coreStack,
  Stat as coreStat,
  Table as coreTable,
  Text as coreText,
  type ChartProps,
  type TableColumn,
} from "../components.ts";
import type {
  ReportChartNode,
  ReportNode,
  ReportStatNode,
  ReportTableNode,
  ReportTone,
} from "../semantic/closed.ts";
import {
  analysisIssueText,
  evidenceRefText,
  formatMetricValue,
  presentMetric,
} from "./format.ts";
import type { ReportLocale } from "./locale.ts";

type RowRecord = object;

/** A classic child may be direct semantic data, JSX output, text, or a fragment-like array. */
export type ClassicChild = AuthorReportNode | string | number;
export type ClassicChildren = ClassicChild | readonly ClassicChildren[];

/** The author-time node type accepted by classic composition helpers. */
export type ClassicNode = ClassicChildren;

export interface LayoutProps {
  readonly children?: ClassicChildren;
}

/** Vertical composition.  It does not introduce an execution or data boundary. */
export function Col(input: LayoutProps): AuthorReportNode {
  return classicElement("div", "niceeval-classic niceeval-classic-stack", normalizeChildren(input.children));
}

/** A responsive renderer-selected grid; text remains a full sequential reading order. */
export function Row(input: LayoutProps): AuthorReportNode {
  return classicElement("div", "niceeval-classic niceeval-classic-grid", normalizeChildren(input.children));
}

export function Grid(input: LayoutProps): AuthorReportNode {
  return classicElement("div", "niceeval-classic niceeval-classic-grid", normalizeChildren(input.children));
}

/**
 * A classic information section maps to the current semantic Callout.  The
 * title and every child are present in text, web, static, and no-JS output.
 */
export function Section(input: {
  readonly title: LocalizedText;
  readonly children?: ClassicChildren;
  readonly tone?: ReportTone;
}): AuthorReportNode {
  return classicElement("section", "niceeval-classic niceeval-classic-section", coreCallout({
    tone: input.tone ?? "neutral",
    title: input.title,
    children: normalizeChildren(input.children),
  }));
}

export const Area = Section;

/** Plain text stays text data; no Markdown or HTML path is implicitly opened. */
export function Text(input: { readonly value: string | number }): ReportNode {
  return coreText({ value: String(input.value) });
}

/**
 * Markdown is intentionally a readable source block in the closed semantic
 * tree.  Hosts can enhance its typography later, but raw markup never enters
 * the static core.
 */
export function Markdown(input: { readonly value: string; readonly title?: LocalizedText }): AuthorReportNode {
  return classicElement("section", "niceeval-classic niceeval-classic-markdown", input.title === undefined
    ? coreStack({ children: [Text({ value: input.value })] })
    : Section({ title: input.title, children: [Text({ value: input.value })] }));
}

/** A copyable value with a complete no-JS text equivalent. */
export function CopyBlock(input: { readonly value: string; readonly title?: LocalizedText }): AuthorReportNode {
  return classicElement("section", "niceeval-classic niceeval-classic-copy-block", Section({
    title: input.title ?? "Copy",
    children: [Text({ value: input.value })],
  }));
}

/** Current neutral Table, retained under the classic facade for migration. */
export function Table<Row extends RowRecord>(input: {
  readonly rows: readonly Row[];
  readonly columns?: readonly TableColumn<Row>[];
  readonly caption?: LocalizedText;
}): ReportTableNode {
  return coreTable(input);
}

export interface BarsSort<Row extends RowRecord> {
  readonly field: Extract<keyof Row, string>;
  readonly direction?: "asc" | "desc";
}

export interface ClassicChartProps<Row extends RowRecord> extends ChartProps<Row> {
  /** A display-only sort of closed points; it never changes a MetricValue. */
  readonly sort?: BarsSort<Row>;
  /** A display-only point limit; the original points retain their denominators. */
  readonly limit?: number;
  /** Legacy visual preference retained as a host hint, not an author CSS escape hatch. */
  readonly layout?: "horizontal" | "vertical";
}

/** Current neutral Bars, still accepting only closed points and field names. */
export function Bars<Row extends RowRecord>(input: ClassicChartProps<Row>): ReportChartNode {
  return coreBars(classicChartInput(input));
}

/** Current neutral Line, still accepting only closed points and field names. */
export function Line<Row extends RowRecord>(input: ClassicChartProps<Row>): ReportChartNode {
  return coreLine(classicChartInput(input));
}

/** Current neutral Scatter, still accepting only closed points and field names. */
export function Scatter<Row extends RowRecord>(input: ClassicChartProps<Row>): ReportChartNode {
  return coreScatter(classicChartInput(input));
}

/** Generic chart selection for classic call sites that choose the visual shape. */
export function Chart<Row extends RowRecord>(input: ClassicChartProps<Row> & {
  readonly kind: "bars" | "line" | "scatter";
}): ReportChartNode {
  const { kind, ...props } = input;
  switch (kind) {
    case "bars":
      return coreBars(props);
    case "line":
      return coreLine(props);
    case "scatter":
      return coreScatter(props);
  }
}

/**
 * Sorts and limits only the visible point list.  The returned rows are the
 * original closed values, so a chart cannot turn `20 / 100 partial` into an
 * apparent `20 / 20 available` metric.
 */
export function applyBarsSortLimit<Row extends RowRecord>(
  points: readonly Row[],
  sort?: BarsSort<Row>,
  limit?: number,
): readonly Row[] {
  let visible = [...points];
  if (sort !== undefined) {
    visible.sort((left, right) => {
      const difference = sortValue(left[sort.field]) - sortValue(right[sort.field]);
      return sort.direction === "asc" ? difference : -difference;
    });
  }
  if (limit !== undefined) {
    if (!Number.isSafeInteger(limit) || limit < 0) {
      throw new TypeError("chart limit must be a non-negative safe integer");
    }
    visible = visible.slice(0, limit);
  }
  return preserveRowsMetadata(points, visible);
}

/**
 * A classic stat only accepts the complete Analysis-owned metric.  A caller
 * cannot accidentally detach `value` from its state, denominator, issues, or
 * evidence by passing a bare number.
 */
export function Stat(input: {
  readonly label: LocalizedText;
  readonly value: MetricValue;
}): ReportStatNode {
  return coreStat(input);
}

/**
 * A detailed metric uses the same MetricValue in the primary Stat and exposes
 * its state, denominator, issues, and evidence as ordinary readable nodes.
 */
export function Metric(input: {
  readonly label: LocalizedText;
  readonly value: MetricValue;
  readonly locale?: ReportLocale;
}): AuthorReportNode {
  const presentation = presentMetric(input.value, input.locale);
  const metadata: ReportNode[] = [
    Table({
      caption: "Metric completeness",
      columns: [
        { key: "value", label: "Value" },
        { key: "coverage", label: "Contributed / denominator" },
        { key: "state", label: "State" },
      ],
      rows: [{
        value: presentation.value,
        coverage: presentation.coverage,
        state: presentation.state,
      }],
    }),
  ];
  if (presentation.issues.length > 0) {
    metadata.push(analysisIssuesNode(presentation.issues));
  }
  if (presentation.refs.length > 0) {
    metadata.push(evidenceRefsNode(presentation.refs));
  }
  return classicElement(
    "section",
    "niceeval-classic niceeval-classic-metric",
    coreStack({ children: [coreStat({ label: input.label, value: input.value }), ...metadata] }),
  );
}

export interface CalloutItem {
  readonly tone: ReportTone;
  readonly title: LocalizedText;
  readonly text: string;
  readonly issues?: readonly AnalysisIssue[];
  readonly refs?: readonly EvidenceRef[];
}

/** Every callout keeps its issue/evidence metadata visible instead of relying on color alone. */
export function Callouts(input: { readonly items: readonly CalloutItem[] }): AuthorReportNode {
  return classicElement("section", "niceeval-classic niceeval-classic-callouts", coreStack({
    children: input.items.map((item) => coreCallout({
      tone: item.tone,
      title: item.title,
      children: [
        Text({ value: item.text }),
        ...(item.issues === undefined || item.issues.length === 0 ? [] : [analysisIssuesNode(item.issues)]),
        ...(item.refs === undefined || item.refs.length === 0 ? [] : [evidenceRefsNode(item.refs)]),
      ],
    })),
  }));
}

export interface TabItem {
  readonly title: LocalizedText;
  readonly children?: ClassicChildren;
}

/**
 * All tabs remain direct `section.niceeval-classic-tab` children in source
 * order. Those classes are the optional enhancer's DOM contract; it may add
 * controls, but cannot make a tab's only content disappear without JavaScript.
 */
export function Tabs(input: { readonly tabs: readonly TabItem[] }): AuthorReportNode {
  return classicElement("section", "niceeval-classic niceeval-classic-tabs", input.tabs.map((tab) =>
    classicElement("section", "niceeval-classic-tab", Section({ title: tab.title, children: tab.children }))
  ));
}

export function Tab(input: TabItem): AuthorReportNode {
  return Section(input);
}

export interface SourceBlock {
  readonly title?: LocalizedText;
  readonly language?: string;
  readonly source: string;
}

/** Closed source text only; this component never opens a file or attachment. */
export function SourceView(input: SourceBlock): AuthorReportNode {
  const label = input.language === undefined ? undefined : `Language: ${input.language}`;
  return classicElement("section", "niceeval-classic niceeval-classic-source", Section({
    title: input.title ?? "Source",
    children: [
      ...(label === undefined ? [] : [Text({ value: label })]),
      Text({ value: input.source }),
    ],
  }));
}

export interface DiffFile {
  readonly path: string;
  readonly state?: "added" | "modified" | "deleted" | "renamed" | "unknown";
  readonly patch: string;
  readonly issues?: readonly AnalysisIssue[];
  readonly refs?: readonly EvidenceRef[];
}

/** A diff is closed text and its declared collection limitations, never a filesystem handle. */
export function DiffView(input: { readonly files: readonly DiffFile[] }): AuthorReportNode {
  if (input.files.length === 0) {
    return classicElement("section", "niceeval-classic niceeval-classic-diff", coreCallout({
      tone: "neutral",
      title: "File changes",
      children: [Text({ value: "No closed file changes were supplied." })],
    }));
  }
  return classicElement("section", "niceeval-classic niceeval-classic-diff", coreStack({
    children: input.files.map((file) => coreCallout({
      tone: file.issues !== undefined && file.issues.length > 0 ? "warning" : "neutral",
      title: `${file.state ?? "unknown"}: ${file.path}`,
      children: [
        Text({ value: file.patch }),
        ...(file.issues === undefined || file.issues.length === 0 ? [] : [analysisIssuesNode(file.issues)]),
        ...(file.refs === undefined || file.refs.length === 0 ? [] : [evidenceRefsNode(file.refs)]),
      ],
    })),
  }));
}

export interface ConversationEntry {
  readonly speaker: string;
  readonly content: string;
  readonly state?: string;
  readonly issues?: readonly AnalysisIssue[];
  readonly refs?: readonly EvidenceRef[];
}

/** Full conversation entries remain available in all faces; no transcript is hidden behind JS. */
export function Conversation(input: { readonly entries: readonly ConversationEntry[] }): AuthorReportNode {
  return classicElement("section", "niceeval-classic niceeval-classic-conversation", coreStack({
    children: input.entries.map((entry) => coreCallout({
      tone: entry.issues !== undefined && entry.issues.length > 0 ? "warning" : "neutral",
      title: entry.state === undefined ? entry.speaker : `${entry.speaker} · ${entry.state}`,
      children: [
        Text({ value: entry.content }),
        ...(entry.issues === undefined || entry.issues.length === 0 ? [] : [analysisIssuesNode(entry.issues)]),
        ...(entry.refs === undefined || entry.refs.length === 0 ? [] : [evidenceRefsNode(entry.refs)]),
      ],
    })),
  }));
}

export interface WaterfallRow {
  readonly label: string;
  readonly start?: number | null;
  readonly duration?: number | null;
  readonly state?: string;
  readonly issues?: readonly AnalysisIssue[];
  readonly refs?: readonly EvidenceRef[];
}

/** A readable tabular fallback for the classic timing/waterfall information architecture. */
export function Waterfall(input: { readonly title?: LocalizedText; readonly rows: readonly WaterfallRow[] }): AuthorReportNode {
  return classicElement("section", "niceeval-classic niceeval-classic-waterfall", coreStack({
    children: [
      Table({
        caption: input.title ?? "Timeline",
        columns: [
          { key: "label", label: "Event" },
          { key: "start", label: "Start" },
          { key: "duration", label: "Duration" },
          { key: "state", label: "State" },
        ],
        rows: input.rows.map((row) => ({
          label: row.label,
          start: row.start ?? null,
          duration: row.duration ?? null,
          state: row.state ?? "available",
        })),
      }),
      ...input.rows.flatMap((row) => [
        ...(row.issues === undefined || row.issues.length === 0 ? [] : [analysisIssuesNode(row.issues)]),
        ...(row.refs === undefined || row.refs.length === 0 ? [] : [evidenceRefsNode(row.refs)]),
      ]),
    ],
  }));
}

export interface CommandEvidenceItem {
  readonly command: string;
  readonly outcome: string;
  readonly output?: string;
  readonly diagnostic?: string;
  readonly issues?: readonly AnalysisIssue[];
  readonly refs?: readonly EvidenceRef[];
}

/** Command evidence is rendered as text and never re-executed by a host. */
export function CommandEvidence(input: { readonly items: readonly CommandEvidenceItem[] }): AuthorReportNode {
  return classicElement("section", "niceeval-classic niceeval-classic-command-evidence", coreStack({
    children: input.items.map((item) => coreCallout({
      tone: item.issues !== undefined && item.issues.length > 0 ? "warning" : "neutral",
      title: item.outcome,
      children: [
        Text({ value: `$ ${item.command}` }),
        ...(item.output === undefined ? [] : [Text({ value: item.output })]),
        ...(item.diagnostic === undefined ? [] : [Text({ value: `Diagnostic: ${item.diagnostic}` })]),
        ...(item.issues === undefined || item.issues.length === 0 ? [] : [analysisIssuesNode(item.issues)]),
        ...(item.refs === undefined || item.refs.length === 0 ? [] : [evidenceRefsNode(item.refs)]),
      ],
    })),
  }));
}

/** A semantic Series grouping; it preserves all children in the text fallback. */
export function Series(input: LayoutProps): AuthorReportNode {
  return classicElement("section", "niceeval-classic niceeval-classic-series", normalizeChildren(input.children));
}

/** A small author-scoped element shell; Host owns all actual HTML closure. */
function classicElement(
  tag: "div" | "section",
  className: string,
  children: AuthorReportNode,
): AuthorReportNode {
  return reportElement(tag, Object.freeze({ className, children }));
}

function analysisIssuesNode(issues: readonly AnalysisIssue[]): ReportNode {
  return Table({
    caption: "Analysis issues",
    columns: [
      { key: "code", label: "Code" },
      { key: "message", label: "Message" },
      { key: "evidence", label: "Evidence" },
    ],
    rows: issues.map((issue) => ({
      code: issue.code,
      message: issue.message,
      evidence: issue.refs.map(evidenceRefText).join(", "),
    })),
  });
}

function evidenceRefsNode(refs: readonly EvidenceRef[]): ReportNode {
  return Table({
    caption: "Evidence",
    columns: [{ key: "reference", label: "Reference" }],
    rows: refs.map((reference) => ({ reference: evidenceRefText(reference) })),
  });
}

/** Kept for classic renderers that want a compact metric line without changing its data. */
export function metricText(value: MetricValue, locale?: ReportLocale): string {
  return formatMetricValue(value, locale);
}

function classicChartInput<Row extends RowRecord>(input: ClassicChartProps<Row>): ChartProps<Row> {
  const { points, sort, limit, layout, ...channels } = input;
  void layout;
  return {
    ...channels,
    points: applyBarsSortLimit(points, sort, limit),
  };
}

function sortValue(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string") return stableTextValue(value);
  if (isMetricValue(value)) return value.value ?? Number.NEGATIVE_INFINITY;
  return Number.NEGATIVE_INFINITY;
}

function isMetricValue(value: unknown): value is MetricValue {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<MetricValue>;
  return (typeof candidate.value === "number" || candidate.value === null) &&
    typeof candidate.samples === "number" && typeof candidate.total === "number" &&
    typeof candidate.state === "string";
}

function stableTextValue(value: string): number {
  let result = 0;
  for (const byte of new TextEncoder().encode(value)) result = (result * 257 + byte) % 2_147_483_647;
  return result;
}

/**
 * A visible sort/limit must not erase the ClosedRows identity, captured issues,
 * or captured evidence refs that Analysis attached to the original result.
 */
function preserveRowsMetadata<Row extends RowRecord>(
  source: readonly Row[],
  visible: readonly Row[],
): readonly Row[] {
  if (!isClosedRows(source)) return Object.freeze([...visible]);
  const metadata = closedRowsMetadata(source);
  if (metadata === undefined) return Object.freeze([...visible]);
  return makeClosedRows<Row>({
    rows: visible,
    identity: metadata.identity,
    issues: metadata.issues,
    refs: metadata.refs,
  });
}

/**
 * JSX gives a component either one child, an array, a Fragment result, or a
 * false/null branch.  Flatten that author-time shape once before installing it
 * beneath a semantic Stack/Grid/Callout.  The host then resolves each retained
 * Report component exactly once in the normal execution path.
 */
function normalizeChildren(value: ClassicChildren | undefined): readonly ReportNode[] {
  const nodes: ReportNode[] = [];
  const active = new Set<object>();
  const visit = (child: ClassicChildren | undefined): void => {
    if (child === undefined || child === null || child === false || child === true) return;
    if (typeof child === "string") {
      nodes.push(coreText({ value: child }));
      return;
    }
    if (typeof child === "number") {
      if (!Number.isFinite(child)) throw new TypeError("classic Report text children must be finite");
      nodes.push(coreText({ value: String(child) }));
      return;
    }
    if (Array.isArray(child)) {
      if (active.has(child)) throw new TypeError("classic Report children cannot contain a cycle");
      active.add(child);
      for (const entry of child) visit(entry);
      active.delete(child);
      return;
    }
    // ReportElement and ReportComponentInvocation close through the existing
    // Host traversal.  The static semantic type is intentionally narrower than
    // the author surface, so the cast sits at this one validated boundary.
    nodes.push(child as ReportNode);
  };
  visit(value);
  return Object.freeze(nodes);
}
