import { Effect } from "effect";
import type * as Scope from "effect/Scope";
import {
  sampleCapabilityTypeId,
  type JsonValue,
  type Sample,
  type SampleIdentity,
} from "../../analysis/contracts.ts";
import type { LocalizedText } from "../../shared/types.ts";
import type { PanelMode } from "../model/panel.ts";

/** A closed page has no route back to an author callback or a live Sample. */
export const RESOLVED_PAGE_FORMAT = "niceeval.report.resolved-page/v1";

export interface ResolvedPageTarget {
  readonly pageId: string;
  readonly route: string;
  /** Parameter identity is data, never a page loader or encoder callback. */
  readonly params?: JsonValue;
}

export interface ResolvedPageTextProjection {
  readonly locale: string;
  readonly width: number;
  readonly panelMode: PanelMode;
  readonly text: string;
}

export interface ResolvedPageWebProjection {
  readonly locale: string;
  readonly html: string;
}

/**
 * A closed download remains a real byte payload until the site builder places
 * it in a revision file. This boundary takes ownership through a defensive
 * copy; byte-count limits deliberately remain a site-builder policy.
 */
export interface ResolvedPageDownload {
  readonly id: string;
  readonly path: string;
  readonly mediaType: string;
  /** The exact closed payload that view/static must write unchanged. */
  readonly bytes: Uint8Array;
  readonly byteLength: number;
  readonly sha256?: string;
}

/** Download payload supplied by the live page-closure phase. */
export interface ResolvedPageDownloadOutput {
  readonly id: string;
  readonly path: string;
  readonly mediaType: string;
  readonly bytes: Uint8Array;
  readonly sha256?: string;
}

/** Closed renderer payloads that belong in a full site revision, not downloads. */
export type ResolvedPageAssetKind = "style" | "script" | "source" | "diff" | "other";

export interface ResolvedPageAsset {
  readonly kind: ResolvedPageAssetKind;
  /** Canonical POSIX-relative path within the eventual revision. */
  readonly path: string;
  readonly mediaType: string;
  /** The exact closed payload that view/static must write unchanged. */
  readonly bytes: Uint8Array;
  readonly byteLength: number;
  readonly sha256?: string;
}

/** Asset payload supplied by the live page-closure phase. */
export interface ResolvedPageAssetOutput {
  readonly kind: ResolvedPageAssetKind;
  readonly path: string;
  readonly mediaType: string;
  readonly bytes: Uint8Array;
  readonly sha256?: string;
}

/**
 * The one closed product of a Page execution. `head` is structured data only;
 * no React element, generic semantic tree, renderer, or author function may
 * survive into this value.
 */
export interface ResolvedPage {
  readonly format: typeof RESOLVED_PAGE_FORMAT;
  readonly target: ResolvedPageTarget;
  readonly sample: SampleIdentity;
  readonly title: LocalizedText;
  readonly head: JsonValue;
  readonly text: readonly ResolvedPageTextProjection[];
  readonly web: readonly ResolvedPageWebProjection[];
  readonly downloads: readonly ResolvedPageDownload[];
  readonly assets: readonly ResolvedPageAsset[];
}

/** The only live capability passed to the page closure phase. */
export interface LiveResolvedPageContext {
  readonly sample: Sample;
  readonly target: ResolvedPageTarget;
}

/**
 * The closure phase owns author/component resolution and must produce both
 * projections before the enclosing Sample Scope closes. Its return type has no
 * escape hatch for open component data.
 */
export interface ResolvedPageOutput {
  readonly title: LocalizedText;
  readonly head?: JsonValue;
  readonly text: readonly ResolvedPageTextProjection[];
  readonly web: readonly ResolvedPageWebProjection[];
  /** Real payloads are closed here rather than discarded into summaries. */
  readonly downloads?: readonly ResolvedPageDownloadOutput[];
  /** Renderer assets and Source/Diff payloads remain distinct from downloads. */
  readonly assets?: readonly ResolvedPageAssetOutput[];
}

export interface ResolvePageInput<Rendered, Error, Requirements> {
  readonly sample: Sample;
  readonly target: ResolvedPageTarget;
  /** Already adapted at the public callback boundary. Evaluated exactly once. */
  readonly render: Effect.Effect<Rendered, Error, Requirements>;
  /**
   * Resolves every author component and produces all closed projections. This
   * operation is evaluated exactly once and receives the live Sample only here.
   */
  readonly close: (
    rendered: Rendered,
    context: LiveResolvedPageContext,
  ) => Effect.Effect<ResolvedPageOutput, Error, Requirements>;
}

