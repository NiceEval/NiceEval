import type {
  AnalysisIssue,
  ClosedRowsIdentity,
  MetricValue,
  Sample,
} from "../analysis/index.ts";
import {
  closedRowsMetadata,
  isClosedRows,
} from "../analysis/contracts.ts";
import type { LocalizedText } from "../shared/types.ts";
import type { AuthorReportNode } from "./author/element.ts";
import {
  reportComponentNode,
  type DimensionDeclarations,
  type ReportCalloutNode,
  type ReportChartNode,
  type ReportComponentInvocation,
  type ReportDownloadFile,
  type ReportDownloadNode,
  type ReportGridNode,
  type ReportNode,
  type ReportStackNode,
  type ReportStatNode,
  type ReportTableColumn,
  type ReportTableNode,
  type ReportTextNode,
  type ReportTone,
  type TextFaceNode,
  type WebFaceNode,
} from "./semantic/closed.ts";

const reportComponentTypeId: unique symbol = Symbol("@niceeval/report/ReportComponent");

/** Metadata available to Page, compose, and resolve callbacks while live. */
export interface PageContext {
  readonly id: string;
  readonly path: string;
  readonly title: LocalizedText;
}

/** A compose callback can read through this bounded Sample only. */
export interface ComposeContext {
  /** Current spelling retained for the new Analysis-facing author surface. */
  readonly sample: Sample;
  /** v0.12 spelling; it is the exact same Sample capability as `sample`. */
  readonly scope: Sample;
  readonly page: PageContext;
}

/** resolve() has the same live capability boundary as a compose callback. */
export interface ResolveContext extends ComposeContext {}

/** Compatibility aliases for code that named the explicit author callback boundary. */
export type AuthorComposeContext = ComposeContext;
export type AuthorResolveContext = ResolveContext;

/**
 * Host adapters created before scope was restored only supply sample. The
 * descriptor bridge below maps it to the author-required scope without
 * widening the public callback contract or exposing a Record capability.
 */
interface HostComposeContext {
  readonly sample: Sample;
  readonly scope?: Sample;
  readonly page: PageContext;
}

interface HostResolveContext extends HostComposeContext {}

/** Renderer faces are synchronous and receive only the already resolved value. */
export interface TextContext {
  readonly locale: string;
  readonly width: number;
}

/** Renderer faces are synchronous and have no Sample, reader, or DOM handle. */
export interface WebContext {
  readonly locale: string;
}

export interface ComponentFaces<Props extends object, Resolved = Props> {
  readonly resolve?: (
    props: Props,
    context: AuthorResolveContext,
  ) => Resolved | Promise<Resolved>;
  readonly dimensions?: (
    data: Resolved,
    props: Props,
  ) => DimensionDeclarations;
  readonly text: (data: Resolved, context: TextContext) => TextFaceNode;
  readonly web: (data: Resolved, context: WebContext) => WebFaceNode;
}

/**
 * A Report component is a node constructor, not a React component. Calling it
 * records an opaque invocation for the host to resolve exactly once.
 */
export interface ReportComponent<Props extends object> {
  /** Direct invocation remains a semantic component node for existing authors. */
  (props: Props): ReportNode;
  readonly [reportComponentTypeId]: true;
}

export interface ComposeComponentDescriptor {
  readonly kind: "compose";
  readonly compose: (
    props: Readonly<Record<string, unknown>>,
    context: HostComposeContext,
  ) => AuthorReportNode | Promise<AuthorReportNode>;
}

export interface PrimitiveComponentDescriptor {
  readonly kind: "primitive";
  readonly resolve?: (
    props: Readonly<Record<string, unknown>>,
    context: HostResolveContext,
  ) => unknown | Promise<unknown>;
  readonly dimensions?: (
    data: unknown,
    props: Readonly<Record<string, unknown>>,
  ) => DimensionDeclarations;
  readonly text: (data: unknown, context: TextContext) => TextFaceNode;
  readonly web: (data: unknown, context: WebContext) => WebFaceNode;
}

export type ReportComponentDescriptor =
  | ComposeComponentDescriptor
  | PrimitiveComponentDescriptor;

const descriptors = new WeakMap<object, ReportComponentDescriptor>();

