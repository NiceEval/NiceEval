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
  ClosedElementTag,
  ReportNode,
  ReportTone,
} from "../semantic/closed.ts";
import {
  compactMetricText,
  evidenceRefText,
  formatMetricValue,
  presentClosedCell,
  presentClosedLabel,
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

/** Plain text stays closed data; locale maps reach Host unchanged. */
export function Text(input: { readonly value: LocalizedText | number }): ReportNode {
  return coreText({ value: typeof input.value === "number" ? String(input.value) : input.value });
}

/** A local route/fragment or explicit HTTPS target; Host classifies the href. */
export function Link(input: {
  readonly href: string;
  readonly children?: ClassicChildren;
  readonly className?: string;
}): AuthorReportNode {
  return reportElement("a", Object.freeze({
    href: input.href,
    ...(input.className === undefined ? {} : { className: input.className }),
    children: normalizeChildren(input.children),
  }));
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
    title: input.title ?? { en: "Copy", "zh-CN": "复制" },
    children: [Text({ value: input.value })],
  }));
}

export interface ClassicTableProps<Row extends RowRecord> {
  readonly rows: readonly Row[];
  readonly columns?: readonly TableColumn<Row>[];
  readonly caption?: LocalizedText;
  /** When true, enhance.js injects the 0.12 filter field over this table. */
  readonly searchable?: boolean;
  /** A display-only sort of already closed rows. */
  readonly sort?: BarsSort<Row> | Extract<keyof Row, string>;
}

/** Classic Table projects closed cells into readable scalars before Host HTML. */
export function Table<Row extends RowRecord>(input: ClassicTableProps<Row>): AuthorReportNode {
  const sort = typeof input.sort === "string" ? { field: input.sort } : input.sort;
  const visible = applyBarsSortLimit(input.rows, sort);
  const columns = input.columns === undefined
    ? inferDisplayColumns(visible)
    : input.columns;
  const presented = presentTableRows(visible, columns);
  const className = [
    "niceeval-classic",
    "niceeval-classic-table",
    input.searchable === true ? "niceeval-classic-searchable" : "",
  ].filter((entry) => entry.length > 0).join(" ");
  if (hasSubRows(visible)) {
    return renderTreeTable(className, columns, visible, input.caption, sort);
  }
  return classicElement("section", className, coreTable({
    rows: presented as never,
    columns: columns.map((column) => Object.freeze({
      key: column.key,
      label: column.label,
      ...(column.align === undefined ? {} : { align: column.align }),
    })),
    ...(input.caption === undefined ? {} : { caption: input.caption }),
  }));
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
  /** Display-only point identity field; it does not change closed chart statistics. */
  readonly point?: ChartProps<Row>["point"];
  /** Legacy visual preference retained as a host hint, not an author CSS escape hatch. */
  readonly layout?: "horizontal" | "vertical";
}

/** Classic Bars keep numeric y for the Host SVG and drop Evidence bags from the data table. */
export function Bars<Row extends RowRecord>(input: ClassicChartProps<Row>): AuthorReportNode {
  return classicElement("section", chartClassName("bars", input.layout), coreBars(classicChartInput(input)));
}

/** Classic Line, still accepting only closed points and field names. */
export function Line<Row extends RowRecord>(input: ClassicChartProps<Row>): AuthorReportNode {
  return classicElement("section", chartClassName("line"), coreLine(classicChartInput(input)));
}

/** Classic Scatter, still accepting only closed points and field names. */
export function Scatter<Row extends RowRecord>(input: ClassicChartProps<Row>): AuthorReportNode {
  return classicElement("section", chartClassName("scatter"), coreScatter(classicChartInput(input)));
}

