import type { LocalizedText } from "../../shared/types.ts";
import type {
  AnalysisIssue,
  ClosedRowsIdentity,
  MetricValue,
} from "../../analysis/index.ts";
import { hasCompleteReportLocaleMap } from "../classic/locale.ts";
import type { ReportClosedValue } from "./value.ts";

export const REPORT_DOCUMENT_NODES_MAX = 20_000;
/** A complete SSG revision may contain many independently bounded Pages. */
const REPORT_SITE_NODES_MAX = 1_000_000;
export const REPORT_DOCUMENT_DEPTH_MAX = 32;

export type ReportTone = "neutral" | "positive" | "warning" | "negative";

export interface ReportTextNode {
  readonly type: "text";
  /** Language-neutral text or a complete closed browser-locale map. */
  readonly value: LocalizedText;
}

export interface ReportStackNode {
  readonly type: "stack";
  readonly children: readonly ReportNode[];
}

export interface ReportGridNode {
  readonly type: "grid";
  readonly children: readonly ReportNode[];
}

export interface ReportCalloutNode {
  readonly type: "callout";
  readonly tone: ReportTone;
  readonly title?: LocalizedText;
  readonly children: readonly ReportNode[];
}

export interface ReportTableColumn {
  readonly key: string;
  readonly label: LocalizedText;
  readonly align?: "start" | "end";
}

export interface ReportTableNode {
  readonly type: "table";
  readonly caption?: LocalizedText;
  /**
   * Table() always materializes columns, including an empty list for an empty
   * external rows array. A manually-authored node therefore cannot leave the
   * renderer to guess a table shape.
   */
  readonly columns: readonly ReportTableColumn[];
  readonly rows: readonly Readonly<Record<string, unknown>>[];
  readonly identity?: ClosedRowsIdentity;
  readonly issues?: readonly AnalysisIssue[];
}

export interface ReportChartNode {
  readonly type: "bars" | "line" | "scatter";
  readonly title?: LocalizedText;
  readonly points: readonly Readonly<Record<string, unknown>>[];
  readonly x: string;
  readonly y: string;
  readonly color?: string;
  readonly series?: string;
  /** Display-only point identity field; it does not change chart statistics. */
  readonly point?: string;
  /** Display-only orientation for bar charts. */
  readonly layout?: "horizontal" | "vertical";
  readonly identity?: ClosedRowsIdentity;
  readonly issues?: readonly AnalysisIssue[];
}

export interface ReportStatNode {
  readonly type: "stat";
  readonly label: LocalizedText;
  readonly value: MetricValue;
}

/** Bytes are closed author data; their output path is only interpreted by Host. */
export interface ReportDownloadFile {
  readonly path: string;
  readonly mediaType: string;
  readonly bytes: Uint8Array;
}

/**
 * An authored Download is still open: execution resolves its children, closes
 * its bytes into ClosedReportTree.downloads, and replaces file.path with a
 * closed download id before any renderer sees it.
 */
export interface ReportDownloadNode {
  readonly type: "download";
  readonly file: ReportDownloadFile;
  readonly children: readonly ReportNode[];
}

/**
 * An unresolved component instance. It is valid only while the Report Host is
 * executing author callbacks; it is deliberately absent from ClosedReportNode.
 */
export interface ReportComponentInvocation {
  readonly type: "component";
  readonly component: unknown;
  readonly props: Readonly<Record<string, unknown>>;
}

export type ReportNode =
  | ReportTextNode
  | ReportStackNode
  | ReportGridNode
  | ReportCalloutNode
  | ReportTableNode
  | ReportChartNode
  | ReportStatNode
  | ReportDownloadNode
  | ReportComponentInvocation;

export interface ClosedTextNode {
  readonly type: "text";
  /** Language-neutral text or a complete closed browser-locale map. */
  readonly value: LocalizedText;
}

export interface ClosedStackNode {
  readonly type: "stack";
  readonly children: readonly ClosedReportNode[];
}

export interface ClosedGridNode {
  readonly type: "grid";
  readonly children: readonly ClosedReportNode[];
}

export interface ClosedCalloutNode {
  readonly type: "callout";
  readonly tone: ReportTone;
  readonly title?: LocalizedText;
  readonly children: readonly ClosedReportNode[];
}

export interface ClosedTableNode {
  readonly type: "table";
  readonly caption?: LocalizedText;
  readonly columns: readonly ReportTableColumn[];
  readonly rows: readonly Readonly<Record<string, ReportClosedValue | MetricValue>>[];
  readonly identity?: ClosedRowsIdentity;
  readonly issues?: readonly AnalysisIssue[];
}

export interface ClosedChartNode {
  readonly type: "bars" | "line" | "scatter";
  readonly title?: LocalizedText;
  readonly points: readonly Readonly<Record<string, ReportClosedValue | MetricValue>>[];
  readonly x: string;
  readonly y: string;
  readonly color?: string;
  readonly series?: string;
  /** Display-only point identity field; it does not change chart statistics. */
  readonly point?: string;
  /** Display-only orientation for bar charts. */
  readonly layout?: "horizontal" | "vertical";
  readonly identity?: ClosedRowsIdentity;
  readonly issues?: readonly AnalysisIssue[];
}

export interface ClosedStatNode {
  readonly type: "stat";
  readonly label: LocalizedText;
  readonly value: MetricValue;
}

/** A renderer-safe link to an item already collected in ClosedReportTree.downloads. */
export interface ClosedDownloadNode {
  readonly type: "download";
  readonly id: string;
  readonly children: readonly ClosedReportNode[];
}

/** A deliberately small, data-only subset of intrinsic JSX structure. */
export type ClosedElementTag =
  | "article"
  | "aside"
  | "blockquote"
  | "code"
  | "details"
  | "div"
  | "em"
  | "footer"
  | "header"
  | "h1"
  | "h2"
  | "h3"
  | "h4"
  | "h5"
  | "h6"
  | "li"
  | "main"
  | "ol"
  | "p"
  | "pre"
  | "section"
  | "small"
  | "span"
  | "strong"
  | "summary"
  | "ul";

/**
 * JSX intrinsic elements become this closed semantic shape.  It carries no
 * DOM object, event handler, inline style, or arbitrary attribute bag.
 */
export interface ClosedElementNode {
  readonly type: "element";
  readonly tag: ClosedElementTag;
  readonly classes?: readonly string[];
  readonly children: readonly ClosedReportNode[];
}

