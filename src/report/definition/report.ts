/**
 * The Report author declaration.  This module deliberately knows how to
 * validate and normalize author data, but never how to open a Record, run an
 * Effect, or publish a site.  Those are Host responsibilities.
 */

import type {
  AttemptEvidenceDomainView,
  JsonValue,
  PricingProfile,
  Sample as AnalysisSample,
} from "../../analysis/index.ts";
import { builtInPricingProfile, isPricingProfile } from "../../analysis/cost.ts";
import type { AttemptLocator } from "../../attempt-locator.ts";
import type { LocalizedText } from "../model/locale.ts";
import {
  isThemeDefinition,
  type ThemeDefinition,
} from "../theme.ts";
import {
  assertDimensionPins,
  type DimensionPins,
} from "../presentation.ts";
import type { ReportNode } from "./tree.ts";

export type { DimensionPins } from "../presentation.ts";
export type { PricingProfile } from "../../analysis/index.ts";

/**
 * A Host-issued Analysis capability at the Report boundary.  It is an alias,
 * rather than a wrapper, so the Analysis facade can consume it without a
 * second capability registry.  Its public shape exposes no reader, path, or
 * Effect Scope.
 */
export type ReportSample = AnalysisSample;

/** Author-facing Sample alias for Report imports. */
export type Sample = ReportSample;

export const DEFAULT_PAGE_ID = "report";
export const DEFAULT_PAGE_TITLE: LocalizedText = Object.freeze({ en: "Report", "zh-CN": "报告" });

export type HeadAttributeValue = string | true;
export type HeadAttributes = Readonly<Record<string, HeadAttributeValue>>;

export type ScriptCrossOrigin = "anonymous" | "use-credentials";
export type ScriptReferrerPolicy =
  | "no-referrer"
  | "no-referrer-when-downgrade"
  | "origin"
  | "origin-when-cross-origin"
  | "same-origin"
  | "strict-origin"
  | "strict-origin-when-cross-origin"
  | "unsafe-url";

/** The normalized script attributes retained after Host validation. */
export type ScriptHeadAttributes = Readonly<{
  readonly src?: string;
  readonly type?: string;
  readonly async?: true;
  readonly defer?: true;
  readonly integrity?: string;
  readonly crossorigin?: ScriptCrossOrigin;
  readonly referrerpolicy?: ScriptReferrerPolicy;
}> & Readonly<Partial<Record<`data-${string}`, string>>>;

/**
 * The author shape: a closed tag-name union with ordinary string/boolean
 * attributes. The Host still applies tag-specific validation before any value
 * enters a revision, so this preserves author inference without opening raw
 * HTML or bypassing the script/style safety boundary.
 */
export type HeadTag =
  | Readonly<{
    readonly tag: "meta" | "link";
    readonly attrs: HeadAttributes;
    readonly children?: never;
  }>
  | Readonly<{
    readonly tag: "script" | "style";
    readonly attrs?: HeadAttributes;
    readonly children?: string;
  }>;

export type StyleDeclaration = Readonly<{
  readonly tag: "style";
  readonly attrs?: HeadAttributes;
  readonly children: string;
}>;

/** Declarative asset value; materialization remains Host-owned. */
export type ReportAsset =
  | Readonly<{ readonly src: string; readonly inline?: never }>
  | Readonly<{ readonly inline: string; readonly src?: never }>;

export interface ReportShell {
  readonly title?: LocalizedText;
  readonly theme?: ThemeDefinition;
  readonly dimensionPins?: DimensionPins;
  readonly head?: readonly HeadTag[];
  /**
   * The one pricing source for this Report's cost projections.  It must be a
   * pricing-profile/v1 value created by Analysis `definePricingProfile`.
   * Report validates it through Analysis and retains the same frozen object.
   */
  readonly pricing?: PricingProfile;
}

/** The page identity made available to callbacks while the ReportSample lives. */
export interface PageContext {
  readonly id: string;
  readonly path: string;
  readonly title: LocalizedText;
  /** Present only for one already-enumerated parameterized Page instance. */
  readonly params?: JsonValue;
}

/** A canonical locator selects one Host-provided closed Evidence view. */
export type EvidenceLocator = AttemptLocator;
export type PageEvidence = AttemptEvidenceDomainView;

/**
 * The deliberately narrow Page data access surface.  Evidence is already a
 * closed domain view; no Record reader, source root, filesystem path, or
 * arbitrary lookup enters author callbacks.
 */
export interface PageLoadContext {
  readonly page: PageContext;
  readonly evidence: (locator: EvidenceLocator) => Promise<PageEvidence>;
}

export type PageLoad<Params, Input> = (
  sample: ReportSample,
  params: Params,
  context: PageLoadContext,
) => Input | Promise<Input>;

export type PageRender<Input> = (
  input: Input,
  context: PageContext,
) => ReportNode | Promise<ReportNode>;

/** A parameter codec and the finite set of instances belonging to one build. */
export interface PageParams<Params extends JsonValue> {
  readonly encode: (params: Params) => string;
  readonly decode: (key: string) => Params;
  readonly enumerate: (sample: ReportSample) => Iterable<Params> | Promise<Iterable<Params>>;
}

