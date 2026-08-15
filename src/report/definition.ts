import type { AttemptEvidenceDomainView, JsonValue, Sample } from "../analysis/index.ts";
import type { AttemptLocator } from "../attempt-locator.ts";
import type { LocalizedText } from "../shared/types.ts";
import type { PageContext } from "./components.ts";
import type { AuthorReportNode } from "./author/element.ts";
import {
  isThemeDefinition,
  type ThemeDefinition,
} from "./host/theme.ts";
import { hasCompleteReportLocaleMap } from "./classic/locale.ts";
import type { ReportNode } from "./semantic/closed.ts";

const reportTypeId: unique symbol = Symbol("@niceeval/report/Report");
const PAGE_ID_PATTERN = /^[a-z][a-z0-9_-]*$/;
const PATH_SEGMENT_PATTERN = /^[a-z0-9][a-z0-9._~-]*$/;
const WINDOWS_DEVICE_PATTERN = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const MAX_PAGE_ID_BYTES = 128;
const MAX_PATH_SEGMENT_BYTES = 128;
const MAX_PATH_BYTES = 1_024;
const MAX_PATH_SEGMENTS = 32;
const encoder = new TextEncoder();

export const DEFAULT_PAGE_ID = "report";
export const DEFAULT_PAGE_TITLE: LocalizedText = "Report";

export type HeadAttributeValue = string | true;
export type HeadAttributes = Readonly<Record<string, HeadAttributeValue>>;

/**
 * Safe document metadata only. Script and resource-loading link relations are
 * intentionally absent: a Report must not acquire a functional network
 * dependency outside its closed Host output.
 */
export type HeadTag =
  | Readonly<{ readonly tag: "meta"; readonly attrs: HeadAttributes; readonly children?: never }>
  | Readonly<{ readonly tag: "link"; readonly attrs: HeadAttributes; readonly children?: never }>
  | Readonly<{ readonly tag: "style"; readonly attrs?: HeadAttributes; readonly children: string }>;

export type StyleDeclaration = Extract<HeadTag, { readonly tag: "style" }>;

/** Props accepted by `<Style>` while an author callback is still live. */
export interface StyleProps {
  readonly children: string;
  readonly media?: string;
}

/** An open, author-time style node. The Host scopes and closes it before render. */
export interface StyleNode {
  readonly type: "style";
  readonly css: string;
  readonly attrs?: HeadAttributes;
}

/**
 * Pins keep a semantic dimension value in a stable visual slot. Rendering
 * remains Host-owned; this declaration never carries CSS or callbacks.
 */
export type DimensionPins = Readonly<Record<string, Readonly<Record<string, number>>>>;

export interface ReportShell {
  readonly title?: LocalizedText;
  readonly theme?: ThemeDefinition;
  readonly dimensionPins?: DimensionPins;
  readonly head?: readonly HeadTag[];
}

/** A canonical locator selects one host-provided closed evidence view. */
export type EvidenceLocator = AttemptLocator;

/**
 * Evidence stays a closed domain view. This context deliberately has no
 * Record reader, source/root, filesystem path, or arbitrary lookup surface.
 */
export type PageEvidence = AttemptEvidenceDomainView;

export interface PageLoadContext {
  readonly page: PageContext;
  readonly evidence: (
    locator: EvidenceLocator,
  ) => Promise<PageEvidence>;
}

export type PageLoad<Params, Input> = (
  sample: Sample,
  params: Params,
  context: PageLoadContext,
) => Input | Promise<Input>;

export type PageRender<Input> = (
  input: Input,
  context: PageContext,
) => AuthorReportNode | Promise<AuthorReportNode>;

export interface PageParams<Params extends JsonValue> {
  encode(params: Params): string;
  decode(key: string): Params;
  enumerate(sample: Sample): Iterable<Params> | Promise<Iterable<Params>>;
}

/** A normal navigable Page whose render input defaults to the live Sample. */
export interface PlainPageDefinition<Input = Sample> {
  readonly id: string;
  /** Omit path to let the Report definition derive /<id> (and / for report). */
  readonly path?: string;
  readonly title: LocalizedText;
  readonly navigation?: boolean;
  readonly params?: never;
  readonly load?: PageLoad<void, Input>;
  readonly render: PageRender<Input>;
}

