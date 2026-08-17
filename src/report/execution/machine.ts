import { Effect } from "effect";
import type * as Scope from "effect/Scope";
import type {
  JsonValue,
  Sample,
} from "../../analysis/contracts.ts";
import {
  isCostProjectionValue,
  type PricingProfile,
} from "../../analysis/cost.ts";
import type { LocalizedText } from "../../shared/types.ts";
import {
  compareUtf8,
  type ResolvedPage,
} from "../runtime/resolved-page.ts";
import { resolvedPageText } from "../runtime/text.ts";

/** Content-addressed identities are opaque, printable strings at this boundary. */
export type ContentAddress = string;

/** The exact machine schemas in docs/feature/reports/cli.md. */
export const BUILT_IN_SHOW_SCHEMA = "niceeval.show/v1";
export const CUSTOM_TARGET_EXECUTION_SCHEMA = "niceeval.report-target-execution/v1";
export const REPORT_PROJECTIONS_SCHEMA = "niceeval.report-projections/v1";

export type BuiltInReportToken = string;

export type ShowSelection =
  | {
      readonly kind: "project-current";
      readonly sampleIdentity: ContentAddress;
      readonly experimentIds: readonly string[];
    }
  | {
      readonly kind: "explicit-runs";
      readonly sampleIdentity: ContentAddress;
      readonly runIds: readonly string[];
    }
  | {
      readonly kind: "attempt-locator";
      readonly sampleIdentity: ContentAddress;
      readonly locator: string;
    };

/**
 * Host-owned problems expose canonical ordering inputs. Their exact detailed
 * shape remains Host-owned; no callback, Error, Cause, or reader is allowed.
 */
export interface ReportProblem {
  readonly code: string;
  readonly path: readonly string[];
  readonly refs: readonly string[];
  readonly summary?: string;
}

/**
 * Built-ins may emit only their declared domain families. This is intentionally
 * not a generic component/HTML/text reverse-engineering format.
 */
export type BuiltInShowData =
  | { readonly kind: "leaderboard"; readonly rows: JsonValue }
  | {
      readonly kind: "attempt";
      readonly evidence: JsonValue;
      readonly observability: JsonValue;
      readonly fileChanges: JsonValue;
    }
  | { readonly kind: "source"; readonly sources: JsonValue }
  | { readonly kind: "execution"; readonly execution: JsonValue }
  | { readonly kind: "timing"; readonly timing: JsonValue };

export interface BuiltInShowDocument {
  readonly schema: typeof BUILT_IN_SHOW_SCHEMA;
  readonly locale: "en";
  readonly selection: ShowSelection;
  readonly report: {
    readonly token: BuiltInReportToken;
    readonly identity: ContentAddress;
  };
  readonly page: {
    readonly route: string;
    readonly pageId: string;
    readonly title: LocalizedText;
  };
  readonly data: BuiltInShowData;
  readonly projections: ReportProjections;
  readonly problems: readonly ReportProblem[];
}

/**
 * The custom schema is a single target execution manifest, never a revision.
 * It contains only the selected Page's closed English text—not a React tree,
 * HTML body, site identity, Sample capability, Record payload, or raw bytes.
 */
export interface CustomTargetExecutionManifest {
  readonly schema: typeof CUSTOM_TARGET_EXECUTION_SCHEMA;
  readonly locale: "en";
  readonly selection: ShowSelection;
  readonly report: {
    readonly identity: ContentAddress;
    readonly title: LocalizedText;
  };
  readonly page: {
    readonly route: string;
    readonly pageId: string;
    readonly title: LocalizedText;
    readonly renderedText: string;
  };
  readonly downloads: readonly {
    readonly path: string;
    readonly mediaType: string;
    readonly bytes: number;
  }[];
  readonly projections: ReportProjections;
  readonly problems: readonly ReportProblem[];
}