/** Defines a composition component that can asynchronously obtain closed data. */
export function defineComponent<Props extends object>(
  compose: (
    props: Props,
    context: AuthorComposeContext,
  ) => AuthorReportNode | Promise<AuthorReportNode>,
): ReportComponent<Props>;

/** Defines a dual-face primitive with one shared optional resolve phase. */
export function defineComponent<Props extends object, Resolved = Props>(
  faces: ComponentFaces<Props, Resolved>,
): ReportComponent<Props>;

export function defineComponent<Props extends object>(
  input:
    | ((props: Props, context: AuthorComposeContext) => AuthorReportNode | Promise<AuthorReportNode>)
    | ComponentFaces<Props, unknown>,
): ReportComponent<Props> {
  const descriptor = typeof input === "function"
    ? composeDescriptor(input)
    : primitiveDescriptor(input);
  const component = ((props: Props): ReportNode =>
    reportComponentNode(component, copyProps(props))) as ReportComponent<Props>;
  Object.defineProperty(component, reportComponentTypeId, {
    value: true,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  descriptors.set(component, descriptor);
  return Object.freeze(component);
}

/** @internal Host bridge for the exact component factory returned by defineComponent(). */
export function reportComponentDescriptor(component: unknown): ReportComponentDescriptor {
  if ((typeof component !== "object" && typeof component !== "function") || component === null) {
    throw new TypeError("a Report component must be created by defineComponent");
  }
  const descriptor = descriptors.get(component);
  if (descriptor === undefined) {
    throw new TypeError("a Report component must be created by defineComponent");
  }
  return descriptor;
}

/** @internal Tests whether an unresolved node belongs to this Report runtime. */
export function isReportComponentInvocation(
  value: unknown,
): value is ReportComponentInvocation {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const node = value as Partial<ReportComponentInvocation>;
  return node.type === "component" &&
    (typeof node.component === "object" || typeof node.component === "function") &&
    node.component !== null && descriptors.has(node.component) && isPlainObject(node.props);
}

/** A neutral text node. Text remains data and never becomes raw HTML. */
export function Text(input: { readonly value: string }): ReportTextNode {
  return Object.freeze({ type: "text" as const, value: input.value });
}

/** Groups child nodes vertically without attaching a renderer callback. */
export function Stack(input: { readonly children: readonly ReportNode[] }): ReportStackNode {
  return Object.freeze({ type: "stack" as const, children: freezeArray(input.children) });
}

/** Groups child nodes in a renderer-chosen grid without CSS author input. */
export function Grid(input: { readonly children: readonly ReportNode[] }): ReportGridNode {
  return Object.freeze({ type: "grid" as const, children: freezeArray(input.children) });
}

/** Adds a semantic status grouping; text and web choose their own presentation. */
export function Callout(input: {
  readonly tone: ReportTone;
  readonly title?: LocalizedText;
  readonly children: readonly ReportNode[];
}): ReportCalloutNode {
  return Object.freeze({
    type: "callout" as const,
    tone: input.tone,
    ...(input.title === undefined ? {} : { title: cloneLocalizedText(input.title) }),
    children: freezeArray(input.children),
  });
}

/** A closed file payload authored into a Download semantic primitive. */
export type DownloadFile = ReportDownloadFile;

/**
 * A Download carries only closed bytes and semantic children. Execution owns
 * path validation, collision detection, and collection into its download set.
 */
export function Download(input: {
  readonly file: DownloadFile;
  readonly children: ReportNode | readonly ReportNode[];
}): ReportDownloadNode {
  const file = freezeDownloadFile(input.file);
  return Object.freeze({
    type: "download" as const,
    file,
    children: normalizeChildren(input.children),
  });
}

type RowRecord = object;
type StringKey<Row> = Extract<keyof Row, string>;
type ChartScalar = string | number | boolean | MetricValue<unknown>;

export type ChartAxisKey<Row extends RowRecord> = {
  readonly [Key in keyof Row]-?: Row[Key] extends ChartScalar ? Key : never;
}[keyof Row] & string;

export type ChartDimensionKey<Row extends RowRecord> = {
  readonly [Key in keyof Row]-?: Row[Key] extends string | number | boolean ? Key : never;
}[keyof Row] & string;

export interface TableColumn<Row extends RowRecord> {
  readonly key: StringKey<Row>;
  readonly label: LocalizedText;
  readonly align?: "start" | "end";
}

/** A neutral table retains row values rather than projecting them into strings. */
export function Table<Row extends RowRecord>(input: {
  readonly rows: readonly Row[];
  readonly columns?: readonly TableColumn<Row>[];
  readonly caption?: LocalizedText;
}): ReportTableNode {
  const rows = freezeRows(input.rows);
  const columns = input.columns === undefined
    ? inferColumns(rows)
    : freezeColumns(input.columns);
  return Object.freeze({
    type: "table" as const,
    ...(input.caption === undefined ? {} : { caption: cloneLocalizedText(input.caption) }),
    columns,
    rows,
    ...rowsMetadata(input.rows),
  });
}

export interface ChartProps<Row extends RowRecord> {
  readonly points: readonly Row[];
  readonly x: ChartAxisKey<Row>;
  readonly y: ChartAxisKey<Row>;
  readonly color?: ChartDimensionKey<Row>;
  readonly series?: ChartDimensionKey<Row>;
  readonly title?: LocalizedText;
}

/** A neutral bar chart; the Host later verifies every requested field. */
export function Bars<Row extends RowRecord>(input: ChartProps<Row>): ReportChartNode {
  return chartNode("bars", input);
}

/** A neutral line chart; it never recalculates a MetricValue. */
export function Line<Row extends RowRecord>(input: ChartProps<Row>): ReportChartNode {
  return chartNode("line", input);
}

/** A neutral scatter chart; it preserves the same rows passed to Table. */
export function Scatter<Row extends RowRecord>(input: ChartProps<Row>): ReportChartNode {
  return chartNode("scatter", input);
}

/** A statistic accepts the whole MetricValue, never an extracted number. */
export function Stat(input: {
  readonly label: LocalizedText;
  readonly value: MetricValue;
}): ReportStatNode {
  return Object.freeze({
    type: "stat" as const,
    label: cloneLocalizedText(input.label),
    value: input.value,
  });
}

function composeDescriptor<Props extends object>(
  compose: (
    props: Props,
    context: AuthorComposeContext,
  ) => AuthorReportNode | Promise<AuthorReportNode>,
): ComposeComponentDescriptor {
  if (typeof compose !== "function") {
    throw new TypeError("defineComponent(compose) requires a compose callback");
  }
  return Object.freeze({
    kind: "compose" as const,
    compose: (props: Readonly<Record<string, unknown>>, context: HostComposeContext) => compose(
      props as Props,
      authorComposeContext(context),
    ),
  });
}

function primitiveDescriptor<Props extends object>(
  faces: ComponentFaces<Props, unknown>,
): PrimitiveComponentDescriptor {
  const fields = ownFields(faces, "defineComponent(faces)");
  for (const key of fields.keys()) {
    if (key !== "resolve" && key !== "dimensions" && key !== "text" && key !== "web") {
      throw new TypeError(`defineComponent(faces) has an unknown field: ${key}`);
    }
  }
  const text = fields.get("text");
  const web = fields.get("web");
  if (typeof text !== "function" || typeof web !== "function") {
    throw new TypeError("defineComponent(faces) requires both synchronous text and web faces");
  }
  const resolve = fields.get("resolve");
  const dimensions = fields.get("dimensions");
  if (resolve !== undefined && typeof resolve !== "function") {
    throw new TypeError("defineComponent(faces).resolve must be a function when supplied");
  }
  if (dimensions !== undefined && typeof dimensions !== "function") {
    throw new TypeError("defineComponent(faces).dimensions must be a function when supplied");
  }
  const authorResolve = resolve === undefined
    ? undefined
    : (props: Readonly<Record<string, unknown>>, context: HostResolveContext) =>
      (resolve as (props: Props, context: AuthorResolveContext) => unknown | Promise<unknown>)(
        props as Props,
        authorComposeContext(context),
      );
  return Object.freeze({
    kind: "primitive" as const,
    ...(authorResolve === undefined
      ? {}
      : { resolve: authorResolve }),
    ...(dimensions === undefined
      ? {}
      : { dimensions: dimensions as PrimitiveComponentDescriptor["dimensions"] }),
    text: text as PrimitiveComponentDescriptor["text"],
    web: web as PrimitiveComponentDescriptor["web"],
  });
}

function authorComposeContext(context: HostComposeContext): AuthorComposeContext {
  // Scope and sample deliberately cannot diverge.  Older Host adapters may
  // omit `scope`, but no adapter can expose a second capability under that
  // legacy spelling.
  if (context.scope !== undefined && context.scope !== context.sample) {
    throw new TypeError("Report compose context scope and sample must be the same Sample capability");
  }
  return Object.freeze({ sample: context.sample, scope: context.sample, page: context.page });
}

function chartNode<Row extends RowRecord>(
  type: ReportChartNode["type"],
  input: ChartProps<Row>,
): ReportChartNode {
  return Object.freeze({
    type,
    ...(input.title === undefined ? {} : { title: cloneLocalizedText(input.title) }),
    points: freezeRows(input.points),
    x: input.x,
    y: input.y,
    ...(input.color === undefined ? {} : { color: input.color }),
    ...(input.series === undefined ? {} : { series: input.series }),
    ...rowsMetadata(input.points),
  });
}

function freezeRows<Row extends RowRecord>(rows: readonly Row[]): readonly Readonly<Record<string, unknown>>[] {
  return Object.freeze(rows.map((row) => copyProps(row)));
}

function inferColumns(rows: readonly Readonly<Record<string, unknown>>[]): readonly ReportTableColumn[] {
  const keys = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) keys.add(key);
  }
  return Object.freeze([...keys]
    .sort(compareUtf8)
    .map((key) => Object.freeze({ key, label: key })));
}

