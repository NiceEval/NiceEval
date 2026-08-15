import { Either } from "effect";
import {
  assertionsProjector,
  attemptSlotProjection,
  attemptTimingProjector,
  attemptUsageProjector,
  verdictProjector,
} from "../../projection/index.ts";
import {
  reportEvaluationPlanProjection,
  reportScoreProjection,
} from "../evaluation-projections.ts";
import {
  authorInternalSetPageNavigation,
  definePage,
  definePageFamily,
  defineReport as defineLowLevelReport,
  isReportPage,
  isReportPageFamily,
  reportInputs,
  type Report,
  type ReportCalculationSet,
  type NonEmptyReportDataPlan,
  type ReportDownload,
  type ReportPage,
  type ReportPageFamily,
} from "../author/model.ts";
import {
  classicSelectionNotice,
  containsClassicSelectionNotice,
} from "./components.ts";
import {
  isReportId,
  reportComponentId,
  reportId,
  reportRoute,
  type ReportComponentId,
  type ReportId,
} from "../author/identity.ts";
import {
  classicAttemptHandleFromRow,
  unavailableAttemptEvidence,
  type AttemptEvidence,
} from "./attempt.ts";
import {
  classicAttemptInstanceKey,
  classicAttemptRoute,
} from "./routes.ts";
import {
  reportDocument,
  type ReportBlock,
  type ReportDocument,
} from "../semantic/document.ts";
import { classicSampleFromProjectedInputs } from "./from-context.ts";
import { markClassicIdentityInput } from "./identity.ts";
import { evaluateClassicTree } from "./jsx.ts";
import { isLocalizedText, resolveLocalizedText, type LocalizedText } from "./localize.ts";
import type { Sample } from "./sample.ts";

export type ClassicPageRender = (
  sample: Sample,
) => unknown | Promise<unknown>;

export type ClassicAttemptPageRender = (
  attempt: AttemptEvidence,
) => unknown | Promise<unknown>;

export interface ClassicSamplePageDefinition {
  readonly id: string;
  readonly title: LocalizedText;
  readonly input?: "sample";
  readonly navigation?: boolean;
  readonly render: ClassicPageRender;
}

export interface ClassicAttemptPageDefinition {
  readonly id: string;
  readonly title: LocalizedText;
  readonly input: "attempt";
  readonly navigation: false;
  readonly render: ClassicAttemptPageRender;
}

export type ClassicReportPageDefinition =
  | ClassicSamplePageDefinition
  | ClassicAttemptPageDefinition;

export interface ClassicReportDefinition {
  readonly title: LocalizedText;
  readonly pages: readonly (ClassicReportPageDefinition | ReportPage | ReportPageFamily)[];
}

export interface ClassicCompiledPage {
  readonly id: ReportComponentId;
  readonly title: LocalizedText;
  readonly render: ClassicPageRender;
}

export interface ClassicReportContents {
  readonly title: LocalizedText;
  readonly pages: readonly ClassicCompiledPage[];
}

const classicContentsByReport = new WeakMap<object, ClassicReportContents>();

export const classicDataPlan: NonEmptyReportDataPlan = reportInputs({
  "evaluation-plan": reportEvaluationPlanProjection,
  verdict: attemptSlotProjection(verdictProjector),
  score: reportScoreProjection,
  assertions: attemptSlotProjection(assertionsProjector),
  timing: attemptSlotProjection(attemptTimingProjector),
  usage: attemptSlotProjection(attemptUsageProjector),
});
markClassicIdentityInput(classicDataPlan, "evaluation-plan");

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

export function renderClassicDocument(input: {
  readonly title: LocalizedText;
  readonly tree: unknown;
  readonly sample: Sample;
}): Promise<ReportDocument> {
  return renderClassicTree({
    title: input.title,
    tree: input.tree,
    sample: input.sample,
  });
}

async function renderClassicTree(input: {
  readonly title: LocalizedText;
  readonly tree: unknown;
  readonly sample: Sample;
}): Promise<ReportDocument> {
  const children = await evaluateClassicTree(input.tree, {
    scope: input.sample,
  });
  return reportDocument({
    title: resolveLocalizedText(input.title, input.sample.locale),
    presentation: "classic-dashboard",
    metadataOrigin: input.sample.metadataOrigin,
    children: withSelectionNotice(input.sample, children),
  });
}

function withSelectionNotice(
  sample: Sample,
  children: readonly ReportBlock[],
): readonly ReportBlock[] {
  const notice = classicSelectionNotice(sample);
  if (notice === null || containsClassicSelectionNotice(children)) {
    return children;
  }
  return Object.freeze([
    notice,
    ...children,
  ]);
}