/** One captured cost projection bound to the Page execution that requested it. */
export interface ReportProjectionCost {
  readonly page: {
    readonly pageId: string;
    readonly route: string;
  };
  readonly measureId: string;
  readonly row: {
    readonly key: string;
    readonly dimensions: Readonly<Record<string, JsonValue>>;
  };
  readonly profileIdentity: string;
  /** Analysis-owned closed projection; Report never rebuilds it from `value`. */
  readonly projection: JsonValue;
}

/**
 * The top-level projections object shared verbatim by the built-in show
 * document and the custom target-execution manifest, and written as the site
 * revision's `_niceeval/data/projections.json`.  `pricingProfile` is the
 * closed JSON form of the Report's PricingProfile, or null when the Report
 * declares none.  `costs` is canonical: route → pageId → measureId → row.key
 * → profileIdentity. A projection may appear on distinct Pages; distinct
 * dimensions or projections at one canonical capture key are a build failure.
 */
export interface ReportProjections {
  readonly schema: typeof REPORT_PROJECTIONS_SCHEMA;
  readonly pricingProfile: JsonValue | null;
  readonly costs: readonly ReportProjectionCost[];
}

export interface ReportProjectionCostInput {
  readonly page: {
    readonly pageId: string;
    readonly route: string;
  };
  readonly measureId: string;
  readonly row: {
    readonly key: string;
    readonly dimensions: Readonly<Record<string, unknown>>;
  };
  readonly profileIdentity: string;
  readonly projection: unknown;
}

/** A same-key, different row-content failure that a Host can surface directly. */
export interface ReportProjectionConflict {
  readonly code: "report-cost-projection-conflict";
  readonly page: { readonly pageId: string; readonly route: string };
  readonly measureId: string;
  readonly rowKey: string;
  readonly profileIdentity: string;
}

/** Capture and projection must name the same Analysis-owned PricingProfile. */
export interface ReportProjectionProfileIdentityMismatch {
  readonly code: "report-cost-projection-profile-identity-mismatch";
  readonly page: { readonly pageId: string; readonly route: string };
  readonly measureId: string;
  readonly rowKey: string;
  readonly profileIdentity: string;
  readonly projectionProfileIdentity: string | null;
}

/** A cost capture cannot exist when the Report declares no PricingProfile. */
export interface ReportProjectionReportPricingMissing {
  readonly code: "report-cost-projection-report-pricing-missing";
  readonly page: { readonly pageId: string; readonly route: string };
  readonly measureId: string;
  readonly rowKey: string;
  readonly profileIdentity: string;
}

/** Every captured cost must use the exact Profile declared by the Report. */
export interface ReportProjectionReportPricingMismatch {
  readonly code: "report-cost-projection-report-pricing-mismatch";
  readonly page: { readonly pageId: string; readonly route: string };
  readonly measureId: string;
  readonly rowKey: string;
  readonly profileIdentity: string;
  readonly reportPricingProfileIdentity: string;
}

export type ReportProjectionBuildFailure =
  | ReportProjectionConflict
  | ReportProjectionProfileIdentityMismatch
  | ReportProjectionReportPricingMissing
  | ReportProjectionReportPricingMismatch;

/**
 * Closes, deduplicates, and canonically sorts captured projection entries.
 * Two identical entries at one canonical capture key collapse. Different
 * Page bindings deliberately do not collide; distinct dimensions at one key
 * do, because they represent distinct captured rows.
 */