/** A typed target for a Report-owned route. */
export interface ReportTarget<Params extends JsonValue = JsonValue> {
  readonly page: string;
  readonly params?: Params;
}

/** A normal Page.  Without load(), its render input is the fixed ReportSample. */
export interface PlainPage<Input = ReportSample> {
  readonly id: string;
  readonly path?: string;
  readonly title: LocalizedText;
  readonly navigation?: boolean;
  readonly params?: never;
  readonly load?: PageLoad<void, Input>;
  readonly render: PageRender<Input>;
}

/** A parameterized page has no navigation entry until a Host enumerates it. */
export interface ParameterizedPage<Params extends JsonValue, Input> {
  readonly id: string;
  readonly path?: string;
  readonly title: LocalizedText;
  readonly navigation: false;
  readonly role?: {
    readonly kind: "experiment-group";
    readonly groupKind: "named" | "singleton";
  };
  readonly params: PageParams<Params>;
  readonly load: PageLoad<Params, Input>;
  readonly render: PageRender<Input>;
}

export type Page<Params extends JsonValue | void = void, Input = ReportSample> =
  [Params] extends [void]
    ? PlainPage<Input>
    : ParameterizedPage<Extract<Params, JsonValue>, Input>;

type AnyPage = PlainPage<any> | ParameterizedPage<any, any>;

interface NormalizedPlainPage<Input = unknown> {
  readonly id: string;
  readonly path: string;
  readonly title: LocalizedText;
  readonly navigation: boolean;
  readonly params?: never;
  readonly load?: PageLoad<void, Input>;
  readonly render: PageRender<Input>;
}

interface NormalizedParameterizedPage<
  Params extends JsonValue = JsonValue,
  Input = unknown,
> {
  readonly id: string;
  readonly path: string;
  readonly title: LocalizedText;
  readonly navigation: false;
  readonly role?: {
    readonly kind: "experiment-group";
    readonly groupKind: "named" | "singleton";
  };
  readonly params: PageParams<Params>;
  readonly load: PageLoad<Params, Input>;
  readonly render: PageRender<Input>;
}

type NormalizedPage =
  | NormalizedPlainPage
  | NormalizedParameterizedPage;

/** Internal product-list helper also used by the built-in declaration factory. */
export type NonEmptyArray<Value> = readonly [Value, ...Value[]];

interface ReportInput<
  Pages extends NonEmptyArray<AnyPage> = NonEmptyArray<AnyPage>,
> extends ReportShell {
  readonly pages: Pages;
}

/** Internal input shape for package-built Report factories; not a public manifest alias. */
export interface ReportOptions<
  Pages extends NonEmptyArray<AnyPage> = NonEmptyArray<AnyPage>,
> extends ReportInput<Pages> {}

/**
 * A frozen Report definition.  Callback-bearing pages stay here only while a
 * Host resolves them; a finished Site revision must never retain this value.
 */
export interface ReportDefinition extends Omit<ReportShell, "pricing"> {
  readonly kind: "report";
  /** Structural-only declaration marker that survives independently emitted declarations. */
  readonly __niceevalReportDefinition: never;
  readonly head: readonly HeadTag[];
  readonly pages: NonEmptyArray<NormalizedPage>;
  /** The exact Analysis-created Profile, or the explicit no-Profile state. */
  readonly pricing: PricingProfile | null;
}

export interface ReportMetaPage {
  readonly id: string;
  readonly title: LocalizedText;
  readonly navigation: boolean;
}

/** Closed declaration metadata available as ctx.report during one resolve. */
export interface ReportMeta {
  readonly title: LocalizedText;
  readonly pages: readonly ReportMetaPage[];
  /**
   * The exact same frozen value as the owning ReportDefinition's `pricing`.
   * `ctx.report.pricing === report.pricing` holds by construction; consumers
   * pass it to the profile-taking `costUSD(profile)` / `totalCostUSD(profile)`.
   */
  readonly pricing: PricingProfile | null;
}

const REPORT_DESCRIPTOR: unique symbol = Symbol.for("niceeval.report.definition/v2");
const REPORT_DESCRIPTOR_VERSION = 2;

// This exact pair is shared with execution/machine.ts.  The Report module
// does not import that Host module: it only recognizes and copies this
// data-only descriptor while normalizing an input definition.
const BUILT_IN_MACHINE_DESCRIPTOR = Symbol.for("niceeval.report.built-in-machine-descriptor/v2");
const BUILT_IN_MACHINE_REPORT_DESCRIPTOR = Symbol.for("niceeval.report.built-in-machine-report-descriptor/v2");
const BUILT_IN_MACHINE_DESCRIPTOR_BRAND = "niceeval.report.built-in-machine-descriptor/v2";

interface ReportDescriptor {
  readonly version: 2;
  readonly kind: "report";
}

interface BuiltInMachineDescriptorCopy {
  readonly producerId: string;
}

