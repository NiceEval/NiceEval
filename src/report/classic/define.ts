import { Either } from "effect";
import {
  attemptSlotProjection,
  attemptTimingProjector,
  attemptUsageProjector,
  evaluationPlanProjector,
  selectedRunProjection,
  verdictProjector,
} from "../../projection/index.ts";
import {
  definePage,
  defineReport as defineLowLevelReport,
  reportInputs,
  type Report,
  type ReportCalculationSet,
  type ReportDownload,
  type ReportPage,
  type ReportPageFamily,
} from "../author/model.ts";
import {
  isReportId,
  reportComponentId,
  reportId,
  reportRoute,
  type ReportComponentId,
  type ReportId,
} from "../author/identity.ts";
import {
  reportDocument,
  reportStatus,
  reportText,
  type ReportBlock,
  type ReportDocument,
} from "../semantic/document.ts";
import { evaluateClassicTree } from "./jsx.ts";
import { isLocalizedText, resolveLocalizedText, type LocalizedText } from "./localize.ts";
import { CLASSIC_SELECTION_PROFILE_UNAVAILABLE } from "./origin.ts";
import type { ClassicSample } from "./sample.ts";

export interface ClassicReportPageDefinition {
  readonly id: string;
  readonly title: LocalizedText;
  readonly render: () => unknown;
}

export interface ClassicReportDefinition {
  readonly title: LocalizedText;
  readonly pages: readonly ClassicReportPageDefinition[];
}

export interface ClassicCompiledPage {
  readonly id: ReportComponentId;
  readonly title: LocalizedText;
  readonly render: () => unknown;
}

export interface ClassicReportContents {
  readonly title: LocalizedText;
  readonly pages: readonly ClassicCompiledPage[];
}

const classicContentsByReport = new WeakMap<object, ClassicReportContents>();

const classicDataPlan = reportInputs({
  "evaluation-plan": selectedRunProjection(evaluationPlanProjector),
  verdict: attemptSlotProjection(verdictProjector),
  timing: attemptSlotProjection(attemptTimingProjector),
  usage: attemptSlotProjection(attemptUsageProjector),
});

export function defineReport(definition: ClassicReportDefinition): Report;
export function defineReport<Calculations extends object = {}>(definition: {
  readonly id: ReportId;
  readonly calculations?: Calculations;
  readonly pages: readonly (ReportPage | ReportPageFamily)[];
  readonly downloads?: readonly ReportDownload[];
}): Report;
export function defineReport(definition: unknown): Report {
  if (isClassicReportDefinition(definition)) {
    return defineClassicReport(definition);
  }
  if (isLowLevelReportDefinition(definition)) {
    return defineLowLevelReport(definition);
  }
  throw new TypeError("defineReport requires a classic page list or a branded Report definition");
}

export function isClassicReport(report: Report): boolean {
  return classicContentsByReport.has(report);
}

export function classicReportContents(report: Report): ClassicReportContents | undefined {
  return classicContentsByReport.get(report);
}

export async function renderClassicPage(input: {
  readonly report: Report;
  readonly pageId: ReportComponentId;
  readonly sample: ClassicSample;
}): Promise<ReportDocument> {
  const contents = classicContentsByReport.get(input.report);
  if (contents === undefined) {
    throw new TypeError("a classic Report must be created by the classic defineReport overload");
  }
  const page = contents.pages.find((candidate) => candidate.id === input.pageId);
  if (page === undefined) {
    throw new TypeError("a classic Page is missing from its Report");
  }
  const children = await evaluateClassicTree(page.render(), {
    scope: input.sample,
  });
  return reportDocument({
    title: resolveLocalizedText(contents.title, input.sample.locale),
    presentation: "classic-dashboard",
    metadataOrigin: input.sample.metadataOrigin,
    children: withSelectionNotice(input.sample, children),
  });
}

function withSelectionNotice(
  sample: ClassicSample,
  children: readonly ReportBlock[],
): readonly ReportBlock[] {
  if (sample.metadataOrigin !== "partial") {
    return children;
  }
  return Object.freeze([
    reportStatus({
      tone: "warning",
      label: CLASSIC_SELECTION_PROFILE_UNAVAILABLE.summary,
      detail: [reportText(CLASSIC_SELECTION_PROFILE_UNAVAILABLE.code)],
    }),
    ...children,
  ]);
}

function defineClassicReport(definition: ClassicReportDefinition): Report {
  if (definition.pages.length === 0) {
    throw new TypeError("a classic Report must declare at least one page");
  }
  const seen = new Set<string>();
  const compiledPages: ClassicCompiledPage[] = [];
  const pages: ReportPage[] = [];

  for (const [index, page] of definition.pages.entries()) {
    if (!isClassicPageDefinition(page)) {
      throw new TypeError("every classic Report page must declare id, title, and render");
    }
    if (seen.has(page.id)) {
      throw new TypeError("classic Report page IDs must be unique");
    }
    seen.add(page.id);
    const componentId = Either.getOrThrow(reportComponentId(page.id));
    const route = Either.getOrThrow(reportRoute(index === 0 ? "/" : `/${page.id}`));
    const compiled = Object.freeze({
      id: componentId,
      title: page.title,
      render: page.render,
    });
    compiledPages.push(compiled);
    pages.push(definePage({
      id: componentId,
      route,
      inputs: classicDataPlan,
      completeness: "allow-partial",
      render: () => {
        throw new TypeError("a classic Page must be executed by the classic Report host");
      },
    }));
  }

  const id = Either.getOrThrow(reportId(classicReportId(definition)));
  const report = defineLowLevelReport({
    id,
    pages,
  });
  classicContentsByReport.set(
    report,
    Object.freeze({
      title: definition.title,
      pages: Object.freeze(compiledPages),
    }),
  );
  return report;
}

function classicReportId(definition: ClassicReportDefinition): string {
  const first = definition.pages[0];
  if (first !== undefined && /^[a-z0-9][a-z0-9_-]*$/.test(first.id)) {
    return first.id;
  }
  return "classic";
}

function isLowLevelReportDefinition(value: unknown): value is {
  readonly id: ReportId;
  readonly calculations?: ReportCalculationSet;
  readonly pages: readonly (ReportPage | ReportPageFamily)[];
  readonly downloads?: readonly ReportDownload[];
} {
  return isPlainObject(value) && isReportId(value.id) && Array.isArray(value.pages);
}

export function isClassicReportDefinition(value: unknown): value is ClassicReportDefinition {
  if (!isPlainObject(value) || !("title" in value) || !("pages" in value)) {
    return false;
  }
  if ("id" in value && isReportId(value.id)) {
    return false;
  }
  return Array.isArray(value.pages) && value.pages.every(isClassicPageDefinition);
}

function isClassicPageDefinition(value: unknown): value is ClassicReportPageDefinition {
  return (
    isPlainObject(value)
    && typeof value.id === "string"
    && isLocalizedText(value.title)
    && typeof value.render === "function"
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