function freezeColumns<Row extends RowRecord>(
  columns: readonly TableColumn<Row>[],
): readonly ReportTableColumn[] {
  return Object.freeze(columns.map((column) =>
    Object.freeze({
      key: column.key,
      label: cloneLocalizedText(column.label),
      ...(column.align === undefined ? {} : { align: column.align }),
    })
  ));
}

function rowsMetadata(rows: readonly unknown[]): {
  readonly identity?: ClosedRowsIdentity;
  readonly issues?: readonly AnalysisIssue[];
} {
  if (!isClosedRows(rows)) return {};
  const metadata = closedRowsMetadata(rows);
  if (metadata === undefined) return {};
  return Object.freeze({
    identity: metadata.identity,
    issues: metadata.issues,
  });
}

function freezeDownloadFile(value: DownloadFile): ReportDownloadFile {
  const fields = ownFields(value, "Download.file");
  for (const key of fields.keys()) {
    if (key !== "path" && key !== "mediaType" && key !== "bytes") {
      throw new TypeError(`Download.file has an unknown field: ${key}`);
    }
  }
  const path = fields.get("path");
  const mediaType = fields.get("mediaType");
  const bytes = fields.get("bytes");
  if (typeof path !== "string" || typeof mediaType !== "string" || !(bytes instanceof Uint8Array)) {
    throw new TypeError("Download.file requires string path, string mediaType, and Uint8Array bytes");
  }
  return Object.freeze({ path, mediaType, bytes: new Uint8Array(bytes) });
}