function defineClassicReport(definition: ClassicReportDefinition): Report {
  if (definition.pages.length === 0) {
    throw new TypeError("a classic Report must declare at least one page");
  }
  const seen = new Set<string>();
  const compiledPages: ClassicCompiledPage[] = [];
  const pages: Array<ReportPage | ReportPageFamily> = [];

  for (const [index, page] of definition.pages.entries()) {
    if (isReportPage(page) || isReportPageFamily(page)) {
      if (seen.has(page.id)) {
        throw new TypeError("classic Report page IDs must be unique");
      }
      seen.add(page.id);
      pages.push(page);
      continue;
    }
    if (!isClassicPageDefinition(page)) {
      throw new TypeError("every classic Report page must declare id, title, and render");
    }
    if (seen.has(page.id)) {
      throw new TypeError("classic Report page IDs must be unique");
    }
    seen.add(page.id);
    const componentId = Either.getOrThrow(reportComponentId(page.id));
    if (page.input === "attempt") {
      const renderAttempt = page.render;
      compiledPages.push(Object.freeze({
        id: componentId,
        title: page.title,
        render: async (sample: Sample) => renderAttempt(firstAttemptEvidence(sample)),
      }));
      pages.push(definePageFamily({
        id: componentId,
        inputs: classicDataPlan,
        completeness: "allow-partial",
        instances: (context) =>
          classicSampleFromProjectedInputs({
            sample: context.sample,
            inputs: context.inputs,
          }).attempts.filter((attempt) => attempt.attemptId !== undefined),
        key: (attempt) => classicAttemptInstanceKey(attempt.attemptId!),
        route: (attempt) => classicAttemptRoute(attempt.attemptId!),
        render: async ({ instance, sample, inputs }) => {
          const closed = classicSampleFromProjectedInputs({ sample, inputs });
          const evidence = classicAttemptHandleFromRow(closed, instance);
          if (evidence === undefined) {
            throw new TypeError("classic Attempt page requires a locatable Attempt");
          }
          return renderClassicTree({
            title: page.title,
            tree: await renderAttempt(evidence),
            sample: closed,
          });
        },
      }));
      continue;
    }
    const route = Either.getOrThrow(reportRoute(index === 0 ? "/" : `/${page.id}`));
    const compiled = Object.freeze({
      id: componentId,
      title: page.title,
      render: page.render,
    });
    compiledPages.push(compiled);
    const fixedPage = definePage({
      id: componentId,
      route,
      inputs: classicDataPlan,
      completeness: "allow-partial",
      render: async (context) => {
        const sample = classicSampleFromProjectedInputs({
          sample: context.sample,
          inputs: context.inputs,
        });
        return renderClassicTree({
          title: page.id === primaryClassicPageId(definition) ? definition.title : page.title,
          tree: await page.render(sample),
          sample,
        });
      },
    });
    authorInternalSetPageNavigation(fixedPage, {
      title: page.title,
      visible: page.navigation !== false,
    });
    pages.push(fixedPage);
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

function primaryClassicPageId(definition: ClassicReportDefinition): string | undefined {
  for (const page of definition.pages) {
    if (isClassicPageDefinition(page)) return page.id;
  }
  return undefined;
}

function classicReportId(definition: ClassicReportDefinition): string {
  for (const page of definition.pages) {
    if (isClassicPageDefinition(page) && /^[a-z0-9][a-z0-9_-]*$/.test(page.id)) {
      return page.id;
    }
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
  return Array.isArray(value.pages) && value.pages.every(isClassicOrCompiledPage);
}

function isClassicOrCompiledPage(value: unknown): boolean {
  return isClassicPageDefinition(value) || isReportPage(value) || isReportPageFamily(value);
}

function isClassicPageDefinition(value: unknown): value is ClassicReportPageDefinition {
  if (
    !isPlainObject(value)
    || typeof value.id !== "string"
    || !isLocalizedText(value.title)
    || typeof value.render !== "function"
  ) {
    return false;
  }
  if (value.input === "attempt") {
    return value.navigation === false;
  }
  return value.input === undefined || value.input === "sample";
}

function firstAttemptEvidence(sample: Sample): AttemptEvidence {
  const first = sample.attempts.find((attempt) => attempt.target !== undefined || attempt.attemptId !== undefined);
  if (first === undefined) {
    return unavailableAttemptEvidence();
  }
  return classicAttemptHandleFromRow(sample, first) ?? unavailableAttemptEvidence();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