/**
 * Defines a Report with a non-empty Page list. A separate overload accepts a
 * single-page shorthand and normalizes it to /.
 */
export function defineReport<const Pages extends NonEmptyArray<AnyPage>>(
  definition: ReportInput<Pages>,
): ReportDefinition;
export function defineReport(
  render: (sample: ReportSample) => ReportNode | Promise<ReportNode>,
): ReportDefinition;
export function defineReport(input: unknown): ReportDefinition {
  const source = typeof input === "function"
    ? {
      pages: [{ id: DEFAULT_PAGE_ID, title: DEFAULT_PAGE_TITLE, render: input }],
    }
    : input;
  const builtInMachine = readBuiltInMachineDescriptor(source);
  const fields = ownFields(source, "defineReport", [BUILT_IN_MACHINE_REPORT_DESCRIPTOR]);
  assertOnlyFields(
    fields,
    ["title", "theme", "dimensionPins", "head", "pages", "pricing"],
    "defineReport",
    ["title", "theme", "dimensionPins", "head", "pricing"],
  );

  const title = fields.has("title") ? normalizeLocalizedText(fields.get("title"), "Report title") : undefined;
  const theme = fields.has("theme") ? normalizeTheme(fields.get("theme")) : undefined;
  const dimensionPins = fields.has("dimensionPins")
    ? normalizeDimensionPins(fields.get("dimensionPins"))
    : undefined;
  const head = fields.has("head") ? normalizeHead(fields.get("head")) : Object.freeze([]) as readonly HeadTag[];
  const pages = normalizePages(fields.get("pages"));
  const pricing = fields.has("pricing") ? normalizePricingProfile(fields.get("pricing")) : builtInPricingProfile;

  const report: Record<string | symbol, unknown> = {
    kind: "report",
    ...(title === undefined ? {} : { title }),
    ...(theme === undefined ? {} : { theme }),
    ...(dimensionPins === undefined ? {} : { dimensionPins }),
    pricing,
    head,
    pages,
  };
  Object.defineProperty(report, REPORT_DESCRIPTOR, {
    value: Object.freeze({ version: REPORT_DESCRIPTOR_VERSION, kind: "report" } satisfies ReportDescriptor),
    enumerable: false,
    writable: false,
    configurable: false,
  });
  if (builtInMachine !== undefined) {
    Object.defineProperty(report, BUILT_IN_MACHINE_REPORT_DESCRIPTOR, {
      value: builtInMachine,
      enumerable: false,
      writable: false,
      configurable: false,
    });
  }
  return Object.freeze(report) as unknown as ReportDefinition;
}

/** Recognizes a Report from another installed copy of niceeval as well. */
export function isReport(value: unknown): value is ReportDefinition {
  if (!isPlainObject(value) || !Object.isFrozen(value)) return false;
  if (!hasExactReportFields(value)) return false;
  if (value.kind !== "report" || !Object.hasOwn(value, "pricing") ||
    (value.pricing !== null && !isPricingProfile(value.pricing))) return false;
  const descriptor = Object.getOwnPropertyDescriptor(value, REPORT_DESCRIPTOR);
  if (!isFrozenHiddenDataDescriptor(descriptor) || !isReportDescriptor(descriptor.value)) return false;
  if (!isFrozenHead(value.head) || !isFrozenPages(value.pages)) return false;
  return isOptionalFrozenLocalizedText(value.title) &&
    isOptionalThemeDefinition(value.theme) && isOptionalFrozenDimensionPins(value.dimensionPins) &&
    isValidBuiltInMachineReportDescriptor(value);
}

/** Internal Host boundary: validates the Symbol.for descriptor before use. */
function reportDefinition(value: ReportDefinition): ReportDefinition {
  if (!isReport(value)) throw new TypeError("a Report must be created by defineReport");
  return value;
}

/** The declaration title is stable without opening a Sample. */
export function resolveReportTitle(value: ReportDefinition): LocalizedText {
  const report = reportDefinition(value);
  return report.title ?? report.pages[0].title ?? DEFAULT_PAGE_TITLE;
}

/** Produces declaration-only metadata for ctx.report; it never opens a Sample. */
export function buildReportMeta(value: ReportDefinition): ReportMeta {
  const report = reportDefinition(value);
  const meta: Record<string, unknown> = {
    title: resolveReportTitle(report),
    pages: Object.freeze(report.pages.map((page) => Object.freeze({
      id: page.id,
      title: page.title,
      navigation: page.navigation,
    }))),
    pricing: report.pricing,
  };
  return Object.freeze(meta) as unknown as ReportMeta;
}

function isReportDescriptor(value: unknown): value is ReportDescriptor {
  if (!isPlainObject(value) || !Object.isFrozen(value)) return false;
  if (!hasExactOwnDataFields(value, ["version", "kind"])) return false;
  return value.version === REPORT_DESCRIPTOR_VERSION && value.kind === "report";
}

/**
 * A global Symbol alone is not provenance.  A duplicate package can recognize
 * a frozen Report, but a hand-written lookalike must still satisfy the exact
 * normalized representation `defineReport` emits: no hidden fields,
 * accessors, mutable arrays, or raw Page/Head shapes survive this boundary.
 */