/** A closed link targets a local route/fragment or an explicit HTTPS navigation. */
export interface ClosedLinkNode {
  readonly type: "link";
  readonly href: string;
  readonly children: readonly ClosedReportNode[];
}

export interface DimensionDeclarations {
  readonly minWidth?: number;
  readonly minHeight?: number;
  readonly preferredWidth?: number;
  readonly preferredHeight?: number;
}

/**
 * The result of a dual-face primitive after resolve() has run. Both renderer
 * faces are data-only nodes; neither can contain a DOM object or callback.
 */
export interface ClosedPrimitiveNode {
  readonly type: "primitive";
  readonly text: TextFaceNode;
  readonly web: WebFaceNode;
  readonly dimensions?: DimensionDeclarations;
}

export type ClosedReportNode =
  | ClosedTextNode
  | ClosedStackNode
  | ClosedGridNode
  | ClosedCalloutNode
  | ClosedTableNode
  | ClosedChartNode
  | ClosedStatNode
  | ClosedDownloadNode
  | ClosedElementNode
  | ClosedLinkNode
  | ClosedPrimitiveNode;

/** The terminal face of an authored primitive. */
export type TextFaceNode = ClosedReportNode;

/** The web face of an authored primitive. */
export type WebFaceNode = ClosedReportNode;

export interface ClosedReportPage {
  readonly pageId: string;
  readonly route: string;
  readonly title: LocalizedText;
  /** Closed navigation intent; terminal, web, and static share this hierarchy. */
  readonly navigation: boolean;
  /** Safe metadata and scoped styles collected while author callbacks are live. */
  readonly head: ClosedReportHead;
  readonly node: ClosedReportNode;
  readonly problemIds: readonly number[];
}

/** A closed attribute bag never contains callbacks, URL schemes, or DOM values. */
export type ClosedHeadAttributeValue = string | true;
export type ClosedHeadAttributes = Readonly<Record<string, ClosedHeadAttributeValue>>;

/**
 * Metadata is deliberately limited to inert `meta` and local `link` tags.
 * A closed tree therefore cannot acquire a script, stylesheet URL, or network
 * dependency after the author Scope has ended.
 */
export interface ClosedReportHeadMetadata {
  readonly tag: "meta" | "link";
  readonly attrs: ClosedHeadAttributes;
}

/** CSS has already been parsed, scoped, and stripped of network/script escape hatches. */
export interface ClosedReportStyle {
  readonly attrs?: ClosedHeadAttributes;
  readonly css: string;
}

export interface ClosedReportHead {
  readonly metadata: readonly ClosedReportHeadMetadata[];
  readonly styles: readonly ClosedReportStyle[];
}

export interface ClosedDownload {
  readonly id: string;
  readonly mediaType: string;
  readonly bytes: Uint8Array;
}

export interface ClosedReportProblem {
  readonly id: number;
  readonly code: string;
  readonly summary: string;
}

/** The only Report value a terminal, web revision, or static export may read. */
export interface ClosedReportTree {
  readonly pages: readonly ClosedReportPage[];
  readonly downloads: readonly ClosedDownload[];
  readonly problemTable: readonly ClosedReportProblem[];
}

export interface ReportSemanticIssue {
  readonly code:
    | "shape"
    | "unicode"
    | "number"
    | "metric"
    | "table"
    | "chart"
    | "cycle"
    | "limit"
    | "unsafe-capability";
  readonly path: readonly (string | number)[];
  readonly reason: string;
}

export interface ClosedReportNodeValidation {
  readonly valid: boolean;
  readonly issues: readonly ReportSemanticIssue[];
  readonly nodeCount: number;
}

/** The only two link navigation capabilities a closed Report may carry. */
export type ClosedLinkTarget = "local" | "https";

/**
 * Classifies a renderer-safe user navigation without performing any request.
 * Local paths/fragment identifiers remain same-origin; an external target is
 * accepted only when it is explicitly a fully qualified HTTPS URL.
 */