export interface ResolvedPageClosureError {
  readonly code: "report-resolved-page-invalid";
  readonly path: readonly string[];
  readonly reason: string;
}

/**
 * Runs one Page render and one component-resolution closure while its caller's
 * Sample Scope is live. The returned object is deliberately data-only, so it
 * can outlive that Scope without retaining a reader, Promise, Effect Scope, or
 * callback.
 */
export function resolvePage<Rendered, Error, Requirements>(
  input: ResolvePageInput<Rendered, Error, Requirements>,
): Effect.Effect<
  ResolvedPage,
  Error | ResolvedPageClosureError,
  Requirements | Scope.Scope
> {
  return Effect.gen(function* () {
    const rendered = yield* input.render;
    const output = yield* input.close(rendered, {
      sample: input.sample,
      target: input.target,
    });
    return yield* closeResolvedPage({
      sample: input.sample,
      target: input.target,
      output,
    });
  });
}

/** Finds an already-built terminal projection. It never invokes a renderer. */
export function resolvedPageTextProjection(
  page: ResolvedPage,
  input: { readonly locale: string; readonly width: number; readonly panelMode: PanelMode },
): ResolvedPageTextProjection | undefined {
  return page.text.find((projection) =>
    projection.locale === input.locale &&
    projection.width === input.width &&
    projection.panelMode === input.panelMode
  );
}

/** Finds an already-built browser projection. It never invokes a renderer. */
export function resolvedPageWebProjection(
  page: ResolvedPage,
  input: { readonly locale: string },
): ResolvedPageWebProjection | undefined {
  return page.web.find((projection) => projection.locale === input.locale);
}

function closeResolvedPage(input: {
  readonly sample: Sample;
  readonly target: ResolvedPageTarget;
  readonly output: ResolvedPageOutput;
}): Effect.Effect<ResolvedPage, ResolvedPageClosureError> {
  return Effect.try({
    try: () => freezeResolvedPage(input),
    catch: (error): ResolvedPageClosureError => Object.freeze({
      code: "report-resolved-page-invalid" as const,
      path: Object.freeze([]),
      reason: error instanceof Error ? error.message : "a Page closure returned an invalid value",
    }),
  });
}

function freezeResolvedPage(input: {
  readonly sample: Sample;
  readonly target: ResolvedPageTarget;
  readonly output: ResolvedPageOutput;
}): ResolvedPage {
  const target = freezeTarget(input.target, input.sample);
  const title = freezeLocalizedText(input.output.title, input.sample, ["title"]);
  const head = closeJson(input.output.head ?? null, input.sample, ["head"], new Set<object>());
  const text = freezeTextProjections(input.output.text, input.sample);
  const web = freezeWebProjections(input.output.web, input.sample);
  const downloads = freezeDownloads(input.output.downloads ?? []);
  const assets = freezeAssets(input.output.assets ?? []);
  assertDistinctPayloadPaths(downloads, assets);
  const sample = input.sample.snapshot.identity;
  if (sample.kind !== "analysis-sample" || !isNonEmptyString(sample.id)) {
    throw new TypeError("sample identity must be a closed analysis-sample identity");
  }
  return Object.freeze({
    format: RESOLVED_PAGE_FORMAT,
    target,
    sample: Object.freeze({ kind: "analysis-sample" as const, id: sample.id }),
    title,
    head,
    text,
    web,
    downloads,
    assets,
  });
}

function freezeTarget(input: ResolvedPageTarget, sample: Sample): ResolvedPageTarget {
  if (!isNonEmptyString(input.pageId)) throw new TypeError("target.pageId must be a non-empty string");
  if (!isNonEmptyString(input.route)) throw new TypeError("target.route must be a non-empty string");
  return Object.freeze({
    pageId: input.pageId,
    route: input.route,
    ...(input.params === undefined
      ? {}
      : { params: closeJson(input.params, sample, ["target", "params"], new Set<object>()) }),
  });
}

function freezeLocalizedText(
  value: LocalizedText,
  sample: Sample,
  path: readonly string[],
): LocalizedText {
  if (typeof value === "string") return value;
  const closed = closeJson(value, sample, path, new Set<object>());
  if (Array.isArray(closed) || closed === null || typeof closed !== "object") {
    throw new TypeError(`${path.join(".")} must be a string or locale map`);
  }
  const entries = Object.entries(closed);
  if (entries.length === 0 || entries.some(([locale, text]) => !isNonEmptyString(locale) || typeof text !== "string")) {
    throw new TypeError(`${path.join(".")} must be a non-empty locale map of strings`);
  }
  const result: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const [locale, text] of entries) {
    // The validation above proves this is a locale-string pair.
    result[locale] = text as string;
  }
  return Object.freeze(result);
}

