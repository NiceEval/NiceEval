import { Effect } from "effect";
import type * as Scope from "effect/Scope";

import type { AttemptLocator } from "../../attempt-locator.ts";
import { resolveAttemptLocator } from "../../attempt-locator-resolution.ts";
import { analysisHost } from "../../analysis/host.ts";
import type {
  AnalysisSelectionRequest,
  ExperimentId,
  JsonValue,
  Sample,
} from "../../analysis/index.ts";
import { experimentGroups } from "../../analysis/index.ts";
import type { RecordCoordination } from "../../coordination/record-leases.ts";
import { recordHost } from "../../record/host/runtime.ts";
import type { RecordRoot } from "../../record/platform/root.ts";
import type { RecordFileSystem } from "../../record/platform/services.ts";
import type {
  RecordReaderOpenError,
  RecordReaderReadError,
} from "../../record/reader/errors.ts";
import {
  captureAnalysisIssues,
  narrowSample,
  narrowSampleByCurrentIdentity,
  type AnalysisIssueCapture,
} from "../../sample/capability.ts";
import {
  materializeSampleSnapshot,
  narrowSampleSnapshot,
  narrowSampleSnapshotByCurrentIdentity,
} from "../../sample/analysis.ts";
import type {
  RecordReadSession,
  RecordSelection,
} from "../../record/host/types.ts";
import { defaultAttemptOverviewReport } from "../built-in/attempt-overview.ts";
import {
  builtInMachineProducerIds,
} from "../built-in/machine.ts";
import { defaultRunMembershipOverviewReport } from "../built-in/run-membership-overview.ts";
import { standard } from "../built-in/standard.tsx";
import {
  resolveReportTitle,
  type ReportDefinition,
} from "../definition/report.ts";
import type { ClosedSiteRevision } from "../execution/model.ts";
import {
  builtInMachineDescriptorOf,
  builtInShowDocument,
  buildReportProjections,
  canonicalMachineJson,
  closePricingProfileJson,
  customTargetExecutionManifest,
  produceBuiltInShowData,
  reportProjectionFailure,
  type BuiltInMachineDescriptor,
  type BuiltInMachineProducerMissing,
  type ReportProjectionCostInput,
  type ShowSelection,
} from "../execution/machine.ts";
import { renderResolvedPageText } from "../runtime/text.ts";
import type { PanelMode } from "../model/panel.ts";
import type { ThemeDefinition } from "../theme.ts";
import {
  executeReportSite,
  startReportBuildBudget,
  executeReportTarget,
  reportDefinitionIdentity,
  type ClosedReportSite,
  type ClosedTargetExecution,
  type ReportBuildBudgetAnchor,
  type ReportExecutionError,
} from "./execute.ts";
import {
  builtInMachineRegistry,
  type BuiltInMachineProductionFailed,
} from "./machine.ts";
import {
  selectShowTarget,
  type ShowTargetError,
} from "./show-target.ts";
import {
  isReportTargetRouteInvalid,
  showTargetRequestForRoute,
} from "./target-route.ts";
import { withReportHostPhase } from "./progress.ts";
import {
  buildSiteRevision,
  type ReportSiteBuildError,
} from "./static.ts";

const SHOW_TEXT_WIDTH = 80;

export interface ReportShowPresentationFailed {
  readonly code: "report-show-presentation-failed";
  readonly operation: "text" | "machine";
  readonly reason: string;
}

export type ExecuteReportFromRecordError =
  | RecordReaderOpenError
  | RecordReaderReadError
  | ReportExecutionError
  | ReportSiteBuildError
  | BuiltInMachineProductionFailed
  | BuiltInMachineProducerMissing
  | ReportShowPresentationFailed
  | {
      readonly code: "sample-attempt-locator-not-found";
      readonly locator: AttemptLocator;
    }
  | {
      readonly code: "sample-attempt-locator-ambiguous";
      readonly locator: AttemptLocator;
    };