/** A non-navigable parameterized Page whose exact instances come from enumerate(). */
export interface ParameterizedPageDefinition<
  Params extends JsonValue,
  Input,
> {
  readonly id: string;
  /** Omit path to let the Report definition derive /<id> (and / for report). */
  readonly path?: string;
  readonly title: LocalizedText;
  readonly navigation: false;
  readonly params: PageParams<Params>;
  readonly load: PageLoad<Params, Input>;
  readonly render: PageRender<Input>;
}

export type PageDefinition<
  Params extends JsonValue = JsonValue,
  Input = unknown,
> =
  | PlainPageDefinition<Input>
  | ParameterizedPageDefinition<Params, Input>;

type AnyPageDefinition =
  | PlainPageDefinition<any>
  | ParameterizedPageDefinition<any, any>;

export interface NormalizedPlainPageDefinition<Input = unknown> {
  readonly id: string;
  readonly path: string;
  readonly title: LocalizedText;
  readonly navigation?: boolean;
  readonly params?: never;
  readonly load?: PageLoad<void, Input>;
  readonly render: PageRender<Input>;
}

export interface NormalizedParameterizedPageDefinition<
  Params extends JsonValue = JsonValue,
  Input = unknown,
> {
  readonly id: string;
  readonly path: string;
  readonly title: LocalizedText;
  readonly navigation: false;
  readonly params: PageParams<Params>;
  readonly load: PageLoad<Params, Input>;
  readonly render: PageRender<Input>;
}

export type NormalizedPageDefinition =
  | NormalizedPlainPageDefinition
  | NormalizedParameterizedPageDefinition;

export type NonEmptyArray<Value> = readonly [Value, ...Value[]];

export interface ReportDefinition<
  Pages extends NonEmptyArray<AnyPageDefinition> = NonEmptyArray<AnyPageDefinition>,
> extends ReportShell {
  readonly pages: Pages;
}

/**
 * A frozen direct definition. Pages retain their declared fields and callbacks;
 * callbacks are executed only by the Report Host while the Sample Scope lives.
 */
export interface Report<
  Pages extends NonEmptyArray<NormalizedPageDefinition> = NonEmptyArray<NormalizedPageDefinition>,
> extends ReportShell {
  readonly head: readonly HeadTag[];
  readonly pages: Pages;
  readonly [reportTypeId]: true;
}

/** A stable, closed author-side summary of declared pages. */
export interface ReportMetaPage {
  readonly id: string;
  readonly path: string;
  readonly title: LocalizedText;
  readonly navigation: boolean;
}

/** Introspection never opens a Sample or exposes a Host revision. */
export interface ReportMeta {
  readonly title: LocalizedText;
  readonly pages: readonly ReportMetaPage[];
}

/**
 * One entry for mixed ordinary and parameterized Pages. Each object keeps the
 * Input inferred from its own load() so sibling Pages do not collapse to unknown.
 */
export function defineReport<
  const Pages extends NonEmptyArray<AnyPageDefinition>,
>(definition: ReportDefinition<Pages>): Report;
/** The one-page author shorthand, normalized as id "report" at route "/". */
export function defineReport(render: PageRender<Sample>): Report;
export function defineReport(
  definition: unknown,
): Report {
  if (typeof definition === "function") {
    return defineReport({
      pages: [{ id: DEFAULT_PAGE_ID, title: DEFAULT_PAGE_TITLE, render: definition as PageRender<Sample> }],
    });
  }
  const fields = ownFields(definition, "defineReport");
  assertOnlyFields(
    fields,
    ["title", "theme", "dimensionPins", "head", "pages"],
    "defineReport",
    ["title", "theme", "dimensionPins", "head"],
  );
  const title = fields.has("title") ? normalizeLocalizedText(fields.get("title"), "Report title") : undefined;
  const theme = fields.has("theme") ? normalizeTheme(fields.get("theme")) : undefined;
  const dimensionPins = fields.has("dimensionPins")
    ? normalizeDimensionPins(fields.get("dimensionPins"))
    : undefined;
  const head = fields.has("head") ? normalizeHead(fields.get("head")) : Object.freeze([]) as readonly HeadTag[];
  const pages = normalizePages(fields.get("pages"));
  const report = Object.freeze({
    ...(title === undefined ? {} : { title }),
    ...(theme === undefined ? {} : { theme }),
    ...(dimensionPins === undefined ? {} : { dimensionPins }),
    head,
    pages,
    [reportTypeId]: true as const,
  }) as Report;
  reports.add(report);
  return report;
}

