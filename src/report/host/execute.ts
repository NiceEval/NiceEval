import { Effect, Either } from "effect";
import { projectAnalysisSample } from "../../projection/index.ts";
import type { ProjectionCoverage } from "../../projection/coverage.ts";
import type {
  ProjectedSample,
  ProjectionAccess,
  ProjectionLimitError,
} from "../../projection/model.ts";
import type { RecordProjection } from "../../projection/projector.ts";
import type { RecordReaderReadError } from "../../record/reader/errors.ts";
import { resolveAnalysisSampleHandle } from "../../sample/analysis.ts";
import type {
  AnalysisSample,
  AnalysisSampleHandle,
  RunId,
  SlotId,
} from "../../analysis/index.ts";
import {
  reportCalculationDescriptor,
  reportDataPlanDescriptor,
  reportDownloadDescriptor,
  reportGraphDescriptor,
  reportPageMemberDescriptor,
  type ReportCalculationDescriptor,
  type ReportComponentReferences,
  type ReportDataPlanDescriptor,
  type ReportDownloadDescriptor,
  type ReportGraphDescriptor,
  type ReportHostCalculations,
  type ReportHostContext,
  type ReportHostInputs,
  type ReportPageDescriptor,
  type ReportPageFamilyDescriptor,
  type ReportPageMemberDescriptor,
} from "../author/internal.ts";
import {
  isReportDownloadPath,
  isReportInstanceKey,
  isReportRoute,
  reportStaticPathConflict,
  staticPathForReportDownload,
  staticPathForReportRoute,
  type ReportComponentId,
  type ReportDownloadPath,
  type ReportInstanceKey,
  type ReportRoute,
} from "../author/identity.ts";
import type {
  AnyReportCalculation,
  Report,
  ReportDataPlan,
  ReportDataState,
  ReportDownloadFile,
} from "../author/model.ts";
import {
  REPORT_DOWNLOAD_FILE_BYTES_MAX,
  REPORT_DOWNLOAD_FILES_MAX,
  REPORT_PAGES_MAX,
  reportExecution,
  type ReportExecution,
  type ReportExecutionValueError,
  type ReportLimitExceeded,
} from "../execution/model.ts";
import {
  REPORT_PROBLEM_TABLE_MAX,
  reportProblemTable,
  type ReportExecutionProblem,
  type ReportProblem,
  type ReportProblemId,
  type ReportProblemTableError,
  type ReportRecordedDataProblem,
} from "../execution/problems.ts";
import {
  reportProjectionId,
  type ReportCalculationExecutionResult,
  type ReportCalculationResult,
  type ReportDownloadResult,
  type ReportPageFamilyResult,
  type ReportPageResult,
  type ReportProjectionId,
  type ReportProjectionSummary,
} from "../execution/results.ts";
import {
  REPORT_DOCUMENT_DEPTH_MAX,
  REPORT_DOCUMENT_NODES_MAX,
  freezeReportDocument,
  validateReportDocument,
  type ReportBlock,
  type ReportDocument,
  type ReportInline,
} from "../semantic/document.ts";

/** A Report or its private author descriptors did not come from NiceEval. */
export interface ReportAuthoringInvalid {
  readonly code: "report-definition-invalid";
  readonly issues: readonly string[];
}

/** Expected failures from the current-process Report host. */
export type ReportExecutionError =
  | RecordReaderReadError
  | ProjectionLimitError
  | ReportLimitExceeded
  | ReportAuthoringInvalid
  | ReportProblemTableError;

interface CompiledProjection {
  readonly projectionId: ReportProjectionId;
  readonly inputKey: string;
  readonly projection: RecordProjection<ProjectionAccess, unknown>;
  /** The first consumer gives a unique projector defect a stable owner. */
  readonly consumerId: ReportComponentId;
}

interface CompiledDataPlan {
  readonly declarations: readonly {
    readonly key: string;
    readonly projection: CompiledProjection;
  }[];
}

interface CompiledCalculation {
  readonly calculation: AnyReportCalculation;
  readonly descriptor: ReportCalculationDescriptor;
  readonly inputs: CompiledDataPlan;
}

interface CompiledPageMember {
  readonly descriptor: ReportPageMemberDescriptor;
  readonly inputs?: CompiledDataPlan;
}

interface CompiledDownload {
  readonly descriptor: ReportDownloadDescriptor;
  readonly inputs?: CompiledDataPlan;
}

interface CompiledReport {
  readonly graph: ReportGraphDescriptor;
  readonly calculations: readonly CompiledCalculation[];
  readonly pages: readonly CompiledPageMember[];
  readonly downloads: readonly CompiledDownload[];
  readonly projections: readonly CompiledProjection[];
}

type ProjectionOutcome =
  | {
      readonly state: "projected";
      readonly value: ProjectedSample<ProjectionAccess, unknown>;
    }
  | {
      readonly state: "execution-failed";
      readonly problemId: ReportProblemId;
    };

interface PreparedInputs {
  readonly inputs: ReportHostInputs;
  readonly partial: boolean;
  readonly dataProblemIds: readonly ReportProblemId[];
  readonly projectionProblemIds: readonly ReportProblemId[];
}

type CallbackOutcome<Value> =
  | { readonly state: "succeeded"; readonly value: Value }
  | { readonly state: "failed"; readonly problemId: ReportProblemId };

interface PageCandidate {
  readonly kind: "candidate";
  readonly pageId: ReportComponentId;
  readonly route: ReportRoute;
  document: ReportDocument;
  readonly problemIds: readonly ReportProblemId[];
  conflictProblemId?: ReportProblemId;
  semanticProblemId?: ReportProblemId;
}

interface FailedPage {
  readonly kind: "failed";
  readonly state: "data-unavailable" | "execution-failed";
  readonly pageId: ReportComponentId;
  readonly route?: ReportRoute;
  readonly problemIds: readonly [ReportProblemId, ...ReportProblemId[]];
}

type PageIntermediate = PageCandidate | FailedPage;

interface FamilyIntermediate {
  readonly familyId: ReportComponentId;
  readonly state: "expanded" | "data-unavailable" | "execution-failed";
  readonly instanceCount: number;
  readonly problemIds: readonly ReportProblemId[];
}

interface BuiltDownload {
  readonly kind: "built";
  readonly downloadId: ReportComponentId;
  readonly files: readonly ReportDownloadFile[];
  readonly problemIds: readonly ReportProblemId[];
  conflictProblemId?: ReportProblemId;
}

interface FailedDownload {
  readonly kind: "failed";
  readonly state: "data-unavailable" | "execution-failed";
  readonly downloadId: ReportComponentId;
  readonly problemIds: readonly [ReportProblemId, ...ReportProblemId[]];
}

type DownloadIntermediate = BuiltDownload | FailedDownload;

interface FamilyInstance {
  readonly instance: unknown;
  readonly key: ReportInstanceKey;
  readonly route: ReportRoute;
}

