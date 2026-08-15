import type { AnalysisSample } from "../../analysis/index.ts";
import type { ProjectedSample, ProjectionAccess } from "../../projection/model.ts";
import {
  projectionRequirementDependency,
  recordProjectionDeclaration,
  type RecordProjection,
} from "../../projection/projector.ts";
import type { ReportCalculationResult } from "../execution/results.ts";
import type { ReportDocument } from "../semantic/document.ts";
import {
  isReportComponentId,
  isReportId,
  isReportRoute,
  type ReportComponentId,
  type ReportDownloadPath,
  type ReportId,
  type ReportInstanceKey,
  type ReportRoute,
} from "./identity.ts";

const reportDataPlanTypeId: unique symbol = Symbol(
  "@niceeval/report/ReportDataPlan",
);
const reportDataPlanCardinalityTypeId: unique symbol = Symbol(
  "@niceeval/report/ReportDataPlanCardinality",
);
const reportCalculationTypeId: unique symbol = Symbol(
  "@niceeval/report/ReportCalculation",
);
const reportPageTypeId: unique symbol = Symbol("@niceeval/report/ReportPage");
const reportPageFamilyTypeId: unique symbol = Symbol(
  "@niceeval/report/ReportPageFamily",
);
const reportDownloadTypeId: unique symbol = Symbol(
  "@niceeval/report/ReportDownload",
);
const reportTypeId: unique symbol = Symbol("@niceeval/report/Report");

type DataPlanCardinality = "empty" | "non-empty";
type AnyRecordProjection = RecordProjection<any, any>;

export interface DataPlan<Shape extends object, Cardinality extends DataPlanCardinality> {
  readonly [reportDataPlanTypeId]: { readonly _Shape: () => Shape };
  readonly [reportDataPlanCardinalityTypeId]: Cardinality;
}

/**
 * A package-created, named projection shape. Its actual declarations live in
 * a private WeakMap rather than in a forgeable object field.
 */
export type ReportDataPlan<Shape extends object = object> = DataPlan<
  Shape,
  DataPlanCardinality
>;

type EmptyReportDataPlan = DataPlan<object, "empty">;
export type NonEmptyReportDataPlan = DataPlan<object, "non-empty">;

export type ReportDataShape<Plan extends ReportDataPlan> =
  Plan extends DataPlan<infer Shape, DataPlanCardinality> ? Shape : never;

export type ReportProjectedValues<Plan extends ReportDataPlan> = {
  readonly [Key in keyof ReportDataShape<Plan>]:
    ReportDataShape<Plan>[Key] extends RecordProjection<
      infer Access,
      infer Value
    >
      ? ProjectedSample<Access, Value>
      : never;
};

export type ReportCompleteness = "allow-partial" | "require-complete";

export interface ReportDataState {
  readonly state: "complete" | "partial";
}

type CalculationCompleteness<Inputs extends ReportDataPlan> =
  Inputs extends NonEmptyReportDataPlan
    ? { readonly completeness: ReportCompleteness }
    : { readonly completeness?: never };

/** One static projection-derived value with no dependency on another Calculation. */
export type ReportCalculation<Inputs extends ReportDataPlan, Value> = Readonly<{
  readonly id: ReportComponentId;
  readonly inputs: Inputs;
  readonly calculate: (context: {
    readonly sample: AnalysisSample;
    readonly inputs: ReportProjectedValues<Inputs>;
  }) => Value;
  readonly [reportCalculationTypeId]: (value: Value) => Value;
}> & CalculationCompleteness<Inputs>;

export type AnyReportCalculation = ReportCalculation<any, any>;
export type ReportCalculationSet = Readonly<Record<string, AnyReportCalculation>>;

export type ReportCalculationResults<Set extends object> = {
  readonly [Key in keyof Set]: Set[Key] extends ReportCalculation<any, infer Value>
    ? ReportCalculationResult<Value>
    : never;
};