export function closedLinkTarget(value: unknown): ClosedLinkTarget | undefined {
  if (typeof value !== "string" || !hasOnlyUnicodeScalars(value)) return undefined;
  if (isLocalReportHref(value)) return "local";
  if (!/^https:\/\//i.test(value) || hasUrlUserInfo(value)) return undefined;
  try {
    const target = new URL(value);
    return target.protocol === "https:" && target.hostname.length > 0 &&
      target.username.length === 0 && target.password.length === 0
      ? "https"
      : undefined;
  } catch {
    return undefined;
  }
}

function hasUrlUserInfo(value: string): boolean {
  const authority = value.slice(value.indexOf("://") + 3).split(/[/?#]/, 1)[0] ?? "";
  return authority.includes("@");
}

const encoder = new TextEncoder();
const MAX_ISSUES = 64;
const CLOSED_HEAD_ATTRIBUTE_NAME = /^[A-Za-z_:][A-Za-z0-9:._-]*$/;
const CLOSED_META_ATTRIBUTES = new Set(["content", "itemprop", "name", "property"]);
const CLOSED_LINK_ATTRIBUTES = new Set(["href", "hreflang", "rel", "title", "type"]);
const CLOSED_STYLE_ATTRIBUTES = new Set(["media", "type"]);
const CLOSED_LINK_RELATIONS = new Set(["alternate", "author", "canonical", "license"]);

/** Builds an unresolved component node without ever treating it as closed. */
export function reportComponentNode(
  component: unknown,
  props: Readonly<Record<string, unknown>>,
): ReportComponentInvocation {
  return Object.freeze({ type: "component" as const, component, props });
}

/** Validates a fully resolved node before any renderer receives it. */
export function validateClosedReportNode(value: unknown): ClosedReportNodeValidation {
  const state = validationState();
  validateNode(value, state, [], 0);
  return validationResult(state);
}

/** Validates a complete execution tree, including pages and static assets. */
export function validateClosedReportTree(value: unknown): ClosedReportNodeValidation {
  const state = validationState(REPORT_SITE_NODES_MAX);
  const tree = enterRecord(value, state, [], 0);
  if (tree !== undefined) {
    try {
      exactFields(tree, ["pages", "downloads", "problemTable"], state, []);
      forEachArray(field(tree, "pages"), state, ["pages"], (page, index) => {
        if (state.nodeCount > state.nodeLimit) return;
        const pageState = validationState();
        validatePage(page, pageState, ["pages", index]);
        mergeValidationState(state, pageState, ["pages", index]);
      });
      forEachArray(field(tree, "downloads"), state, ["downloads"], (download, index) =>
        validateDownload(download, state, ["downloads", index]),
      );
      forEachArray(field(tree, "problemTable"), state, ["problemTable"], (problem, index) =>
        validateProblem(problem, state, ["problemTable", index]),
      );
    } finally {
      state.active.delete(tree);
    }
  }
  return validationResult(state);
}

/** Deep-freezes a validated semantic node and rejects all executable values. */
export function freezeClosedReportNode(value: unknown): ClosedReportNode {
  const validation = validateClosedReportNode(value);
  if (!validation.valid) {
    throw new TypeError("a closed Report node must contain only validated semantic data");
  }
  return cloneValue(value) as ClosedReportNode;
}

/** Deep-freezes the sole renderer input after validating its complete closure. */
export function freezeClosedReportTree(value: unknown): ClosedReportTree {
  const validation = validateClosedReportTree(value);
  if (!validation.valid) {
    throw new TypeError("a closed Report tree must contain only validated semantic data");
  }
  return cloneValue(value) as ClosedReportTree;
}

interface ValidationState {
  readonly issues: ReportSemanticIssue[];
  readonly active: Set<object>;
  readonly nodeLimit: number;
  nodeCount: number;
}

function validationState(nodeLimit = REPORT_DOCUMENT_NODES_MAX): ValidationState {
  return { issues: [], active: new Set<object>(), nodeLimit, nodeCount: 0 };
}

function mergeValidationState(
  target: ValidationState,
  source: ValidationState,
  path: readonly (string | number)[],
): void {
  const before = target.nodeCount;
  target.nodeCount += source.nodeCount;
  if (before <= target.nodeLimit && target.nodeCount > target.nodeLimit) {
    issue(target, "limit", path, `a Report site may contain at most ${target.nodeLimit} nodes`);
  }
  for (const entry of source.issues) {
    if (target.issues.length >= MAX_ISSUES) return;
    target.issues.push(entry);
  }
}

function validationResult(state: ValidationState): ClosedReportNodeValidation {
  return Object.freeze({
    valid: state.issues.length === 0,
    issues: Object.freeze(state.issues),
    nodeCount: state.nodeCount,
  });
}

function validatePage(
  value: unknown,
  state: ValidationState,
  path: readonly (string | number)[],
): void {
  const page = enterRecord(value, state, path, 0);
  if (page === undefined) return;
  try {
    exactFields(page, ["pageId", "route", "title", "navigation", "head", "node", "problemIds"], state, path);
    validateIdentifier(field(page, "pageId"), state, append(path, "pageId"));
    validateRoute(field(page, "route"), state, append(path, "route"));
    validateLocalizedText(field(page, "title"), state, append(path, "title"));
    if (typeof field(page, "navigation") !== "boolean") {
      issue(state, "shape", append(path, "navigation"), "a closed Report Page navigation field must be boolean");
    }
    validateHead(field(page, "head"), state, append(path, "head"));
    validateNode(field(page, "node"), state, append(path, "node"), 1);
    forEachArray(field(page, "problemIds"), state, append(path, "problemIds"), (id, index) =>
      validateProblemId(id, state, append(append(path, "problemIds"), index)),
    );
  } finally {
    state.active.delete(page);
  }
}

function validateHead(
  value: unknown,
  state: ValidationState,
  path: readonly (string | number)[],
): void {
  const head = enterRecord(value, state, path, 0);
  if (head === undefined) return;
  try {
    exactFields(head, ["metadata", "styles"], state, path);
    forEachArray(field(head, "metadata"), state, append(path, "metadata"), (entry, index) => {
      const entryPath = append(append(path, "metadata"), index);
      const metadata = enterRecord(entry, state, entryPath, 0);
      if (metadata === undefined) return;
      try {
        exactFields(metadata, ["tag", "attrs"], state, entryPath);
        const tag = field(metadata, "tag");
        if (tag !== "meta" && tag !== "link") {
          issue(state, "shape", append(entryPath, "tag"), "closed Report head metadata must be meta or inert link");
          return;
        }
        validateClosedHeadAttributes(field(metadata, "attrs"), tag, state, append(entryPath, "attrs"));
      } finally {
        state.active.delete(metadata);
      }
    });
    forEachArray(field(head, "styles"), state, append(path, "styles"), (entry, index) => {
      const entryPath = append(append(path, "styles"), index);
      const style = enterRecord(entry, state, entryPath, 0);
      if (style === undefined) return;
      try {
        exactFields(style, ["attrs", "css"], state, entryPath);
        if (Object.hasOwn(style, "attrs")) {
          validateClosedHeadAttributes(field(style, "attrs"), "style", state, append(entryPath, "attrs"));
        }
        const css = field(style, "css");
        validateString(css, state, append(entryPath, "css"));
        if (typeof css === "string" && !isScopedClosedCss(css)) {
          issue(state, "unsafe-capability", append(entryPath, "css"), "closed Report CSS must be host-scoped and cannot load or cover host surfaces");
        }
      } finally {
        state.active.delete(style);
      }
    });
  } finally {
    state.active.delete(head);
  }
}

function validateClosedHeadAttributes(
  value: unknown,
  tag: "meta" | "link" | "style",
  state: ValidationState,
  path: readonly (string | number)[],
): void {
  const attrs = enterRecord(value, state, path, 0);
  if (attrs === undefined) return;
  try {
    const allowed = tag === "meta"
      ? CLOSED_META_ATTRIBUTES
      : tag === "link"
      ? CLOSED_LINK_ATTRIBUTES
      : CLOSED_STYLE_ATTRIBUTES;
    for (const key of Object.keys(attrs)) {
      const attributePath = append(path, key);
      const attribute = field(attrs, key);
      if (!allowed.has(key) || !CLOSED_HEAD_ATTRIBUTE_NAME.test(key) || key.toLowerCase().startsWith("on")) {
        issue(state, "unsafe-capability", attributePath, "this head attribute is not part of the closed safe metadata model");
        continue;
      }
      if (attribute !== true && typeof attribute !== "string") {
        issue(state, "shape", attributePath, "a closed head attribute must be a string or true");
        continue;
      }
      if (typeof attribute === "string") validateString(attribute, state, attributePath);
    }
    if (tag === "link") {
      const rel = field(attrs, "rel");
      const href = field(attrs, "href");
      if (typeof rel !== "string" || !CLOSED_LINK_RELATIONS.has(rel.toLowerCase()) ||
        typeof href !== "string" || !isLocalHeadReference(href)) {
        issue(state, "unsafe-capability", path, "a closed link must be inert metadata with a local href");
      }
    }
    if (tag === "style" && Object.hasOwn(attrs, "type") && field(attrs, "type") !== "text/css") {
      issue(state, "shape", append(path, "type"), "a closed style type must be text/css");
    }
  } finally {
    state.active.delete(attrs);
  }
}

function validateDownload(
  value: unknown,
  state: ValidationState,
  path: readonly (string | number)[],
): void {
  const download = enterRecord(value, state, path, 0);
  if (download === undefined) return;
  try {
    exactFields(download, ["id", "mediaType", "bytes"], state, path);
    validateIdentifier(field(download, "id"), state, append(path, "id"));
    validateString(field(download, "mediaType"), state, append(path, "mediaType"));
    if (!(field(download, "bytes") instanceof Uint8Array)) {
      issue(state, "shape", append(path, "bytes"), "a closed download must contain Uint8Array bytes");
    }
  } finally {
    state.active.delete(download);
  }
}

function validateProblem(
  value: unknown,
  state: ValidationState,
  path: readonly (string | number)[],
): void {
  const problem = enterRecord(value, state, path, 0);
  if (problem === undefined) return;
  try {
    exactFields(problem, ["id", "code", "summary"], state, path);
    validateProblemId(field(problem, "id"), state, append(path, "id"));
    validateIdentifier(field(problem, "code"), state, append(path, "code"));
    validateString(field(problem, "summary"), state, append(path, "summary"));
  } finally {
    state.active.delete(problem);
  }
}

function validateNode(
  value: unknown,
  state: ValidationState,
  path: readonly (string | number)[],
  depth: number,
): void {
  const node = enterRecord(value, state, path, depth);
  if (node === undefined) return;
  try {
    switch (field(node, "type")) {
      case "text":
        exactFields(node, ["type", "value"], state, path);
        validateLocalizedText(field(node, "value"), state, append(path, "value"));
        return;
      case "stack":
      case "grid":
        exactFields(node, ["type", "children"], state, path);
        validateChildren(field(node, "children"), state, append(path, "children"), depth + 1);
        return;
      case "callout":
        exactFields(node, ["type", "tone", "title", "children"], state, path);
        if (!isTone(field(node, "tone"))) {
          issue(state, "shape", append(path, "tone"), "a callout tone must be recognized");
        }
        optionalLocalizedText(node, "title", state, path);
        validateChildren(field(node, "children"), state, append(path, "children"), depth + 1);
        return;
      case "table":
        validateTable(node, state, path);
        return;
      case "bars":
      case "line":
      case "scatter":
        validateChart(node, state, path);
        return;
      case "stat":
        exactFields(node, ["type", "label", "value"], state, path);
        validateLocalizedText(field(node, "label"), state, append(path, "label"));
        validateMetricValue(field(node, "value"), state, append(path, "value"));
        return;
      case "download":
        exactFields(node, ["type", "id", "children"], state, path);
        validateString(field(node, "id"), state, append(path, "id"));
        validateChildren(field(node, "children"), state, append(path, "children"), depth + 1);
        return;
      case "element":
        validateElement(node, state, path, depth);
        return;
      case "link":
        exactFields(node, ["type", "href", "children"], state, path);
        validateLinkHref(field(node, "href"), state, append(path, "href"));
        validateChildren(field(node, "children"), state, append(path, "children"), depth + 1);
        return;
      case "primitive":
        exactFields(node, ["type", "text", "web", "dimensions"], state, path);
        validateNode(field(node, "text"), state, append(path, "text"), depth + 1);
        validateNode(field(node, "web"), state, append(path, "web"), depth + 1);
        optionalDimensions(node, state, path);
        return;
      case "component":
        issue(
          state,
          "unsafe-capability",
          path,
          "an unresolved component callback cannot enter a closed Report tree",
        );
        return;
      default:
        issue(state, "shape", append(path, "type"), "this node type is not part of the closed Report model");
    }
  } finally {
    state.active.delete(node);
  }
}

function validateElement(
  node: Record<string, unknown>,
  state: ValidationState,
  path: readonly (string | number)[],
  depth: number,
): void {
  exactFields(node, ["type", "tag", "classes", "children"], state, path);
  if (!isClosedElementTag(field(node, "tag"))) {
    issue(state, "shape", append(path, "tag"), "this JSX tag is not part of the closed Report model");
  }
  if (Object.hasOwn(node, "classes")) {
    forEachArray(field(node, "classes"), state, append(path, "classes"), (entry, index) => {
      if (typeof entry !== "string" || !isSafeCssClass(entry)) {
        issue(state, "unsafe-capability", append(append(path, "classes"), index), "a closed JSX class must be a safe author-scoped token");
      }
    });
  }
  validateChildren(field(node, "children"), state, append(path, "children"), depth + 1);
}

function validateLinkHref(
  value: unknown,
  state: ValidationState,
  path: readonly (string | number)[],
): void {
  if (closedLinkTarget(value) === undefined) {
    issue(state, "unsafe-capability", path, "a closed Report link must be a local route, fragment, or explicit HTTPS URL");
  }
}

function isLocalReportHref(value: string): boolean {
  if (!(value.startsWith("/") || value.startsWith("#"))) return false;
  try {
    return new URL(value, "https://niceeval.invalid/").origin === "https://niceeval.invalid";
  } catch {
    return false;
  }
}

function isLocalHeadReference(value: string): boolean {
  return value.length > 0 && hasOnlyUnicodeScalars(value) && !value.startsWith("//") &&
    !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value);
}

function validateChildren(
  value: unknown,
  state: ValidationState,
  path: readonly (string | number)[],
  depth: number,
): void {
  forEachArray(value, state, path, (child, index) =>
    validateNode(child, state, append(path, index), depth),
  );
}

function validateTable(
  table: Record<string, unknown>,
  state: ValidationState,
  path: readonly (string | number)[],
): void {
  exactFields(table, ["type", "caption", "columns", "rows", "identity", "issues"], state, path);
  optionalLocalizedText(table, "caption", state, path);
  const columns = validateColumns(field(table, "columns"), state, append(path, "columns"));
  validateRows(field(table, "rows"), state, append(path, "rows"), columns);
  optionalRowsMetadata(table, state, path);
}

function validateColumns(
  value: unknown,
  state: ValidationState,
  path: readonly (string | number)[],
): readonly string[] {
  const keys: string[] = [];
  forEachArray(value, state, path, (column, index) => {
    const columnPath = append(path, index);
    const record = enterRecord(column, state, columnPath, 0);
    if (record === undefined) return;
    try {
      exactFields(record, ["key", "label", "align"], state, columnPath);
      const key = field(record, "key");
      if (typeof key !== "string" || key.length === 0) {
        issue(state, "table", append(columnPath, "key"), "a table column key must be a non-empty string");
      } else if (keys.includes(key)) {
        issue(state, "table", append(columnPath, "key"), "table column keys must be unique");
      } else {
        validateString(key, state, append(columnPath, "key"));
        keys.push(key);
      }
      validateLocalizedText(field(record, "label"), state, append(columnPath, "label"));
      if (Object.hasOwn(record, "align") && field(record, "align") !== "start" && field(record, "align") !== "end") {
        issue(state, "table", append(columnPath, "align"), "a table column alignment must be start or end");
      }
    } finally {
      state.active.delete(record);
    }
  });
  return keys;
}

function validateRows(
  value: unknown,
  state: ValidationState,
  path: readonly (string | number)[],
  columns?: readonly string[],
): readonly Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  forEachArray(value, state, path, (row, index) => {
    const rowPath = append(path, index);
    const record = enterRecord(row, state, rowPath, 0);
    if (record === undefined) return;
    try {
      const keys = Object.keys(record);
      if (columns !== undefined &&
        (keys.length !== columns.length || keys.some((key) => !columns.includes(key)))) {
        issue(state, "table", rowPath, "row keys must exactly match the table columns");
      }
      for (const key of keys) {
        if (dangerousField(key)) {
          issue(state, "unsafe-capability", append(rowPath, key), "closed rows cannot carry a path or renderer runtime field");
          continue;
        }
        validateClosedCell(field(record, key), state, append(rowPath, key));
      }
      rows.push(record);
    } finally {
      state.active.delete(record);
    }
  });
  return rows;
}

function validateChart(
  chart: Record<string, unknown>,
  state: ValidationState,
  path: readonly (string | number)[],
): void {
  exactFields(chart, ["type", "title", "points", "x", "y", "color", "series", "point", "layout", "identity", "issues"], state, path);
  optionalLocalizedText(chart, "title", state, path);
  const x = validateAxis(field(chart, "x"), state, append(path, "x"));
  const y = validateAxis(field(chart, "y"), state, append(path, "y"));
  const color = optionalAxis(chart, "color", state, path);
  const series = optionalAxis(chart, "series", state, path);
  const pointField = optionalAxis(chart, "point", state, path);
  if (Object.hasOwn(chart, "layout") && field(chart, "layout") !== "horizontal" && field(chart, "layout") !== "vertical") {
    issue(state, "chart", append(path, "layout"), "a chart layout must be horizontal or vertical");
  }
  const points = validateRows(field(chart, "points"), state, append(path, "points"));
  optionalRowsMetadata(chart, state, path);
  for (const [index, point] of points.entries()) {
    const pointPath = append(append(path, "points"), index);
    for (const axis of [x, y, color, series, pointField]) {
      if (axis === undefined) continue;
      if (!Object.hasOwn(point, axis)) {
        issue(state, "chart", pointPath, `chart field ${JSON.stringify(axis)} is absent from a point`);
        continue;
      }
      const value = field(point, axis);
      if (!isAxisValue(value)) {
        issue(state, "chart", append(pointPath, axis), "a chart channel must use a scalar or MetricValue");
      }
    }
  }
}

function validateAxis(
  value: unknown,
  state: ValidationState,
  path: readonly (string | number)[],
): string | undefined {
  if (typeof value !== "string" || value.length === 0) {
    issue(state, "chart", path, "a chart channel must be a non-empty field name");
    return undefined;
  }
  validateString(value, state, path);
  return value;
}

function optionalAxis(
  record: Record<string, unknown>,
  key: string,
  state: ValidationState,
  path: readonly (string | number)[],
): string | undefined {
  if (!Object.hasOwn(record, key)) return undefined;
  return validateAxis(field(record, key), state, append(path, key));
}

function validateClosedCell(
  value: unknown,
  state: ValidationState,
  path: readonly (string | number)[],
): void {
  if (looksLikeMetricValue(value)) {
    validateMetricValue(value, state, path);
    return;
  }
  validateClosedValue(value, state, path, 0);
}

function validateMetricValue(
  value: unknown,
  state: ValidationState,
  path: readonly (string | number)[],
): void {
  const metric = enterRecord(value, state, path, 0);
  if (metric === undefined) return;
  try {
    exactFields(
      metric,
      ["value", "state", "samples", "total", "basis", "issues", "refs", "unit", "format", "better", "bounds"],
      state,
      path,
    );
    const metricValue = field(metric, "value");
    const metricState = field(metric, "state");
    const samples = field(metric, "samples");
    const total = field(metric, "total");
    const issues = field(metric, "issues");
    if (metricValue !== null && (typeof metricValue !== "number" || !Number.isFinite(metricValue))) {
      issue(state, "metric", append(path, "value"), "a MetricValue value must be a finite number or null");
    }
    if (!isMetricState(metricState)) {
      issue(state, "metric", append(path, "state"), "a MetricValue state must be recognized");
    }
    validateCount(samples, state, append(path, "samples"));
    validateCount(total, state, append(path, "total"));
    if (isMetricState(metricState) && isCount(samples) && isCount(total)) {
      validateMetricTruthTable({
        value: metricValue,
        state: metricState,
        samples,
        total,
        issueCount: Array.isArray(issues) ? issues.length : undefined,
      }, state, path);
    }
    if (!isMetricBasis(field(metric, "basis"))) {
      issue(state, "metric", append(path, "basis"), "a MetricValue basis must be recognized");
    }
    validateIssues(issues, state, append(path, "issues"));
    validateEvidenceRefs(field(metric, "refs"), state, append(path, "refs"));
    optionalString(metric, "unit", state, path);
    optionalMeasureFormat(metric, state, path);
    if (Object.hasOwn(metric, "better") && !isBetter(field(metric, "better"))) {
      issue(state, "metric", append(path, "better"), "a MetricValue better direction must be recognized");
    }
    if (Object.hasOwn(metric, "bounds")) {
      validateBounds(field(metric, "bounds"), state, append(path, "bounds"));
    }
  } finally {
    state.active.delete(metric);
  }
}

function validateIssues(
  value: unknown,
  state: ValidationState,
  path: readonly (string | number)[],
): void {
  forEachArray(value, state, path, (issueValue, index) => {
    const issuePath = append(path, index);
    const record = enterRecord(issueValue, state, issuePath, 0);
    if (record === undefined) return;
    try {
      exactFields(record, ["code", "message", "refs"], state, issuePath);
      validateIdentifier(field(record, "code"), state, append(issuePath, "code"));
      validateString(field(record, "message"), state, append(issuePath, "message"));
      validateEvidenceRefs(field(record, "refs"), state, append(issuePath, "refs"));
    } finally {
      state.active.delete(record);
    }
  });
}

function validateEvidenceRefs(
  value: unknown,
  state: ValidationState,
  path: readonly (string | number)[],
): void {
  forEachArray(value, state, path, (reference, index) => {
    const referencePath = append(path, index);
    const record = enterRecord(reference, state, referencePath, 0);
    if (record === undefined) return;
    try {
      exactFields(record, ["identity"], state, referencePath);
      validateEvidenceIdentity(field(record, "identity"), state, append(referencePath, "identity"));
    } finally {
      state.active.delete(record);
    }
  });
}

function validateEvidenceIdentity(
  value: unknown,
  state: ValidationState,
  path: readonly (string | number)[],
): void {
  const identity = enterRecord(value, state, path, 0);
  if (identity === undefined) return;
  try {
    exactFields(identity, ["kind", "locator"], state, path);
    if (field(identity, "kind") !== "attempt") {
      issue(state, "metric", append(path, "kind"), "an EvidenceRef identity kind must be attempt");
    }
    validateIdentifier(field(identity, "locator"), state, append(path, "locator"));
  } finally {
    state.active.delete(identity);
  }
}

function optionalMeasureFormat(
  record: Record<string, unknown>,
  state: ValidationState,
  path: readonly (string | number)[],
): void {
  if (!Object.hasOwn(record, "format")) return;
  const formatPath = append(path, "format");
  const value = field(record, "format");
  if (typeof value === "string") {
    validateString(value, state, formatPath);
    return;
  }
  const format = enterRecord(value, state, formatPath, 0);
  if (format === undefined) return;
  try {
    exactFields(format, ["kind", "options"], state, formatPath);
    validateIdentifier(field(format, "kind"), state, append(formatPath, "kind"));
    if (Object.hasOwn(format, "options")) {
      validateClosedValue(field(format, "options"), state, append(formatPath, "options"), 0);
    }
  } finally {
    state.active.delete(format);
  }
}

function optionalRowsMetadata(
  record: Record<string, unknown>,
  state: ValidationState,
  path: readonly (string | number)[],
): void {
  const hasIdentity = Object.hasOwn(record, "identity");
  const hasIssues = Object.hasOwn(record, "issues");
  if (hasIdentity !== hasIssues) {
    issue(state, "shape", path, "closed row provenance must preserve both identity and issues");
  }
  if (hasIdentity) {
    validateClosedValue(field(record, "identity"), state, append(path, "identity"), 0);
  }
  if (hasIssues) {
    validateIssues(field(record, "issues"), state, append(path, "issues"));
  }
}

function validateBounds(
  value: unknown,
  state: ValidationState,
  path: readonly (string | number)[],
): void {
  const bounds = enterRecord(value, state, path, 0);
  if (bounds === undefined) return;
  try {
    exactFields(bounds, ["min", "max"], state, path);
    optionalFiniteNumber(bounds, "min", state, path);
    optionalFiniteNumber(bounds, "max", state, path);
  } finally {
    state.active.delete(bounds);
  }
}

function optionalDimensions(
  record: Record<string, unknown>,
  state: ValidationState,
  path: readonly (string | number)[],
): void {
  if (!Object.hasOwn(record, "dimensions")) return;
  const dimensionsPath = append(path, "dimensions");
  const dimensions = enterRecord(field(record, "dimensions"), state, dimensionsPath, 0);
  if (dimensions === undefined) return;
  try {
    exactFields(dimensions, ["minWidth", "minHeight", "preferredWidth", "preferredHeight"], state, dimensionsPath);
    for (const key of ["minWidth", "minHeight", "preferredWidth", "preferredHeight"] as const) {
      if (!Object.hasOwn(dimensions, key)) continue;
      const value = field(dimensions, key);
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        issue(state, "number", append(dimensionsPath, key), "a component dimension must be a finite non-negative number");
      }
    }
  } finally {
    state.active.delete(dimensions);
  }
}