interface CollectedFamilyInstances {
  readonly state: "collected";
  readonly values: readonly unknown[];
}

interface FamilyInstancesLimit {
  readonly state: "limit";
  readonly error: ReportLimitExceeded;
}

type FamilyInstancesOutcome = CollectedFamilyInstances | FamilyInstancesLimit;

interface DownloadBuild {
  readonly state: "built";
  readonly files: readonly ReportDownloadFile[];
}

interface DownloadLimit {
  readonly state: "limit";
  readonly error: ReportLimitExceeded;
}

type DownloadBuildOutcome = DownloadBuild | DownloadLimit;

/**
 * Executes a complete in-process Report while the supplied Sample handle is
 * still live. All Record I/O is confined to declared projections; callbacks
 * only receive self-contained projected and calculated values.
 */
export function executeReport(input: {
  readonly sampleHandle: AnalysisSampleHandle;
  readonly report: Report;
}): Effect.Effect<ReportExecution, ReportExecutionError, never> {
  return Effect.gen(function* () {
    const compiled = yield* compileReportEffect(input.report);
    // Validate even Reports with no projected inputs. A pure or copied Sample
    // must never be enough to enter the host.
    const bound = yield* resolveAnalysisSampleHandle(input.sampleHandle);
    const problems = new ProblemCollector();
    const projectionOutcomes = new Map<CompiledProjection, ProjectionOutcome>();

    for (const projection of compiled.projections) {
      const outcome = yield* executeProjection({
        sampleHandle: input.sampleHandle,
        projection,
        problems,
      });
      projectionOutcomes.set(projection, outcome);
    }

    const calculationResults = new Map<
      AnyReportCalculation,
      ReportCalculationExecutionResult
    >();
    for (const calculation of compiled.calculations) {
      const prepared = yield* Effect.sync(() =>
        prepareInputs({
          plan: calculation.inputs,
          outcomes: projectionOutcomes,
          consumerId: calculation.descriptor.id,
          problems,
        })
      );
      const result = yield* executeCalculation({
        calculation,
        sample: bound.sample,
        prepared,
        problems,
      });
      calculationResults.set(calculation.calculation, result);
    }

    const pages: PageIntermediate[] = [];
    const families: FamilyIntermediate[] = [];
    for (const member of compiled.pages) {
      if (member.descriptor.kind === "page") {
        const page = yield* executeFixedPage({
          descriptor: member.descriptor,
          inputs: member.inputs,
          sample: bound.sample,
          projectionOutcomes,
          calculationResults,
          problems,
        });
        pages.push(page);
      } else {
        const family = yield* executePageFamily({
          descriptor: member.descriptor,
          inputs: member.inputs,
          sample: bound.sample,
          projectionOutcomes,
          calculationResults,
          problems,
          priorPageCount: pages.length,
        });
        families.push(family.result);
        pages.push(...family.pages);
      }

      if (pages.length > REPORT_PAGES_MAX) {
        return yield* Effect.fail(reportLimit("pages", REPORT_PAGES_MAX, pages.length));
      }
    }

    let downloadFileCount = 0;
    const downloads: DownloadIntermediate[] = [];
    for (const download of compiled.downloads) {
      const result = yield* executeDownload({
        descriptor: download.descriptor,
        inputs: download.inputs,
        sample: bound.sample,
        projectionOutcomes,
        calculationResults,
        problems,
        priorFileCount: downloadFileCount,
      });
      if (result.kind === "built") {
        downloadFileCount += result.files.length;
      }
      downloads.push(result);
    }

    yield* Effect.sync(() => resolveStaticConflicts(pages, downloads, problems));
    const documentLimit = yield* Effect.sync(() =>
      validateDocuments({ pages, downloads, problems })
    );
    if (documentLimit !== undefined) {
      return yield* Effect.fail(documentLimit);
    }

    return yield* finalizeExecution({
      compiled,
      sample: bound.sample,
      projectionOutcomes,
      calculationResults,
      families,
      pages,
      downloads,
      problems,
    });
  });
}

function compileReportEffect(
  report: Report,
): Effect.Effect<CompiledReport, ReportAuthoringInvalid, never> {
  return Effect.try({
    try: () => compileReport(report),
    catch: () => reportAuthoringInvalid(),
  });
}

function compileReport(report: Report): CompiledReport {
  const graph = reportGraphDescriptor(report);
  const projections: CompiledProjection[] = [];
  const projectionsByIdentity = new Map<object, CompiledProjection>();
  const plans = new Map<ReportDataPlan, CompiledDataPlan>();

  const compilePlan = (
    plan: ReportDataPlan,
    consumerId: ReportComponentId,
  ): CompiledDataPlan => {
    const existing = plans.get(plan);
    if (existing !== undefined) {
      return existing;
    }
    const descriptor = reportDataPlanDescriptor(plan);
    const compiled = compileDataPlan({
      descriptor,
      consumerId,
      projections,
      projectionsByIdentity,
    });
    plans.set(plan, compiled);
    return compiled;
  };

  const calculations = graph.calculationsById
    .map((calculation) => {
      const descriptor = reportCalculationDescriptor(calculation);
      return Object.freeze({
        calculation,
        descriptor,
        inputs: compilePlan(descriptor.inputs, descriptor.id),
      });
    })
    .sort((left, right) => compareText(left.descriptor.id, right.descriptor.id));

  const pages = graph.pages
    .map((page) => {
      const descriptor = reportPageMemberDescriptor(page);
      return Object.freeze({
        descriptor,
        ...(descriptor.inputs === undefined
          ? {}
          : { inputs: compilePlan(descriptor.inputs, descriptor.id) }),
      });
    })
    .sort((left, right) => compareText(left.descriptor.id, right.descriptor.id));

  const downloads = graph.downloads
    .map((download) => {
      const descriptor = reportDownloadDescriptor(download);
      return Object.freeze({
        descriptor,
        ...(descriptor.inputs === undefined
          ? {}
          : { inputs: compilePlan(descriptor.inputs, descriptor.id) }),
      });
    })
    .sort((left, right) => compareText(left.descriptor.id, right.descriptor.id));

  return Object.freeze({
    graph,
    calculations: Object.freeze(calculations),
    pages: Object.freeze(pages),
    downloads: Object.freeze(downloads),
    projections: Object.freeze(projections),
  });
}

function compileDataPlan(input: {
  readonly descriptor: ReportDataPlanDescriptor;
  readonly consumerId: ReportComponentId;
  readonly projections: CompiledProjection[];
  readonly projectionsByIdentity: Map<object, CompiledProjection>;
}): CompiledDataPlan {
  const declarations = input.descriptor.declarations.map((declaration) => {
    const identity = declaration.projection as object;
    let projection = input.projectionsByIdentity.get(identity);
    if (projection === undefined) {
      const parsed = reportProjectionId(input.projections.length);
      if (Either.isLeft(parsed)) {
        throw new Error("Report projection IDs exceeded the supported range");
      }
      projection = Object.freeze({
        projectionId: parsed.right,
        inputKey: declaration.key,
        projection: declaration.projection,
        consumerId: input.consumerId,
      });
      input.projections.push(projection);
      input.projectionsByIdentity.set(identity, projection);
    }
    return Object.freeze({ key: declaration.key, projection });
  });
  return Object.freeze({ declarations: Object.freeze(declarations) });
}