export type ReportComponentContext<
  Inputs extends ReportDataPlan | undefined = undefined,
  Calculations extends object = {},
> = {
  readonly sample: AnalysisSample;
  readonly inputs: Inputs extends ReportDataPlan
    ? ReportProjectedValues<Inputs>
    : {};
  readonly calculations: ReportCalculationResults<Calculations>;
};

/** An opaque fixed Page. Its callback is retained only in package-private authority. */
export interface ReportPage {
  readonly id: ReportComponentId;
  readonly route: ReportRoute;
  readonly [reportPageTypeId]: () => void;
}

/** An opaque PageFamily whose instances are expanded only from already-formed values. */
export interface ReportPageFamily {
  readonly id: ReportComponentId;
  readonly [reportPageFamilyTypeId]: () => void;
}

export interface ReportDownloadFile {
  readonly path: ReportDownloadPath;
  readonly mediaType: string;
  readonly bytes: Uint8Array;
}

/** An opaque authored Download. */
export interface ReportDownload {
  readonly id: ReportComponentId;
  readonly [reportDownloadTypeId]: () => void;
}

/** The sole public aggregate for a Report authoring module. */
export interface Report {
  readonly id: ReportId;
  readonly calculations: ReportCalculationSet;
  readonly pages: readonly (ReportPage | ReportPageFamily)[];
  readonly downloads: readonly ReportDownload[];
  readonly [reportTypeId]: () => void;
}

interface DataPlanContents {
  readonly entries: readonly {
    readonly key: string;
    readonly projection: RecordProjection<ProjectionAccess, unknown>;
  }[];
  readonly cardinality: DataPlanCardinality;
}

type AuthorCallback = (...arguments_: never[]) => unknown;

interface ComponentContents {
  readonly calculations: ReportCalculationSet;
  readonly calculationsById: readonly AnyReportCalculation[];
  readonly inputs?: ReportDataPlan;
  readonly completeness?: ReportCompleteness;
}

interface CalculationContents {
  readonly calculations: ReportCalculationSet;
  readonly calculationsById: readonly AnyReportCalculation[];
  readonly inputs: ReportDataPlan;
  readonly completeness?: ReportCompleteness;
  readonly calculate: AuthorCallback;
}

interface PageContents extends ComponentContents {
  readonly render: AuthorCallback;
}

export type ReportPageNavigationTitle = string | {
  readonly en: string;
  readonly "zh-CN": string;
};

export interface ReportPageNavigationDefinition {
  readonly title: ReportPageNavigationTitle;
  readonly visible: boolean;
}

interface PageFamilyContents extends ComponentContents {
  readonly instances: AuthorCallback;
  readonly key: AuthorCallback;
  readonly route: AuthorCallback;
  readonly render: AuthorCallback;
}

interface DownloadContents extends ComponentContents {
  readonly build: AuthorCallback;
}

interface ReportContents {
  readonly calculations: ReportCalculationSet;
  readonly calculationsById: readonly AnyReportCalculation[];
  readonly pages: readonly (ReportPage | ReportPageFamily)[];
  readonly downloads: readonly ReportDownload[];
}

const dataPlanContentsByPlan = new WeakMap<object, DataPlanContents>();
const calculationContentsByCalculation = new WeakMap<object, CalculationContents>();
const pageContentsByPage = new WeakMap<object, PageContents>();
const pageNavigationByPage = new WeakMap<object, ReportPageNavigationDefinition>();
const familyContentsByFamily = new WeakMap<object, PageFamilyContents>();
const downloadContentsByDownload = new WeakMap<object, DownloadContents>();
const reportContentsByReport = new WeakMap<object, ReportContents>();

const INPUT_KEY_PATTERN = /^[a-z][a-z0-9_-]*$/;
const MAX_INPUT_KEY_BYTES = 64;
const encoder = new TextEncoder();

type ProjectionShapeCheck<Shape extends object> = {
  readonly [Key in keyof Shape]: Shape[Key] extends AnyRecordProjection
    ? unknown
    : never;
};