function hasExactReportFields(value: Record<string, unknown>): boolean {
  const names = Object.getOwnPropertyNames(value);
  const allowed = new Set(["kind", "title", "theme", "dimensionPins", "pricing", "head", "pages"]);
  if (!names.includes("kind") || !names.includes("pricing") || !names.includes("head") || !names.includes("pages") ||
    names.some((name) => !allowed.has(name))) return false;
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (!isEnumerableDataDescriptor(descriptor)) return false;
  }
  const symbols = Object.getOwnPropertySymbols(value);
  if (symbols.some((symbol) => symbol !== REPORT_DESCRIPTOR && symbol !== BUILT_IN_MACHINE_REPORT_DESCRIPTOR)) {
    return false;
  }
  return symbols.includes(REPORT_DESCRIPTOR) &&
    ["title", "theme", "dimensionPins"].every((name) => !Object.hasOwn(value, name) || value[name] !== undefined);
}

function isValidBuiltInMachineReportDescriptor(value: Record<string, unknown>): boolean {
  const descriptor = Object.getOwnPropertyDescriptor(value, BUILT_IN_MACHINE_REPORT_DESCRIPTOR);
  if (descriptor === undefined) return true;
  return isFrozenHiddenDataDescriptor(descriptor) && isBuiltInMachineDescriptor(descriptor.value);
}

function isFrozenHiddenDataDescriptor(
  descriptor: PropertyDescriptor | undefined,
): descriptor is PropertyDescriptor & { readonly value: unknown } {
  return descriptor !== undefined && "value" in descriptor &&
    descriptor.enumerable === false && descriptor.writable === false && descriptor.configurable === false &&
    typeof descriptor.get === "undefined" && typeof descriptor.set === "undefined" &&
    typeof descriptor.value === "object" && descriptor.value !== null && Object.isFrozen(descriptor.value);
}

function isEnumerableDataDescriptor(
  descriptor: PropertyDescriptor | undefined,
): descriptor is PropertyDescriptor & { readonly value: unknown } {
  return descriptor !== undefined && "value" in descriptor && descriptor.enumerable === true &&
    typeof descriptor.get === "undefined" && typeof descriptor.set === "undefined";
}

function hasExactOwnDataFields(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const names = Object.getOwnPropertyNames(value);
  if (names.length !== expected.length || expected.some((name) => !names.includes(name)) ||
    Object.getOwnPropertySymbols(value).length !== 0) return false;
  return names.every((name) => isEnumerableDataDescriptor(Object.getOwnPropertyDescriptor(value, name)));
}

function isOptionalThemeDefinition(value: unknown): boolean {
  return value === undefined || isThemeDefinition(value);
}

function isOptionalFrozenLocalizedText(value: unknown): boolean {
  return value === undefined || isFrozenLocalizedText(value);
}

function isOptionalFrozenDimensionPins(value: unknown): boolean {
  return value === undefined || isFrozenDimensionPins(value);
}

function isFrozenLocalizedText(value: unknown): value is LocalizedText {
  if (typeof value === "string") return value.length > 0;
  if (!isPlainObject(value) || !Object.isFrozen(value)) return false;
  const names = Object.getOwnPropertyNames(value);
  return names.length > 0 && Object.getOwnPropertySymbols(value).length === 0 && names.every((name) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    return name.length > 0 && isEnumerableDataDescriptor(descriptor) && typeof descriptor.value === "string";
  }) && names.some((name) => (value as Readonly<Record<string, unknown>>)[name] !== "");
}

function isFrozenHead(value: unknown): value is readonly HeadTag[] {
  if (!Array.isArray(value) || !Object.isFrozen(value) || !isClosedArray(value)) return false;
  return value.every(isFrozenHeadTag);
}

function isFrozenHeadTag(value: unknown): value is HeadTag {
  if (!isPlainObject(value) || !Object.isFrozen(value)) return false;
  try {
    normalizeHeadTag(value, "Report head");
  } catch {
    return false;
  }
  const tag = value.tag;
  if (tag === "meta" || tag === "link") {
    return hasExactOwnDataFields(value, ["tag", "attrs"]) && isFrozenHeadAttributes(value.attrs);
  }
  if (tag === "style") {
    const valid = hasExactOwnDataFields(value, ["tag", "children"]) ||
      hasExactOwnDataFields(value, ["tag", "attrs", "children"]);
    return valid && typeof value.children === "string" &&
      (value.attrs === undefined || isFrozenHeadAttributes(value.attrs));
  }
  if (tag !== "script") return false;
  const valid = hasExactOwnDataFields(value, ["tag", "attrs"]) ||
    hasExactOwnDataFields(value, ["tag", "children"]) ||
    hasExactOwnDataFields(value, ["tag", "attrs", "children"]);
  if (!valid || (value.attrs !== undefined && !isFrozenHeadAttributes(value.attrs)) ||
    (value.children !== undefined && typeof value.children !== "string")) return false;
  const attrs = value.attrs as Readonly<Record<string, unknown>> | undefined;
  const hasSource = attrs !== undefined && typeof attrs.src === "string";
  return hasSource !== Object.hasOwn(value, "children");
}