export function buildReportProjections(input: {
  readonly pricingProfile: JsonValue | null;
  readonly costs: readonly ReportProjectionCostInput[];
}): ReportProjections {
  const pricingProfile = input.pricingProfile === null
    ? null
    : closeJson(input.pricingProfile, new Set<object>());
  const failure = reportProjectionFailure({ pricingProfile, costs: input.costs });
  if (failure !== undefined) throw failure;
  const byKey = new Map<string, { readonly cost: ReportProjectionCost; readonly content: string }>();
  for (const entry of input.costs) {
    const cost = closeProjectionCost(entry);
    const key = projectionCostKey(cost);
    const content = projectionCostContent(cost);
    const existing = byKey.get(key);
    if (existing === undefined) {
      byKey.set(key, Object.freeze({ cost, content }));
      continue;
    }
    if (existing.content !== content) {
      throw projectionConflict(cost);
    }
  }
  const costs = Object.freeze([...byKey.values()].map((entry) => entry.cost).sort((left, right) =>
    compareUtf8(left.page.route, right.page.route) ||
    compareUtf8(left.page.pageId, right.page.pageId) ||
    compareUtf8(left.measureId, right.measureId) ||
    compareUtf8(left.row.key, right.row.key) ||
    compareUtf8(left.profileIdentity, right.profileIdentity)
  ));
  return Object.freeze({
    schema: REPORT_PROJECTIONS_SCHEMA,
    pricingProfile,
    costs,
  });
}

/** The empty projections for a Page or site that captured no cost values. */
export function emptyReportProjections(pricingProfile: JsonValue | null): ReportProjections {
  return buildReportProjections({ pricingProfile, costs: [] });
}

/** Validates Report Profile binding and same-key row-content identity. */
export function reportProjectionFailure(
  input: {
    readonly pricingProfile: JsonValue | null;
    readonly costs: readonly ReportProjectionCostInput[];
  },
): ReportProjectionBuildFailure | undefined {
  const reportPricingProfileIdentity = pricingProfileIdentity(input.pricingProfile);
  const byKey = new Map<string, { readonly content: string }>();
  for (const inputEntry of input.costs) {
    const cost = closeProjectionCost(inputEntry);
    if (reportPricingProfileIdentity === null) return reportPricingMissing(cost);
    const profileIdentity = projectionProfileIdentity(cost.projection);
    if (profileIdentity !== cost.profileIdentity) return projectionProfileIdentityMismatch(cost, profileIdentity);
    if (cost.profileIdentity !== reportPricingProfileIdentity) {
      return reportPricingMismatch(cost, reportPricingProfileIdentity);
    }
    const key = projectionCostKey(cost);
    const content = projectionCostContent(cost);
    const prior = byKey.get(key);
    if (prior !== undefined && prior.content !== content) {
      return projectionConflict(cost);
    }
    byKey.set(key, Object.freeze({ content }));
  }
  return undefined;
}

function closeProjectionCost(input: ReportProjectionCostInput): ReportProjectionCost {
  const page = input.page;
  const row = input.row;
  if (!isPlainRecord(page) || !isPlainRecord(row)) {
    throw new TypeError("projection cost page and row must be plain data objects");
  }
  // CostProjectionValue has one closed-domain validator in Analysis. This
  // machine boundary deliberately calls it before JSON closing rather than
  // accepting any projection-shaped payload from a capture.
  if (!isCostProjectionValue(input.projection)) {
    throw new TypeError("projection cost projection must be an Analysis CostProjectionValue");
  }
  const dimensions = closeJson(row.dimensions, new Set<object>());
  if (dimensions === null || Array.isArray(dimensions) || typeof dimensions !== "object") {
    throw new TypeError("projection cost row.dimensions must be a plain data object");
  }
  return Object.freeze({
    page: Object.freeze({
      pageId: requireNonEmptyString(page.pageId, "projection cost page.pageId"),
      route: requireNonEmptyString(page.route, "projection cost page.route"),
    }),
    measureId: requireNonEmptyString(input.measureId, "projection cost measureId"),
    row: Object.freeze({
      key: requireString(row.key, "projection cost row.key"),
      dimensions: dimensions as Readonly<Record<string, JsonValue>>,
    }),
    profileIdentity: requireNonEmptyString(input.profileIdentity, "projection cost profileIdentity"),
    projection: closeJson(input.projection, new Set<object>()),
  });
}

function projectionCostKey(cost: ReportProjectionCost): string {
  return writeCanonicalJson(Object.freeze([
    cost.page.route,
    cost.page.pageId,
    cost.measureId,
    cost.row.key,
    cost.profileIdentity,
  ]));
}