function executeProjection(input: {
  readonly sampleHandle: AnalysisSampleHandle;
  readonly projection: CompiledProjection;
  readonly problems: ProblemCollector;
}): Effect.Effect<ProjectionOutcome, RecordReaderReadError | ProjectionLimitError, never> {
  return projectAnalysisSample({
    sampleHandle: input.sampleHandle,
    projection: input.projection.projection,
  }).pipe(
    Effect.map((value): ProjectionOutcome =>
      Object.freeze({ state: "projected" as const, value })
    ),
    Effect.catchAllDefect(() =>
      Effect.succeed(
        Object.freeze({
          state: "execution-failed" as const,
          problemId: input.problems.execution({
            code: "projection-callback-defect",
            consumerId: input.projection.consumerId,
            summary: "the RecordAttachment projector callback threw",
          }),
        }),
      ),
    ),
  );
}

function executeCalculation(input: {
  readonly calculation: CompiledCalculation;
  readonly sample: AnalysisSample;
  readonly prepared: PreparedInputs;
  readonly problems: ProblemCollector;
}): Effect.Effect<ReportCalculationExecutionResult, never, never> {
  const { calculation, sample, prepared, problems } = input;
  const problemIds = uniqueProblemIds([
    ...prepared.dataProblemIds,
    ...prepared.projectionProblemIds,
  ]);
  if (prepared.projectionProblemIds.length > 0) {
    return Effect.succeed(
      Object.freeze({
        state: "execution-failed" as const,
        calculationId: calculation.descriptor.id,
        problemIds: requireProblemIds(problemIds),
      }),
    );
  }
  if (calculation.descriptor.completeness === "require-complete" && prepared.partial) {
    return Effect.succeed(
      Object.freeze({
        state: "data-unavailable" as const,
        calculationId: calculation.descriptor.id,
        problemIds: requireProblemIds(problemIds),
      }),
    );
  }

  return invokeCallback({
    callback: () =>
      calculation.descriptor.calculate(
        calculationContext(sample, prepared.inputs),
      ),
    problems,
    problem: {
      code: "calculation-callback-defect",
      consumerId: calculation.descriptor.id,
      summary: "the Calculation callback threw",
    },
  }).pipe(
    Effect.map((outcome): ReportCalculationExecutionResult => {
      if (outcome.state === "failed") {
        return Object.freeze({
          state: "execution-failed" as const,
          calculationId: calculation.descriptor.id,
          problemIds: requireProblemIds(uniqueProblemIds([...problemIds, outcome.problemId])),
        });
      }
      return Object.freeze({
        state: "available" as const,
        calculationId: calculation.descriptor.id,
        value: outcome.value,
        inputState: dataState(prepared.partial),
        problemIds,
      });
    }),
  );
}

function executeFixedPage(input: {
  readonly descriptor: ReportPageDescriptor;
  readonly inputs?: CompiledDataPlan;
  readonly sample: AnalysisSample;
  readonly projectionOutcomes: ReadonlyMap<CompiledProjection, ProjectionOutcome>;
  readonly calculationResults: ReadonlyMap<
    AnyReportCalculation,
    ReportCalculationExecutionResult
  >;
  readonly problems: ProblemCollector;
}): Effect.Effect<PageIntermediate, never, never> {
  return Effect.gen(function* () {
    const prepared = yield* Effect.sync(() =>
      prepareComponentInputs({
        references: input.descriptor,
        consumerId: input.descriptor.id,
        plan: input.inputs,
        outcomes: input.projectionOutcomes,
        problems: input.problems,
      })
    );
    const blocked = blockedPage({
      pageId: input.descriptor.id,
      route: input.descriptor.route,
      completeness: input.descriptor.completeness,
      prepared,
    });
    if (blocked !== undefined) {
      return blocked;
    }

    const context = yield* Effect.sync(() =>
      componentContext({
        sample: input.sample,
        prepared,
        references: input.descriptor,
        calculationResults: input.calculationResults,
      })
    );
    const outcome = yield* invokeCallback({
      callback: () => input.descriptor.render(context),
      problems: input.problems,
      problem: {
        code: "page-execution-failed",
        consumerId: input.descriptor.id,
        summary: "the Page render callback threw",
      },
    });
    if (outcome.state === "failed") {
      return failedPage({
        state: "execution-failed",
        pageId: input.descriptor.id,
        route: input.descriptor.route,
        problemIds: uniqueProblemIds([...prepared.dataProblemIds, outcome.problemId]),
      });
    }
    return {
      kind: "candidate" as const,
      pageId: input.descriptor.id,
      route: input.descriptor.route,
      document: outcome.value,
      problemIds: prepared.dataProblemIds,
    };
  });
}

function executePageFamily(input: {
  readonly descriptor: ReportPageFamilyDescriptor;
  readonly inputs?: CompiledDataPlan;
  readonly sample: AnalysisSample;
  readonly projectionOutcomes: ReadonlyMap<CompiledProjection, ProjectionOutcome>;
  readonly calculationResults: ReadonlyMap<
    AnyReportCalculation,
    ReportCalculationExecutionResult
  >;
  readonly problems: ProblemCollector;
  /** Pages already fixed by earlier canonical Page/PageFamily members. */
  readonly priorPageCount: number;
}): Effect.Effect<
  { readonly result: FamilyIntermediate; readonly pages: readonly PageIntermediate[] },
  ReportLimitExceeded,
  never