function isFrozenHeadAttributes(value: unknown): value is HeadAttributes {
  if (!isPlainObject(value) || !Object.isFrozen(value) || Object.getOwnPropertySymbols(value).length !== 0) return false;
  return Object.getOwnPropertyNames(value).every((name) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    return isEnumerableDataDescriptor(descriptor) && (descriptor.value === true || typeof descriptor.value === "string");
  });
}

function isFrozenPages(value: unknown): value is NonEmptyArray<NormalizedPage> {
  if (!Array.isArray(value) || value.length === 0 || !Object.isFrozen(value) || !isClosedArray(value)) return false;
  const ids = new Set<string>();
  const plainPaths = new Set<string>();
  for (const page of value) {
    if (!isFrozenNormalizedPage(page) || ids.has(page.id)) return false;
    ids.add(page.id);
    if (page.params === undefined) {
      if (plainPaths.has(page.path)) return false;
      plainPaths.add(page.path);
    }
  }
  return true;
}

function isFrozenNormalizedPage(value: unknown): value is NormalizedPage {
  if (!isPlainObject(value) || !Object.isFrozen(value) || !isFrozenLocalizedText(value.title) ||
    typeof value.id !== "string" || typeof value.path !== "string" || typeof value.navigation !== "boolean" ||
    typeof value.render !== "function") return false;
  try {
    normalizePageId(value.id, "Report page");
    normalizePath(value.path, "Report page");
  } catch {
    return false;
  }
  if (Object.hasOwn(value, "params")) {
    return value.navigation === false && typeof value.load === "function" &&
      (hasExactOwnDataFields(value, ["id", "path", "title", "navigation", "params", "load", "render"]) ||
        hasExactOwnDataFields(value, ["id", "path", "title", "navigation", "role", "params", "load", "render"])) &&
      (!Object.hasOwn(value, "role") || isExperimentGroupRole(value.role)) &&
      isFrozenPageParams(value.params);
  }
  const valid = hasExactOwnDataFields(value, ["id", "path", "title", "navigation", "render"]) ||
    hasExactOwnDataFields(value, ["id", "path", "title", "navigation", "load", "render"]);
  return valid && (!Object.hasOwn(value, "load") || typeof value.load === "function");
}

function isFrozenDimensionPins(value: unknown): value is DimensionPins {
  if (!isPlainObject(value) || !Object.isFrozen(value) || Object.getOwnPropertySymbols(value).length !== 0) return false;
  try {
    assertDimensionPins(value);
  } catch {
    return false;
  }
  return Object.getOwnPropertyNames(value).every((dimension) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, dimension);
    if (!isEnumerableDataDescriptor(descriptor) || !isPlainObject(descriptor.value) ||
      !Object.isFrozen(descriptor.value) || Object.getOwnPropertySymbols(descriptor.value).length !== 0) {
      return false;
    }
    return Object.getOwnPropertyNames(descriptor.value).every((entry) =>
      isEnumerableDataDescriptor(Object.getOwnPropertyDescriptor(descriptor.value, entry))
    );
  });
}

function isFrozenPageParams(value: unknown): value is PageParams<JsonValue> {
  return isPlainObject(value) && Object.isFrozen(value) &&
    hasExactOwnDataFields(value, ["encode", "decode", "enumerate"]) &&
    typeof value.encode === "function" && typeof value.decode === "function" && typeof value.enumerate === "function";
}

function isClosedArray(value: readonly unknown[]): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (!isEnumerableDataDescriptor(Object.getOwnPropertyDescriptor(value, String(index)))) return false;
  }
  const names = Object.getOwnPropertyNames(value);
  return names.length === value.length + 1 && names.includes("length") &&
    names.every((name) => name === "length" || isArrayIndex(name)) && Object.getOwnPropertySymbols(value).length === 0;
}

/**
 * Copies the versioned identifier only.  The Host owns the producer registry;
 * no executable field can pass from an input definition to its frozen Report.
 */