type ShapeCardinality<Shape extends object> = keyof Shape extends never
  ? "empty"
  : "non-empty";

type CalculationSetCheck<Set extends object> = {
  readonly [Key in keyof Set]: Set[Key] extends AnyReportCalculation
    ? unknown
    : never;
};

/**
 * Captures an exact named projection shape. Runtime validation rejects copied
 * projections, accessors, symbols, and non-plain objects before any host I/O.
 */
export function reportInputs<const Shape extends object>(
  shape: Shape & ProjectionShapeCheck<Shape>,
): DataPlan<Shape, ShapeCardinality<Shape>> {
  const fields = ownFields(shape, "report inputs");
  const entries: DataPlanContents["entries"][number][] = [];

  for (const [key, value] of fields) {
    if (!INPUT_KEY_PATTERN.test(key) || utf8Bytes(key) > MAX_INPUT_KEY_BYTES) {
      throw new TypeError(
        "a report input key must match [a-z][a-z0-9_-]* and contain at most 64 UTF-8 bytes",
      );
    }
    const projection = requireProjection(value);
    entries.push(Object.freeze({ key, projection }));
  }
  entries.sort((left, right) => compareText(left.key, right.key));

  const projectionIdentities = new Set<object>(
    entries.map((entry) => entry.projection as object),
  );
  for (const entry of entries) {
    const dependency = projectionRequirementDependency(entry.projection);
    if (dependency !== undefined && !projectionIdentities.has(dependency)) {
      throw new TypeError(
        `report input ${entry.key} requires its package projection dependency in the same plan`,
      );
    }
  }

  const cardinality: ShapeCardinality<Shape> = entries.length === 0
    ? "empty" as ShapeCardinality<Shape>
    : "non-empty" as ShapeCardinality<Shape>;
  const plan = Object.freeze({
    [reportDataPlanTypeId]: { _Shape: (): Shape => shape },
    [reportDataPlanCardinalityTypeId]: cardinality,
  }) as DataPlan<Shape, ShapeCardinality<Shape>>;
  dataPlanContentsByPlan.set(
    plan,
    Object.freeze({
      entries: Object.freeze(entries),
      cardinality,
    }),
  );
  return plan;
}

export function defineCalculation<Inputs extends EmptyReportDataPlan, Value>(
  definition: {
    readonly id: ReportComponentId;
    readonly inputs: Inputs;
    readonly completeness?: never;
    readonly calculate: (context: {
      readonly sample: AnalysisSample;
      readonly inputs: ReportProjectedValues<Inputs>;
    }) => Value;
  },
): ReportCalculation<Inputs, Value>;
export function defineCalculation<Inputs extends NonEmptyReportDataPlan, Value>(
  definition: {
    readonly id: ReportComponentId;
    readonly inputs: Inputs;
    readonly completeness: ReportCompleteness;
    readonly calculate: (context: {
      readonly sample: AnalysisSample;
      readonly inputs: ReportProjectedValues<Inputs>;
    }) => Value;
  },
): ReportCalculation<Inputs, Value>;
export function defineCalculation(
  definition: unknown,
): ReportCalculation<ReportDataPlan, unknown> {
  const fields = fieldsOnly(
    definition,
    ["id", "inputs", "completeness", "calculate"],
    "a Calculation",
  );
  const id = requireReportComponentId(fields.get("id"));
  const inputs = requireDataPlan(fields.get("inputs"));
  const contents = dataPlanContents(inputs);
  const calculate = requireFunction(fields.get("calculate"), "calculate");
  const completeness = validateCompleteness(fields, contents.cardinality, "a Calculation");

  const calculation = Object.freeze({
    id,
    inputs,
    ...(completeness === undefined ? {} : { completeness }),
    calculate,
    [reportCalculationTypeId]: (value: unknown): unknown => value,
  }) as ReportCalculation<ReportDataPlan, unknown>;
  calculationContentsByCalculation.set(
    calculation,
    Object.freeze({
      calculations: Object.freeze({}),
      calculationsById: Object.freeze([]),
      inputs,
      ...(completeness === undefined ? {} : { completeness }),
      calculate,
    }),
  );
  return calculation;
}