function validateClosedValue(
  value: unknown,
  state: ValidationState,
  path: readonly (string | number)[],
  depth: number,
): void {
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) issue(state, "number", path, "numbers in a closed Report tree must be finite");
    return;
  }
  if (typeof value === "string") {
    validateString(value, state, path);
    return;
  }
  if (typeof value === "function") {
    issue(state, "unsafe-capability", path, "callbacks cannot enter a closed Report tree");
    return;
  }
  if (isPromise(value)) {
    issue(state, "unsafe-capability", path, "Promises cannot enter a closed Report tree");
    return;
  }
  if (Array.isArray(value)) {
    const array = enterArray(value, state, path, depth);
    if (array === undefined) return;
    try {
      array.forEach((entry, index) => validateClosedValue(entry, state, append(path, index), depth + 1));
    } finally {
      state.active.delete(array);
    }
    return;
  }
  const record = enterRecord(value, state, path, depth);
  if (record === undefined) return;
  try {
    for (const key of Object.keys(record)) {
      if (dangerousField(key)) {
        issue(state, "unsafe-capability", append(path, key), "closed values cannot carry a path or renderer runtime field");
        continue;
      }
      validateClosedValue(field(record, key), state, append(path, key), depth + 1);
    }
  } finally {
    state.active.delete(record);
  }
}