> {
  return Effect.gen(function* () {
    const prepared = yield* Effect.sync(() =>
      prepareComponentInputs({
        references: input.descriptor,
        consumerId: input.descriptor.id,
        plan: input.inputs,
        outcomes: input.projectionOutcomes,
        problems: input.problems,
      })
    );
    const blocked = blockedFamily({
      familyId: input.descriptor.id,
      completeness: input.descriptor.completeness,
      prepared,
    });
    if (blocked !== undefined) {
      return Object.freeze({ result: blocked, pages: Object.freeze([]) });
    }

    const context = yield* Effect.sync(() =>
      componentContext({
        sample: input.sample,
        prepared,
        references: input.descriptor,
        calculationResults: input.calculationResults,
      })
    );
    const iterable = yield* invokeCallback({
      callback: () => input.descriptor.instances(context),
      problems: input.problems,
      problem: {
        code: "page-family-instances-defect",
        consumerId: input.descriptor.id,
        summary: "the PageFamily instances callback threw",
      },
    });
    if (iterable.state === "failed") {
      return Object.freeze({
        result: failedFamily({
          familyId: input.descriptor.id,
          problemIds: uniqueProblemIds([...prepared.dataProblemIds, iterable.problemId]),
        }),
        pages: Object.freeze([]),
      });
    }

    // A family is an arbitrary iterable, so apply the global page budget while
    // consuming it rather than materializing an unbounded author collection.
    const collected = yield* invokeCallback({
      callback: () => collectInstances(iterable.value, input.priorPageCount),
      problems: input.problems,
      problem: {
        code: "page-family-instances-defect",
        consumerId: input.descriptor.id,
        summary: "the PageFamily instances callback threw",
      },
    });
    if (collected.state === "failed") {
      return Object.freeze({
        result: failedFamily({
          familyId: input.descriptor.id,
          problemIds: uniqueProblemIds([...prepared.dataProblemIds, collected.problemId]),
        }),
        pages: Object.freeze([]),
      });
    }
    if (collected.value.state === "limit") {
      return yield* Effect.fail(collected.value.error);
    }
    const instances = collected.value.values;

    const bindings: FamilyInstance[] = [];
    const keys = new Set<string>();
    for (const instance of instances) {
      const key = yield* invokeCallback({
        callback: () => input.descriptor.key(instance),
        problems: input.problems,
        problem: {
          code: "page-family-key-defect",
          consumerId: input.descriptor.id,
          summary: "the PageFamily key callback threw or returned an invalid key",
        },
      });
      if (key.state === "failed" || !isReportInstanceKey(key.value)) {
        const problemId = key.state === "failed"
          ? key.problemId
          : input.problems.execution({
            code: "page-family-key-defect",
            consumerId: input.descriptor.id,
            summary: "the PageFamily key callback threw or returned an invalid key",
          });
        return Object.freeze({
          result: failedFamily({
            familyId: input.descriptor.id,
            problemIds: uniqueProblemIds([...prepared.dataProblemIds, problemId]),
          }),
          pages: Object.freeze([]),
        });
      }
      if (keys.has(key.value)) {
        const problemId = input.problems.execution({
          code: "page-family-key-conflict",
          consumerId: input.descriptor.id,
          summary: "the PageFamily produced duplicate instance keys",
        });
        return Object.freeze({
          result: failedFamily({
            familyId: input.descriptor.id,
            problemIds: uniqueProblemIds([...prepared.dataProblemIds, problemId]),
          }),
          pages: Object.freeze([]),
        });
      }
      keys.add(key.value);

      const route = yield* invokeCallback({
        callback: () => input.descriptor.route(instance),
        problems: input.problems,
        problem: {
          code: "page-family-key-defect",
          consumerId: input.descriptor.id,
          summary: "the PageFamily route callback threw or returned an invalid route",
        },
      });
      if (route.state === "failed" || !isReportRoute(route.value)) {
        const problemId = route.state === "failed"
          ? route.problemId
          : input.problems.execution({
            code: "page-family-key-defect",
            consumerId: input.descriptor.id,
            summary: "the PageFamily route callback threw or returned an invalid route",
          });
        return Object.freeze({
          result: failedFamily({
            familyId: input.descriptor.id,
            problemIds: uniqueProblemIds([...prepared.dataProblemIds, problemId]),
          }),
          pages: Object.freeze([]),
        });
      }
      bindings.push(Object.freeze({ instance, key: key.value, route: route.value }));
    }

    const pages: PageIntermediate[] = [];
    for (const binding of bindings) {
      const rendered = yield* invokeCallback({
        callback: () =>
          input.descriptor.render(
            Object.freeze({ ...context, instance: binding.instance }),
          ),
        problems: input.problems,
        problem: {
          code: "page-execution-failed",
          consumerId: input.descriptor.id,
          summary: "a PageFamily Page render callback threw",
        },
      });
      if (rendered.state === "failed") {
        pages.push(
          failedPage({
            state: "execution-failed",
            pageId: input.descriptor.id,
            route: binding.route,
            problemIds: uniqueProblemIds([...prepared.dataProblemIds, rendered.problemId]),
          }),
        );
      } else {
        pages.push({
          kind: "candidate" as const,
          pageId: input.descriptor.id,
          route: binding.route,
          document: rendered.value,
          problemIds: prepared.dataProblemIds,
        });
      }
    }

    return Object.freeze({
      result: Object.freeze({
        state: "expanded" as const,
        familyId: input.descriptor.id,
        instanceCount: bindings.length,
        problemIds: prepared.dataProblemIds,
      }),
      pages: Object.freeze(pages),
    });
  });
}

function executeDownload(input: {
  readonly descriptor: ReportDownloadDescriptor;
  readonly inputs?: CompiledDataPlan;
  readonly sample: AnalysisSample;
  readonly projectionOutcomes: ReadonlyMap<CompiledProjection, ProjectionOutcome>;
  readonly calculationResults: ReadonlyMap<
    AnyReportCalculation,
    ReportCalculationExecutionResult
  >;
  readonly problems: ProblemCollector;
  readonly priorFileCount: number;
}): Effect.Effect<DownloadIntermediate, ReportLimitExceeded, never> {
  return Effect.gen(function* () {
    const prepared = yield* Effect.sync(() =>
      prepareComponentInputs({
        references: input.descriptor,
        consumerId: input.descriptor.id,
        plan: input.inputs,
        outcomes: input.projectionOutcomes,
        problems: input.problems,
      })
    );
    const blocked = blockedDownload({
      downloadId: input.descriptor.id,
      completeness: input.descriptor.completeness,
      prepared,
    });
    if (blocked !== undefined) {
      return blocked;
    }

    const context = yield* Effect.sync(() =>
      componentContext({
        sample: input.sample,
        prepared,
        references: input.descriptor,
        calculationResults: input.calculationResults,
      })
    );
    const built = yield* invokeCallback({
      callback: () => buildDownloadFiles(input.descriptor.build(context), input.priorFileCount),
      problems: input.problems,
      problem: {
        code: "download-execution-failed",
        consumerId: input.descriptor.id,
        summary: "the Download build callback returned invalid files or threw",
      },
    });
    if (built.state === "failed") {
      return failedDownload({
        state: "execution-failed",
        downloadId: input.descriptor.id,
        problemIds: uniqueProblemIds([...prepared.dataProblemIds, built.problemId]),
      });
    }
    if (built.value.state === "limit") {
      return yield* Effect.fail(built.value.error);
    }
    return {
      kind: "built" as const,
      downloadId: input.descriptor.id,
      files: built.value.files,
      problemIds: prepared.dataProblemIds,
    };
  });
}

function prepareComponentInputs(input: {
  readonly references: ReportComponentReferences;
  readonly consumerId: ReportComponentId;
  readonly plan?: CompiledDataPlan;
  readonly outcomes: ReadonlyMap<CompiledProjection, ProjectionOutcome>;
  readonly problems: ProblemCollector;
}): PreparedInputs {
  if (input.references.inputs === undefined) {
    return emptyPreparedInputs();
  }
  if (input.plan === undefined) {
    throw new Error("a Report component lost its compiled input plan");
  }
  return prepareInputs({
    plan: input.plan,
    outcomes: input.outcomes,
    consumerId: input.consumerId,
    problems: input.problems,
  });
}