export function definePage<Calculations extends object = {}>(definition: {
  readonly id: ReportComponentId;
  readonly route: ReportRoute;
  readonly inputs?: never;
  readonly completeness?: never;
  readonly calculations?: Calculations & CalculationSetCheck<Calculations>;
  readonly render: (
    context: ReportComponentContext<undefined, Calculations>,
  ) => ReportDocument | Promise<ReportDocument>;
}): ReportPage;
export function definePage<
  Inputs extends NonEmptyReportDataPlan,
  Calculations extends object = {},
>(definition: {
  readonly id: ReportComponentId;
  readonly route: ReportRoute;
  readonly inputs: Inputs;
  readonly completeness: ReportCompleteness;
  readonly calculations?: Calculations & CalculationSetCheck<Calculations>;
  readonly render: (
    context: ReportComponentContext<Inputs, Calculations>,
  ) => ReportDocument | Promise<ReportDocument>;
}): ReportPage;
export function definePage(definition: unknown): ReportPage {
  const fields = fieldsOnly(
    definition,
    ["id", "route", "inputs", "completeness", "calculations", "render"],
    "a Page",
  );
  const id = requireReportComponentId(fields.get("id"));
  const reportRouteValue = requireReportRoute(fields.get("route"));
  const component = componentData(fields, "a Page");
  const render = requireFunction(fields.get("render"), "render");

  const page = Object.freeze({
    id,
    route: reportRouteValue,
    [reportPageTypeId]: (): void => undefined,
  }) as ReportPage;
  pageContentsByPage.set(
    page,
    Object.freeze({ ...component, render }),
  );
  return page;
}

export function definePageFamily<Instance, Calculations extends object = {}>(
  definition: {
    readonly id: ReportComponentId;
    readonly inputs?: never;
    readonly completeness?: never;
    readonly calculations?: Calculations & CalculationSetCheck<Calculations>;
    readonly instances: (
      context: ReportComponentContext<undefined, Calculations>,
    ) => Iterable<Instance>;
    readonly key: (instance: Instance) => ReportInstanceKey;
    readonly route: (instance: Instance) => ReportRoute;
    readonly render: (
      context: ReportComponentContext<undefined, Calculations> & {
        readonly instance: Instance;
      },
    ) => ReportDocument | Promise<ReportDocument>;
  },
): ReportPageFamily;
export function definePageFamily<
  Inputs extends NonEmptyReportDataPlan,
  Instance,
  Calculations extends object = {},
>(definition: {
  readonly id: ReportComponentId;
  readonly inputs: Inputs;
  readonly completeness: ReportCompleteness;
  readonly calculations?: Calculations & CalculationSetCheck<Calculations>;
  readonly instances: (
    context: ReportComponentContext<Inputs, Calculations>,
  ) => Iterable<Instance>;
  readonly key: (instance: Instance) => ReportInstanceKey;
  readonly route: (instance: Instance) => ReportRoute;
  readonly render: (
    context: ReportComponentContext<Inputs, Calculations> & {
      readonly instance: Instance;
    },
    ) => ReportDocument | Promise<ReportDocument>;
}): ReportPageFamily;
export function definePageFamily(definition: unknown): ReportPageFamily {
  const fields = fieldsOnly(
    definition,
    ["id", "inputs", "completeness", "calculations", "instances", "key", "route", "render"],
    "a PageFamily",
  );
  const id = requireReportComponentId(fields.get("id"));
  const component = componentData(fields, "a PageFamily");
  const instances = requireFunction(fields.get("instances"), "instances");
  const key = requireFunction(fields.get("key"), "key");
  const route = requireFunction(fields.get("route"), "route");
  const render = requireFunction(fields.get("render"), "render");

  const family = Object.freeze({
    id,
    [reportPageFamilyTypeId]: (): void => undefined,
  }) as ReportPageFamily;
  familyContentsByFamily.set(
    family,
    Object.freeze({
      ...component,
      instances,
      key,
      route,
      render,
    }),
  );
  return family;
}