function enterRecord(
  value: unknown,
  state: ValidationState,
  path: readonly (string | number)[],
  depth: number,
): Record<string, unknown> | undefined {
  if (depth > REPORT_DOCUMENT_DEPTH_MAX) {
    issue(state, "limit", path, `a Report tree may be at most ${REPORT_DOCUMENT_DEPTH_MAX} nodes deep`);
    return undefined;
  }
  if (typeof value === "function") {
    issue(state, "unsafe-capability", path, "callbacks cannot enter a closed Report tree");
    return undefined;
  }
  if (isPromise(value)) {
    issue(state, "unsafe-capability", path, "Promises cannot enter a closed Report tree");
    return undefined;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    issue(state, "shape", path, "a semantic node must be a plain object");
    return undefined;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    issue(state, "unsafe-capability", path, "DOM, React, reader, and runtime objects cannot enter a closed Report tree");
    return undefined;
  }
  if (state.active.has(value)) {
    issue(state, "cycle", path, "a closed Report tree cannot contain a cycle");
    return undefined;
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") {
      issue(state, "unsafe-capability", path, "semantic nodes cannot contain symbol fields or React runtime markers");
      return undefined;
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
      issue(state, "unsafe-capability", append(path, key), "semantic nodes cannot contain accessors or hidden runtime fields");
      return undefined;
    }
  }
  state.nodeCount += 1;
  if (state.nodeCount > state.nodeLimit) {
    issue(state, "limit", path, `a Report tree may contain at most ${state.nodeLimit} nodes`);
    return undefined;
  }
  state.active.add(value);
  return value as Record<string, unknown>;
}