function prepareInputs(input: {
  readonly plan: CompiledDataPlan;
  readonly outcomes: ReadonlyMap<CompiledProjection, ProjectionOutcome>;
  readonly consumerId: ReportComponentId;
  readonly problems: ProblemCollector;
}): PreparedInputs {
  const values: Record<string, ProjectedSample<ProjectionAccess, unknown>> = Object.create(null) as Record<
    string,
    ProjectedSample<ProjectionAccess, unknown>
  >;
  const dataProblemIds: ReportProblemId[] = [];
  const projectionProblemIds: ReportProblemId[] = [];
  let partial = false;

  for (const declaration of input.plan.declarations) {
    const outcome = input.outcomes.get(declaration.projection);
    if (outcome === undefined) {
      throw new Error("a compiled projection did not execute");
    }
    if (outcome.state === "execution-failed") {
      projectionProblemIds.push(outcome.problemId);
      partial = true;
      continue;
    }
    Object.defineProperty(values, declaration.key, {
      value: outcome.value,
      enumerable: true,
      writable: false,
      configurable: false,
    });
    for (const entry of outcome.value.entries) {
      const problem = recordedDataProblem({
        entry,
        consumerId: input.consumerId,
        inputKey: declaration.key,
      });
      if (problem !== undefined) {
        partial = true;
        dataProblemIds.push(input.problems.add(problem));
      }
    }
  }

  return Object.freeze({
    inputs: Object.freeze(values),
    partial,
    dataProblemIds: uniqueProblemIds(dataProblemIds),
    projectionProblemIds: uniqueProblemIds(projectionProblemIds),
  });
}

function emptyPreparedInputs(): PreparedInputs {
  return Object.freeze({
    inputs: Object.freeze({}) as ReportHostInputs,
    partial: false,
    dataProblemIds: Object.freeze([]),
    projectionProblemIds: Object.freeze([]),
  });
}

function recordedDataProblem(input: {
  readonly entry: ProjectedSample<ProjectionAccess, unknown>["entries"][number];
  readonly consumerId: ReportComponentId;
  readonly inputKey: string;
}): ReportRecordedDataProblem | undefined {
  const location = "slot" in input.entry
    ? { slotId: input.entry.slot.slotId, runId: input.entry.slot.runId }
    : { runId: input.entry.run.runId };
  switch (input.entry.state) {
    case "excluded":
    case "not-recorded":
    case "core-invalid":
      return recordedProblem({
        code: "unavailable",
        consumerId: input.consumerId,
        inputKey: input.inputKey,
        ...location,
      });
    case "attachment-result": {
      switch (input.entry.attachment.state) {
        case "available":
          return undefined;
        case "unavailable":
        case "migration-required":
        case "migration-unavailable":
        case "unsupported":
        case "invalid":
          return recordedProblem({
            code: input.entry.attachment.state,
            consumerId: input.consumerId,
            inputKey: input.inputKey,
            ...location,
          });
      }
    }
  }
}

function recordedProblem(input: {
  readonly code: ReportRecordedDataProblem["code"];
  readonly consumerId: ReportComponentId;
  readonly inputKey: string;
  readonly slotId?: SlotId;
  readonly runId?: RunId;
}): ReportRecordedDataProblem {
  return Object.freeze({
    category: "recorded-data" as const,
    code: input.code,
    consumerId: input.consumerId,
    inputKey: input.inputKey,
    ...(input.slotId === undefined ? {} : { slotId: input.slotId }),
    ...(input.runId === undefined ? {} : { runId: input.runId }),
  });
}

function calculationContext(
  sample: AnalysisSample,
  inputs: ReportHostInputs,
): { readonly sample: AnalysisSample; readonly inputs: ReportHostInputs } {
  return Object.freeze({ sample, inputs });
}

function componentContext(input: {
  readonly sample: AnalysisSample;
  readonly prepared: PreparedInputs;
  readonly references: ReportComponentReferences;
  readonly calculationResults: ReadonlyMap<
    AnyReportCalculation,
    ReportCalculationExecutionResult
  >;
}): ReportHostContext {
  return Object.freeze({
    sample: input.sample,
    inputs: input.prepared.inputs,
    calculations: calculationContextValues(input.references, input.calculationResults),
  });
}

function calculationContextValues(
  references: ReportComponentReferences,
  calculationResults: ReadonlyMap<AnyReportCalculation, ReportCalculationExecutionResult>,
): ReportHostCalculations {
  const values: Record<string, ReportCalculationResult<unknown>> = Object.create(null) as Record<
    string,
    ReportCalculationResult<unknown>
  >;
  for (const key of Object.keys(references.calculations).sort(compareText)) {
    const calculation = references.calculations[key];
    if (calculation === undefined) {
      throw new Error("a Report Calculation mapping lost its value");
    }
    const result = calculationResults.get(calculation);
    if (result === undefined) {
      throw new Error("a component referenced a Calculation that did not execute");
    }
    Object.defineProperty(values, key, {
      value: callbackCalculationResult(result),
      enumerable: true,
      writable: false,
      configurable: false,
    });
  }
  return Object.freeze(values);
}

function callbackCalculationResult(
  result: ReportCalculationExecutionResult,
): ReportCalculationResult<unknown> {
  switch (result.state) {
    case "available":
      return Object.freeze({
        state: "available" as const,
        value: result.value,
        inputState: result.inputState,
      });
    case "data-unavailable":
      return Object.freeze({
        state: "data-unavailable" as const,
        problemIds: result.problemIds,
      });
    case "execution-failed":
      return Object.freeze({
        state: "execution-failed" as const,
        problemIds: result.problemIds,
      });
  }
}

function blockedPage(input: {
  readonly pageId: ReportComponentId;
  readonly route: ReportRoute;
  readonly completeness: "allow-partial" | "require-complete" | undefined;
  readonly prepared: PreparedInputs;
}): FailedPage | undefined {
  const allProblems = uniqueProblemIds([
    ...input.prepared.dataProblemIds,
    ...input.prepared.projectionProblemIds,
  ]);
  if (input.prepared.projectionProblemIds.length > 0) {
    return failedPage({
      state: "execution-failed",
      pageId: input.pageId,
      route: input.route,
      problemIds: allProblems,
    });
  }
  if (input.completeness === "require-complete" && input.prepared.partial) {
    return failedPage({
      state: "data-unavailable",
      pageId: input.pageId,
      route: input.route,
      problemIds: allProblems,
    });
  }
  return undefined;
}