export function defineDownload<Calculations extends object = {}>(definition: {
  readonly id: ReportComponentId;
  readonly inputs?: never;
  readonly completeness?: never;
  readonly calculations?: Calculations & CalculationSetCheck<Calculations>;
  readonly build: (
    context: ReportComponentContext<undefined, Calculations>,
  ) => Iterable<ReportDownloadFile>;
}): ReportDownload;
export function defineDownload<
  Inputs extends NonEmptyReportDataPlan,
  Calculations extends object = {},
>(definition: {
  readonly id: ReportComponentId;
  readonly inputs: Inputs;
  readonly completeness: ReportCompleteness;
  readonly calculations?: Calculations & CalculationSetCheck<Calculations>;
  readonly build: (
    context: ReportComponentContext<Inputs, Calculations>,
  ) => Iterable<ReportDownloadFile>;
}): ReportDownload;
export function defineDownload(definition: unknown): ReportDownload {
  const fields = fieldsOnly(
    definition,
    ["id", "inputs", "completeness", "calculations", "build"],
    "a Download",
  );
  const id = requireReportComponentId(fields.get("id"));
  const component = componentData(fields, "a Download");
  const build = requireFunction(fields.get("build"), "build");

  const download = Object.freeze({
    id,
    [reportDownloadTypeId]: (): void => undefined,
  }) as ReportDownload;
  downloadContentsByDownload.set(
    download,
    Object.freeze({ ...component, build }),
  );
  return download;
}

export function defineReport<Calculations extends object = {}>(definition: {
  readonly id: ReportId;
  readonly calculations?: Calculations & CalculationSetCheck<Calculations>;
  readonly pages: readonly (ReportPage | ReportPageFamily)[];
  readonly downloads?: readonly ReportDownload[];
}): Report {
  const fields = fieldsOnly(
    definition,
    ["id", "calculations", "pages", "downloads"],
    "a Report",
  );
  const id = requireReportId(fields.get("id"));
  const calculations = calculationSet(fields.get("calculations"));
  const pages = reportPages(fields.get("pages"));
  const downloads = reportDownloads(fields.get("downloads"));

  const components: Array<ReportPage | ReportPageFamily | ReportDownload | AnyReportCalculation> = [
    ...calculations.values,
    ...pages,
    ...downloads,
  ];
  assertUniqueComponentIds(components);

  const registeredCalculations = new Set<object>(calculations.values);
  for (const component of pages) {
    const calculationsForComponent = isReportPage(component)
      ? pageCalculations(component)
      : familyCalculations(component);
    for (const calculation of calculationsForComponent) {
      if (!registeredCalculations.has(calculation)) {
        throw new TypeError("a Page or PageFamily may reference only Calculations registered by its Report");
      }
    }
  }
  for (const download of downloads) {
    for (const calculation of downloadCalculations(download)) {
      if (!registeredCalculations.has(calculation)) {
        throw new TypeError("a Download may reference only Calculations registered by its Report");
      }
    }
  }

  const report = Object.freeze({
    id,
    calculations: calculations.object,
    pages: Object.freeze([...pages]),
    downloads: Object.freeze([...downloads].sort(compareComponent)),
    [reportTypeId]: (): void => undefined,
  }) as Report;
  reportContentsByReport.set(
    report,
    Object.freeze({
      calculations: calculations.object,
      calculationsById: calculations.values,
      pages: report.pages,
      downloads: report.downloads,
    }),
  );
  return report;
}

export function isReport(value: unknown): value is Report {
  return typeof value === "object" && value !== null && reportContentsByReport.has(value);
}

