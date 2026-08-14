import type { AttemptEvidenceDomainView, JsonValue, Sample } from "../analysis/index.ts";
import type { AttemptLocator } from "../attempt-locator.ts";
import type { LocalizedText } from "../shared/types.ts";
import type { PageContext } from "./components.ts";
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
) => ReportNode | Promise<ReportNode>;

export interface PageParams<Params extends JsonValue> {
  encode(params: Params): string;
  decode(key: string): Params;
  enumerate(sample: Sample): Iterable<Params> | Promise<Iterable<Params>>;
}

/** A normal navigable Page whose render input defaults to the live Sample. */
export interface PlainPageDefinition<Input = Sample> {
  readonly id: string;
  readonly path: string;
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
  readonly path: string;
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

export interface ReportDefinition<
  Pages extends readonly AnyPageDefinition[] = readonly [AnyPageDefinition, ...AnyPageDefinition[]],
> {
  readonly title?: LocalizedText;
  readonly pages: Pages;
}

/**
 * A frozen direct definition. Pages retain their declared fields and callbacks;
 * callbacks are executed only by the Report Host while the Sample Scope lives.
 */
export interface Report<
  Pages extends readonly AnyPageDefinition[] = readonly [AnyPageDefinition, ...AnyPageDefinition[]],
> {
  readonly title?: LocalizedText;
  readonly pages: Pages;
  readonly [reportTypeId]: true;
}

/**
 * One entry for mixed ordinary and parameterized Pages. Each object keeps the
 * Input inferred from its own load() so sibling Pages do not collapse to unknown.
 */
export function defineReport<
  const Pages extends readonly [AnyPageDefinition, ...AnyPageDefinition[]],
>(definition: ReportDefinition<Pages>): Report<Pages>;
export function defineReport(
  definition: unknown,
): Report<readonly AnyPageDefinition[]> {
  const fields = ownFields(definition, "defineReport");
  assertOnlyFields(fields, ["title", "pages"], "defineReport", ["title"]);
  const title = fields.has("title") ? normalizeLocalizedText(fields.get("title"), "Report title") : undefined;
  const pages = normalizePages(fields.get("pages"));
  const report = Object.freeze({
    ...(title === undefined ? {} : { title }),
    pages,
    [reportTypeId]: true as const,
  }) as Report<readonly AnyPageDefinition[]>;
  reports.add(report);
  return report;
}

const reports = new WeakSet<object>();

/** @internal Exact-identity guard for the Report Host loader. */
export function isReport(value: unknown): value is Report {
  return typeof value === "object" && value !== null && reports.has(value);
}

/** @internal Gives the Host a direct validated definition with no legacy graph facade. */
export function reportDefinition(value: Report): Report {
  if (!isReport(value)) {
    throw new TypeError("a Report must be created by defineReport");
  }
  return value;
}

function normalizePages(value: unknown): readonly AnyPageDefinition[] {
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
  return Object.freeze(pages);
}

function normalizePage(value: unknown, index: number): AnyPageDefinition {
  const label = `Report page at pages[${index}]`;
  const fields = ownFields(value, label);
  const parameterized = fields.has("params");
  assertOnlyFields(
    fields,
    parameterized
      ? ["id", "path", "title", "navigation", "params", "load", "render"]
      : ["id", "path", "title", "navigation", "load", "render"],
    label,
    parameterized ? [] : ["navigation", "load"],
  );
  const id = normalizePageId(fields.get("id"), label);
  const path = normalizePath(fields.get("path"), label);
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
    }) as ParameterizedPageDefinition<JsonValue, unknown>;
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
  }) as PlainPageDefinition<unknown>;
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