function blockedFamily(input: {
  readonly familyId: ReportComponentId;
  readonly completeness: "allow-partial" | "require-complete" | undefined;
  readonly prepared: PreparedInputs;
}): FamilyIntermediate | undefined {
  const allProblems = uniqueProblemIds([
    ...input.prepared.dataProblemIds,
    ...input.prepared.projectionProblemIds,
  ]);
  if (input.prepared.projectionProblemIds.length > 0) {
    return failedFamily({ familyId: input.familyId, problemIds: allProblems });
  }
  if (input.completeness === "require-complete" && input.prepared.partial) {
    return Object.freeze({
      state: "data-unavailable" as const,
      familyId: input.familyId,
      instanceCount: 0,
      problemIds: requireProblemIds(allProblems),
    });
  }
  return undefined;
}

function blockedDownload(input: {
  readonly downloadId: ReportComponentId;
  readonly completeness: "allow-partial" | "require-complete" | undefined;
  readonly prepared: PreparedInputs;
}): FailedDownload | undefined {
  const allProblems = uniqueProblemIds([
    ...input.prepared.dataProblemIds,
    ...input.prepared.projectionProblemIds,
  ]);
  if (input.prepared.projectionProblemIds.length > 0) {
    return failedDownload({
      state: "execution-failed",
      downloadId: input.downloadId,
      problemIds: allProblems,
    });
  }
  if (input.completeness === "require-complete" && input.prepared.partial) {
    return failedDownload({
      state: "data-unavailable",
      downloadId: input.downloadId,
      problemIds: allProblems,
    });
  }
  return undefined;
}

function failedPage(input: {
  readonly state: "data-unavailable" | "execution-failed";
  readonly pageId: ReportComponentId;
  readonly route?: ReportRoute;
  readonly problemIds: readonly ReportProblemId[];
}): FailedPage {
  return Object.freeze({
    kind: "failed" as const,
    state: input.state,
    pageId: input.pageId,
    ...(input.route === undefined ? {} : { route: input.route }),
    problemIds: requireProblemIds(input.problemIds),
  });
}

function failedFamily(input: {
  readonly familyId: ReportComponentId;
  readonly problemIds: readonly ReportProblemId[];
}): FamilyIntermediate {
  return Object.freeze({
    state: "execution-failed" as const,
    familyId: input.familyId,
    instanceCount: 0,
    problemIds: requireProblemIds(input.problemIds),
  });
}

function failedDownload(input: {
  readonly state: "data-unavailable" | "execution-failed";
  readonly downloadId: ReportComponentId;
  readonly problemIds: readonly ReportProblemId[];
}): FailedDownload {
  return Object.freeze({
    kind: "failed" as const,
    state: input.state,
    downloadId: input.downloadId,
    problemIds: requireProblemIds(input.problemIds),
  });
}

function invokeCallback<Value>(input: {
  readonly callback: () => Value;
  readonly problems: ProblemCollector;
  readonly problem: Omit<ReportExecutionProblem, "category">;
}): Effect.Effect<CallbackOutcome<Value>, never, never> {
  return Effect.sync(input.callback).pipe(
    Effect.map((value): CallbackOutcome<Value> =>
      Object.freeze({ state: "succeeded" as const, value })
    ),
    // This boundary deliberately converts only author defects. Typed failures
    // do not exist in synchronous author callbacks, and interruption remains a
    // Cause rather than a Report problem.
    Effect.catchAllDefect(() =>
      Effect.succeed(
        Object.freeze({
          state: "failed" as const,
          problemId: input.problems.execution(input.problem),
        }),
      ),
    ),
  );
}

function collectInstances(
  value: Iterable<unknown>,
  priorPageCount: number,
): FamilyInstancesOutcome {
  const values: unknown[] = [];
  for (const instance of value) {
    const observed = priorPageCount + values.length + 1;
    if (observed > REPORT_PAGES_MAX) {
      return Object.freeze({
        state: "limit" as const,
        error: reportLimit("pages", REPORT_PAGES_MAX, observed),
      });
    }
    values.push(instance);
  }
  return Object.freeze({ state: "collected" as const, values: Object.freeze(values) });
}

function buildDownloadFiles(
  value: Iterable<ReportDownloadFile>,
  priorFileCount: number,
): DownloadBuildOutcome {
  const files: ReportDownloadFile[] = [];
  const paths = new Set<string>();
  for (const file of value) {
    const observed = priorFileCount + files.length + 1;
    if (observed > REPORT_DOWNLOAD_FILES_MAX) {
      return Object.freeze({
        state: "limit" as const,
        error: reportLimit("download-files", REPORT_DOWNLOAD_FILES_MAX, observed),
      });
    }
    if (typeof file !== "object" || file === null || !isReportDownloadPath(file.path)) {
      throw new TypeError("a Download file must use a valid ReportDownloadPath");
    }
    if (
      typeof file.mediaType !== "string" ||
      file.mediaType.length === 0 ||
      !hasOnlyUnicodeScalars(file.mediaType)
    ) {
      throw new TypeError("a Download file must use a non-empty Unicode media type");
    }
    if (!(file.bytes instanceof Uint8Array)) {
      throw new TypeError("a Download file must use Uint8Array bytes");
    }
    if (file.bytes.byteLength > REPORT_DOWNLOAD_FILE_BYTES_MAX) {
      return Object.freeze({
        state: "limit" as const,
        error: reportLimit(
          "download-file-bytes",
          REPORT_DOWNLOAD_FILE_BYTES_MAX,
          file.bytes.byteLength,
        ),
      });
    }
    if (paths.has(file.path)) {
      throw new TypeError("a Download cannot produce duplicate file paths");
    }
    paths.add(file.path);
    files.push(
      Object.freeze({
        path: file.path,
        mediaType: file.mediaType,
        bytes: new Uint8Array(file.bytes),
      }),
    );
  }
  files.sort((left, right) => compareText(left.path, right.path));
  return Object.freeze({ state: "built" as const, files: Object.freeze(files) });
}

function resolveStaticConflicts(
  pages: readonly PageIntermediate[],
  downloads: readonly DownloadIntermediate[],
  problems: ProblemCollector,
): void {
  const outputs: Array<
    | { readonly kind: "page"; readonly page: PageCandidate }
    | { readonly kind: "download"; readonly download: BuiltDownload; readonly path: ReportDownloadPath }
  > = [];
  for (const page of pages) {
    if (page.kind === "candidate") {
      outputs.push({ kind: "page", page });
    }
  }
  for (const download of downloads) {
    if (download.kind === "built") {
      for (const file of download.files) {
        outputs.push({ kind: "download", download, path: file.path });
      }
    }
  }

  for (let left = 0; left < outputs.length; left += 1) {
    const current = outputs[left];
    if (current === undefined) continue;
    for (let right = left + 1; right < outputs.length; right += 1) {
      const next = outputs[right];
      if (next === undefined) continue;
      const currentPath = current.kind === "page"
        ? staticPathForReportRoute(current.page.route)
        : staticPathForReportDownload(current.path);
      const nextPath = next.kind === "page"
        ? staticPathForReportRoute(next.page.route)
        : staticPathForReportDownload(next.path);
      if (reportStaticPathConflict(currentPath, nextPath) === undefined) {
        continue;
      }
      markStaticConflict(current, problems);
      markStaticConflict(next, problems);
    }
  }
}