/** @internal Exact-identity bridge used only by author/internal.ts. */
export function authorInternalReportContents(report: Report): ReportContents {
  const contents = reportContentsByReport.get(report);
  if (contents === undefined) {
    throw new TypeError("a Report must be created by defineReport");
  }
  return contents;
}

/** @internal Exact-identity bridge used only by author/internal.ts. */
export function authorInternalDataPlanContents(plan: ReportDataPlan): DataPlanContents {
  return dataPlanContents(plan);
}

/** @internal Exact-identity bridge used only by author/internal.ts. */
export function authorInternalCalculationContents(
  calculation: AnyReportCalculation,
): CalculationContents {
  const contents = calculationContentsByCalculation.get(calculation);
  if (contents === undefined) {
    throw new TypeError("a Calculation must be created by defineCalculation");
  }
  return contents;
}

/** @internal Exact-identity bridge used only by author/internal.ts. */
export function authorInternalPageContents(page: ReportPage): PageContents {
  const contents = pageContentsByPage.get(page);
  if (contents === undefined) {
    throw new TypeError("a Page must be created by definePage");
  }
  return contents;
}

/** @internal Adds classic host navigation metadata without widening the low-level Page author API. */
export function authorInternalSetPageNavigation(
  page: ReportPage,
  navigation: ReportPageNavigationDefinition,
): void {
  if (!pageContentsByPage.has(page)) {
    throw new TypeError("page navigation requires a Page created by definePage");
  }
  const title = typeof navigation.title === "string"
    ? navigation.title
    : Object.freeze({ ...navigation.title });
  pageNavigationByPage.set(page, Object.freeze({ title, visible: navigation.visible }));
}

/** @internal Reads optional classic navigation metadata for one exact fixed Page. */
export function authorInternalPageNavigation(
  page: ReportPage,
): ReportPageNavigationDefinition | undefined {
  return pageNavigationByPage.get(page);
}

/** @internal Exact-identity bridge used only by author/internal.ts. */
export function authorInternalPageFamilyContents(
  family: ReportPageFamily,
): PageFamilyContents {
  const contents = familyContentsByFamily.get(family);
  if (contents === undefined) {
    throw new TypeError("a PageFamily must be created by definePageFamily");
  }
  return contents;
}

/** @internal Exact-identity bridge used only by author/internal.ts. */
export function authorInternalPageMemberContents(
  member: ReportPage | ReportPageFamily,
):
  | { readonly kind: "page"; readonly contents: PageContents }
  | { readonly kind: "page-family"; readonly contents: PageFamilyContents } {
  const page = pageContentsByPage.get(member);
  if (page !== undefined) {
    return Object.freeze({ kind: "page" as const, contents: page });
  }
  const family = familyContentsByFamily.get(member);
  if (family !== undefined) {
    return Object.freeze({ kind: "page-family" as const, contents: family });
  }
  throw new TypeError("a Report page must be created by definePage or definePageFamily");
}

/** @internal Exact-identity bridge used only by author/internal.ts. */
export function authorInternalDownloadContents(
  download: ReportDownload,
): DownloadContents {
  const contents = downloadContentsByDownload.get(download);
  if (contents === undefined) {
    throw new TypeError("a Download must be created by defineDownload");
  }
  return contents;
}

function componentData(
  fields: ReadonlyMap<string, unknown>,
  label: string,
): ComponentContents {
  const hasInputs = fields.has("inputs");
  if (!hasInputs) {
    if (fields.has("completeness")) {
      throw new TypeError(`${label} without projected inputs must not declare completeness`);
    }
    const calculations = calculationSet(fields.get("calculations"));
    return Object.freeze({
      calculations: calculations.object,
      calculationsById: calculations.values,
    });
  }

  const plan = requireDataPlan(fields.get("inputs"));
  if (dataPlanContents(plan).cardinality === "empty") {
    throw new TypeError(`${label} with no projected inputs must omit inputs and completeness`);
  }
  const completeness = validateCompleteness(fields, "non-empty", label);
  const calculations = calculationSet(fields.get("calculations"));
  return Object.freeze({
    calculations: calculations.object,
    calculationsById: calculations.values,
    inputs: plan,
    ...(completeness === undefined ? {} : { completeness }),
  });
}