function freezeTextProjections(
  value: readonly ResolvedPageTextProjection[],
  sample: Sample,
): readonly ResolvedPageTextProjection[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError("a resolved Page must contain at least one text projection");
  }
  const seen = new Set<string>();
  const closed = value.map((projection, index) => {
    if (projection === null || typeof projection !== "object" || Array.isArray(projection)) {
      throw new TypeError(`text[${index}] must be a projection object`);
    }
    if (rejectLiveCapability(projection, sample, ["text", String(index)])) {
      throw new TypeError(`text[${index}] retains a live Sample capability`);
    }
    if (!isNonEmptyString(projection.locale) || !isPositiveSafeInteger(projection.width) ||
      (projection.panelMode !== "boxed" && projection.panelMode !== "plain") || typeof projection.text !== "string") {
      throw new TypeError(`text[${index}] must contain locale, positive width, panel mode, and text`);
    }
    const key = `${projection.locale}\u0000${projection.width}\u0000${projection.panelMode}`;
    if (seen.has(key)) throw new TypeError(`text projection ${JSON.stringify(key)} is duplicated`);
    seen.add(key);
    return Object.freeze({
      locale: projection.locale,
      width: projection.width,
      panelMode: projection.panelMode,
      text: projection.text,
    });
  });
  return Object.freeze(closed.sort((left, right) =>
    compareUtf8(left.locale, right.locale) ||
    left.width - right.width ||
    compareUtf8(left.panelMode, right.panelMode)
  ));
}

function freezeWebProjections(
  value: readonly ResolvedPageWebProjection[],
  sample: Sample,
): readonly ResolvedPageWebProjection[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError("a resolved Page must contain at least one web projection");
  }
  const seen = new Set<string>();
  const closed = value.map((projection, index) => {
    if (projection === null || typeof projection !== "object" || Array.isArray(projection)) {
      throw new TypeError(`web[${index}] must be a projection object`);
    }
    if (rejectLiveCapability(projection, sample, ["web", String(index)])) {
      throw new TypeError(`web[${index}] retains a live Sample capability`);
    }
    if (!isNonEmptyString(projection.locale) || typeof projection.html !== "string") {
      throw new TypeError(`web[${index}] must contain locale and html`);
    }
    if (seen.has(projection.locale)) throw new TypeError(`web locale ${JSON.stringify(projection.locale)} is duplicated`);
    seen.add(projection.locale);
    return Object.freeze({ locale: projection.locale, html: projection.html });
  });
  return Object.freeze(closed.sort((left, right) => compareUtf8(left.locale, right.locale)));
}

function freezeDownloads(value: readonly ResolvedPageDownloadOutput[]): readonly ResolvedPageDownload[] {
  if (!Array.isArray(value)) throw new TypeError("downloads must be an array");
  const ids = new Set<string>();
  const paths = new Set<string>();
  const closed = value.map((download, index) => {
    if (!isPlainDataRecord(download) || !hasExactFields(
      download,
      ["id", "path", "mediaType", "bytes", "sha256"],
      ["id", "path", "mediaType", "bytes"],
    )) {
      throw new TypeError(`downloads[${index}] must be a closed payload object`);
    }
    if (!isNonEmptyString(download.id) || !isCanonicalRelativePath(download.path) || !isNonEmptyString(download.mediaType) ||
      !(download.bytes instanceof Uint8Array) ||
      (download.sha256 !== undefined && !isNonEmptyString(download.sha256))) {
      throw new TypeError(`downloads[${index}] has an invalid payload`);
    }
    if (ids.has(download.id) || paths.has(download.path)) {
      throw new TypeError(`downloads[${index}] repeats an id or path`);
    }
    ids.add(download.id);
    paths.add(download.path);
    // A non-empty TypedArray cannot be Object.freeze()'d by ECMAScript. The
    // frozen wrapper owns this fresh copy, so later mutation of the author's
    // buffer cannot alter the resolved payload.
    const bytes = new Uint8Array(download.bytes);
    return Object.freeze({
      id: download.id,
      path: download.path,
      mediaType: download.mediaType,
      bytes,
      byteLength: bytes.byteLength,
      ...(download.sha256 === undefined ? {} : { sha256: download.sha256 }),
    });
  });
  return Object.freeze(closed.sort((left, right) =>
    compareUtf8(left.path, right.path) || compareUtf8(left.id, right.id)
  ));
}