function enterArray(
  value: readonly unknown[],
  state: ValidationState,
  path: readonly (string | number)[],
  depth: number,
): readonly unknown[] | undefined {
  if (depth > REPORT_DOCUMENT_DEPTH_MAX) {
    issue(state, "limit", path, `a Report tree may be at most ${REPORT_DOCUMENT_DEPTH_MAX} nodes deep`);
    return undefined;
  }
  if (state.active.has(value)) {
    issue(state, "cycle", path, "a closed Report tree cannot contain a cycle");
    return undefined;
  }
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !("value" in descriptor)) {
      issue(state, "shape", append(path, index), "semantic arrays cannot contain holes or accessors");
      return undefined;
    }
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === "symbol" || (key !== "length" && !isArrayIndex(key))) {
      issue(state, "unsafe-capability", path, "semantic arrays cannot contain custom fields or runtime markers");
      return undefined;
    }
  }
  state.nodeCount += 1;
  if (state.nodeCount > state.nodeLimit) {
    issue(state, "limit", path, `a Report tree may contain at most ${state.nodeLimit} nodes`);
    return undefined;
  }
  state.active.add(value);
  return value;
}

function forEachArray(
  value: unknown,
  state: ValidationState,
  path: readonly (string | number)[],
  visit: (value: unknown, index: number) => void,
): void {
  if (!Array.isArray(value)) {
    issue(state, "shape", path, "this semantic field must be an array");
    return;
  }
  const array = enterArray(value, state, path, 0);
  if (array === undefined) return;
  try {
    array.forEach(visit);
  } finally {
    state.active.delete(array);
  }
}