function validateCompleteness(
  fields: ReadonlyMap<string, unknown>,
  cardinality: DataPlanCardinality,
  label: string,
): ReportCompleteness | undefined {
  if (cardinality === "empty") {
    if (fields.has("completeness")) {
      throw new TypeError(`${label} with no projected inputs must not declare completeness`);
    }
    return undefined;
  }
  const value = fields.get("completeness");
  if (value !== "allow-partial" && value !== "require-complete") {
    throw new TypeError(`${label} with projected inputs must declare completeness`);
  }
  return value;
}

function calculationSet(value: unknown): {
  readonly object: ReportCalculationSet;
  readonly values: readonly AnyReportCalculation[];
} {
  if (value === undefined) {
    return Object.freeze({ object: Object.freeze({}), values: Object.freeze([]) });
  }
  const fields = ownFields(value, "a Calculation set");
  const entries: Array<readonly [string, AnyReportCalculation]> = [];
  for (const [key, candidate] of fields) {
    entries.push(Object.freeze([key, requireCalculation(candidate)]));
  }
  entries.sort((left, right) => compareText(left[0], right[0]));

  const object: Record<string, AnyReportCalculation> = Object.create(null) as Record<
    string,
    AnyReportCalculation
  >;
  for (const [key, calculation] of entries) {
    Object.defineProperty(object, key, {
      value: calculation,
      enumerable: true,
      writable: false,
      configurable: false,
    });
  }
  return Object.freeze({
    object: Object.freeze(object),
    values: Object.freeze(
      entries.map(([, calculation]) => calculation).sort(compareCalculation),
    ),
  });
}

function reportPages(value: unknown): readonly (ReportPage | ReportPageFamily)[] {
  if (!Array.isArray(value)) {
    throw new TypeError("a Report must declare pages as an array");
  }
  const pages = value.map((candidate) => {
    if (isReportPage(candidate) || isReportPageFamily(candidate)) {
      return candidate;
    }
    throw new TypeError("every Report page must be created by definePage or definePageFamily");
  });
  return Object.freeze(pages);
}

function reportDownloads(value: unknown): readonly ReportDownload[] {
  if (value === undefined) {
    return Object.freeze([]);
  }
  if (!Array.isArray(value)) {
    throw new TypeError("Report downloads must be an array");
  }
  return Object.freeze(value.map((candidate) => requireDownload(candidate)));
}

function assertUniqueComponentIds(
  components: readonly (ReportPage | ReportPageFamily | ReportDownload | AnyReportCalculation)[],
): void {
  const ids = new Set<string>();
  for (const component of components) {
    if (ids.has(component.id)) {
      throw new TypeError("component IDs must be unique within a Report");
    }
    ids.add(component.id);
  }
}

function pageCalculations(page: ReportPage): readonly AnyReportCalculation[] {
  const contents = pageContentsByPage.get(page);
  if (contents === undefined) {
    throw new TypeError("a Page must be created by definePage");
  }
  return contents.calculationsById;
}

function familyCalculations(family: ReportPageFamily): readonly AnyReportCalculation[] {
  const contents = familyContentsByFamily.get(family);
  if (contents === undefined) {
    throw new TypeError("a PageFamily must be created by definePageFamily");
  }
  return contents.calculationsById;
}

function downloadCalculations(download: ReportDownload): readonly AnyReportCalculation[] {
  const contents = downloadContentsByDownload.get(download);
  if (contents === undefined) {
    throw new TypeError("a Download must be created by defineDownload");
  }
  return contents.calculationsById;
}

function requireCalculation(value: unknown): AnyReportCalculation {
  if (typeof value !== "object" || value === null || !calculationContentsByCalculation.has(value)) {
    throw new TypeError("a Calculation must be created by defineCalculation");
  }
  return value as AnyReportCalculation;
}