export type ExecuteReportForAttemptFromRecordError = ExecuteReportFromRecordError;
export type ExecuteReportFromRecordRequirements = RecordFileSystem | RecordCoordination;

interface SelectionTarget {
  readonly root: RecordRoot;
  readonly selection: AnalysisSelectionRequest;
  readonly report?: ReportDefinition;
}

interface AttemptTarget {
  readonly root: RecordRoot;
  readonly locator: AttemptLocator;
  readonly report?: ReportDefinition;
}

export type ReportRecordTarget = SelectionTarget | AttemptTarget;

export type ShowReportFromRecordInput = ReportRecordTarget & {
  readonly route?: string;
  readonly format?: "text" | "json";
  readonly textProjection?: { readonly width: number; readonly panelMode: PanelMode };
};

export type BuildReportSiteFromRecordInput = ReportRecordTarget & {
  readonly theme?: ThemeDefinition;
};

export type CloseReportSiteFromRecordInput = ReportRecordTarget;

/**
 * The Record-backed show boundary executes and closes exactly one Page. It
 * never enumerates a parameterized Page and never forms a Site revision.
 */
export function showReportFromRecord(
  input: ShowReportFromRecordInput,
): Effect.Effect<string, ExecuteReportFromRecordError, ExecuteReportFromRecordRequirements> {
  return "locator" in input
    ? showAttemptFromRecord(input)
    : showSelectionFromRecord(input);
}

/**
 * The Record-backed site boundary enumerates every Page instance once, closes
 * all projections while the Sample is live, and then forms one opaque byte
 * revision consumed unchanged by view and static export.
 */
export function buildReportSiteFromRecord(
  input: BuildReportSiteFromRecordInput,
): Effect.Effect<ClosedSiteRevision, ExecuteReportFromRecordError, ExecuteReportFromRecordRequirements> {
  return Effect.flatMap(
    closeReportSiteFromRecord(input),
    (site) => buildSiteRevision({
      site,
      ...(input.theme === undefined ? {} : { theme: input.theme }),
    }),
  );
}

/** @internal Page-level cache input: closed data only, with no live Sample. */
export function closeReportSiteFromRecord(
  input: CloseReportSiteFromRecordInput,
): Effect.Effect<ClosedReportSite, ExecuteReportFromRecordError, ExecuteReportFromRecordRequirements> {
  return Effect.suspend(() => {
    const budget = startReportBuildBudget();
    return "locator" in input
      ? closeAttemptSiteFromRecord(input, budget)
      : closeSelectionSiteFromRecord(input, budget);
  });
}

/**
 * @internal Watch-only Record probe. It shares the same selection and
 * project-current/attempt narrowing as Sample opening, but stops after the
 * selected semantic snapshot is materialized. No Sample capability or Report
 * callback is opened on this path.
 */
export function reportSnapshotIdentityFromRecord(
  input: ReportRecordTarget,
): Effect.Effect<string, ExecuteReportFromRecordError, ExecuteReportFromRecordRequirements> {
  return Effect.scoped("locator" in input
    ? snapshotIdentityForAttempt(input.root, input.locator)
    : snapshotIdentityForSelection(input.root, input.selection));
}

function showSelectionFromRecord(input: SelectionTarget & {
  readonly route?: string;
  readonly format?: "text" | "json";
  readonly textProjection?: { readonly width: number; readonly panelMode: PanelMode };
}) {
  return Effect.scoped(Effect.gen(function* () {
    const sample = yield* openSelectionSample(input.root, input.selection);
    const report = input.report ?? defaultReportForSelection(input.selection);
    const selection = showSelectionForRequest(sample, input.selection);
    const implicitRoute = input.route === undefined
      ? singleExperimentGroupRoute(report, sample)
      : undefined;
    return yield* presentShowTarget({
      sample,
      report,
      selection,
      ...(input.route === undefined && implicitRoute === undefined ? {} : { route: input.route ?? implicitRoute }),
      ...(input.textProjection === undefined ? {} : { textProjection: input.textProjection }),
      format: input.format ?? "text",
    });
  }));
}