function exactFields(
  record: Record<string, unknown>,
  allowed: readonly string[],
  state: ValidationState,
  path: readonly (string | number)[],
): void {
  const allowedFields = new Set(allowed);
  for (const key of Object.keys(record)) {
    if (!allowedFields.has(key)) {
      const kind = dangerousField(key) ? "unsafe-capability" : "shape";
      issue(state, kind, append(path, key), "this field is not part of the closed Report semantic model");
    }
  }
  for (const key of allowed) {
    if (!Object.hasOwn(record, key) && !optionalField(key)) {
      issue(state, "shape", append(path, key), "a required semantic field is missing");
    }
  }
}

function optionalField(key: string): boolean {
  return key === "title" || key === "caption" || key === "align" || key === "color" || key === "series" ||
    key === "point" || key === "layout" ||
    key === "dimensions" || key === "unit" || key === "format" || key === "better" || key === "bounds" ||
    key === "min" || key === "max" || key === "identity" || key === "issues" || key === "classes";
}

function dangerousField(key: string): boolean {
  return key === "html" || key === "css" || key === "style" || key === "className" ||
    key === "dangerouslySetInnerHTML" || key === "reader" || key === "root" || key === "callback" ||
    key === "promise" || key === "stream" || key === "element" || key === "react" || key === "path";
}

function field(record: Record<string, unknown>, key: string): unknown {
  return Object.getOwnPropertyDescriptor(record, key)?.value;
}

function append(
  path: readonly (string | number)[],
  entry: string | number,
): readonly (string | number)[] {
  return [...path, entry];
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
    issue(state, "unicode", path, "strings in a closed Report tree must contain Unicode scalar values");
  }
}

function validateLocalizedText(
  value: unknown,
  state: ValidationState,
  path: readonly (string | number)[],
): void {
  if (typeof value === "string") {
    validateString(value, state, path);
    return;
  }
  const record = enterRecord(value, state, path, 0);
  if (record === undefined) return;
  try {
    const keys = Object.keys(record);
    if (keys.length === 0) {
      issue(state, "shape", path, "localized text must contain at least one locale string");
    }
    if (!hasCompleteReportLocaleMap(record)) {
      issue(state, "shape", path, "a localized text map must provide text for en and zh-CN");
    }
    for (const key of keys) {
      validateString(key, state, append(path, key));
      validateString(field(record, key), state, append(path, key));
    }
  } finally {
    state.active.delete(record);
  }
}

function optionalLocalizedText(
  record: Record<string, unknown>,
  key: string,
  state: ValidationState,
  path: readonly (string | number)[],
): void {
  if (Object.hasOwn(record, key)) validateLocalizedText(field(record, key), state, append(path, key));
}

function optionalString(
  record: Record<string, unknown>,
  key: string,
  state: ValidationState,
  path: readonly (string | number)[],
): void {
  if (Object.hasOwn(record, key)) validateString(field(record, key), state, append(path, key));
}

function optionalFiniteNumber(
  record: Record<string, unknown>,
  key: string,
  state: ValidationState,
  path: readonly (string | number)[],
): void {
  if (!Object.hasOwn(record, key)) return;
  const value = field(record, key);
  if (typeof value !== "number" || !Number.isFinite(value)) {
    issue(state, "number", append(path, key), "this semantic field must be a finite number");
  }
}