function requireDownload(value: unknown): ReportDownload {
  if (typeof value !== "object" || value === null || !downloadContentsByDownload.has(value)) {
    throw new TypeError("a Download must be created by defineDownload");
  }
  return value as ReportDownload;
}

export function isReportPage(value: unknown): value is ReportPage {
  return typeof value === "object" && value !== null && pageContentsByPage.has(value);
}

export function isReportPageFamily(value: unknown): value is ReportPageFamily {
  return typeof value === "object" && value !== null && familyContentsByFamily.has(value);
}

function requireDataPlan(value: unknown): ReportDataPlan {
  if (typeof value !== "object" || value === null || !dataPlanContentsByPlan.has(value)) {
    throw new TypeError("Report inputs must be created by reportInputs");
  }
  return value as ReportDataPlan;
}

function dataPlanContents(value: ReportDataPlan): DataPlanContents {
  const contents = dataPlanContentsByPlan.get(value);
  if (contents === undefined) {
    throw new TypeError("Report inputs must be created by reportInputs");
  }
  return contents;
}

function requireProjection(value: unknown): RecordProjection<ProjectionAccess, unknown> {
  if (typeof value !== "object" || value === null) {
    throw new TypeError("every report input must be a RecordProjection");
  }
  const projection = value as RecordProjection<ProjectionAccess, unknown>;
  try {
    recordProjectionDeclaration(projection);
  } catch {
    throw new TypeError("every report input must be a RecordProjection created by NiceEval");
  }
  return projection;
}

function requireReportId(value: unknown): ReportId {
  if (!isReportId(value)) {
    throw new TypeError("a Report must use a ReportId created by reportId");
  }
  return value as ReportId;
}

function requireReportComponentId(value: unknown): ReportComponentId {
  if (!isReportComponentId(value)) {
    throw new TypeError(
      "a Report component must use a ReportComponentId created by reportComponentId",
    );
  }
  return value as ReportComponentId;
}

function requireReportRoute(value: unknown): ReportRoute {
  if (!isReportRoute(value)) {
    throw new TypeError("a Page must use a ReportRoute created by reportRoute");
  }
  return value as ReportRoute;
}

function requireFunction(value: unknown, name: string): (...arguments_: never[]) => unknown {
  if (typeof value !== "function") {
    throw new TypeError(`${name} must be a function`);
  }
  return value as (...arguments_: never[]) => unknown;
}

function fieldsOnly(
  value: unknown,
  allowed: readonly string[],
  label: string,
): ReadonlyMap<string, unknown> {
  const fields = ownFields(value, label);
  const allowedFields = new Set(allowed);
  for (const [key] of fields) {
    if (!allowedFields.has(key)) {
      throw new TypeError(`${label} has an unknown field: ${key}`);
    }
  }
  return new Map(fields);
}

function ownFields(value: unknown, label: string): readonly (readonly [string, unknown])[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be a plain object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain object`);
  }
  const keys = Reflect.ownKeys(value);
  const fields: Array<readonly [string, unknown]> = [];
  for (const key of keys) {
    if (typeof key !== "string") {
      throw new TypeError(`${label} cannot contain symbol fields`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !("value" in descriptor)
    ) {
      throw new TypeError(`${label} cannot contain accessors or hidden fields`);
    }
    fields.push(Object.freeze([key, descriptor.value]));
  }
  return Object.freeze(fields);
}

function compareCalculation(
  left: AnyReportCalculation,
  right: AnyReportCalculation,
): number {
  return compareText(left.id, right.id);
}

function compareComponent(
  left: ReportPage | ReportPageFamily | ReportDownload,
  right: ReportPage | ReportPageFamily | ReportDownload,
): number {
  return compareText(left.id, right.id);
}

function compareText(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

function utf8Bytes(value: string): number {
  return encoder.encode(value).byteLength;
}