/** Generic chart selection for classic call sites that choose the visual shape. */
export function Chart<Row extends RowRecord>(input: ClassicChartProps<Row> & {
  readonly kind: "bars" | "line" | "scatter";
}): AuthorReportNode {
  const { kind, ...props } = input;
  switch (kind) {
    case "bars":
      return Bars(props);
    case "line":
      return Line(props);
    case "scatter":
      return Scatter(props);
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
  return preserveRowsMetadata(points, visible as readonly Readonly<Record<string, unknown>>[]) as readonly Row[];
}

/**
 * A classic stat only accepts the complete Analysis-owned metric.  A caller
 * cannot accidentally detach `value` from its state, denominator, issues, or
 * evidence by passing a bare number.
 */
export function Stat(input: {
  readonly label: LocalizedText;
  readonly value: MetricValue;
}): AuthorReportNode {
  return classicElement("div", "niceeval-classic-stat niceeval-classic-stat-metric", coreStat(input));
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
  const metadata: AuthorReportNode[] = [
    coreTable({
      caption: { en: "Metric completeness", "zh-CN": "度量完整度" },
      columns: [
        { key: "value", label: { en: "Value", "zh-CN": "值" } },
        { key: "coverage", label: { en: "Contributed / denominator", "zh-CN": "贡献 / 分母" } },
        { key: "state", label: { en: "State", "zh-CN": "状态" } },
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
  return classicElement(
    "section",
    "niceeval-classic niceeval-classic-metric",
    [classicStat(input.label, compactMetricText(input.value, input.locale)), ...metadata],
  );
}

export interface CalloutItem {
  readonly tone: ReportTone;
  readonly title: LocalizedText;
  readonly text: LocalizedText;
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
        ...(item.refs === undefined || item.refs.length === 0
          ? []
          : [Text({ value: `${item.refs.length} evidence` })]),
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
    title: input.title ?? { en: "Source", "zh-CN": "源码" },
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
      title: { en: "File changes", "zh-CN": "文件变更" },
      children: [Text({
        value: {
          en: "No closed file changes were supplied.",
          "zh-CN": "没有提供已闭合的文件变更。",
        },
      })],
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
      coreTable({
        caption: input.title ?? { en: "Timeline", "zh-CN": "时间线" },
        columns: [
          { key: "label", label: { en: "Event", "zh-CN": "事件" } },
          { key: "start", label: { en: "Start", "zh-CN": "开始" } },
          { key: "duration", label: { en: "Duration", "zh-CN": "时长" } },
          { key: "state", label: { en: "State", "zh-CN": "状态" } },
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

type ClassicHostTag = ClosedElementTag | "a";

/** A small author-scoped element shell; Host owns all actual HTML closure. */
function classicElement(
  tag: ClassicHostTag,
  className: string,
  children: AuthorReportNode,
): AuthorReportNode {
  return reportElement(tag, Object.freeze({ className, children }));
}

function classicStat(label: LocalizedText, value: string): AuthorReportNode {
  return classicElement("div", "niceeval-classic-stat", [
    classicElement("div", "niceeval-classic-stat-label", Text({ value: label })),
    classicElement("div", "niceeval-classic-stat-value", Text({ value })),
  ]);
}

function chartClassName(kind: "bars" | "line" | "scatter", layout?: "horizontal" | "vertical"): string {
  return [
    "niceeval-classic",
    "niceeval-classic-chart",
    `niceeval-classic-${kind}`,
    layout === "horizontal" ? "niceeval-classic-chart-horizontal" : "",
  ].filter((entry) => entry.length > 0).join(" ");
}

const HIDDEN_TABLE_KEYS = Object.freeze(new Set([
  "refs",
  "issues",
  "identity",
  "subRows",
  "children",
  "key",
  "href",
  "fresh",
]));

function inferDisplayColumns<Row extends RowRecord>(
  rows: readonly Row[],
): readonly TableColumn<Row>[] {
  const keys = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (HIDDEN_TABLE_KEYS.has(key) || !isDisplayableCell((row as Record<string, unknown>)[key])) continue;
      keys.add(key);
    }
  }
  return Object.freeze([...keys].sort().map((key) => Object.freeze({
    key: key as Extract<keyof Row, string>,
    label: key,
    align: isNumericColumn(rows, key) ? "end" as const : "start" as const,
  })));
}

function presentTableRows<Row extends RowRecord>(
  rows: readonly Row[],
  columns: readonly TableColumn<Row>[],
): readonly Readonly<Record<string, unknown>>[] {
  const visible = rows.map((row) => {
    const presented: Record<string, unknown> = {};
    for (const column of columns) {
      presented[column.key] = presentClosedCell((row as Record<string, unknown>)[column.key]) ?? "—";
    }
    return Object.freeze(presented);
  });
  return preserveRowsMetadata(rows, visible);
}

function renderTreeTable<Row extends RowRecord>(
  className: string,
  columns: readonly TableColumn<Row>[],
  rows: readonly Row[],
  caption: LocalizedText | undefined,
  sort: BarsSort<Row> | undefined,
): AuthorReportNode {
  return classicElement("section", `${className} niceeval-classic-table-tree`, [
    ...(caption === undefined ? [] : [classicElement("p", "niceeval-classic-table-caption", Text({
      value: caption,
    }))]),
    classicElement("header", "niceeval-classic-table-head", columns.map((column) =>
      classicElement("span", treeHeaderClassName(column, sort), Text({
        value: column.label,
      }))
    )),
    classicElement("section", "niceeval-classic-table-body", rows.map((row) => renderTreeRow(columns, row, 0))),
  ]);
}

function treeHeaderClassName<Row extends RowRecord>(
  column: TableColumn<Row>,
  sort: BarsSort<Row> | undefined,
): string {
  const sorted = sort !== undefined && column.key === sort.field
    ? sort.direction === "asc" ? " niceeval-sort-asc" : " niceeval-sort-desc"
    : "";
  return [
    "niceeval-classic-table-cell",
    "niceeval-classic-table-sort",
    column.align === "end" ? "niceeval-classic-table-end" : "",
  ].filter((entry) => entry.length > 0).join(" ") + sorted;
}

function renderTreeRow<Row extends RowRecord>(
  columns: readonly TableColumn<Row>[],
  row: Row,
  depth: number,
): AuthorReportNode {
  const record = row as Record<string, unknown>;
  const children = Array.isArray(record.subRows) ? record.subRows as readonly Row[] : [];
  const stale = record.fresh === false;
  const href = typeof record.href === "string" && record.href.length > 0 ? record.href : undefined;
  const rowClass = [
    "niceeval-classic-table-row",
    depth === 0 ? "" : "niceeval-classic-table-child",
    stale ? "niceeval-classic-stale" : "",
  ].filter((entry) => entry.length > 0).join(" ");
  const cells = columns.map((column, index) => {
    const presented = presentClosedLabel(record[column.key]);
    const body = index === 0 && href !== undefined
      ? Link({ href, children: Text({ value: presented }) })
      : Text({ value: presented });
    return classicElement(
      "span",
      column.align === "end" ? "niceeval-classic-table-cell niceeval-classic-table-end" : "niceeval-classic-table-cell",
      body,
    );
  });
  if (children.length === 0) {
    return classicElement("div", rowClass, cells);
  }
  return classicElement("details", stale
    ? "niceeval-classic-table-group niceeval-classic-stale"
    : "niceeval-classic-table-group", [
    classicElement("summary", rowClass, cells),
    classicElement("div", "niceeval-classic-table-children", children.map((child) =>
      renderTreeRow(columns, child, depth + 1)
    )),
  ]);
}

function hasSubRows(rows: readonly object[]): boolean {
  return rows.some((row) => Array.isArray((row as { readonly subRows?: unknown }).subRows) &&
    ((row as { readonly subRows: readonly unknown[] }).subRows.length > 0));
}

function isDisplayableCell(value: unknown): boolean {
  if (value === undefined) return false;
  const presented = presentClosedCell(value);
  return presented !== null;
}

function isNumericColumn<Row extends RowRecord>(rows: readonly Row[], key: string): boolean {
  return rows.some((row) => {
    const value = (row as Record<string, unknown>)[key];
    return typeof value === "number" || isMetricValue(value);
  });
}

function analysisIssuesNode(issues: readonly AnalysisIssue[]): ReportNode {
  return coreTable({
    caption: { en: "Analysis issues", "zh-CN": "Analysis 问题" },
    columns: [
      { key: "code", label: { en: "Code", "zh-CN": "代码" } },
      { key: "message", label: { en: "Message", "zh-CN": "说明" } },
      { key: "evidence", label: { en: "Evidence", "zh-CN": "证据" } },
    ],
    rows: issues.map((issue) => ({
      code: issue.code,
      message: issue.message,
      evidence: issue.refs.map(evidenceRefText).join(", "),
    })),
  });
}

function evidenceRefsNode(refs: readonly EvidenceRef[]): ReportNode {
  return Text({
    value: refs.length === 1 ? evidenceRefText(refs[0]!) : `${refs.length} evidence`,
  });
}

/** Kept for classic renderers that want a compact metric line without changing its data. */
export function metricText(value: MetricValue, locale?: ReportLocale): string {
  return formatMetricValue(value, locale);
}

function classicChartInput<Row extends RowRecord>(input: ClassicChartProps<Row>): ChartProps<Row> {
  const { points, sort, limit, layout, ...channels } = input;
  const visible = applyBarsSortLimit(points, sort, limit);
  const presented = visible
    .map((point) => presentChartPoint(point, channels))
    .filter((point): point is Readonly<Record<string, unknown>> => point !== undefined);
  return {
    ...channels,
    ...(layout === undefined ? {} : { layout }),
    points: Object.freeze(presented) as readonly Row[],
  };
}

function presentChartPoint<Row extends RowRecord>(
  point: Row,
  channels: {
    readonly x: string;
    readonly y: string;
    readonly color?: string;
    readonly series?: string;
    readonly point?: string;
  },
): Readonly<Record<string, unknown>> | undefined {
  const record = point as Record<string, unknown>;
  const x = presentChartAxis(record[channels.x]);
  const y = presentChartAxis(record[channels.y]);
  if (x === undefined || y === undefined) return undefined;
  const presented: Record<string, unknown> = {
    [channels.x]: x,
    [channels.y]: y,
  };
  if (channels.color !== undefined) {
    const color = presentChartAxis(record[channels.color]);
    if (color === undefined) return undefined;
    presented[channels.color] = color;
  }
  if (channels.series !== undefined) {
    const series = presentChartAxis(record[channels.series]);
    if (series === undefined) return undefined;
    presented[channels.series] = series;
  }
  if (channels.point !== undefined) {
    const identity = presentChartAxis(record[channels.point]);
    if (identity === undefined) return undefined;
    presented[channels.point] = identity;
  }
  return Object.freeze(presented);
}

function presentChartAxis(value: unknown): string | number | boolean | MetricValue | undefined {
  if (isMetricValue(value)) return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (value === null || value === undefined) return undefined;
  const presented = presentClosedCell(value);
  return typeof presented === "string" || typeof presented === "number" || typeof presented === "boolean"
    ? presented
    : undefined;
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
  visible: readonly Readonly<Record<string, unknown>>[],
): readonly Readonly<Record<string, unknown>>[] {
  if (!isClosedRows(source)) return Object.freeze([...visible]);
  const metadata = closedRowsMetadata(source);
  if (metadata === undefined) return Object.freeze([...visible]);
  return makeClosedRows({
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