function readBuiltInMachineDescriptor(value: unknown): BuiltInMachineDescriptorCopy | undefined {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) return undefined;
  const property = Object.getOwnPropertyDescriptor(value, BUILT_IN_MACHINE_REPORT_DESCRIPTOR);
  if (property === undefined) return undefined;
  if (!("value" in property) || property.enumerable || !isBuiltInMachineDescriptor(property.value)) {
    throw new TypeError("defineReport received an invalid built-in machine descriptor");
  }
  const copy: Record<string | symbol, unknown> = { producerId: property.value.producerId };
  Object.defineProperty(copy, BUILT_IN_MACHINE_DESCRIPTOR, {
    value: BUILT_IN_MACHINE_DESCRIPTOR_BRAND,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return Object.freeze(copy) as unknown as BuiltInMachineDescriptorCopy;
}

function isBuiltInMachineDescriptor(value: unknown): value is BuiltInMachineDescriptorCopy {
  if (!isPlainObject(value) || !hasOnlyStringFields(value, ["producerId"]) || !isVersionedProducerId(value.producerId)) {
    return false;
  }
  const brand = Object.getOwnPropertyDescriptor(value, BUILT_IN_MACHINE_DESCRIPTOR);
  return brand !== undefined && "value" in brand && brand.value === BUILT_IN_MACHINE_DESCRIPTOR_BRAND;
}

function hasOnlyStringFields(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

function isVersionedProducerId(value: unknown): value is string {
  return typeof value === "string" && /^[^\s@][^\s]*@v[1-9][0-9]*$/u.test(value);
}

function normalizePages(value: unknown): NonEmptyArray<NormalizedPage> {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError("defineReport requires a non-empty pages array");
  }
  assertArray(value, "Report pages");
  const pages = value.map((page, index) => normalizePage(page, index));
  const ids = new Set<string>();
  const plainPaths = new Set<string>();
  for (const page of pages) {
    if (ids.has(page.id)) throw new TypeError(`Report page id ${JSON.stringify(page.id)} is duplicated`);
    ids.add(page.id);
    if (page.params === undefined) {
      if (plainPaths.has(page.path)) {
        throw new TypeError(`ordinary Report page path ${JSON.stringify(page.path)} is duplicated`);
      }
      plainPaths.add(page.path);
    }
  }
  return Object.freeze(pages) as NonEmptyArray<NormalizedPage>;
}

function normalizePage(value: unknown, index: number): NormalizedPage {
  const label = `Report page at pages[${index}]`;
  const fields = ownFields(value, label);
  const parameterized = fields.has("params");
  assertOnlyFields(
    fields,
    parameterized
      ? ["id", "path", "title", "navigation", "role", "params", "load", "render"]
      : ["id", "path", "title", "navigation", "load", "render"],
    label,
    parameterized ? ["path", "role"] : ["path", "navigation", "load"],
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
    const role = fields.has("role") ? normalizeExperimentGroupRole(fields.get("role"), `${label}.role`) : undefined;
    return Object.freeze({
      id,
      path,
      title,
      navigation: false as const,
      ...(role === undefined ? {} : { role }),
      params,
      load: load as PageLoad<JsonValue, unknown>,
      render: render as PageRender<unknown>,
    }) as NormalizedParameterizedPage<JsonValue, unknown>;
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
    navigation: navigation !== false,
    ...(load === undefined ? {} : { load: load as PageLoad<void, unknown> }),
    render: render as PageRender<unknown>,
  }) as NormalizedPlainPage<unknown>;
}

function normalizeExperimentGroupRole(value: unknown, label: string): NonNullable<NormalizedParameterizedPage["role"]> {
  const fields = ownFields(value, label);
  assertOnlyFields(fields, ["kind", "groupKind"], label);
  if (fields.get("kind") !== "experiment-group" ||
    (fields.get("groupKind") !== "named" && fields.get("groupKind") !== "singleton")) {
    throw new TypeError(`${label} must declare experiment-group and named/singleton`);
  }
  return Object.freeze({
    kind: "experiment-group" as const,
    groupKind: fields.get("groupKind") as "named" | "singleton",
  });
}