function singleExperimentGroupRoute(report: ReportDefinition, sample: Sample): string | undefined {
  const groups = experimentGroups(sample);
  if (groups.length !== 1) return undefined;
  const group = groups[0]!.group;
  const declaresGroupPage = report.pages.some((page) =>
    "role" in page
    && page.role?.kind === "experiment-group"
    && page.role.groupKind === group.kind
  );
  return declaresGroupPage ? groupRoute(group) : undefined;
}

function groupRoute(group: import("../../analysis/index.ts").ExperimentGroupIdentity): string {
  return group.kind === "named"
    ? `/group/named/${group.groupId}`
    : `/group/singleton/${String(group.experimentId)}`;
}

function showAttemptFromRecord(input: AttemptTarget & {
  readonly route?: string;
  readonly format?: "text" | "json";
  readonly textProjection?: { readonly width: number; readonly panelMode: PanelMode };
}) {
  return Effect.scoped(Effect.gen(function* () {
    const sample = yield* openAttemptSample(input.root, input.locator);
    const report = input.report ?? defaultAttemptOverviewReport;
    const selection: ShowSelection = Object.freeze({
      kind: "attempt-locator" as const,
      sampleIdentity: sample.snapshot.identity.id,
      locator: String(input.locator),
    });
    return yield* presentShowTarget({
      sample,
      report,
      selection,
      ...(input.route === undefined ? {} : { route: input.route }),
      ...(input.textProjection === undefined ? {} : { textProjection: input.textProjection }),
      format: input.format ?? "text",
    });
  }));
}

/**
 * One selected target for one fixed Sample. A built-in machine Report is
 * executed by the Host-owned producer registry from its data-only descriptor;
 * its author callbacks are never invoked, so a duplicate installed copy is
 * recognized and executed safely. Custom Reports keep executing the selected
 * author Page and then present the closed result.
 */
function presentShowTarget(input: {
  readonly sample: Sample;
  readonly report: ReportDefinition;
  readonly selection: ShowSelection;
  readonly route?: string;
  readonly format: "text" | "json";
  readonly textProjection?: { readonly width: number; readonly panelMode: PanelMode };
}): Effect.Effect<string, ExecuteReportFromRecordError, Scope.Scope> {
  if (input.format === "json") {
    const descriptor = builtInMachineDescriptorOf(input.report);
    if (descriptor !== undefined) {
      return presentBuiltInMachineShow({
        sample: input.sample,
        report: input.report,
        descriptor,
        selection: input.selection,
        ...(input.route === undefined ? {} : { route: input.route }),
      });
    }
  }
  return Effect.gen(function* () {
    const execution = yield* withReportHostPhase("report-execution", executeReportTarget({
      sample: input.sample,
      report: input.report,
      ...(input.route === undefined ? {} : { route: input.route }),
      ...(input.textProjection === undefined ? {} : { textProjection: input.textProjection }),
    }));
    return yield* presentTarget({
      sample: input.sample,
      report: input.report,
      execution,
      selection: input.selection,
      format: input.format,
      ...(input.textProjection === undefined ? {} : { textProjection: input.textProjection }),
    });
  });
}

/**
 * Produces the Host-owned built-in machine document without executing any
 * author callback. Route and Page selection stay pure; the producer registry
 * resolves the data-only descriptor, and the analysis capture records the
 * same problem table an author execution would surface.
 */
function presentBuiltInMachineShow(input: {
  readonly sample: Sample;
  readonly report: ReportDefinition;
  readonly descriptor: BuiltInMachineDescriptor;
  readonly selection: ShowSelection;
  readonly route?: string;
}): Effect.Effect<
  string,
  ReportExecutionError | BuiltInMachineProductionFailed | BuiltInMachineProducerMissing | ReportShowPresentationFailed,
  Scope.Scope