function freezeAssets(value: readonly ResolvedPageAssetOutput[]): readonly ResolvedPageAsset[] {
  if (!Array.isArray(value)) throw new TypeError("assets must be an array");
  const paths = new Set<string>();
  const closed = value.map((asset, index) => {
    if (!isPlainDataRecord(asset) || !hasExactFields(
      asset,
      ["kind", "path", "mediaType", "bytes", "sha256"],
      ["kind", "path", "mediaType", "bytes"],
    )) {
      throw new TypeError(`assets[${index}] must be a closed payload object`);
    }
    if (!isResolvedPageAssetKind(asset.kind) || !isCanonicalRelativePath(asset.path) ||
      !isNonEmptyString(asset.mediaType) || !(asset.bytes instanceof Uint8Array) ||
      (asset.sha256 !== undefined && !isNonEmptyString(asset.sha256))) {
      throw new TypeError(`assets[${index}] has an invalid payload`);
    }
    if (paths.has(asset.path)) throw new TypeError(`assets[${index}] repeats a path`);
    paths.add(asset.path);
    // TypedArray elements cannot be frozen by ECMAScript. The frozen wrapper
    // owns this independent payload; callers cannot mutate the author's copy.
    const bytes = new Uint8Array(asset.bytes);
    return Object.freeze({
      kind: asset.kind,
      path: asset.path,
      mediaType: asset.mediaType,
      bytes,
      byteLength: bytes.byteLength,
      ...(asset.sha256 === undefined ? {} : { sha256: asset.sha256 }),
    });
  });
  return Object.freeze(closed.sort((left, right) =>
    compareUtf8(left.path, right.path) ||
    compareUtf8(left.kind, right.kind) ||
    compareUtf8(left.mediaType, right.mediaType)
  ));
}

/** A full revision receives one namespace of emitted paths across payload kinds. */
function assertDistinctPayloadPaths(
  downloads: readonly ResolvedPageDownload[],
  assets: readonly ResolvedPageAsset[],
): void {
  const downloadPaths = new Set(downloads.map((download) => download.path));
  for (const asset of assets) {
    if (downloadPaths.has(asset.path)) {
      throw new TypeError(`asset path ${JSON.stringify(asset.path)} conflicts with a download path`);
    }
  }
}

function closeJson(
  value: unknown,
  sample: Sample,
  path: readonly string[],
  active: Set<object>,
): JsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`${path.join(".")} contains a non-finite number`);
    return value;
  }
  if (typeof value === "undefined" || typeof value === "bigint" || typeof value === "symbol" || typeof value === "function") {
    throw new TypeError(`${path.join(".")} contains a non-closed value`);
  }
  if (rejectLiveCapability(value, sample, path)) {
    throw new TypeError(`${path.join(".")} retains a live Sample capability`);
  }
  if (active.has(value)) throw new TypeError(`${path.join(".")} contains a cycle`);
  active.add(value);
  try {
    if (Array.isArray(value)) {
      return Object.freeze(value.map((entry, index) => closeJson(entry, sample, [...path, String(index)], active)));
    }
    if (!isPlainDataRecord(value)) {
      throw new TypeError(`${path.join(".")} must be a plain data object`);
    }
    const result: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
    for (const key of Object.keys(value).sort(compareUtf8)) {
      result[key] = closeJson(value[key], sample, [...path, key], active);
    }
    return Object.freeze(result);
  } finally {
    active.delete(value);
  }
}

function rejectLiveCapability(value: object, sample: Sample, _path: readonly string[]): boolean {
  if (value === sample) return true;
  const brand = Object.getOwnPropertyDescriptor(value, sampleCapabilityTypeId);
  if (brand !== undefined && "value" in brand && brand.value === true) return true;
  const kind = Object.getOwnPropertyDescriptor(value, "kind");
  const snapshot = Object.getOwnPropertyDescriptor(value, "snapshot");
  return kind !== undefined && "value" in kind && kind.value === "analysis-sample" && snapshot !== undefined;
}

function isPlainDataRecord(value: object): value is Readonly<Record<string, unknown>> {
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return false;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) return false;
  }
  return true;
}

function hasExactFields(
  value: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
  required: readonly string[],
): boolean {
  const keys = Object.getOwnPropertyNames(value);
  return keys.every((key) => allowed.includes(key)) &&
    required.every((key) => Object.hasOwn(value, key));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isResolvedPageAssetKind(value: unknown): value is ResolvedPageAssetKind {
  return value === "style" || value === "script" || value === "source" || value === "diff" || value === "other";
}

function isCanonicalRelativePath(value: unknown): value is string {
  if (!isNonEmptyString(value) || value.startsWith("/") || value.endsWith("/") || value.includes("\\") || value.includes("\u0000")) {
    return false;
  }
  return value.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

const textEncoder = new TextEncoder();

/** UTF-8 byte ordering is the canonical ordering shared by machine output. */
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