function markStaticConflict(
  output:
    | { readonly kind: "page"; readonly page: PageCandidate }
    | { readonly kind: "download"; readonly download: BuiltDownload; readonly path: ReportDownloadPath },
  problems: ProblemCollector,
): void {
  if (output.kind === "page") {
    if (output.page.conflictProblemId === undefined) {
      output.page.conflictProblemId = problems.execution({
        code: "route-conflict",
        consumerId: output.page.pageId,
        summary: "the Page route conflicts with another Report output",
      });
    }
    return;
  }
  if (output.download.conflictProblemId === undefined) {
    output.download.conflictProblemId = problems.execution({
      code: "route-conflict",
      consumerId: output.download.downloadId,
      summary: "a Download path conflicts with another Report output",
    });
  }
}

function validateDocuments(input: {
  readonly pages: readonly PageIntermediate[];
  readonly downloads: readonly DownloadIntermediate[];
  readonly problems: ProblemCollector;
}): ReportLimitExceeded | undefined {
  const candidates = input.pages.filter(
    (page): page is PageCandidate => page.kind === "candidate" && page.conflictProblemId === undefined,
  );
  const routes = new Set<ReportRoute>(candidates.map((page) => page.route));
  const downloads = new Set<ReportDownloadPath>();
  for (const download of input.downloads) {
    if (download.kind === "built" && download.conflictProblemId === undefined) {
      for (const file of download.files) {
        downloads.add(file.path);
      }
    }
  }

  const reverseLinks = new Map<ReportRoute, PageCandidate[]>();
  const invalidRoutes: ReportRoute[] = [];
  for (const page of candidates) {
    const validation = validateCandidateDocument(page.document, routes, downloads);
    if (validation.state === "limit") {
      return validation.error;
    }
    if (validation.state === "invalid") {
      markSemanticProblem(page, input.problems);
      invalidRoutes.push(page.route);
      continue;
    }
    page.document = validation.document;
    for (const route of validation.routes) {
      const linked = reverseLinks.get(route);
      if (linked === undefined) {
        reverseLinks.set(route, [page]);
      } else {
        linked.push(page);
      }
    }
  }

  for (let index = 0; index < invalidRoutes.length; index += 1) {
    const invalidRoute = invalidRoutes[index];
    if (invalidRoute === undefined) continue;
    for (const dependent of reverseLinks.get(invalidRoute) ?? []) {
      if (dependent.semanticProblemId !== undefined) continue;
      markSemanticProblem(dependent, input.problems);
      invalidRoutes.push(dependent.route);
    }
  }
  return undefined;
}

function validateCandidateDocument(
  document: ReportDocument,
  routes: ReadonlySet<ReportRoute>,
  downloads: ReadonlySet<ReportDownloadPath>,
):
  | { readonly state: "valid"; readonly document: ReportDocument; readonly routes: readonly ReportRoute[] }
  | { readonly state: "invalid" }
  | { readonly state: "limit"; readonly error: ReportLimitExceeded } {
  try {
    const validation = validateReportDocument(document, { routes, downloads });
    const limit = reportDocumentLimit(validation);
    if (limit !== undefined) {
      return Object.freeze({ state: "limit" as const, error: limit });
    }
    if (!validation.valid) {
      return Object.freeze({ state: "invalid" as const });
    }
    const frozen = freezeReportDocument(document);
    return Object.freeze({
      state: "valid" as const,
      document: frozen,
      routes: Object.freeze(routeLinks(frozen)),
    });
  } catch {
    return Object.freeze({ state: "invalid" as const });
  }
}

function reportDocumentLimit(validation: {
  readonly issues: readonly { readonly code: string; readonly reason: string }[];
  readonly nodeCount: number;
}): ReportLimitExceeded | undefined {
  for (const issue of validation.issues) {
    if (issue.code !== "limit") continue;
    if (issue.reason.includes("nodes deep")) {
      return reportLimit("document-depth", REPORT_DOCUMENT_DEPTH_MAX, REPORT_DOCUMENT_DEPTH_MAX + 1);
    }
    return reportLimit("document-nodes", REPORT_DOCUMENT_NODES_MAX, validation.nodeCount);
  }
  return undefined;
}

function markSemanticProblem(page: PageCandidate, problems: ProblemCollector): void {
  if (page.semanticProblemId === undefined) {
    page.semanticProblemId = problems.execution({
      code: "semantic-document-invalid",
      consumerId: page.pageId,
      summary: "the Page returned an invalid semantic document",
    });
  }
}

function routeLinks(document: ReportDocument): readonly ReportRoute[] {
  const routes: ReportRoute[] = [];
  const visitInline = (inline: ReportInline): void => {
    switch (inline.type) {
      case "text":
      case "code":
        return;
      case "emphasis":
        inline.children.forEach(visitInline);
        return;
      case "link":
        inline.label.forEach(visitInline);
        if (inline.target.kind === "route") routes.push(inline.target.route);
        return;
    }
  };
  const visitBlock = (block: ReportBlock): void => {
    switch (block.type) {
      case "section":
        block.children.forEach(visitBlock);
        return;
      case "paragraph":
        block.children.forEach(visitInline);
        return;
      case "list":
        block.items.forEach((item) => item.forEach(visitBlock));
        return;
      case "status":
        block.detail?.forEach(visitInline);
        return;
      case "table":
      case "metric":
      case "code-block":
      case "chart":
        return;
    }
  };
  document.children.forEach(visitBlock);
  return routes;
}

function finalizeExecution(input: {
  readonly compiled: CompiledReport;
  readonly sample: AnalysisSample;
  readonly projectionOutcomes: ReadonlyMap<CompiledProjection, ProjectionOutcome>;
  readonly calculationResults: ReadonlyMap<
    AnyReportCalculation,
    ReportCalculationExecutionResult
  >;
  readonly families: readonly FamilyIntermediate[];
  readonly pages: readonly PageIntermediate[];
  readonly downloads: readonly DownloadIntermediate[];
  readonly problems: ProblemCollector;
}): Effect.Effect<ReportExecution, ReportLimitExceeded | ReportProblemTableError, never> {
  return Effect.gen(function* () {
    const table = input.problems.table();
    if (Either.isLeft(table)) {
      return yield* Effect.fail(table.left);
    }
    const projections = projectionSummaries(
      input.compiled.projections,
      input.projectionOutcomes,
      input.sample,
    );
    const calculations = input.compiled.calculations.map(({ calculation }) => {
      const result = input.calculationResults.get(calculation);
      if (result === undefined) {
        throw new Error("a Calculation did not retain its execution result");
      }
      return result;
    });
    const execution = reportExecution({
      reportId: input.compiled.graph.id,
      sample: input.sample,
      projections,
      calculations,
      families: input.families.map(familyResult),
      pages: input.pages.map(pageResult),
      downloads: input.downloads.map(downloadResult),
      problemTable: table.right,
    });
    if (Either.isLeft(execution)) {
      if (execution.left.code === "report-limit-exceeded") {
        return yield* Effect.fail(execution.left);
      }
      throw executionInvariant(execution.left);
    }
    return execution.right;
  });
}