function isExperimentGroupRole(value: unknown): value is NonNullable<NormalizedParameterizedPage["role"]> {
  try {
    return normalizeExperimentGroupRole(value, "Report page role") !== undefined;
  } catch {
    return false;
  }
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

const PAGE_ID_PATTERN = /^[a-z][a-z0-9_-]*$/;
const PATH_SEGMENT_PATTERN = /^[a-z0-9][a-z0-9._~-]*$/;
const WINDOWS_DEVICE_PATTERN = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const MAX_PAGE_ID_BYTES = 128;
const MAX_PATH_SEGMENT_BYTES = 128;
const MAX_PATH_BYTES = 1_024;
const MAX_PATH_SEGMENTS = 32;
const encoder = new TextEncoder();

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
  if (typeof value !== "string") throw new TypeError(`${label}.path must be a string`);
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

// PricingProfile normalization and cross-package validation have exactly one
// owner: `niceeval/analysis`.  Preserve the validated frozen reference so
// `ctx.report.pricing === ReportDefinition.pricing` remains true.
function normalizePricingProfile(value: unknown): PricingProfile {
  if (!isPricingProfile(value)) {
    throw new TypeError("Report pricing must be a PricingProfile created by definePricingProfile");
  }
  return value;
}

function normalizeDimensionPins(value: unknown): DimensionPins {
  assertDimensionPins(value);
  const dimensions = ownFields(value, "Report dimensionPins");
  const copy: Record<string, Readonly<Record<string, number>>> = Object.create(null) as Record<string, Readonly<Record<string, number>>>;
  for (const [dimension, rawValues] of dimensions) {
    const values = ownFields(rawValues, `Report dimensionPins.${dimension}`);
    const pinned: Record<string, number> = Object.create(null) as Record<string, number>;
    for (const [valueName, slot] of values) {
      if (typeof slot !== "number") {
        throw new TypeError(`Report dimensionPins.${dimension}.${valueName} must be a seriesSlot number`);
      }
      pinned[valueName] = slot;
    }
    copy[dimension] = Object.freeze(pinned);
  }
  return Object.freeze(copy);
}

const HEAD_ATTRIBUTE_NAME = /^[A-Za-z_:][A-Za-z0-9:._-]*$/;
const SAFE_LINK_RELATIONS = new Set(["alternate", "author", "canonical", "license"]);
const SCRIPT_DATA_ATTRIBUTE_NAME = /^data-[a-z][a-z0-9_.:-]*$/;
const SCRIPT_REFERRER_POLICIES = new Set<ScriptReferrerPolicy>([
  "no-referrer",
  "no-referrer-when-downgrade",
  "origin",
  "origin-when-cross-origin",
  "same-origin",
  "strict-origin",
  "strict-origin-when-cross-origin",
  "unsafe-url",
]);
const SCRIPT_INTEGRITY_TOKEN = /^(?:sha256|sha384|sha512)-[A-Za-z0-9+/_-]+={0,2}(?:\?[A-Za-z0-9_-]+)?$/;
const SCRIPT_TYPE = /^(?:module|importmap|speculationrules|[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+(?:\s*;\s*[A-Za-z0-9!#$&^_.+-]+=[A-Za-z0-9!#$&^_.+-]+)*)$/;
const INLINE_SCRIPT_BYTES_MAX = 65_536;

function normalizeHead(value: unknown): readonly HeadTag[] {
  if (!Array.isArray(value)) throw new TypeError("Report head must be an array of structured meta, link, style, or script declarations");
  assertArray(value, "Report head");
  return Object.freeze(value.map((entry, index) => normalizeHeadTag(entry, `Report head[${index}]`)));
}

function normalizeHeadTag(value: unknown, label: string): HeadTag {
  const fields = ownFields(value, label);
  const tag = fields.get("tag");
  if (tag === "script") {
    assertOnlyFields(fields, ["tag", "attrs", "children"], label, ["attrs", "children"]);
    const attrs = fields.has("attrs") ? normalizeScriptAttributes(fields.get("attrs"), `${label}.attrs`) : undefined;
    const source = attrs?.src;
    const hasInline = fields.has("children");
    if ((source === undefined) === !hasInline) {
      throw new TypeError(`${label} script must declare exactly one of attrs.src or inline children`);
    }
    if (hasInline) {
      const children = fields.get("children");
      if (typeof children !== "string") throw new TypeError(`${label}.children must be inline script text`);
      assertInlineScript(children, `${label}.children`);
      return Object.freeze({
        tag,
        ...(attrs === undefined ? {} : { attrs: withoutScriptSource(attrs) }),
        children,
      }) as HeadTag;
    }
    return Object.freeze({
      tag,
      attrs: attrs as ScriptHeadAttributes & Readonly<{ readonly src: string }>,
    }) as HeadTag;
  }
  if (tag !== "meta" && tag !== "link" && tag !== "style") {
    throw new TypeError(`${label}.tag must be \"meta\", \"link\", \"style\", or \"script\"`);
  }
  if (tag === "style") {
    assertOnlyFields(fields, ["tag", "attrs", "children"], label, ["attrs"]);
    const children = fields.get("children");
    if (typeof children !== "string") throw new TypeError(`${label}.children must be CSS text`);
    assertSafeStyle(children, `${label}.children`);
    const attrs = fields.has("attrs")
      ? normalizeHeadAttributes(fields.get("attrs"), `${label}.attrs`, ["media", "type"])
      : undefined;
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

function normalizeScriptAttributes(value: unknown, label: string): ScriptHeadAttributes {
  const fields = ownFields(value, label);
  const copy: Record<string, string | true> = Object.create(null) as Record<string, string | true>;
  for (const [name, attribute] of fields) {
    const lower = name.toLowerCase();
    if (lower.startsWith("on") || lower === "nonce") {
      throw new TypeError(`${label}.${name} is not permitted on a Report script`);
    }
    if (SCRIPT_DATA_ATTRIBUTE_NAME.test(name)) {
      if (typeof attribute !== "string") throw new TypeError(`${label}.${name} must be a string data-* value`);
      copy[name] = attribute;
      continue;
    }
    switch (name) {
      case "src":
        if (typeof attribute !== "string") throw new TypeError(`${label}.src must be a string`);
        assertScriptSource(attribute, `${label}.src`);
        copy.src = attribute;
        break;
      case "type":
        if (typeof attribute !== "string" || !SCRIPT_TYPE.test(attribute)) {
          throw new TypeError(`${label}.type must be a supported script type or MIME type`);
        }
        copy.type = attribute;
        break;
      case "async":
      case "defer":
        if (attribute !== true) throw new TypeError(`${label}.${name} must be true when supplied`);
        copy[name] = true;
        break;
      case "integrity":
        if (typeof attribute !== "string" || attribute.length === 0 ||
          !attribute.split(/\s+/u).every((token) => SCRIPT_INTEGRITY_TOKEN.test(token))) {
          throw new TypeError(`${label}.integrity must contain one or more sha256/384/512 SRI tokens`);
        }
        copy.integrity = attribute;
        break;
      case "crossorigin":
        if (attribute !== "anonymous" && attribute !== "use-credentials") {
          throw new TypeError(`${label}.crossorigin must be \"anonymous\" or \"use-credentials\"`);
        }
        copy.crossorigin = attribute;
        break;
      case "referrerpolicy":
        if (typeof attribute !== "string" || !SCRIPT_REFERRER_POLICIES.has(attribute as ScriptReferrerPolicy)) {
          throw new TypeError(`${label}.referrerpolicy must be a recognized referrer policy`);
        }
        copy.referrerpolicy = attribute;
        break;
      default:
        throw new TypeError(`${label}.${name} is not a supported Report script attribute`);
    }
  }
  return Object.freeze(copy) as ScriptHeadAttributes;
}

function withoutScriptSource(value: ScriptHeadAttributes): Omit<ScriptHeadAttributes, "src"> {
  const { src: _source, ...attrs } = value;
  return Object.freeze(attrs);
}

function assertScriptSource(value: string, label: string): void {
  if (value.length === 0 || value.startsWith("//") || value.includes("\\") || /[\u0000-\u001F\u007F]/u.test(value)) {
    throw new TypeError(`${label} must be a revision-local path, HTTPS URL, or loopback HTTP URL`);
  }
  if (!/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) {
    const pathname = value.split(/[?#]/, 1)[0] ?? "";
    if (pathname.length === 0 || pathname.split("/").some((segment) => segment === "..")) {
      throw new TypeError(`${label} must stay within the closed site revision`);
    }
    return;
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError(`${label} must be a valid HTTPS or loopback HTTP URL`);
  }
  if (parsed.username.length > 0 || parsed.password.length > 0) {
    throw new TypeError(`${label} cannot contain URL credentials`);
  }
  if (parsed.protocol === "https:") return;
  if (parsed.protocol === "http:" && isLoopbackHostname(parsed.hostname)) return;
  throw new TypeError(`${label} must use HTTPS or HTTP only for a loopback hostname`);
}

function isLoopbackHostname(value: string): boolean {
  const hostname = value.toLowerCase().replace(/^\[|\]$/g, "");
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function assertInlineScript(value: string, label: string): void {
  if (encoder.encode(value).byteLength > INLINE_SCRIPT_BYTES_MAX) {
    throw new TypeError(`${label} may contain at most ${INLINE_SCRIPT_BYTES_MAX} UTF-8 bytes`);
  }
  if (/<\/script\b/i.test(value)) throw new TypeError(`${label} cannot contain </script`);
}

function normalizeHeadAttributes(value: unknown, label: string, allowed: readonly string[]): HeadAttributes {
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

function normalizeLocalizedText(value: unknown, label: string): LocalizedText {
  if (typeof value === "string") {
    if (value.length === 0) throw new TypeError(`${label} must not be an empty string`);
    return value;
  }
  const fields = ownFields(value, label);
  if (fields.size === 0) throw new TypeError(`${label} must be a string or a non-empty locale map`);
  const copy: Record<string, string> = Object.create(null) as Record<string, string>;
  let hasNonEmptyText = false;
  for (const [locale, text] of fields) {
    if (locale.length === 0 || typeof text !== "string") {
      throw new TypeError(`${label} locale entries must use non-empty string keys and values`);
    }
    copy[locale] = text;
    hasNonEmptyText ||= text.length > 0;
  }
  if (!hasNonEmptyText) {
    throw new TypeError(`${label} locale map must contain at least one non-empty text value`);
  }
  return Object.freeze(copy);
}

function requireFunction(value: unknown, label: string): (...arguments_: never[]) => unknown {
  if (typeof value !== "function") throw new TypeError(`${label} must be a function`);
  return value as (...arguments_: never[]) => unknown;
}

function ownFields(
  value: unknown,
  label: string,
  allowedHiddenSymbols: readonly symbol[] = [],
): ReadonlyMap<string, unknown> {
  if (!isPlainObject(value)) throw new TypeError(`${label} must be a direct plain object`);
  const fields: Array<readonly [string, unknown]> = [];
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!allowedHiddenSymbols.includes(key) || descriptor === undefined || descriptor.enumerable || !("value" in descriptor)) {
        throw new TypeError(`${label} cannot contain symbol fields`);
      }
      continue;
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
      throw new TypeError(`${label} cannot contain accessors or hidden fields`);
    }
    fields.push([key, descriptor.value]);
  }
  return new Map(fields);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertOnlyFields(
  fields: ReadonlyMap<string, unknown>,
  allowed: readonly string[],
  label: string,
  optional: readonly string[] = [],
): void {
  const allowedFields = new Set(allowed);
  for (const key of fields.keys()) {
    if (!allowedFields.has(key)) throw new TypeError(`${label} has an unknown field: ${key}`);
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