/**
 * Dimensions are retained outside the canonical capture key so they do not
 * affect sort order, but they remain part of the captured row's meaning. Two
 * entries at one key can collapse only when both dimensions and projection
 * are byte-identical canonical JSON.
 */
function projectionCostContent(cost: ReportProjectionCost): string {
  return writeCanonicalJson(Object.freeze({
    dimensions: cost.row.dimensions,
    projection: cost.projection,
  }));
}

function projectionConflict(cost: ReportProjectionCost): ReportProjectionConflict {
  return Object.freeze({
    code: "report-cost-projection-conflict" as const,
    page: cost.page,
    measureId: cost.measureId,
    rowKey: cost.row.key,
    profileIdentity: cost.profileIdentity,
  });
}

function projectionProfileIdentity(value: JsonValue): string | null {
  if (value === null || Array.isArray(value) || typeof value !== "object") return null;
  const profile = (value as Readonly<Record<string, JsonValue>>).profile;
  if (profile === null || Array.isArray(profile) || typeof profile !== "object") return null;
  const record = profile as Readonly<Record<string, JsonValue>>;
  return typeof record.contentIdentity === "string" && record.contentIdentity.length > 0
    ? record.contentIdentity
    : null;
}

function pricingProfileIdentity(value: JsonValue | null): string | null {
  if (value === null) return null;
  if (!isPlainRecord(value) || typeof value.contentIdentity !== "string" || value.contentIdentity.length === 0) {
    throw new TypeError("projection pricingProfile must be a closed PricingProfile JSON object");
  }
  return value.contentIdentity;
}

function projectionProfileIdentityMismatch(
  cost: ReportProjectionCost,
  projectionProfileIdentity: string | null,
): ReportProjectionProfileIdentityMismatch {
  return Object.freeze({
    code: "report-cost-projection-profile-identity-mismatch" as const,
    page: cost.page,
    measureId: cost.measureId,
    rowKey: cost.row.key,
    profileIdentity: cost.profileIdentity,
    projectionProfileIdentity,
  });
}

function reportPricingMissing(cost: ReportProjectionCost): ReportProjectionReportPricingMissing {
  return Object.freeze({
    code: "report-cost-projection-report-pricing-missing" as const,
    page: cost.page,
    measureId: cost.measureId,
    rowKey: cost.row.key,
    profileIdentity: cost.profileIdentity,
  });
}

function reportPricingMismatch(
  cost: ReportProjectionCost,
  reportPricingProfileIdentity: string,
): ReportProjectionReportPricingMismatch {
  return Object.freeze({
    code: "report-cost-projection-report-pricing-mismatch" as const,
    page: cost.page,
    measureId: cost.measureId,
    rowKey: cost.row.key,
    profileIdentity: cost.profileIdentity,
    reportPricingProfileIdentity,
  });
}

const BUILT_IN_MACHINE_DESCRIPTOR = Symbol.for("niceeval.report.built-in-machine-descriptor/v2");
const BUILT_IN_MACHINE_REPORT_DESCRIPTOR = Symbol.for("niceeval.report.built-in-machine-report-descriptor/v2");
const BUILT_IN_MACHINE_DESCRIPTOR_BRAND = "niceeval.report.built-in-machine-descriptor/v2";

/**
 * A descriptor intentionally contains only one versioned producer id. The
 * Symbol.for brand makes that data identity work across duplicate packages.
 */
export interface BuiltInMachineDescriptor {
  readonly producerId: string;
}

export interface BuiltInMachineProducerInput {
  readonly sample: Sample;
  readonly selection: ShowSelection;
  readonly route: string;
  readonly pageId: string;
}

/** This callback is held only in a Host registry—not on a descriptor. */
export type BuiltInMachineProducer<Error, Requirements> = (
  input: BuiltInMachineProducerInput,
) => Effect.Effect<BuiltInShowData, Error, Requirements>;