function validateCount(
  value: unknown,
  state: ValidationState,
  path: readonly (string | number)[],
): void {
  if (!isCount(value)) {
    issue(state, "metric", path, "MetricValue samples and total must be non-negative integers");
  }
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/**
 * MetricValue is one closed statistical fact. The state and denominator cannot
 * be independently rewritten by a Report author after Analysis has closed it.
 */
function validateMetricTruthTable(
  metric: {
    readonly value: unknown;
    readonly state: "available" | "partial" | "empty" | "unsupported" | "failed";
    readonly samples: number;
    readonly total: number;
    readonly issueCount: number | undefined;
  },
  state: ValidationState,
  path: readonly (string | number)[],
): void {
  if (metric.samples > metric.total) {
    issue(state, "metric", append(path, "samples"), "MetricValue samples cannot exceed total");
  }
  switch (metric.state) {
    case "available":
      if (typeof metric.value !== "number" || !Number.isFinite(metric.value)) {
        issue(state, "metric", append(path, "value"), "an available MetricValue requires a finite numeric value");
      }
      if (metric.total === 0 || metric.samples !== metric.total) {
        issue(state, "metric", path, "an available MetricValue requires every non-empty denominator member to contribute");
      }
      if (metric.issueCount !== undefined && metric.issueCount !== 0) {
        issue(state, "metric", append(path, "issues"), "an available MetricValue cannot carry unresolved analysis issues");
      }
      return;
    case "partial":
      if (metric.total === 0 || metric.samples >= metric.total) {
        issue(state, "metric", path, "a partial MetricValue requires fewer contributions than its non-empty denominator");
      }
      requireStateIssue(metric, state, path);
      return;
    case "empty":
      if (metric.value !== null) {
        issue(state, "metric", append(path, "value"), "an empty MetricValue requires value: null");
      }
      if (metric.samples !== metric.total) {
        issue(state, "metric", path, "an empty MetricValue requires a complete denominator");
      }
      if (metric.issueCount !== undefined && metric.issueCount !== 0) {
        issue(state, "metric", append(path, "issues"), "an empty MetricValue cannot carry unresolved analysis issues");
      }
      return;
    case "unsupported":
      if (metric.value !== null) {
        issue(state, "metric", append(path, "value"), "an unsupported MetricValue requires value: null");
      }
      if (metric.total === 0 || metric.samples !== 0) {
        issue(state, "metric", path, "an unsupported MetricValue requires no contributions from a non-empty denominator");
      }
      requireStateIssue(metric, state, path);
      return;
    case "failed":
      if (metric.value !== null) {
        issue(state, "metric", append(path, "value"), "a failed MetricValue requires value: null");
      }
      requireStateIssue(metric, state, path);
      return;
  }
}

function requireStateIssue(
  metric: { readonly issueCount: number | undefined; readonly state: string },
  state: ValidationState,
  path: readonly (string | number)[],
): void {
  if (metric.issueCount === 0) {
    issue(
      state,
      "metric",
      append(path, "issues"),
      `a ${metric.state} MetricValue requires at least one AnalysisIssue explaining its state`,
    );
  }
}

function validateIdentifier(
  value: unknown,
  state: ValidationState,
  path: readonly (string | number)[],
): void {
  if (typeof value !== "string" || value.length === 0) {
    issue(state, "shape", path, "this semantic identity must be a non-empty string");
    return;
  }
  validateString(value, state, path);
}

function validateRoute(
  value: unknown,
  state: ValidationState,
  path: readonly (string | number)[],
): void {
  if (typeof value !== "string" || !value.startsWith("/")) {
    issue(state, "shape", path, "a closed page route must be an absolute semantic route");
    return;
  }
  validateString(value, state, path);
}

function validateProblemId(
  value: unknown,
  state: ValidationState,
  path: readonly (string | number)[],
): void {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    issue(state, "shape", path, "a problem id must be a non-negative integer");
  }
}

function looksLikeMetricValue(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.hasOwn(value, "value") && Object.hasOwn(value, "state") &&
    Object.hasOwn(value, "samples") && Object.hasOwn(value, "total") && Object.hasOwn(value, "basis") &&
    Object.hasOwn(value, "issues") && Object.hasOwn(value, "refs") &&
    isMetricState(Object.getOwnPropertyDescriptor(value, "state")?.value) &&
    isMetricBasis(Object.getOwnPropertyDescriptor(value, "basis")?.value);
}

function isAxisValue(value: unknown): boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ||
    looksLikeMetricValue(value);
}

function isTone(value: unknown): value is ReportTone {
  return value === "neutral" || value === "positive" || value === "warning" || value === "negative";
}

function isClosedElementTag(value: unknown): value is ClosedElementTag {
  return value === "article" || value === "aside" || value === "blockquote" || value === "code" ||
    value === "details" || value === "div" || value === "em" || value === "footer" || value === "header" ||
    value === "h1" || value === "h2" || value === "h3" || value === "h4" || value === "h5" ||
    value === "h6" || value === "li" || value === "main" || value === "ol" || value === "p" ||
    value === "pre" || value === "section" || value === "small" || value === "span" ||
    value === "strong" || value === "summary" || value === "ul";
}

function isSafeCssClass(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_-]{0,127}$/.test(value) && !value.startsWith("niceeval-report");
}

/**
 * The Host sanitizer adds this prefix to every accepted rule. Keep a second
 * structural guard at the closure boundary so raw/global CSS cannot arrive
 * through a hand-built tree or a future renderer seam.
 */
function isScopedClosedCss(value: string): boolean {
  if (value.length > 65_536 || value.includes("@") || value.includes("\\") || value.includes("</") ||
    /url\s*\(/i.test(value) || /expression\s*\(/i.test(value) || /!important/i.test(value) ||
    /(?:^|[^-\w])(?:html|body|:root|\.niceeval-report__(?:problems|page-problems|row-issues))/i.test(value)) {
    return false;
  }
  const rules = value.split("}").filter((rule) => rule.trim().length > 0);
  return rules.length > 0 && rules.every((rule) => rule.trimStart().startsWith(".niceeval-report__author "));
}

function isMetricState(
  value: unknown,
): value is "available" | "partial" | "empty" | "unsupported" | "failed" {
  return value === "available" || value === "partial" || value === "empty" ||
    value === "unsupported" || value === "failed";
}

function isMetricBasis(value: unknown): boolean {
  return value === "attempt" || value === "eval" || value === "run" || value === "pair" || value === "slot";
}

function isBetter(value: unknown): boolean {
  return value === "higher" || value === "lower" || value === "neutral";
}

function isPromise(value: unknown): boolean {
  return value instanceof Promise;
}

function isArrayIndex(value: string): boolean {
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) return false;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 && number < 2 ** 32 - 1;
}

function hasOnlyUnicodeScalars(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function issue(
  state: ValidationState,
  code: ReportSemanticIssue["code"],
  path: readonly (string | number)[],
  reason: string,
): void {
  if (state.issues.length >= MAX_ISSUES) return;
  state.issues.push(Object.freeze({ code, path: Object.freeze([...path]), reason }));
}

function cloneValue(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (Array.isArray(value)) return Object.freeze(value.map(cloneValue));
  const copy: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(value)) {
    copy[key] = cloneValue(Object.getOwnPropertyDescriptor(value, key)?.value);
  }
  return Object.freeze(copy);
}