const reports = new WeakSet<object>();

/** @internal Exact-identity guard for the Report Host loader. */
export function isReport(value: unknown): value is Report {
  return typeof value === "object" && value !== null && reports.has(value);
}

/** v0.12-compatible spelling for the validated Report identity guard. */
export const isReportDefinition = isReport;

/** @internal Gives the Host a direct validated definition with no legacy graph facade. */
export function reportDefinition(value: Report): Report {
  if (!isReport(value)) {
    throw new TypeError("a Report must be created by defineReport");
  }
  return value;
}

/** The declared title is stable before execution; a Page title is the fallback. */
export function resolveReportTitle(value: Report): LocalizedText {
  const report = reportDefinition(value);
  return report.title ?? report.pages[0].title ?? DEFAULT_PAGE_TITLE;
}

/**
 * Produces only immutable declaration metadata. The optional Sample parameter
 * preserves the old call shape without creating an execution dependency.
 */
export function buildReportMeta(value: Report, _sample?: Sample): ReportMeta {
  const report = reportDefinition(value);
  return Object.freeze({
    title: resolveReportTitle(report),
    pages: Object.freeze(report.pages.map((page) => Object.freeze({
      id: page.id,
      path: page.path,
      title: page.title,
      navigation: page.navigation !== false,
    }))),
  });
}

function normalizePages(value: unknown): NonEmptyArray<NormalizedPageDefinition> {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError("defineReport requires a non-empty pages array");
  }
  assertArray(value, "Report pages");
  const pages = value.map((page, index) => normalizePage(page, index));
  const ids = new Set<string>();
  const plainPaths = new Set<string>();
  for (const page of pages) {
    if (ids.has(page.id)) {
      throw new TypeError(`Report page id ${JSON.stringify(page.id)} is duplicated`);
    }
    ids.add(page.id);
    if (page.params === undefined) {
      if (plainPaths.has(page.path)) {
        throw new TypeError(`ordinary Report page path ${JSON.stringify(page.path)} is duplicated`);
      }
      plainPaths.add(page.path);
    }
  }
  return Object.freeze(pages) as NonEmptyArray<NormalizedPageDefinition>;
}

function normalizePage(value: unknown, index: number): NormalizedPageDefinition {
  const label = `Report page at pages[${index}]`;
  const fields = ownFields(value, label);
  const parameterized = fields.has("params");
  assertOnlyFields(
    fields,
    parameterized
      ? ["id", "path", "title", "navigation", "params", "load", "render"]
      : ["id", "path", "title", "navigation", "load", "render"],
    label,
    parameterized ? ["path"] : ["path", "navigation", "load"],
  );
  const id = normalizePageId(fields.get("id"), label);
  const path = fields.has("path") && fields.get("path") !== undefined
    ? normalizePath(fields.get("path"), label)
    : derivePagePath(id);
  const title = normalizeLocalizedText(fields.get("title"), `${label} title`);
  const render = requireFunction(fields.get("render"), `${label}.render`);

  if (parameterized) {
    if (fields.get("navigation") !== false) {
      throw new TypeError(`${label} declares params and must set navigation: false`);
    }
    const params = normalizePageParams(fields.get("params"), `${label}.params`);
    const load = requireFunction(fields.get("load"), `${label}.load`);
    return Object.freeze({
      id,
      path,
      title,
      navigation: false as const,
      params,
      load: load as PageLoad<JsonValue, unknown>,
      render: render as PageRender<unknown>,
    }) as NormalizedParameterizedPageDefinition<JsonValue, unknown>;
  }

  const navigation = fields.get("navigation");
  if (navigation !== undefined && typeof navigation !== "boolean") {
    throw new TypeError(`${label}.navigation must be a boolean when supplied`);
  }
  const load = fields.get("load");
  if (load !== undefined && typeof load !== "function") {
    throw new TypeError(`${label}.load must be a function when supplied`);
  }
  return Object.freeze({
    id,
    path,
    title,
    ...(navigation === undefined ? {} : { navigation }),
    ...(load === undefined ? {} : { load: load as PageLoad<void, unknown> }),
    render: render as PageRender<unknown>,
  }) as NormalizedPlainPageDefinition<unknown>;
}