> {
  return withReportHostPhase("report-execution", Effect.gen(function* () {
    const request = showTargetRequestForRoute(input.report, input.route);
    if (isReportTargetRouteInvalid(request)) return yield* Effect.fail(request);
    const selected = selectShowTarget(input.report, request);
    if (isShowTargetSelectionError(selected)) {
      return yield* Effect.fail(selected);
    }
    const pageId = selected.page.id;
    const route = selected.kind === "plain" ? selected.target.route : selected.route;
    const capture = yield* captureAnalysisIssues(input.sample);
    return yield* Effect.ensuring(
      Effect.gen(function* () {
        const data = yield* Effect.tryPromise({
          // The producer's Analysis facade captures the execution-local issue
          // token synchronously, so it must start inside the capture context.
          try: () => capture.run(() => Effect.runPromise(Effect.scoped(produceBuiltInShowData({
            registry: builtInMachineRegistry,
            descriptor: input.descriptor,
            sample: input.sample,
            selection: input.selection,
            route,
            pageId,
          })))),
          catch: (cause): BuiltInMachineProductionFailed | BuiltInMachineProducerMissing | ReportShowPresentationFailed => {
            if (isMachineShowFailure(cause)) return cause;
            return presentationFailure("machine", cause);
          },
        });
        const costs = capturedProjectionCosts(capture, route, pageId);
        const pricingProfile = reportPricingProfileJson(input.report);
        const failure = reportProjectionFailure({ pricingProfile, costs });
        if (failure !== undefined) return yield* Effect.fail(failure);
        return yield* Effect.try({
          try: () => `${canonicalMachineJson(builtInShowDocument({
            selection: input.selection,
            report: {
              token: builtInToken(input.descriptor.producerId),
              identity: reportDefinitionIdentity(input.report),
            },
            page: {
              route,
              pageId,
              title: selected.page.title,
            },
            data,
            // The built-in data keeps no second enumerable projection; the
            // capture's cost entries are the only source, bound to this Page.
            projections: buildReportProjections({
              pricingProfile,
              costs,
            }),
            problems: machineProblems(capture.issues(), pageId),
          }))}\n`,
          catch: (cause): ReportShowPresentationFailed => presentationFailure("machine", cause),
        });
      }),
      Effect.sync(() => capture.close()),
    );
  }));
}

function closeSelectionSiteFromRecord(
  input: SelectionTarget,
  budget: ReportBuildBudgetAnchor,
) {
  return Effect.scoped(Effect.gen(function* () {
    const sample = yield* openSelectionSample(input.root, input.selection);
    return yield* withReportHostPhase("report-execution", executeReportSite({
      sample,
      report: input.report ?? defaultReportForSelection(input.selection),
      budget,
    }));
  }));
}

function closeAttemptSiteFromRecord(
  input: AttemptTarget,
  budget: ReportBuildBudgetAnchor,
) {
  return Effect.scoped(Effect.gen(function* () {
    const sample = yield* openAttemptSample(input.root, input.locator);
    return yield* withReportHostPhase("report-execution", executeReportSite({
      sample,
      report: input.report ?? defaultAttemptOverviewReport,
      budget,
    }));
  }));
}

interface SelectedRecordTarget {
  readonly reader: RecordReadSession;
  readonly selection: RecordSelection;
}

interface SelectedAttemptTarget extends SelectedRecordTarget {
  readonly selectionRequest: AnalysisSelectionRequest;
  readonly runId: import("../../analysis/contracts.ts").RunId;
  readonly slotId: import("../../analysis/contracts.ts").SlotId;
}