function projectionSummaries(
  projections: readonly CompiledProjection[],
  outcomes: ReadonlyMap<CompiledProjection, ProjectionOutcome>,
  sample: AnalysisSample,
): readonly ReportProjectionSummary[] {
  return projections.map((projection) => {
    const outcome = outcomes.get(projection);
    if (outcome === undefined) {
      throw new Error("a compiled projection did not retain its outcome");
    }
    return Object.freeze({
      projectionId: projection.projectionId,
      inputKey: projection.inputKey,
      coverage: outcome.state === "projected"
        ? outcome.value.coverage
        : failedProjectionCoverage(sample, projection.projection.access),
      problemIds: outcome.state === "projected"
        ? Object.freeze([])
        : Object.freeze([outcome.problemId]),
    });
  });
}

function familyResult(value: FamilyIntermediate): ReportPageFamilyResult {
  if (value.state === "expanded") {
    return Object.freeze({
      state: "expanded" as const,
      familyId: value.familyId,
      instanceCount: value.instanceCount,
      problemIds: value.problemIds,
    });
  }
  return Object.freeze({
    state: value.state,
    familyId: value.familyId,
    instanceCount: value.instanceCount,
    problemIds: requireProblemIds(value.problemIds),
  });
}

function pageResult(value: PageIntermediate): ReportPageResult {
  if (value.kind === "failed") {
    return Object.freeze({
      state: value.state,
      pageId: value.pageId,
      ...(value.route === undefined ? {} : { route: value.route }),
      problemIds: value.problemIds,
    });
  }
  const problemIds = uniqueProblemIds([
    ...value.problemIds,
    ...(value.conflictProblemId === undefined ? [] : [value.conflictProblemId]),
    ...(value.semanticProblemId === undefined ? [] : [value.semanticProblemId]),
  ]);
  if (value.conflictProblemId !== undefined || value.semanticProblemId !== undefined) {
    return Object.freeze({
      state: "execution-failed" as const,
      pageId: value.pageId,
      route: value.route,
      problemIds: requireProblemIds(problemIds),
    });
  }
  return Object.freeze({
    state: "rendered" as const,
    pageId: value.pageId,
    route: value.route,
    document: value.document,
    problemIds,
  });
}

function downloadResult(value: DownloadIntermediate): ReportDownloadResult {
  if (value.kind === "failed") {
    return Object.freeze({
      state: value.state,
      downloadId: value.downloadId,
      problemIds: value.problemIds,
    });
  }
  const problemIds = uniqueProblemIds([
    ...value.problemIds,
    ...(value.conflictProblemId === undefined ? [] : [value.conflictProblemId]),
  ]);
  if (value.conflictProblemId !== undefined) {
    return Object.freeze({
      state: "execution-failed" as const,
      downloadId: value.downloadId,
      problemIds: requireProblemIds(problemIds),
    });
  }
  return Object.freeze({
    state: "built" as const,
    downloadId: value.downloadId,
    files: value.files,
    problemIds,
  });
}

function failedProjectionCoverage(
  sample: AnalysisSample,
  access: ProjectionAccess,
): ProjectionCoverage {
  let included = 0;
  let notRecorded = 0;
  let coreInvalid = 0;
  let excluded = 0;
  for (const slot of sample.slots) {
    switch (slot.state) {
      case "included":
        included += 1;
        break;
      case "not-recorded":
        notRecorded += 1;
        break;
      case "core-invalid":
        coreInvalid += 1;
        break;
      case "excluded":
        excluded += 1;
        break;
    }
  }
  const slotAccess = access !== "selected-run";
  return Object.freeze({
    sample: Object.freeze({
      denominator: sample.denominator,
      totalSlots: sample.slots.length,
      included,
      notRecorded,
      coreInvalid,
      excluded,
    }),
    entries: Object.freeze({
      total: slotAccess ? sample.slots.length : sample.runs.length,
      attachmentResult: 0,
      notRecorded: slotAccess ? notRecorded : 0,
      coreInvalid: slotAccess ? coreInvalid : 0,
      excluded: slotAccess ? excluded : 0,
    }),
    attachments: Object.freeze({
      available: 0,
      unavailable: 0,
      migrationRequired: 0,
      migrationUnavailable: 0,
      unsupported: 0,
      invalid: 0,
    }),
  });
}

function dataState(partial: boolean): ReportDataState {
  return Object.freeze({ state: partial ? "partial" as const : "complete" as const });
}

function uniqueProblemIds(ids: readonly ReportProblemId[]): readonly ReportProblemId[] {
  const unique: ReportProblemId[] = [];
  const seen = new Set<number>();
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
  }
  return Object.freeze(unique);
}

function requireProblemIds(
  ids: readonly ReportProblemId[],
): readonly [ReportProblemId, ...ReportProblemId[]] {
  if (ids.length === 0) {
    throw new Error("a failed Report result must reference a problem");
  }
  return Object.freeze([...ids]) as readonly [ReportProblemId, ...ReportProblemId[]];
}

function reportLimit(
  limit: ReportLimitExceeded["limit"],
  maximum: number,
  observedAtLeast: number,
): ReportLimitExceeded {
  return Object.freeze({
    code: "report-limit-exceeded" as const,
    limit,
    maximum,
    observedAtLeast,
  });
}

function reportAuthoringInvalid(): ReportAuthoringInvalid {
  return Object.freeze({
    code: "report-definition-invalid" as const,
    issues: Object.freeze(["the Report must be created by NiceEval author constructors"]),
  });
}

function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
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

function executionInvariant(error: ReportExecutionValueError): Error {
  return new Error(`Report host produced an invalid execution: ${error.code}`);
}

class ProblemCollector {
  readonly problems: ReportProblem[] = [];
  private readonly ids = new Map<object, ReportProblemId>();

  add(problem: ReportProblem): ReportProblemId {
    const known = this.ids.get(problem);
    if (known !== undefined) return known;
    const id = this.problems.length as ReportProblemId;
    this.problems.push(problem);
    this.ids.set(problem, id);
    return id;
  }

  execution(problem: Omit<ReportExecutionProblem, "category">): ReportProblemId {
    return this.add(
      Object.freeze({
        category: "execution" as const,
        code: problem.code,
        consumerId: problem.consumerId,
        summary: problem.summary,
      }),
    );
  }

  table() {
    if (this.problems.length > REPORT_PROBLEM_TABLE_MAX) {
      return Either.left({
        code: "report-problem-table-limit" as const,
        maximum: REPORT_PROBLEM_TABLE_MAX,
        observedAtLeast: this.problems.length,
      });
    }
    return reportProblemTable(this.problems);
  }
}