function normalizeChildren(value: ReportNode | readonly ReportNode[]): readonly ReportNode[] {
  return Array.isArray(value)
    ? freezeArray(value as readonly ReportNode[])
    : Object.freeze([value as ReportNode]);
}

function compareUtf8(left: string, right: string): number {
  if (left === right) return 0;
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    const difference = leftBytes[index]! - rightBytes[index]!;
    if (difference !== 0) return difference;
  }
  return leftBytes.length - rightBytes.length;
}

function cloneLocalizedText(value: LocalizedText): LocalizedText {
  if (typeof value === "string") return value;
  return Object.freeze({ ...value });
}

function copyProps(value: object): Readonly<Record<string, unknown>> {
  const fields = ownFields(value, "Report component props");
  const copy: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const [key, fieldValue] of fields) copy[key] = fieldValue;
  return Object.freeze(copy);
}

function ownFields(value: unknown, label: string): ReadonlyMap<string, unknown> {
  if (!isPlainObject(value)) {
    throw new TypeError(`${label} must be a plain object`);
  }
  const entries: Array<readonly [string, unknown]> = [];
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") {
      throw new TypeError(`${label} cannot contain symbol fields`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
      throw new TypeError(`${label} cannot contain accessors or hidden fields`);
    }
    entries.push([key, descriptor.value]);
  }
  return new Map(entries);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function freezeArray<Value>(values: readonly Value[]): readonly Value[] {
  return Object.freeze([...values]);
}