/** The shared true selection boundary for both Sample opening and watch probes. */
function selectRecordForSelection(root: RecordRoot, selection: AnalysisSelectionRequest) {
  return Effect.gen(function* () {
    const reader = yield* withReportHostPhase("record-open", recordHost.current.openRead({ root }));
    const selected = yield* withReportHostPhase("selection", reader.selectRuns(
      selection.policy === "explicit-runs" ? { runIds: selection.runIds } : undefined,
    ));
    const filtered = selection.policy === "project-current" && selection.experimentIds !== undefined
      ? yield* filterSelectionByExperiment(selected, selection.experimentIds)
      : selected;
    return Object.freeze({ reader, selection: filtered }) satisfies SelectedRecordTarget;
  });
}

/** The shared exact-attempt selection boundary for both Sample opening and watch probes. */
function selectRecordForAttempt(root: RecordRoot, locator: AttemptLocator) {
  return Effect.gen(function* () {
    const reader = yield* withReportHostPhase("record-open", recordHost.current.openRead({ root }));
    const resolved = yield* withReportHostPhase("selection", Effect.gen(function* () {
      const selected = yield* reader.selectRuns();
      return yield* resolveAttemptLocator({ reader, selection: selected, locator });
    }));
    if (resolved.kind === "not-found") {
      return yield* Effect.fail({ code: "sample-attempt-locator-not-found" as const, locator });
    }
    if (resolved.kind === "ambiguous") {
      return yield* Effect.fail({ code: "sample-attempt-locator-ambiguous" as const, locator });
    }
    const selectionRequest: AnalysisSelectionRequest = Object.freeze({
      policy: "explicit-runs" as const,
      runIds: Object.freeze([resolved.run.runId]),
    });
    const selection = yield* reader.selectRuns({ runIds: selectionRequest.runIds });
    return Object.freeze({
      reader,
      selection,
      selectionRequest,
      runId: resolved.run.runId,
      slotId: resolved.slotId,
    }) satisfies SelectedAttemptTarget;
  });
}

function snapshotIdentityForSelection(root: RecordRoot, selection: AnalysisSelectionRequest) {
  return Effect.gen(function* () {
    const selected = yield* selectRecordForSelection(root, selection);
    const materialized = yield* materializeSampleSnapshot({
      reader: selected.reader,
      selection: selected.selection,
      selectionRequest: selection,
    });
    const snapshot = selection.policy === "project-current"
      ? narrowSampleSnapshotByCurrentIdentity(
          materialized.snapshot,
          matchingOccurrencesForCurrentIdentity(selected.selection, selection.currentSlots),
        )
      : materialized.snapshot;
    return snapshot.identity.id;
  });
}

function snapshotIdentityForAttempt(root: RecordRoot, locator: AttemptLocator) {
  return Effect.gen(function* () {
    const selected = yield* selectRecordForAttempt(root, locator);
    const materialized = yield* materializeSampleSnapshot({
      reader: selected.reader,
      selection: selected.selection,
      selectionRequest: selected.selectionRequest,
    });
    const snapshot = narrowSampleSnapshot(materialized.snapshot, {
      runIds: [selected.runId],
      slotIds: [selected.slotId],
    });
    // This selector is assembled from one successfully resolved Attempt, so
    // the only invalid-selector branch is an internal invariant violation.
    if ("code" in snapshot) throw snapshot;
    return snapshot.identity.id;
  });
}

function openSelectionSample(root: RecordRoot, selection: AnalysisSelectionRequest) {
  return Effect.gen(function* () {
    const selected = yield* selectRecordForSelection(root, selection);
    const opened = yield* withReportHostPhase("sample-open", analysisHost.openSample({
      reader: selected.reader,
      selection: selected.selection,
      selectionRequest: selection,
    }));
    return selection.policy === "project-current"
      ? narrowSampleByCurrentIdentity(
          opened,
          matchingOccurrencesForCurrentIdentity(selected.selection, selection.currentSlots),
        )
      : opened;
  });
}

function openAttemptSample(root: RecordRoot, locator: AttemptLocator) {
  return Effect.gen(function* () {
    const selected = yield* selectRecordForAttempt(root, locator);
    const sample = yield* withReportHostPhase("sample-open", analysisHost.openSample({
      reader: selected.reader,
      selection: selected.selection,
      selectionRequest: selected.selectionRequest,
    }));
    return narrowSample(sample, {
      runIds: [selected.runId],
      slotIds: [selected.slotId],
    });
  });
}