export interface BuiltInMachineRegistry<Error, Requirements> {
  readonly producers: ReadonlyMap<string, BuiltInMachineProducer<Error, Requirements>>;
}

export interface BuiltInMachineProducerMissing {
  readonly code: "report-built-in-machine-producer-missing";
  readonly producerId: string;
}

/** Defines a data-only descriptor. It has no executable producer field. */
export function defineBuiltInMachineDescriptor(producerId: string): BuiltInMachineDescriptor {
  if (!isVersionedProducerId(producerId)) {
    throw new TypeError("a built-in machine producer id must end in @v<positive integer>");
  }
  const descriptor: BuiltInMachineDescriptor = { producerId };
  Object.defineProperty(descriptor, BUILT_IN_MACHINE_DESCRIPTOR, {
    value: BUILT_IN_MACHINE_DESCRIPTOR_BRAND,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return Object.freeze(descriptor);
}

/** A duplicate installed package recognizes the same descriptor through Symbol.for. */
export function isBuiltInMachineDescriptor(value: unknown): value is BuiltInMachineDescriptor {
  if (!isBuiltInDescriptorRecord(value) || !hasOnlyFields(value, ["producerId"]) || !isVersionedProducerId(value.producerId)) {
    return false;
  }
  const brand = Object.getOwnPropertyDescriptor(value, BUILT_IN_MACHINE_DESCRIPTOR);
  return brand !== undefined && "value" in brand && brand.value === BUILT_IN_MACHINE_DESCRIPTOR_BRAND;
}

/** Installs data identity before a built-in definition is frozen; it installs no callback. */
export function attachBuiltInMachineDescriptor<Definition extends object>(
  definition: Definition,
  descriptor: BuiltInMachineDescriptor,
): Definition {
  if (!isBuiltInMachineDescriptor(descriptor)) {
    throw new TypeError("a built-in Report must use a valid machine descriptor");
  }
  Object.defineProperty(definition, BUILT_IN_MACHINE_REPORT_DESCRIPTOR, {
    value: descriptor,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return definition;
}

/** Reads only the stable data descriptor, never a process-local WeakMap. */
export function builtInMachineDescriptorOf(value: unknown): BuiltInMachineDescriptor | undefined {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) return undefined;
  const property = Object.getOwnPropertyDescriptor(value, BUILT_IN_MACHINE_REPORT_DESCRIPTOR);
  return property !== undefined && "value" in property && isBuiltInMachineDescriptor(property.value)
    ? property.value
    : undefined;
}

/**
 * The Host selects the producer from its own registry by producerId. The
 * descriptor is never called and cannot contain a callback to call.
 */
export function produceBuiltInShowData<Error, Requirements>(input: {
  readonly registry: BuiltInMachineRegistry<Error, Requirements>;
  readonly descriptor: BuiltInMachineDescriptor;
  readonly sample: Sample;
  readonly selection: ShowSelection;
  readonly route: string;
  readonly pageId: string;
}): Effect.Effect<
  BuiltInShowData,
  Error | BuiltInMachineProducerMissing,
  Requirements | Scope.Scope
> {
  if (!isBuiltInMachineDescriptor(input.descriptor)) {
    throw new TypeError("a built-in machine descriptor must be created by defineBuiltInMachineDescriptor");
  }
  const producer = input.registry.producers.get(input.descriptor.producerId);
  if (producer === undefined) {
    return Effect.fail(Object.freeze({
      code: "report-built-in-machine-producer-missing" as const,
      producerId: input.descriptor.producerId,
    }));
  }
  return producer({
    sample: input.sample,
    selection: input.selection,
    route: input.route,
    pageId: input.pageId,
  });
}

/** Builds the docs-defined built-in show document from already closed domain data. */
export function builtInShowDocument(input: {
  readonly selection: ShowSelection;
  readonly report: { readonly token: BuiltInReportToken; readonly identity: ContentAddress };
  readonly page: { readonly route: string; readonly pageId: string; readonly title: LocalizedText };
  readonly data: BuiltInShowData;
  readonly projections: ReportProjections;
  readonly problems?: readonly ReportProblem[];
}): BuiltInShowDocument {
  return Object.freeze({
    schema: BUILT_IN_SHOW_SCHEMA,
    locale: "en" as const,
    selection: freezeSelection(input.selection),
    report: Object.freeze({
      token: requireNonEmptyString(input.report.token, "report.token"),
      identity: requireNonEmptyString(input.report.identity, "report.identity"),
    }),
    page: freezePage(input.page),
    data: freezeBuiltInData(input.data),
    projections: freezeProjections(input.projections),
    problems: freezeProblems(input.problems ?? []),
  });
}

/**
 * Builds the docs-defined custom single-target manifest. `ResolvedPage` has
 * already closed every author callback, so reading its English text performs
 * neither component resolution nor a second Analysis request.
 */
export function customTargetExecutionManifest(input: {
  readonly selection: ShowSelection;
  readonly report: { readonly identity: ContentAddress; readonly title: LocalizedText };
  readonly page: ResolvedPage;
  readonly textWidth: number;
  readonly projections: ReportProjections;
  readonly problems?: readonly ReportProblem[];
}): CustomTargetExecutionManifest {
  if (!isPositiveSafeInteger(input.textWidth)) {
    throw new TypeError("custom target execution textWidth must be a positive safe integer");
  }
  const text = resolvedPageText(input.page, { locale: "en", width: input.textWidth });
  if (!("state" in text) || text.state !== "rendered") {
    throw new TypeError("the selected Page lacks a closed English text projection at the requested width");
  }
  return Object.freeze({
    schema: CUSTOM_TARGET_EXECUTION_SCHEMA,
    locale: "en" as const,
    selection: freezeSelection(input.selection),
    report: Object.freeze({
      identity: requireNonEmptyString(input.report.identity, "report.identity"),
      title: freezeLocalizedText(input.report.title, "report.title"),
    }),
    page: Object.freeze({
      route: input.page.target.route,
      pageId: input.page.target.pageId,
      title: freezeLocalizedText(input.page.title, "page.title"),
      renderedText: text.text,
    }),
    // Assets remain revision payloads. The target-page manifest intentionally
    // exposes only the docs-defined download summaries, never either payload.
    downloads: Object.freeze([...input.page.downloads]
      .map((download) => Object.freeze({
        path: download.path,
        mediaType: download.mediaType,
        bytes: download.byteLength,
      }))
      .sort((left, right) =>
        compareUtf8(left.path, right.path) || compareUtf8(left.mediaType, right.mediaType) || left.bytes - right.bytes
      )),
    projections: freezeProjections(input.projections),
    problems: freezeProblems(input.problems ?? []),
  });
}

/** Canonical UTF-8 JSON for the two show schemas. */
export function canonicalMachineJson(value: BuiltInShowDocument | CustomTargetExecutionManifest): string {
  return writeCanonicalJson(closeMachineJson(value));
}

/** Strict JSON clone for a Host-owned closed domain value. */
export function closeMachineJson(value: unknown): JsonValue {
  return closeJson(value, new Set<object>());
}

/**
 * A PricingProfile carries an internal Symbol descriptor for cross-package
 * validation. Machine documents expose only its closed enumerable data form.
 */
export function closePricingProfileJson(profile: PricingProfile): JsonValue {
  return closeMachineJson(Object.fromEntries(Object.entries(profile)));
}

function freezeSelection(value: ShowSelection): ShowSelection {
  const sampleIdentity = requireNonEmptyString(value.sampleIdentity, "selection.sampleIdentity");
  switch (value.kind) {
    case "project-current":
      return Object.freeze({
        kind: "project-current" as const,
        sampleIdentity,
        experimentIds: freezeSortedUniqueStrings(value.experimentIds, "selection.experimentIds"),
      });
    case "explicit-runs":
      return Object.freeze({
        kind: "explicit-runs" as const,
        sampleIdentity,
        runIds: freezeSortedUniqueStrings(value.runIds, "selection.runIds"),
      });
    case "attempt-locator":
      return Object.freeze({
        kind: "attempt-locator" as const,
        sampleIdentity,
        locator: requireNonEmptyString(value.locator, "selection.locator"),
      });
  }
}

function freezePage(value: {
  readonly route: string;
  readonly pageId: string;
  readonly title: LocalizedText;
}): { readonly route: string; readonly pageId: string; readonly title: LocalizedText } {
  return Object.freeze({
    route: requireNonEmptyString(value.route, "page.route"),
    pageId: requireNonEmptyString(value.pageId, "page.pageId"),
    title: freezeLocalizedText(value.title, "page.title"),
  });
}

function freezeBuiltInData(value: BuiltInShowData): BuiltInShowData {
  if (!isPlainRecord(value) || typeof value.kind !== "string") {
    throw new TypeError("built-in show data must be a named domain result");
  }
  // Domain arrays are deliberately not given a generic renderer sort here.
  // The selected registry producer owns their stable identities and must close
  // them in the canonical order defined for that domain before returning.
  switch (value.kind) {
    case "leaderboard":
      assertExactFields(value, ["kind", "rows"], "leaderboard show data");
      return Object.freeze({ kind: "leaderboard" as const, rows: closeMachineJson(value.rows) });
    case "attempt":
      assertExactFields(value, ["kind", "evidence", "observability", "fileChanges"], "attempt show data");
      return Object.freeze({
        kind: "attempt" as const,
        evidence: closeMachineJson(value.evidence),
        observability: closeMachineJson(value.observability),
        fileChanges: closeMachineJson(value.fileChanges),
      });
    case "source":
      assertExactFields(value, ["kind", "sources"], "source show data");
      return Object.freeze({ kind: "source" as const, sources: closeMachineJson(value.sources) });
    case "execution":
      assertExactFields(value, ["kind", "execution"], "execution show data");
      return Object.freeze({ kind: "execution" as const, execution: closeMachineJson(value.execution) });
    case "timing":
      assertExactFields(value, ["kind", "timing"], "timing show data");
      return Object.freeze({ kind: "timing" as const, timing: closeMachineJson(value.timing) });
    default:
      throw new TypeError("built-in show data kind is not declared by the show schema");
  }
}

/** Re-closes a ReportProjections value: validates schema, dedupes, and canonically sorts. */
function freezeProjections(value: ReportProjections): ReportProjections {
  if (!isPlainRecord(value) || value.schema !== REPORT_PROJECTIONS_SCHEMA) {
    throw new TypeError("projections must be a niceeval.report-projections/v1 value");
  }
  return buildReportProjections({
    pricingProfile: value.pricingProfile,
    costs: value.costs.map((entry) => ({
      page: entry.page,
      measureId: entry.measureId,
      row: entry.row,
      profileIdentity: entry.profileIdentity,
      projection: entry.projection,
    })),
  });
}

function freezeProblems(value: readonly ReportProblem[]): readonly ReportProblem[] {  if (!Array.isArray(value)) throw new TypeError("problems must be an array");
  const entries = value.map((problem, index) => {
    if (!isNonEmptyString(problem.code)) throw new TypeError(`problems[${index}].code must be a non-empty string`);
    const path = freezeStrings(problem.path, `problems[${index}].path`);
    const refs = freezeSortedUniqueStrings(problem.refs, `problems[${index}].refs`);
    if (problem.summary !== undefined && !isNonEmptyString(problem.summary)) {
      throw new TypeError(`problems[${index}].summary must be a non-empty string when supplied`);
    }
    return Object.freeze({
      code: problem.code,
      path,
      refs,
      ...(problem.summary === undefined ? {} : { summary: problem.summary }),
    });
  });
  return Object.freeze(entries.sort((left, right) =>
    compareUtf8(left.code, right.code) ||
    comparePath(left.path, right.path) ||
    compareStringArrays(left.refs, right.refs) ||
    compareUtf8(left.summary ?? "", right.summary ?? "")
  ));
}

function freezeLocalizedText(value: LocalizedText, label: string): LocalizedText {
  if (typeof value === "string") return value;
  const closed = closeMachineJson(value);
  if (closed === null || Array.isArray(closed) || typeof closed !== "object") {
    throw new TypeError(`${label} must be a string or locale map`);
  }
  const entries = Object.entries(closed);
  if (entries.length === 0 || entries.some(([locale, text]) => !isNonEmptyString(locale) || typeof text !== "string")) {
    throw new TypeError(`${label} must be a non-empty locale map of strings`);
  }
  const result: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const [locale, text] of entries) {
    // The validation above proves this is a locale-string pair.
    result[locale] = text as string;
  }
  return Object.freeze(result);
}

function freezeStrings(value: readonly string[], label: string): readonly string[] {
  if (!Array.isArray(value) || value.some((entry) => !isNonEmptyString(entry))) {
    throw new TypeError(`${label} must be an array of non-empty strings`);
  }
  return Object.freeze([...value]);
}

function freezeSortedUniqueStrings(value: readonly string[], label: string): readonly string[] {
  const entries = freezeStrings(value, label);
  return Object.freeze([...new Set(entries)].sort(compareUtf8));
}

function comparePath(left: readonly string[], right: readonly string[]): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = compareUtf8(left[index]!, right[index]!);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

function compareStringArrays(left: readonly string[], right: readonly string[]): number {
  return comparePath(left, right);
}

function closeJson(value: unknown, active: Set<object>): JsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("machine JSON cannot contain a non-finite number");
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value === "undefined" || typeof value === "bigint" || typeof value === "symbol" || typeof value === "function") {
    throw new TypeError("machine JSON must be data only");
  }
  if (active.has(value)) throw new TypeError("machine JSON cannot contain a cycle");
  active.add(value);
  try {
    if (Array.isArray(value)) return Object.freeze(value.map((entry) => closeJson(entry, active)));
    if (!isPlainRecord(value)) throw new TypeError("machine JSON must use plain data objects");
    const copy: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
    for (const key of Object.keys(value).sort(compareUtf8)) copy[key] = closeJson(value[key], active);
    return Object.freeze(copy);
  } finally {
    active.delete(value);
  }
}