function derivePagePath(id: string): string {
  return id === DEFAULT_PAGE_ID ? "/" : `/${id}`;
}

function normalizePageParams(value: unknown, label: string): PageParams<JsonValue> {
  const fields = ownFields(value, label);
  assertOnlyFields(fields, ["encode", "decode", "enumerate"], label);
  const encode = requireFunction(fields.get("encode"), `${label}.encode`);
  const decode = requireFunction(fields.get("decode"), `${label}.decode`);
  const enumerate = requireFunction(fields.get("enumerate"), `${label}.enumerate`);
  return Object.freeze({
    encode: encode as PageParams<JsonValue>["encode"],
    decode: decode as PageParams<JsonValue>["decode"],
    enumerate: enumerate as PageParams<JsonValue>["enumerate"],
  });
}

function normalizePageId(value: unknown, label: string): string {
  if (typeof value !== "string" || !PAGE_ID_PATTERN.test(value) || /^[0-9]+$/.test(value)) {
    throw new TypeError(`${label}.id must match [a-z][a-z0-9_-]* and cannot be an ordinal`);
  }
  if (encoder.encode(value).byteLength > MAX_PAGE_ID_BYTES) {
    throw new TypeError(`${label}.id may contain at most ${MAX_PAGE_ID_BYTES} UTF-8 bytes`);
  }
  return value;
}

function normalizePath(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`${label}.path must be a string`);
  }
  if (value === "/") return value;
  if (!value.startsWith("/") || value.endsWith("/") || value.includes("%") ||
    value.includes("?") || value.includes("#") || value.includes("\\")) {
    throw new TypeError(`${label}.path must be a normalized absolute Report route`);
  }
  if (encoder.encode(value).byteLength > MAX_PATH_BYTES) {
    throw new TypeError(`${label}.path may contain at most ${MAX_PATH_BYTES} UTF-8 bytes`);
  }
  const segments = value.slice(1).split("/");
  if (segments.length === 0 || segments.length > MAX_PATH_SEGMENTS) {
    throw new TypeError(`${label}.path must contain between 1 and ${MAX_PATH_SEGMENTS} segments`);
  }
  for (const segment of segments) {
    if (!PATH_SEGMENT_PATTERN.test(segment) || segment === "." || segment === ".." ||
      segment.endsWith(".") || segment.endsWith(" ") || WINDOWS_DEVICE_PATTERN.test(segment)) {
      throw new TypeError(`${label}.path contains an invalid route segment`);
    }
    if (encoder.encode(segment).byteLength > MAX_PATH_SEGMENT_BYTES) {
      throw new TypeError(`${label}.path has a segment longer than ${MAX_PATH_SEGMENT_BYTES} UTF-8 bytes`);
    }
  }
  return value;
}

function normalizeTheme(value: unknown): ThemeDefinition {
  if (!isThemeDefinition(value)) {
    throw new TypeError("Report theme must be a ThemeDefinition created by defineTheme");
  }
  return value;
}