function presentTarget(input: {
  readonly sample: Sample;
  readonly report: ReportDefinition;
  readonly execution: ClosedTargetExecution;
  readonly selection: ShowSelection;
  readonly format: "text" | "json";
  readonly textProjection?: { readonly width: number; readonly panelMode: PanelMode };
}): Effect.Effect<
  string,
  ReportShowPresentationFailed,
  Scope.Scope
> {
  if (input.format === "text") {
    return Effect.try({
      try: () => withTrailingNewline(renderResolvedPageText(input.execution.page, {
        locale: "en",
        width: input.textProjection?.width ?? SHOW_TEXT_WIDTH,
        panelMode: input.textProjection?.panelMode ?? "plain",
      })),
      catch: (cause): ReportShowPresentationFailed => presentationFailure("text", cause),
    });
  }

  return Effect.try({
    try: () => `${canonicalMachineJson(customTargetExecutionManifest({
      selection: input.selection,
      report: {
        identity: reportDefinitionIdentity(input.report),
        title: resolveReportTitle(input.report),
      },
      page: input.execution.page,
      textWidth: SHOW_TEXT_WIDTH,
      projections: input.execution.projections,
      problems: input.execution.problems,
    }))}\n`,
    catch: (cause): ReportShowPresentationFailed => presentationFailure("machine", cause),
  });
}

function isMachineShowFailure(
  value: unknown,
): value is BuiltInMachineProductionFailed | BuiltInMachineProducerMissing {
  return typeof value === "object" && value !== null &&
    (Reflect.get(value, "code") === "report-built-in-machine-producer-missing" ||
      Reflect.get(value, "code") === "report-built-in-machine-production-failed");
}

/** Distinguishes the pure selection error from a selected target without importing the private union. */
function isShowTargetSelectionError(value: unknown): value is ShowTargetError {
  return typeof value === "object" && value !== null && "code" in value;
}

/** The closed JSON form of the Report's PricingProfile, or null without one. */
function reportPricingProfileJson(report: ReportDefinition): JsonValue | null {
  return report.pricing === null ? null : closePricingProfileJson(report.pricing);
}

/** Binds exact Analysis row-level cost captures to the built-in target Page. */
function capturedProjectionCosts(
  capture: AnalysisIssueCapture,
  route: string,
  pageId: string,
): readonly ReportProjectionCostInput[] {
  return capture.costEntries().map((entry) => Object.freeze({
    page: Object.freeze({ pageId, route }),
    measureId: entry.measureId,
    row: Object.freeze({ key: entry.row.key, dimensions: entry.row.dimensions }),
    profileIdentity: entry.profileIdentity,
    projection: entry.projection,
  }));
}

/** The host problem table for issues the machine producer recorded while the Sample was live. */
function machineProblems(
  issues: readonly import("../../analysis/index.ts").AnalysisIssue[],
  pageId: string,
): readonly import("../execution/machine.ts").ReportProblem[] {
  return Object.freeze(issues.map((issue) => Object.freeze({
    code: `analysis-${issue.code}`,
    path: Object.freeze(["page", pageId]),
    refs: Object.freeze(issue.refs.map((reference) => String(reference.identity.locator)).sort(compareUtf8)),
    summary: issue.message,
  })));
}

function builtInToken(producerId: string): string {
  switch (producerId) {
    case builtInMachineProducerIds.runMembershipOverview:
      return "run-membership-overview";
    case builtInMachineProducerIds.attemptOverview:
      return "attempt-overview";
    case builtInMachineProducerIds.standard:
      return "standard";
    default:
      return producerId;
  }
}