function writeCanonicalJson(value: JsonValue): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      return JSON.stringify(value);
    case "string":
      return JSON.stringify(value);
    case "object":
      break;
  }
  if (Array.isArray(value)) return `[${value.map(writeCanonicalJson).join(",")}]`;
  const record = value as Readonly<Record<string, JsonValue>>;
  const keys = Object.keys(record).sort(compareUtf8);
  return `{${keys.map((key) => `${JSON.stringify(key)}:${writeCanonicalJson(record[key]!)}`).join(",")}}`;
}

function isPlainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value) || value instanceof Uint8Array) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) return false;
  }
  return true;
}

/** The descriptor alone is allowed its one non-enumerable Symbol.for brand. */
function isBuiltInDescriptorRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value) || value instanceof Uint8Array) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === "symbol" && key !== BUILT_IN_MACHINE_DESCRIPTOR) return false;
    if (typeof key !== "string" && typeof key !== "symbol") return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor)) return false;
  }
  return true;
}

function hasOnlyFields(value: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean {
  const actual = Object.getOwnPropertyNames(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function assertExactFields(value: Readonly<Record<string, unknown>>, keys: readonly string[], label: string): void {
  if (!hasOnlyFields(value, keys)) throw new TypeError(`${label} has an invalid field set`);
}

function isVersionedProducerId(value: unknown): value is string {
  return typeof value === "string" && /^[^\s@][^\s]*@v[1-9][0-9]*$/u.test(value);
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (!isNonEmptyString(value)) throw new TypeError(`${label} must be a non-empty string`);
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string") throw new TypeError(`${label} must be a string`);
  return value;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