function normalizeDimensionPins(value: unknown): DimensionPins {
  const dimensions = ownFields(value, "Report dimensionPins");
  const copy: Record<string, Readonly<Record<string, number>>> = Object.create(null) as Record<string, Readonly<Record<string, number>>>;
  for (const [dimension, rawValues] of dimensions) {
    if (dimension.length === 0) throw new TypeError("Report dimensionPins cannot use an empty dimension name");
    const values = ownFields(rawValues, `Report dimensionPins.${dimension}`);
    const slots = new Set<number>();
    const pinned: Record<string, number> = Object.create(null) as Record<string, number>;
    for (const [valueName, slot] of values) {
      if (valueName.length === 0 || typeof slot !== "number" || !Number.isSafeInteger(slot) || slot < 0) {
        throw new TypeError(`Report dimensionPins.${dimension} entries must map non-empty values to non-negative integer slots`);
      }
      if (slots.has(slot)) {
        throw new TypeError(`Report dimensionPins.${dimension} assigns slot ${slot} more than once`);
      }
      slots.add(slot);
      pinned[valueName] = slot;
    }
    copy[dimension] = Object.freeze(pinned);
  }
  return Object.freeze(copy);
}

const HEAD_ATTRIBUTE_NAME = /^[A-Za-z_:][A-Za-z0-9:._-]*$/;
const SAFE_LINK_RELATIONS = new Set(["alternate", "author", "canonical", "license"]);

function normalizeHead(value: unknown): readonly HeadTag[] {
  if (!Array.isArray(value)) throw new TypeError("Report head must be an array of safe meta, link, or style declarations");
  assertArray(value, "Report head");
  return Object.freeze(value.map((entry, index) => normalizeHeadTag(entry, `Report head[${index}]`)));
}

function normalizeHeadTag(value: unknown, label: string): HeadTag {
  const fields = ownFields(value, label);
  const tag = fields.get("tag");
  if (tag === "script") {
    throw new TypeError(`${label} cannot declare script: Report head never permits executable code`);
  }
  if (tag !== "meta" && tag !== "link" && tag !== "style") {
    throw new TypeError(`${label}.tag must be \"meta\", \"link\", or \"style\"; scripts and other executable tags are forbidden`);
  }
  if (tag === "style") {
    assertOnlyFields(fields, ["tag", "attrs", "children"], label, ["attrs"]);
    const children = fields.get("children");
    if (typeof children !== "string") throw new TypeError(`${label}.children must be CSS text`);
    assertSafeStyle(children, `${label}.children`);
    const attrs = fields.has("attrs") ? normalizeHeadAttributes(fields.get("attrs"), `${label}.attrs`, ["media", "type"]) : undefined;
    if (attrs?.type !== undefined && attrs.type !== "text/css") {
      throw new TypeError(`${label}.attrs.type must be \"text/css\" when supplied`);
    }
    return Object.freeze({ tag, ...(attrs === undefined ? {} : { attrs }), children });
  }
  assertOnlyFields(fields, ["tag", "attrs"], label);
  const attrs = normalizeHeadAttributes(
    fields.get("attrs"),
    `${label}.attrs`,
    tag === "meta" ? ["content", "itemprop", "name", "property"] : ["href", "hreflang", "rel", "title", "type"],
  );
  if (tag === "link") {
    const rel = attrs.rel;
    const href = attrs.href;
    if (typeof rel !== "string" || !SAFE_LINK_RELATIONS.has(rel.toLowerCase()) || typeof href !== "string") {
      throw new TypeError(`${label} only permits inert link metadata (rel: alternate, author, canonical, or license) with a local href`);
    }
    assertLocalHeadReference(href, `${label}.attrs.href`);
  }
  return Object.freeze({ tag, attrs });
}

function normalizeHeadAttributes(
  value: unknown,
  label: string,
  allowed: readonly string[],
): HeadAttributes {
  const fields = ownFields(value, label);
  const allowedNames = new Set(allowed);
  const copy: Record<string, HeadAttributeValue> = Object.create(null) as Record<string, HeadAttributeValue>;
  for (const [name, attribute] of fields) {
    if (!HEAD_ATTRIBUTE_NAME.test(name) || name.toLowerCase().startsWith("on") || !allowedNames.has(name)) {
      throw new TypeError(`${label}.${name} is not a safe ${allowed.join(", ")} attribute`);
    }
    if (attribute !== true && typeof attribute !== "string") {
      throw new TypeError(`${label}.${name} must be a string or true`);
    }
    copy[name] = attribute;
  }
  return Object.freeze(copy);
}