function showSelectionForRequest(sample: Sample, selection: AnalysisSelectionRequest): ShowSelection {
  if (selection.policy === "explicit-runs") {
    return Object.freeze({
      kind: "explicit-runs" as const,
      sampleIdentity: sample.snapshot.identity.id,
      runIds: Object.freeze(selection.runIds.map(String)),
    });
  }
  const experimentIds = selection.experimentIds ?? selection.currentSlots.map((slot) => slot.experimentId);
  return Object.freeze({
    kind: "project-current" as const,
    sampleIdentity: sample.snapshot.identity.id,
    experimentIds: Object.freeze(experimentIds.map(String)),
  });
}

function defaultReportForSelection(selection: AnalysisSelectionRequest): ReportDefinition {
  return selection.policy === "explicit-runs"
    ? defaultRunMembershipOverviewReport
    : standard;
}

function matchingOccurrencesForCurrentIdentity(
  selection: import("../../record/host/types.ts").RecordSelection,
  currentSlots: readonly import("../../analysis/contracts.ts").AnalysisCurrentSlotIdentity[],
): readonly import("../../analysis/contracts.ts").AnalysisSlotOccurrenceIdentity[] {
  const digestsByLogicalAlignment = new Map<string, Set<string>>();
  for (const current of currentSlots) {
    const key = logicalAlignmentKey(current.experimentId, current.evalId, current.attemptOrdinal);
    const existing = digestsByLogicalAlignment.get(key) ?? new Set<string>();
    digestsByLogicalAlignment.set(key, existing.add(current.executionIdentityDigest));
  }
  const matching: import("../../analysis/contracts.ts").AnalysisSlotOccurrenceIdentity[] = [];
  for (const entry of selection.expectedSlots) {
    const digests = digestsByLogicalAlignment.get(
      logicalAlignmentKey(entry.experimentId, entry.slot.evalId, entry.slot.attemptOrdinal),
    );
    if (digests === undefined || !digests.has(entry.slot.executionIdentityDigest)) continue;
    matching.push(Object.freeze({ runId: entry.run.runId, slotId: entry.slot.slotId }));
  }
  return Object.freeze(matching);
}

function filterSelectionByExperiment(
  selection: import("../../record/host/types.ts").RecordSelection,
  experimentIds: readonly ExperimentId[],
): Effect.Effect<import("../../record/host/types.ts").RecordSelection> {
  const wanted = new Set(experimentIds);
  const runFacts = selection.runFacts.filter((facts) => wanted.has(facts.experimentId));
  const allowed = new Set(runFacts.map((facts) => facts.run));
  const allowedRunIds = new Set(runFacts.map((facts) => facts.run.runId));
  return Effect.succeed(Object.freeze({
    runRefs: Object.freeze(runFacts.map((facts) => facts.run)),
    runFacts: Object.freeze(runFacts),
    expectedSlots: Object.freeze(selection.expectedSlots.filter((entry) => allowed.has(entry.run))),
    // `selectRuns()` initially scans the Record-wide physical directory. A
    // concurrently written, unselected Run may therefore be incomplete for a
    // moment. Its warning/problem must not alter the selected semantic Sample
    // (or make an unrelated watch signal reopen Analysis).
    problems: Object.freeze(selection.problems.filter((problem) => allowedRunIds.has(problem.runId))),
    warnings: Object.freeze(selection.warnings.filter((warning) => allowedRunIds.has(warning.runId))),
  }));
}

function logicalAlignmentKey(
  experimentId: ExperimentId,
  evalId: import("../../analysis/contracts.ts").EvalId,
  attemptOrdinal: number,
): string {
  return `${experimentId}\0${evalId}\0${attemptOrdinal}`;
}

function presentationFailure(
  operation: ReportShowPresentationFailed["operation"],
  cause: unknown,
): ReportShowPresentationFailed {
  const raw = cause instanceof Error ? cause.message : String(cause);
  return Object.freeze({
    code: "report-show-presentation-failed" as const,
    operation,
    reason: raw.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").slice(0, 512).trim() || `${operation} failed`,
  });
}

function withTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}