function assertLocalHeadReference(value: string, label: string): void {
  if (value.length === 0 || value.startsWith("//") || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) {
    throw new TypeError(`${label} must be a local metadata reference; network URLs and URL schemes are forbidden`);
  }
}

function assertSafeStyle(value: string, label: string): void {
  if (/<\/style/i.test(value)) throw new TypeError(`${label} cannot contain </style>`);
  if (/@import\b|url\s*\(|expression\s*\(|-moz-binding\b|\bbehavior\s*:/i.test(value)) {
    throw new TypeError(`${label} cannot import, fetch, or execute external resources`);
  }
}

/** Creates a safe inline declaration for `defineReport({ head: [...] })`. */
export function Style(css: string): StyleDeclaration;
/** `<Style>` returns an author-time node that the Host collects and scopes. */
export function Style(props: StyleProps): AuthorReportNode;
export function Style(input: string | StyleProps): StyleDeclaration | AuthorReportNode {
  if (typeof input === "string") {
    return normalizeHeadTag({ tag: "style" as const, children: input }, "Style") as StyleDeclaration;
  }
  const declaration = normalizeHeadTag({
    tag: "style" as const,
    children: input.children,
    ...(input.media === undefined ? {} : { attrs: { media: input.media } }),
  }, "Style");
  const style = declaration as StyleDeclaration;
  return Object.freeze({
    type: "style" as const,
    css: style.children,
    ...(style.attrs === undefined ? {} : { attrs: style.attrs }),
  }) as unknown as AuthorReportNode;
}

function normalizeLocalizedText(value: unknown, label: string): LocalizedText {
  if (typeof value === "string") return value;
  const fields = ownFields(value, label);
  if (fields.size === 0) {
    throw new TypeError(`${label} must be a string or a non-empty locale map`);
  }
  const copy: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const [locale, text] of fields) {
    if (locale.length === 0 || typeof text !== "string") {
      throw new TypeError(`${label} locale entries must use non-empty string keys and values`);
    }
    copy[locale] = text;
  }
  if (!hasCompleteReportLocaleMap(copy)) {
    throw new TypeError(`${label} locale maps must provide text for en and zh-CN`);
  }
  return Object.freeze(copy);
}

function requireFunction(value: unknown, label: string): (...arguments_: never[]) => unknown {
  if (typeof value !== "function") {
    throw new TypeError(`${label} must be a function`);
  }
  return value as (...arguments_: never[]) => unknown;
}

function ownFields(value: unknown, label: string): ReadonlyMap<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be a direct plain object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a direct plain object`);
  }
  const fields: Array<readonly [string, unknown]> = [];
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") {
      throw new TypeError(`${label} cannot contain symbol fields`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
      throw new TypeError(`${label} cannot contain accessors or hidden fields`);
    }
    fields.push([key, descriptor.value]);
  }
  return new Map(fields);
}

function assertOnlyFields(
  fields: ReadonlyMap<string, unknown>,
  allowed: readonly string[],
  label: string,
  optional: readonly string[] = [],
): void {
  const allowedFields = new Set(allowed);
  for (const key of fields.keys()) {
    if (!allowedFields.has(key)) {
      throw new TypeError(`${label} has an unknown field: ${key}`);
    }
  }
  for (const key of allowed) {
    if (!fields.has(key) && !optional.includes(key)) {
      throw new TypeError(`${label} is missing required field: ${key}`);
    }
  }
}

function assertArray(value: readonly unknown[], label: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !("value" in descriptor)) {
      throw new TypeError(`${label} cannot contain holes or accessors`);
    }
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === "symbol" || (key !== "length" && !isArrayIndex(key))) {
      throw new TypeError(`${label} cannot contain custom fields`);
    }
  }
}

function isArrayIndex(value: string): boolean {
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) return false;
  const index = Number(value);
  return Number.isSafeInteger(index) && index >= 0 && index < 2 ** 32 - 1;
}
