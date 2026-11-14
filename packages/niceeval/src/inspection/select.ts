// @concord-file
// @concord-implements docs/feature/inspection/README.md
// @concord-implements docs/feature/inspection/use-case/inspection-check-completeness.md
// @concord-implements docs/feature/inspection/use-case/inspection-compare-quality-cost.md
// @concord-implements docs/feature/insight/README.md
import { projectAssertionMatrix, type MatrixInput } from "./assertion-matrix.ts";
import { projectPlannedAttempt, projectAttemptCore, projectRunCore, projectMember } from "./planned-attempt.ts";
import { projectLifecyclePhase } from "./lifecycle.ts";
import { readAttemptNotes, aggregateAttemptNotes } from "./notes.ts";
import { Data, Result, Schema } from "effect";
import { projectAttemptArtifact } from "./artifacts.ts";
import { projectInput, type FrozenProjectInput } from "./project-input.ts";
import { selectInspectionProject } from "./project.ts";
import { InspectionProjectResultSchema } from "./project-result.ts";
import { projectArtifactsListing } from "./artifact-list.ts";
import { combineTotalUsageCosts, summarizeJudgeUsage, takeJudgeUsagePreview } from "../o11y/judge-usage-projection.ts";

import { encodeAttemptLocator } from "../attempt-locator.ts";
import { attemptVerdict } from "./verdict.ts";
import type {
  AssertionCoverage,
  AssertionLimitation,
} from "../assertions/record/model.ts";
import {
  NiceEvalCurrentRecordAttachments,
  NiceEvalRecordAttachments,
} from "../record/family/current.ts";
import type { RunResourcePage } from "../run/storage/types.ts";
import type { RunSummary } from "../run/index.ts";
import { decodeBase64UrlUtf8, encodeBase64UrlUtf8, utf8ByteLength } from "./bytes.ts";
import {
  INSPECTION_BEHAVIOR_VERSION,
  QUERY_PROTOCOL,
  closeInspectionJson,
  isInspectionCodecError,
  type InspectionDocument,
  type InspectionJson,
  type InspectionOperation,
  type InspectionOperationId,
  type InspectionSourceProvenance,
} from "./codec.ts";
import { INSPECTION_ATTEMPT_USAGE_RESULT_BYTE_LIMIT, INSPECTION_RESULT_BYTE_LIMIT, INSPECTION_EXPERIMENT_RESULT_BYTE_LIMIT, INSPECTION_ASSERTION_DETAIL_BYTE_LIMIT } from "./limits.ts";
import { projectAttemptAssertionDetail, projectAttemptAssertionImage } from "./assertions.ts";
import { InspectionRepricingResultSchema } from "./repricing.ts";
import { projectAttemptRepricing } from "./trace.ts";
import {
  attemptAttachment,
  loadInspectionRunResource,
  loadInspectionRuns,
  loadSelectedInspectionRuns,
  readInspectionAssertions,
  resolveInspectionAttempt,
  resolveInspectionMemberAttempt,
  resolveInspectionResourceMemberAttempt,
  runAttachment,
  type DecodedInspectionAttachment,
  type LoadedInspectionRun,
  type LoadedInspectionRunResource,
  type ResolvedInspectionAttempt,
} from "./facts.ts";
import { projectPlannedAttemptMetrics, selectInspectionOverview } from "./overview.ts";
import type { InspectionFactSource } from "./source.ts";
import { projectAttemptSources } from "./sources.ts";
import { projectAttemptDiff } from "./diff.ts";
import {
  combineInspectionUsageTotals,
  projectAttemptTiming,
  readInspectionAgentTurns,
  readCurrentAttachment,
  projectAttemptTrace,
  projectAttemptTraceDetail,
  projectAttemptUsage,
  unavailableInspectionUsageTotals,
  type AttemptTraceAttachments,
} from "./trace.ts";
import {
  InspectionAttemptDiffResultSchema,
  InspectionAttemptResultSchema,
  InspectionAttemptSourcesDocument,
  InspectionAttemptTimingResultSchema,
  InspectionTraceDetailResultSchema,
  InspectionTraceResultSchema,
  InspectionAttemptUsageResultSchema,
  InspectionExperimentResultSchema,
  InspectionOverviewResultSchema,
  InspectionRunResultSchema,
  InspectionRunValueSchema,
  InspectionSourcesResultSchema,
  type InspectionAttemptDiffDocument,
  type InspectionAttemptDocument,
  type InspectionAttemptResult,
  type InspectionAttemptTimingDocument,
  type InspectionAttemptTraceDetailDocument,
  type InspectionAttemptTraceDocument,
  type InspectionAttemptUsageDocument,
  type InspectionExperimentDocument,
  type InspectionOverviewDocument,
  type InspectionResultMetadata,
  type InspectionRunDocument,
  type InspectionRunResult,
  type InspectionRunValue,
} from "./results.ts";
import {
  decodeInspectionDocument,
  inspectionProtocolRegistry,
  narrowInspectionSuccess,
  type InspectionOperationDocument,
  type InspectionOperationFor,
  type InspectionSuccessDocument,
  type InspectionSuccessDocumentFor,
} from "./protocol.ts";
import { RecordIntegrityFailure } from "../record/reader/errors.ts";
import {
  InspectionExecutionTraceError,
  projectExecutionTraceDetail,
  projectExecutionTraceOutline,
} from "./execution-traces.ts";

/** Typed browser-neutral failure from one fixed Inspection operation. */
export class InspectionOperationError extends Data.TaggedError("InspectionOperationError")<{
  readonly code:
    | "inspection-request-invalid"
    | "inspection-selection-missing"
    | "inspection-record-integrity-failure"
    | "inspection-operation-failed"
    | "inspection-result-invalid"
    | "evidence-budget-exceeded"
    | "restart-required"
    | "current-target-unavailable";
  readonly operation: InspectionOperationId;
  readonly reason: string;
  readonly identity?: { readonly runId: string };
  readonly cause?: unknown;
}> {}

const RUN_LIST_PAGE_SIZE = 100;
const ATTACHMENT_COLLECTION_PAGE_SIZE = 64;
const ATTACHMENT_CONTENT_METADATA_LIMIT = 64;
const RUN_SELECTION_LIMIT = 64;

/** Pure fixed-operation selector shared by Node CLI and browser View adapters. */
export function selectInspectionOperation<
  Kind extends InspectionOperationId,
>(
  facts: InspectionFactSource,
  operation: InspectionOperationFor<Kind>,
): InspectionSuccessDocumentFor<Kind>;
// @concord-code
// @concord-implements docs/feature/inspection/README.md
// @concord-implements docs/feature/inspection/use-case/inspection-check-completeness.md
// @concord-implements docs/feature/inspection/use-case/inspection-compare-quality-cost.md
export function selectInspectionOperation(
  facts: InspectionFactSource,
  operation: InspectionOperation,
): InspectionSuccessDocument {
  return evaluateInspectionSuccess(
    operation.kind,
    () => selectOperation(facts, operation),
  );
}

/** Internal CLI explanation over the same selected facts and cutoff. */
// @concord-code
// @concord-implements docs/feature/inspection/README.md
// @concord-implements docs/feature/inspection/use-case/inspection-check-completeness.md
export function explainInspectionOperation(
  facts: InspectionFactSource,
  operation: InspectionOperation,
): InspectionDocument {
  return evaluateInspectionOperation(operation.kind, () => {
    if (operation.kind === "run.list") {
      return runsListExplanation(facts, operation);
    }
    if (operation.kind === "run.get") {
      const run = requireRunResource(facts, operation.kind, operation.runId);
      const supporting = supportingRunFacts(facts, run);
      return Object.freeze({
        ...runResourceBaseDocument(facts, operation.kind, run, supporting),
        outcome: "explanation" as const,
        factKinds: inspectionProtocolRegistry[operation.kind].factKinds,
      });
    }
    const loaded = loadForOperation(facts, operation);
    return Object.freeze({
      ...baseDocument(
        facts,
        operation.kind,
        loaded.selected,
        loaded.requestedRunIds,
        loaded.missingRunIds,
        [],
      ),
      outcome: "explanation" as const,
      factKinds: inspectionProtocolRegistry[operation.kind].factKinds,
    });
  });
}

function selectOperation(
  source: InspectionFactSource,
  operation: InspectionOperation,
): unknown {
  switch (operation.kind) {
    case "project.get": {
      const input = requireCurrentProject(source, operation.experimentIds);
      return Object.freeze({
        ...resultMetadata(source, operation.kind, input.runs, [], [], locators(input.runs)),
        project: decodeRequiredResult(operation.kind, InspectionProjectResultSchema, selectInspectionProject(input, operation.experimentIds)),
      });
    }
    case "overview.get": {
      const requested = operation.runIds ?? [];
      const selection = requested.length === 0
        ? { selected: loadInspectionRuns(source), missing: [] as readonly string[] }
        : selectRuns(loadRuns(source, requested), requested);
      const supporting = loadReferencedOrigins(source, selection.selected);
      return Object.freeze({
        ...resultMetadata(source, operation.kind, selection.selected, requested, selection.missing, locators(supporting)),
        overview: decodeRequiredResult(
          operation.kind,
          InspectionOverviewResultSchema,
          selectInspectionOverview(selection.selected, supporting),
        ),
      });
    }
    case "experiments.assertions": {
      const experimentIds = [...new Set(operation.experimentIds)].sort();
      const input: MatrixInput[] = [];
      const matching = loadSelectedInspectionRuns(source, [...new Set(experimentIds.flatMap((id) => source.findExperimentRunIds(id)))]);
      const selected = loadReferencedOrigins(source, matching);
      const overview = selectInspectionOverview(matching, selected);
      for (const experimentId of experimentIds) {
        if (!overview.experiments.some((item) => item.experimentId === experimentId)) throw selectionMissing(operation.kind, `Experiment ${experimentId} was not found`);
        for (const cell of overview.cells.filter((item) => item.experimentId === experimentId && (operation.evalIdPrefix === undefined || item.evalId === operation.evalIdPrefix || item.evalId.startsWith(operation.evalIdPrefix.replace(/\/$/u, "") + "/")))) {
          for (const member of cell.members) {
            const locator = member.publication.state === "published" ? member.publication.attemptLocator : null;
            const assertions = locator === null ? undefined : readInspectionAssertions(requireAttemptFromSource(source, operation.kind, locator));
            input.push({ evalId: cell.evalId, column: { experimentId, attemptOrdinal: member.attemptOrdinal, locator, publication: member.publication, verdict: member.verdict, score: member.score },
              assertions: assertions?.state === "available" ? { state: "available", entries: assertions.value.entries } : { state: assertions?.state ?? "not-recorded" } });
          }
        }
      }
      return { ...resultMetadata(source, operation.kind, selected, [], [], locators(selected)), matrix: projectAssertionMatrix(experimentIds, input) };
    }
    case "experiment.get": {
      const matching = loadSelectedInspectionRuns(source, source.findExperimentRunIds(operation.experimentId));
      const selected = loadReferencedOrigins(source, matching);
      const overview = selectInspectionOverview(matching, selected);
      const experiment = overview.experiments.find(({ experimentId }) =>
        experimentId === operation.experimentId);
      if (experiment === undefined) {
        throw selectionMissing(
          operation.kind,
          `Experiment ${operation.experimentId} was not found`,
        );
      }
      const experimentCells = Object.freeze(overview.cells.filter(({ experimentId }) => experimentId === operation.experimentId));
      const usageAttempts = new Map<string, ResolvedInspectionAttempt>();
      let unresolvedAttemptCount = 0;
      let plannedAttemptCount = 0;
      let recordedAttemptCount = 0;
      const origins = new Map<string, { readonly origin: LoadedInspectionRun; readonly attempts: ReadonlyMap<string, LoadedInspectionRun["attempts"][number]> }>(selected.map((origin) => [origin.run.runId, {
        origin, attempts: new Map(origin.attempts.map((attempt) => [attempt.attemptId, attempt])),
      }]));
      for (const cell of experimentCells) {
        for (const member of cell.members) {
          plannedAttemptCount++;
          if (member.publication.state !== "published") { unresolvedAttemptCount++; continue; }
          const identity = member.publication;
          const indexed = origins.get(identity.originRunId);
          const origin = indexed?.origin;
          const attempt = indexed?.attempts.get(identity.attemptId);
          if (origin === undefined || attempt === undefined) { unresolvedAttemptCount++; continue; }
          const resolved: ResolvedInspectionAttempt = Object.freeze({ origin, attempt,
            locator: encodeAttemptLocator(attempt.attemptId), targets: Object.freeze([]) });
          recordedAttemptCount++;
          usageAttempts.set(`${resolved.attempt.originRunId}\u0000${resolved.attempt.attemptId}`, resolved);
        }
      }
      const orderedUsageAttempts = [...usageAttempts.values()].sort((left, right) =>
        left.attempt.originRunId.localeCompare(right.attempt.originRunId) || left.locator.localeCompare(right.locator));
      const metadata = resultMetadata(source, operation.kind, selected, [], [], locators(selected));
      const allAttempts = Object.freeze(orderedUsageAttempts.map((resolved) => {
        const { state, configuredModels, modelGroups, judgeUsage, totalCosts, totals } = projectAttemptUsage(traceAttachments(resolved));
        return Object.freeze({
          locator: resolved.locator,
          originRunId: resolved.attempt.originRunId,
          usage: Object.freeze({ state, configuredModels, modelGroups, judgeUsage: summarizeJudgeUsage(judgeUsage), totalCosts, totals }),
        });
      }));
      const costSummary = Object.freeze({
        scope: "latest-recorded-attempts" as const,
        totalCosts: combineTotalUsageCosts(allAttempts.map(({ usage }) => usage.totalCosts), unresolvedAttemptCount > 0),
        coverage: Object.freeze({ plannedAttemptCount, recordedAttemptCount,
          originAttemptCount: allAttempts.length,
          completeAttemptCount: allAttempts.filter(({ usage }) => usage.totalCosts.state === "complete").length,
          partialAttemptCount: allAttempts.filter(({ usage }) => usage.totalCosts.state === "partial").length,
          unavailableAttemptCount: allAttempts.filter(({ usage }) => usage.totalCosts.state === "unavailable").length,
          missingAttemptCount: unresolvedAttemptCount }),
      });
      let attempts = Object.freeze(allAttempts.slice(0, 64));
      const notes = aggregateAttemptNotes(orderedUsageAttempts);
      const experimentResult = () => Object.freeze({
        experiment, cells: experimentCells, costSummary,
        notes,
        modelUsage: Object.freeze({
          attempts, totalAttemptCount: orderedUsageAttempts.length,
          omittedAttemptCount: orderedUsageAttempts.length - attempts.length,
          unresolvedAttemptCount,
        }),
      });
      while (utf8ByteLength(JSON.stringify({ ...metadata, experiment: experimentResult() })) > INSPECTION_EXPERIMENT_RESULT_BYTE_LIMIT &&
        attempts.length > 0) {
        attempts = Object.freeze(attempts.slice(0, -1));
      }
      return requireInspectionResultBudget(operation.kind, Object.freeze({
        ...metadata,
        experiment: decodeRequiredResult(
          operation.kind,
          InspectionExperimentResultSchema,
          experimentResult(),
        ),
      }));
    }
    case "run.list": return runsListDocument(source, operation);
    case "run.get": {
      const run = requireRunResource(source, operation.kind, operation.runId);
      const supporting = supportingRunFacts(source, run);
      return Object.freeze({
        ...runResourceMetadata(source, operation.kind, run, supporting),
        run: decodeRequiredResult(operation.kind, InspectionRunResultSchema, runDetail(supporting, run)),
      });
    }
    case "attempt.get": {
      const resolved = requireAttemptFromSource(source, operation.kind, operation.locator);
      return Object.freeze({
        ...resultMetadata(source, operation.kind, attemptRuns(resolved), [], [], [operation.locator]),
        attempt: decodeRequiredResult(
          operation.kind,
          InspectionAttemptResultSchema,
          attemptDetail(resolved),
        ),
      });
    }
    case "attempt.assertion.detail": {
      const resolved = requireAttemptFromSource(source, operation.kind, operation.locator);
      const assertions = readInspectionAssertions(resolved);
      const assertion = projectAttemptAssertionDetail(
        source,
        assertions,
        readInspectionAgentTurns(traceAttachments(resolved).agentTurns),
        operation.entryId,
        operation.projection,
      );
      if (assertion === undefined) {
        throw selectionMissing(
          operation.kind,
          `Assertion ${operation.entryId} was not found`,
        );
      }
      return Object.freeze({
        ...baseDocument(source, operation.kind, attemptRuns(resolved), [], [], [operation.locator]),
        assertion: boundedJson(assertion, INSPECTION_ASSERTION_DETAIL_BYTE_LIMIT),
      });
    }
    case "attempt.assertion.image": {
      const resolved = requireAttemptFromSource(source, operation.kind, operation.locator);
      const image = projectAttemptAssertionImage(source, readInspectionAssertions(resolved), operation.entryId, operation.imageId,
        operation.offset ?? 0, operation.limit ?? 256 * 1024);
      if (image === undefined) throw selectionMissing(operation.kind, `Assertion ${operation.entryId} was not found`);
      return Object.freeze({ ...baseDocument(source, operation.kind, attemptRuns(resolved), [], [], [operation.locator]), image });
    }
    case "attempt.trace": {
      const resolved = requireAttemptFromSource(source, operation.kind, operation.locator);
      return Object.freeze({
        ...resultMetadata(source, operation.kind, attemptRuns(resolved), [], [], [operation.locator]),
        trace: decodeRequiredResult(
          operation.kind,
          InspectionTraceResultSchema,
          projectAttemptTrace(
            resolved.origin.source,
            traceAttachments(resolved),
            projectExecutionTraceOutline(source, resolved, {
              ...(operation.traceId === undefined ? {} : { traceId: operation.traceId }),
              ...(operation.sourceId === undefined ? {} : { sourceId: operation.sourceId }),
              ...(operation.actorId === undefined ? {} : { actorId: operation.actorId }),
              ...(operation.eventType === undefined ? {} : { eventType: operation.eventType }),
              ...(operation.continuation === undefined ? {} : { continuation: operation.continuation }),
            }),
            {
              ...(operation.traceId === undefined ? {} : { traceId: operation.traceId }),
              ...(operation.sourceId === undefined ? {} : { sourceId: operation.sourceId }),
              ...(operation.actorId === undefined ? {} : { actorId: operation.actorId }),
              ...(operation.eventType === undefined ? {} : { eventType: operation.eventType }),
              ...(operation.continuation === undefined ? {} : { continuation: operation.continuation }),
            },
          ),
        ),
      });
    }
    case "attempt.trace.detail": {
      const resolved = requireAttemptFromSource(source, operation.kind, operation.locator);
      let detail = operation.selector.kind === "execution-event" || operation.selector.kind === "execution-evidence"
        ? projectExecutionTraceDetail(resolved, operation.selector)
        : projectAttemptTraceDetail(
            resolved.origin.source,
            traceAttachments(resolved),
            operation.selector,
          );
      if (detail === undefined && operation.selector.kind === "execution-event") {
        type ItemSelector = Extract<
          Parameters<typeof projectAttemptTraceDetail>[2],
          { readonly kind: "item" }
        >;
        detail = projectAttemptTraceDetail(
          resolved.origin.source,
          traceAttachments(resolved),
          { kind: "item", itemId: operation.selector.eventId as ItemSelector["itemId"] },
        );
      }
      if (detail === undefined) {
        throw selectionMissing(
          operation.kind,
          "Trace detail identity was not found",
        );
      }
      return Object.freeze({
        ...resultMetadata(source, operation.kind, attemptRuns(resolved), [], [], [operation.locator]),
        detail: decodeRequiredResult(
          operation.kind,
          InspectionTraceDetailResultSchema,
          detail,
        ),
      });
    }
    case "attempt.timing": {
      const resolved = requireAttemptFromSource(source, operation.kind, operation.locator);
      return Object.freeze({
        ...resultMetadata(source, operation.kind, attemptRuns(resolved), [], [], [operation.locator]),
        timing: decodeRequiredResult(
          operation.kind,
          InspectionAttemptTimingResultSchema,
          projectAttemptTiming(traceAttachments(resolved)),
        ),
      });
    }
    case "attempt.reprice": {
      const resolved = requireAttemptFromSource(source, operation.kind, operation.locator);
      return requireInspectionResultBudget(operation.kind, Object.freeze({
        ...resultMetadata(source, operation.kind, attemptRuns(resolved), [], [], [operation.locator]),
        repricing: decodeRequiredResult(operation.kind, InspectionRepricingResultSchema,
          projectAttemptRepricing(traceAttachments(resolved), operation.pricing)),
      }));
    }
    case "attempt.usage": {
      const resolved = requireAttemptFromSource(source, operation.kind, operation.locator);
      const metadata = resultMetadata(source, operation.kind, attemptRuns(resolved), [], [], [operation.locator]);
      let usage = projectAttemptUsage(traceAttachments(resolved));
      while (utf8ByteLength(JSON.stringify({ ...metadata, usage })) > INSPECTION_ATTEMPT_USAGE_RESULT_BYTE_LIMIT &&
        (usage.judgeUsage.state === "complete" || usage.judgeUsage.state === "partial") && usage.judgeUsage.calls.length > 0) {
        usage = Object.freeze({ ...usage,
          judgeUsage: takeJudgeUsagePreview(usage.judgeUsage, usage.judgeUsage.calls.length - 1) });
      }
      return requireInspectionResultBudget(operation.kind, Object.freeze({
        ...metadata,
        usage: decodeRequiredResult(
          operation.kind,
          InspectionAttemptUsageResultSchema,
          usage,
        ),
      }));
    }
    case "attempt.diff": {
      const resolved = requireAttemptFromSource(source, operation.kind, operation.locator);
      return Object.freeze({
        ...resultMetadata(source, operation.kind, attemptRuns(resolved), [], [], [operation.locator]),
        diff: decodeRequiredResult(
          operation.kind,
          InspectionAttemptDiffResultSchema,
          projectAttemptDiff(attemptAttachment(
            resolved,
            NiceEvalRecordAttachments.fileChanges.family,
          )),
        ),
      });
    }
    case "attempt.sources": {
      const resolved = requireAttemptFromSource(source, operation.kind, operation.locator);
      return Object.freeze({
        ...resultMetadata(source, operation.kind, attemptRuns(resolved), [], [], [operation.locator]),
        sources: decodeRequiredResult(
          operation.kind,
          InspectionSourcesResultSchema,
          projectAttemptSources(
            resolved.origin.source,
            runAttachment(resolved.origin, NiceEvalRecordAttachments.sources.family),
            readInspectionAssertions(resolved),
          ),
        ),
      });
    }
    case "attempt.artifact": {
      const resolved = requireAttemptFromSource(source, operation.kind, operation.locator);
      const projected = projectAttemptArtifact(resolved, {
        artifactId: operation.artifactId,
        ...(operation.offset === undefined ? {} : { offset: operation.offset }),
        ...(operation.limit === undefined ? {} : { limit: operation.limit }),
      });
      if (Result.isFailure(projected)) throw new InspectionOperationError({
        code: projected.failure.code, operation: operation.kind, reason: projected.failure.reason,
      });
      return Object.freeze({
        ...baseDocument(source, operation.kind, attemptRuns(resolved), [], [], [operation.locator]),
        artifact: boundedJson(projected.success),
      });
    }
    case "attempt.artifacts": {
      const resolved = requireAttemptFromSource(source, operation.kind, operation.locator);
      const attachment = attemptAttachment(resolved, NiceEvalRecordAttachments.artifacts.attempt.family);
      const projected = attachment === undefined ? undefined : projectArtifactsListing(attachment);
      if (projected !== undefined && Result.isFailure(projected)) throw new InspectionOperationError({
        code: "inspection-record-integrity-failure", operation: operation.kind,
        reason: projected.failure.reason, identity: { runId: resolved.attempt.originRunId },
      });
      const value = projected?.success;
      const offset = operation.offset ?? 0;
      const limit = operation.limit ?? 128;
      const total = value?.artifacts.length ?? 0;
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > total ||
        !Number.isSafeInteger(limit) || limit < 1 || limit > 128) throw new InspectionOperationError({
        code: "inspection-request-invalid", operation: operation.kind,
        reason: "Artifact listing requires an offset within the collection and a limit from 1 to 128.",
      });
      const metadata = baseDocument(source, operation.kind, attemptRuns(resolved), [], [], [operation.locator]);
      if (attachment === undefined || value === undefined) return Object.freeze({
        ...metadata, artifacts: Object.freeze({ state: "not-recorded" as const }),
      });
      let items = value.artifacts.slice(offset, offset + limit);
      const page = () => Object.freeze({
        state: "available" as const,
        value: Object.freeze({ collection: value.collection, artifacts: items }),
        collection: Object.freeze({
          state: offset + items.length < total ? "bounded-page" as const : "complete-page" as const,
          items,
          hasMore: offset + items.length < total,
          nextOffset: offset + items.length < total ? offset + items.length : null,
          total,
        }),
        contents: attachment.physical.contents
          .slice(0, ATTACHMENT_CONTENT_METADATA_LIMIT)
          .map(({ logicalHandle, byteLength, digest }) => Object.freeze({ logicalHandle, byteLength, digest })),
        contentsTruncated: attachment.physical.contents.length > ATTACHMENT_CONTENT_METADATA_LIMIT,
      });
      let artifacts = page();
      // Both public arrays share the page; long labels also consume the fixed JSON budget twice.
      while (items.length > 0 && (utf8ByteLength(JSON.stringify(items)) > 128 * 1024 ||
        utf8ByteLength(JSON.stringify(artifacts)) > INSPECTION_RESULT_BYTE_LIMIT)) {
        items = items.slice(0, -1);
        artifacts = page();
      }
      if (items.length === 0 && offset < total) throw new InspectionOperationError({
        code: "inspection-result-invalid", operation: operation.kind,
        reason: "Artifact metadata cannot fit in the Inspection result byte limit.",
      });
      return Object.freeze({ ...metadata, artifacts: boundedJson(artifacts) });
    }
    case "runs.compare": {
      const selected = loadRuns(source, [...operation.leftRunIds, ...operation.rightRunIds]);
      return comparisonDocument(source, loadReferencedOrigins(source, selected), operation);
    }
  }
}

function runsListExplanation(
  source: InspectionFactSource,
  operation: Extract<InspectionOperation, { readonly kind: "run.list" }>,
): unknown {
  const page = runSummaryPage(source, operation.continuation);
  return Object.freeze({
    ...runsListBase(source, source.cutoff(), page.items, page.truncated),
    outcome: "explanation" as const,
    factKinds: inspectionProtocolRegistry[operation.kind].factKinds,
    ...(page.continuation === undefined ? {} : { continuation: page.continuation }),
  });
}

function runsListDocument(
  source: InspectionFactSource,
  operation: Extract<InspectionOperation, { readonly kind: "run.list" }>,
): unknown {
  const page = runSummaryPage(source, operation.continuation);
  return Object.freeze({
    ...runsListBase(source, source.cutoff(), page.items, page.truncated),
    runs: closeJson(page.items),
    ...(page.continuation === undefined ? {} : { continuation: page.continuation }),
  });
}

function runSummaryPage(source: InspectionFactSource, continuation: string | undefined) {
  const binding = continuation === undefined ? undefined : decodeContinuation(continuation);
  const cutoff = source.cutoff();
  let page: RunResourcePage;
  try {
    if (binding !== undefined && binding.cutoffIdentity !== cutoff.identity) throw new Error("Publication cutoff changed");
    page = source.readRunResourcePage(
      binding?.afterRunId ?? "",
      RUN_LIST_PAGE_SIZE,
    );
  } catch (cause) {
    throw operationFailure(
      "run.list",
      "Continuation is invalid or its publication cutoff changed; restart run.list",
      cause,
    );
  }
  return Object.freeze({
    cutoff,
    items: Object.freeze(page.runs.map((run): RunSummary => Object.freeze({
      runId: run.runId,
      invocationId: run.invocationId,
      experimentId: run.experimentId,
      state: run.state,
      startedAt: run.startedAt,
      ...(run.completedAt === undefined ? {} : { completedAt: run.completedAt }),
      coverage: Object.freeze({ expected: run.expected, published: run.published, missing: run.missing }),
    }))),
    truncated: page.nextAfterRunId !== null,
    continuation: page.nextAfterRunId === null
      ? undefined
      : encodeContinuation(page.nextAfterRunId, cutoff.identity),
  });
}

function runsListBase(
  source: InspectionFactSource,
  cutoff: ReturnType<InspectionFactSource["cutoff"]>,
  selected: readonly RunSummary[],
  truncated: boolean,
) {
  return Object.freeze({
    protocol: QUERY_PROTOCOL,
    behaviorVersion: INSPECTION_BEHAVIOR_VERSION,
    outcome: "success" as const,
    operation: "run.list" as const,
    source: sourceProvenance(source, cutoff),
    publicationCutoff: Object.freeze({
      storeGeneration: cutoff.storeGeneration,
      revision: cutoff.revision,
    }),
    selection: Object.freeze({
      requestedRunIds: Object.freeze([]),
      selectedRunIds: Object.freeze(selected.map(({ runId }) => runId)),
      missingRunIds: Object.freeze([]),
      returnedRunCount: selected.length,
      truncated,
    }),
    issues: Object.freeze([]),
    evidence: Object.freeze({ refs: Object.freeze([]) }),
  });
}

function encodeContinuation(afterRunId: string, cutoffIdentity: string): string {
  return encodeBase64UrlUtf8(JSON.stringify([
    "run.list",
    cutoffIdentity,
    afterRunId,
  ]));
}

function decodeContinuation(token: string): {
  readonly cutoffIdentity: string;
  readonly afterRunId: string;
} {
  try {
    const decoded = JSON.parse(decodeBase64UrlUtf8(token)) as unknown;
    if (!Array.isArray(decoded) || decoded.length !== 3 || decoded[0] !== "run.list" ||
      typeof decoded[1] !== "string" || typeof decoded[2] !== "string") {
      throw new Error("continuation binding changed");
    }
    return Object.freeze({ cutoffIdentity: decoded[1], afterRunId: decoded[2] });
  } catch (cause) {
    throw operationFailure(
      "run.list",
      "Continuation is invalid or its sealed cutoff changed; restart run.list",
      cause,
    );
  }
}

function loadForOperation(source: InspectionFactSource, operation: InspectionOperation): {
  readonly selected: readonly LoadedInspectionRun[];
  readonly requestedRunIds: readonly string[];
  readonly missingRunIds: readonly string[];
} {
  if (operation.kind === "project.get") return { selected: requireCurrentProject(source, operation.experimentIds).runs, requestedRunIds: [], missingRunIds: [] };
  if (operation.kind === "overview.get") {
    const requested = operation.runIds ?? [];
    if (requested.length === 0) return { selected: loadInspectionRuns(source), requestedRunIds: [], missingRunIds: [] };
    const selection = selectRuns(loadRuns(source, requested), requested);
    return {
      selected: loadReferencedOrigins(source, selection.selected),
      requestedRunIds: requested,
      missingRunIds: selection.missing,
    };
  }
  if (operation.kind === "experiments.assertions") {
    const ids = [...new Set(operation.experimentIds)].sort();
    for (const id of ids) if (source.findExperimentRunIds(id).length === 0) throw selectionMissing(operation.kind, `Experiment ${id} was not found`);
    return { selected: loadReferencedOrigins(source, loadSelectedInspectionRuns(source, [...new Set(ids.flatMap((id) => source.findExperimentRunIds(id)))])), requestedRunIds: [], missingRunIds: [] };
  }
  if (operation.kind === "experiment.get") {
    return { selected: loadReferencedOrigins(source, loadSelectedInspectionRuns(source,
      source.findExperimentRunIds(operation.experimentId))), requestedRunIds: [], missingRunIds: [] };
  }
  if (operation.kind === "run.list") return { selected: [], requestedRunIds: [], missingRunIds: [] };
  if (operation.kind === "runs.compare") {
    const requested = Object.freeze([...operation.leftRunIds, ...operation.rightRunIds]);
    const selected = selectRuns(loadRuns(source, requested), requested);
    return {
      selected: loadReferencedOrigins(source, selected.selected),
      requestedRunIds: requested,
      missingRunIds: selected.missing,
    };
  }
  if ("runId" in operation) {
    const selected = selectRuns(loadRuns(source, [operation.runId]), [operation.runId]);
    requireOne(operation.kind, selected.selected, operation.runId);
    return {
      selected: loadSummaryFacts(source, selected.selected[0]!),
      requestedRunIds: [operation.runId],
      missingRunIds: selected.missing,
    };
  }
  const resolved = requireAttemptFromSource(source, operation.kind, operation.locator);
  return {
    selected: attemptRuns(resolved),
    requestedRunIds: Object.freeze([]),
    missingRunIds: Object.freeze([]),
  };
}

function requireCurrentProject(source: InspectionFactSource, experimentIds?: readonly string[]): FrozenProjectInput {
  const input = projectInput(source);
  if (source.kind !== "project-record" || input === undefined || input.cutoffIdentity !== source.cutoff().identity) throw new InspectionOperationError({
    code: "current-target-unavailable", operation: "project.get",
    reason: "Current project declarations are unavailable. Use overview.get or an exact run.get to read recorded results.",
  });
  for (const id of experimentIds ?? []) if (!input.target.experiments.some((experiment) => experiment.experimentId === id)) throw selectionMissing("project.get", `Current Experiment ${JSON.stringify(id)} was not found.`);
  return input;
}

function loadRuns(
  source: InspectionFactSource,
  runIds: readonly string[],
): readonly LoadedInspectionRun[] {
  const uniqueRunIds = [...new Set(runIds)];
  if (uniqueRunIds.length > RUN_SELECTION_LIMIT) {
    throw new Error(`Inspection selection exceeds the fixed ${RUN_SELECTION_LIMIT}-Run limit`);
  }
  return loadSelectedInspectionRuns(source, uniqueRunIds);
}

function requireRunResource(
  source: InspectionFactSource,
  operation: InspectionOperationId,
  runId: string,
): LoadedInspectionRunResource {
  const run = loadInspectionRunResource(source, runId);
  if (run === undefined) throw selectionMissing(operation, `Run ${runId} was not found`);
  return run;
}

function inspectionRunValue(run: LoadedInspectionRunResource): InspectionRunValue {
  const { resource, published } = run;
  return decodeRequiredResult("run.get", InspectionRunValueSchema, Object.freeze({
    runId: resource.runId,
    experimentId: resource.experimentId,
    state: resource.state,
    ...(resource.published > 0 && published !== undefined
      ? { context: published.run.context }
      : {}),
    startedAt: Date.parse(resource.startedAt),
    ...(resource.completedAt === undefined
      ? {}
      : { completedAt: Date.parse(resource.completedAt) }),
    plannedAttempts: (published?.run.expectedSlots ?? resource.slots.map((slot) => Object.freeze({
      slotId: slot.slotId,
      evalId: slot.evalId,
      attemptOrdinal: slot.attemptOrdinal,
      executionIdentityDigest: slot.executionIdentityDigest,
    }))).map(projectPlannedAttempt),
  }));
}

function supportingRunFacts(
  _source: InspectionFactSource,
  run: LoadedInspectionRunResource,
): readonly LoadedInspectionRun[] {
  return run.supporting;
}

function runResourceMetadata<Kind extends InspectionOperationId>(
  source: InspectionFactSource,
  operation: Kind,
  run: LoadedInspectionRunResource,
  supporting: readonly LoadedInspectionRun[],
): InspectionResultMetadata<Kind> {
  const metadata = resultMetadata(
    source,
    operation,
    supporting,
    [run.resource.runId],
    [],
    locators(supporting),
  );
  return Object.freeze({
    ...metadata,
    selection: Object.freeze({
      ...metadata.selection,
      selectedRunIds: Object.freeze([run.resource.runId]),
    }),
  });
}

function runResourceBaseDocument(
  source: InspectionFactSource,
  operation: InspectionOperationId,
  run: LoadedInspectionRunResource,
  supporting: readonly LoadedInspectionRun[],
) {
  const document = baseDocument(
    source,
    operation,
    supporting,
    [run.resource.runId],
    [],
    locators(supporting),
  );
  return Object.freeze({
    ...document,
    selection: Object.freeze({
      ...document.selection,
      selectedRunIds: Object.freeze([run.resource.runId]),
    }),
  });
}

function loadReferencedOrigins(
  source: InspectionFactSource,
  targets: readonly LoadedInspectionRun[],
): readonly LoadedInspectionRun[] {
  const targetIds = new Set(targets.map(({ run }) => run.runId));
  const originIds = [...new Set(targets.flatMap(({ members }) => members.flatMap(({ attempt }) =>
    attempt === null || targetIds.has(attempt.originRunId) ? [] : [attempt.originRunId])))];
  return uniqueRuns([...targets, ...loadRuns(source, originIds)]);
}

function loadSummaryFacts(
  source: InspectionFactSource,
  target: LoadedInspectionRun,
): readonly LoadedInspectionRun[] {
  return loadReferencedOrigins(source, [target]);
}

function parseJson(bytes: Uint8Array): unknown {
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
}

function selectRuns(
  all: readonly LoadedInspectionRun[],
  runIds: readonly string[],
) {
  const byId = new Map<string, LoadedInspectionRun>(
    all.map((run) => [run.run.runId, run]),
  );
  const requested = [...new Set(runIds)];
  return Object.freeze({
    selected: Object.freeze(requested.flatMap((runId) => {
      const run = byId.get(runId);
      return run === undefined ? [] : [run];
    })),
    missing: Object.freeze(requested.filter((runId) => !byId.has(runId))),
  });
}

function requireOne(
  operation: InspectionOperationId,
  selected: readonly LoadedInspectionRun[],
  runId: string,
): LoadedInspectionRun {
  const run = selected[0];
  if (run === undefined) {
    throw selectionMissing(operation, `Run ${runId} was not found`);
  }
  return run;
}

function requireAttemptFromSource(
  source: InspectionFactSource,
  operation: InspectionOperationId,
  locator: string,
): ResolvedInspectionAttempt {
  const resolved = resolveInspectionAttempt(source, locator);
  if (resolved === undefined) {
    throw selectionMissing(
      operation,
      `Attempt ${locator} was not found or is ambiguous`,
    );
  }
  return resolved;
}

function attemptRuns(
  resolved: ResolvedInspectionAttempt,
): readonly LoadedInspectionRun[] {
  return uniqueRuns([resolved.origin, ...resolved.targets.map(({ run }) => run)]);
}

function traceAttachments(
  resolved: ResolvedInspectionAttempt,
): AttemptTraceAttachments {
  return Object.freeze({
    models: resolved.origin.run.context.execution.models,
    adapterUsage: attemptAttachment(resolved, NiceEvalRecordAttachments.adapterUsage.family),
    judgeUsage: attemptAttachment(resolved, NiceEvalRecordAttachments.judgeUsage.family),
    agentTurns: attemptAttachment(resolved, NiceEvalRecordAttachments.agentTurns.family),
    turnContexts: attemptAttachment(resolved, NiceEvalRecordAttachments.turnContexts.family),
    sandboxCommands: attemptAttachment(resolved, NiceEvalRecordAttachments.sandboxCommands.family),
    runnerActivities: attemptAttachment(
      resolved,
      NiceEvalRecordAttachments.runnerActivities.attempt.family,
    ),
    runnerDiagnostics: attemptAttachment(
      resolved,
      NiceEvalRecordAttachments.runnerDiagnostics.attempt.family,
    ),
  });
}

function attachmentValue(
  resolved: ResolvedInspectionAttempt,
  family: string,
): InspectionJson {
  const attachment = attemptAttachment(resolved, family);
  return attachment === undefined
    ? Object.freeze({ state: "not-recorded" })
    : Object.freeze({
        state: "available",
        value: attachment.value,
        collection: attachmentCollectionPage(resolved.origin.source, attachment),
      });
}

function runAttachmentValue(
  run: LoadedInspectionRun,
  family: string,
): InspectionJson {
  const attachment = runAttachment(run, family);
  return attachment === undefined
    ? Object.freeze({ state: "not-recorded" })
    : Object.freeze({
        state: "available",
        value: attachment.value,
        collection: attachmentCollectionPage(run.source, attachment),
      });
}

function attachmentCollectionPage(
  source: InspectionFactSource,
  attachment: DecodedInspectionAttachment,
): InspectionJson {
  const page = source.readCollectionPage(
    attachment.physical.attachmentId,
    -1,
    ATTACHMENT_COLLECTION_PAGE_SIZE,
  );
  return closeJson(Object.freeze({
    state: page.nextOrdinal === null ? "complete-page" : "bounded-page",
    items: Object.freeze(page.items.map((item) => closeJson(parseJson(item.canonicalBytes)))),
    hasMore: page.nextOrdinal !== null,
  }));
}

/**
 * Query keeps one leading and one decisive matcher representative. The full
 * durable artifact remains available in the Record, while attempt.get stays a
 * bounded AI-facing overview instead of duplicating attempt.trace-sized data.
 */
function compactAssertionInspection(value: InspectionJson): InspectionJson {
  if (Array.isArray(value)) return Object.freeze(value.map(compactAssertionInspection));
  if (typeof value !== "object" || value === null) return value;
  const output: Record<string, InspectionJson> = {};
  for (const [key, entry] of Object.entries(value)) {
    if ((key === "retainedRows" || key === "representatives") && Array.isArray(entry) && entry.length > 2) {
      output[key] = Object.freeze([
        compactAssertionInspection(entry[0]!),
        compactAssertionInspection(entry[entry.length - 1]!),
      ]);
    } else {
      output[key] = compactAssertionInspection(entry);
    }
  }
  return Object.freeze(output);
}

function attemptDetail(resolved: ResolvedInspectionAttempt): InspectionAttemptResult {
  const assertions = readInspectionAssertions(resolved);
  return Object.freeze({
    core: projectAttemptCore(resolved.attempt),
    locator: resolved.locator,
    originRun: projectRunCore(resolved.origin.run),
    targets: resolved.targets.map(({ run, member }) => Object.freeze({ runId: run.run.runId, member: projectMember(member) })),
    evidence: assertions.state === "available"
      ? Object.freeze({
          state: "available" as const,
          entryCount: assertions.value.entries.length,
          sourceSiteCount: assertions.value.sourceSites.length,
        })
      : Object.freeze({
          state: assertions.state,
          entryCount: 0 as const,
        }),
    notes: readAttemptNotes(resolved),
    assertions: assertionIndex(assertions),
    sections: attemptSections(resolved),
    verdict: attemptVerdict(resolved, assertions),
    score: assertionScore(
      assertions.state === "available" ? assertions.value.entries : [],
    ),
    evidenceCoverage: attemptEvidenceCoverage(resolved),
    limitations: attemptLimitations(
      resolved,
      assertions.state === "available" ? assertions.value.entries : [],
    ),
  });
}

function assertionIndex(
  assertions: ReturnType<typeof readInspectionAssertions>,
): InspectionAttemptResult["assertions"] {
  if (assertions.state !== "available") {
    return Object.freeze({
      state: assertions.state === "not-recorded" ? "not-recorded" : "invalid",
      entries: Object.freeze([]),
    });
  }
  return Object.freeze({
    state: "available",
    entries: Object.freeze(assertions.value.entries.map((entry) => Object.freeze({
      entryId: entry.entryId,
      display: Object.freeze({
        ...(entry.display.label === undefined ? {} : { label: entry.display.label }),
        groupPath: Object.freeze([...entry.display.groupPath]),
      }),
    }))),
  });
}

type AttemptSectionState = "available" | "not-recorded" | "partial" | "unavailable";

function attemptSections(
  resolved: ResolvedInspectionAttempt,
): InspectionAttemptResult["sections"] {
  const assertions = attachmentSectionState(
    attemptAttachment(resolved, NiceEvalRecordAttachments.assertions.family),
    NiceEvalCurrentRecordAttachments.assertions.revision,
  );
  const conversation = attachmentSectionState(
    attemptAttachment(resolved, NiceEvalRecordAttachments.agentTurns.family),
    NiceEvalCurrentRecordAttachments.agentTurns.revision,
  );
  const executionTraces = attachmentSectionState(
    attemptAttachment(resolved, NiceEvalRecordAttachments.executionTraces.family),
    NiceEvalCurrentRecordAttachments.executionTraces.revision,
  );
  const commands = attachmentSectionState(
    attemptAttachment(resolved, NiceEvalRecordAttachments.sandboxCommands.family),
    NiceEvalCurrentRecordAttachments.sandboxCommands.revision,
  );
  const timing = attachmentSectionState(
    attemptAttachment(resolved, NiceEvalRecordAttachments.runnerActivities.attempt.family),
    NiceEvalCurrentRecordAttachments.runnerActivities.attempt.revision,
  );
  const diagnostics = attachmentSectionState(
    attemptAttachment(resolved, NiceEvalRecordAttachments.runnerDiagnostics.attempt.family),
    NiceEvalCurrentRecordAttachments.runnerDiagnostics.attempt.revision,
  );
  const sources = attachmentSectionState(
    runAttachment(resolved.origin, NiceEvalRecordAttachments.sources.family),
    NiceEvalCurrentRecordAttachments.sources.revision,
  );
  const diff = attachmentSectionState(
    attemptAttachment(resolved, NiceEvalRecordAttachments.fileChanges.family),
    NiceEvalCurrentRecordAttachments.fileChanges.revision,
  );
  const artifacts = attachmentSectionState(
    attemptAttachment(resolved, NiceEvalRecordAttachments.artifacts.attempt.family),
    NiceEvalCurrentRecordAttachments.artifacts.attempt.revision,
  );
  return Object.freeze({
    assertions: Object.freeze({ state: assertions }),
    trace: Object.freeze({ state: combineSectionStates([executionTraces, conversation, commands, timing, diagnostics]) }),
    sources: Object.freeze({ state: sources }),
    diff: Object.freeze({ state: diff }),
    artifacts: Object.freeze({ state: artifacts }),
    timing: Object.freeze({ state: timing }),
    usage: Object.freeze({ state: attemptAttachment(resolved, NiceEvalRecordAttachments.adapterUsage.family) === undefined
      ? conversation
      : attachmentSectionState(
          attemptAttachment(resolved, NiceEvalRecordAttachments.adapterUsage.family),
          NiceEvalCurrentRecordAttachments.adapterUsage.revision,
        ) }),
    conversation: Object.freeze({ state: conversation }),
    commands: Object.freeze({ state: commands }),
    diagnostics: Object.freeze({ state: diagnostics }),
  });
}

function attachmentSectionState(
  attachment: DecodedInspectionAttachment | undefined,
  currentRevision: number,
): AttemptSectionState {
  if (attachment === undefined) return "not-recorded";
  if (attachment.physical.familyRevision !== currentRevision) return "unavailable";
  return containsState(attachment.value, "partial") ? "partial" : "available";
}

function combineSectionStates(states: readonly AttemptSectionState[]): AttemptSectionState {
  if (states.some((state) => state === "partial")) return "partial";
  if (states.some((state) => state === "available")) return "available";
  if (states.some((state) => state === "unavailable")) return "unavailable";
  return "not-recorded";
}

function containsState(value: InspectionJson, expected: string): boolean {
  if (Array.isArray(value)) return value.some((entry) => containsState(entry, expected));
  if (typeof value !== "object" || value === null) return false;
  const record = value as Readonly<Record<string, InspectionJson>>;
  return record.state === expected || Object.values(record).some((entry) => containsState(entry, expected));
}

function runDetail(
  _all: readonly LoadedInspectionRun[],
  selectedResource: LoadedInspectionRunResource,
): InspectionRunResult {
  type Member = InspectionRunResult["plannedAttempts"][number];
  type Usage = ReturnType<typeof projectAttemptUsage>;
  const selected = selectedResource.published;
  const diagnosticRead = readCurrentAttachment(
    NiceEvalCurrentRecordAttachments.runnerDiagnostics.run,
    selected === undefined ? undefined : runAttachment(selected, NiceEvalRecordAttachments.runnerDiagnostics.run.family),
  );
  if (diagnosticRead.state === "invalid") {
    throw new InspectionOperationError({
      code: "inspection-result-invalid",
      operation: "run.get",
      reason: diagnosticRead.issues.join(", "),
    });
  }
  const diagnostics = diagnosticRead.state === "available"
    ? diagnosticRead.value.segments.map((diagnostic) => Object.freeze({
        diagnosticId: diagnostic.diagnosticId,
        code: diagnostic.code,
        phase: projectLifecyclePhase(diagnostic.phase),
        summary: diagnostic.summary,
        affectedPlannedAttemptIds: diagnostic.affectedSlotIds ?? Object.freeze([]),
      }))
    : Object.freeze([]);
  const value = inspectionRunValue(selectedResource);
  const publications = new Map(selectedResource.resource.slots.map((slot) => [slot.slotId, slot.publication]));
  const bindings = new Map(selectedResource.members.map((member) => [member.slotId, member]));
  const unavailableUsage = (): Member["usage"] => Object.freeze({
    state: "unavailable",
    summary: null,
    totals: unavailableInspectionUsageTotals(),
    limitations: Object.freeze([]),
    limitationsTruncated: false,
    omittedLimitationCount: 0,
  });
  const unavailableCoverage = (): Member["coverage"] => Object.freeze({
    state: "unavailable",
    facts: Object.freeze([]),
    limitations: Object.freeze([]),
  });
  const projected = value.plannedAttempts.map((slot): {
    readonly member: Member;
    readonly usage?: Usage;
  } => {
    const binding = publications.get(slot.plannedAttemptId);
    if (binding === undefined) throw new Error(`Run ${value.runId} has no Planned attempt ${slot.plannedAttemptId}`);
    const publication: Member["publication"] = binding.state === "published"
      ? Object.freeze({
          state: "published", action: binding.action, attemptId: binding.attemptId,
          attemptLocator: binding.attemptLocator, originRunId: binding.originRunId, originPlannedAttemptId: binding.originSlotId,
        })
      : binding.state === "absent"
        ? Object.freeze({ state: "absent", reason: binding.reason })
        : Object.freeze({ state: "pending" });
    const targetMember = bindings.get(slot.plannedAttemptId);
    const resolved = targetMember?.attempt == null
      ? undefined
      : resolveInspectionResourceMemberAttempt(selectedResource, targetMember);
    const metrics = projectPlannedAttemptMetrics(
      value.runId,
      { ...slot, slotId: slot.plannedAttemptId },
      targetMember,
      resolved,
    );
    if (targetMember === undefined) {
      if (publication.state !== "pending" && publication.state !== "absent") {
        throw new Error(`Terminal Run ${value.runId} has no binding or absence for Planned attempt ${slot.plannedAttemptId}`);
      }
      const limitation = Object.freeze({
        kind: "member-not-observed" as const,
        state: publication.state === "absent"
          ? publication.reason === "interrupted-before-publication" ? "interrupted" as const : "not-dispatched" as const
          : "pending" as const,
      });
      return Object.freeze({
        member: Object.freeze({
          ...slot,
          publication,
          ...metrics,
          state: limitation.state,
          relation: null,
          outcome: null,
          coverage: unavailableCoverage(),
          usage: unavailableUsage(),
          limitations: Object.freeze([limitation]),
        }),
      });
    }
    if (targetMember.attempt === null) {
      const limitation = Object.freeze({
        kind: "member-not-observed" as const,
        state: targetMember.action,
      });
      return Object.freeze({
        member: Object.freeze({
          ...slot,
          publication,
          ...metrics,
          state: targetMember.action,
          relation: null,
          outcome: null,
          coverage: unavailableCoverage(),
          usage: unavailableUsage(),
          limitations: Object.freeze([limitation]),
        }),
      });
    }
    if (resolved === undefined) {
      const limitation = Object.freeze({
        kind: "attempt-unresolved" as const,
        originRunId: targetMember.attempt.originRunId,
        attemptId: targetMember.attempt.attemptId,
      });
      return Object.freeze({
        member: Object.freeze({
          ...slot,
          publication,
          ...metrics,
          state: targetMember.action,
          relation: null,
          outcome: null,
          coverage: unavailableCoverage(),
          usage: unavailableUsage(),
          limitations: Object.freeze([limitation]),
        }),
      });
    }
    const assertions = readInspectionAssertions(resolved);
    const coverageFacts = attemptEvidenceCoverage(resolved);
    const coverageLimitations = attemptLimitations(
      resolved,
      assertions.state === "available" ? assertions.value.entries : [],
    );
    const coverageState: Member["coverage"]["state"] = assertions.state === "available"
      ? coverageLimitations.length === 0 && coverageFacts.every(({ status }) => status === "complete")
        ? "complete"
        : "partial"
      : coverageFacts.length > 0
        ? "partial"
        : assertions.state === "not-recorded"
          ? "not-recorded"
          : "invalid";
    const usage = projectAttemptUsage(traceAttachments(resolved));
    const memberLimitations: Member["limitations"] = Object.freeze([
      ...coverageLimitations.map((detail) => Object.freeze({ kind: "coverage" as const, detail })),
      ...usage.limitations.map((detail) => Object.freeze({ kind: "usage" as const, detail })),
    ]);
    return Object.freeze({
      usage,
      member: Object.freeze({
        ...slot,
        publication,
        ...metrics,
        state: targetMember.action,
        relation: resolved.attempt.originRunId === value.runId ? "origin" : "reference",
        outcome: resolved.attempt.outcome,
        coverage: Object.freeze({
          state: coverageState,
          facts: coverageFacts,
          limitations: coverageLimitations,
        }),
        usage: Object.freeze({
          state: usage.state,
          summary: usage.state === "complete" || usage.state === "partial"
            ? Object.freeze({
                turnCount: usage.turns.length + usage.omittedTurnCount,
                observationCount: usage.observations.length + usage.omittedObservationCount,
              })
            : null,
          totals: usage.totals,
          limitations: usage.limitations,
          limitationsTruncated: usage.limitationsTruncated,
          omittedLimitationCount: usage.omittedLimitationCount,
        }),
        limitations: memberLimitations,
      }),
    });
  });
  const members = Object.freeze(projected.map(({ member }) => member));
  const locatedLimitations = Object.freeze(members.flatMap((member) =>
    member.limitations.map((limitation) => Object.freeze({
      plannedAttemptId: member.plannedAttemptId,
      locator: member.publication.state === "published" ? member.publication.attemptLocator : null,
      limitation,
    }))));
  const usageResults = projected.flatMap(({ usage }) => usage === undefined ? [] : [usage]);
  const observed = members.filter(({ relation }) => relation !== null).length;
  const incompleteUsage = observed !== members.length ||
    usageResults.some(({ state }) => state !== "complete");
  const coverageLimitations = Object.freeze(locatedLimitations.filter(({ limitation }) =>
    limitation.kind !== "usage"));
  const usageLimitations = Object.freeze(locatedLimitations.filter(({ limitation }) =>
    limitation.kind !== "coverage"));
  return Object.freeze({
    value,
    members: selectedResource.members.map(projectMember),
    diagnostics,
    attempts: selected?.attempts.map(projectAttemptCore) ?? Object.freeze([]),
    denominator: Object.freeze({
      expected: selectedResource.resource.expected,
      published: selectedResource.resource.published,
      missing: selectedResource.resource.missing,
    }),
    plannedAttempts: members,
    coverage: Object.freeze({
      state: aggregateRunOverviewState(members.map(({ coverage }) => coverage.state)),
      expectedMemberCount: members.length,
      observedMemberCount: observed,
      completeMemberCount: members.filter(({ coverage }) => coverage.state === "complete").length,
      factCount: members.reduce((total, { coverage }) => total + coverage.facts.length, 0),
      limitations: coverageLimitations,
    }),
    usage: Object.freeze({
      state: aggregateRunOverviewState(members.map(({ usage }) => usage.state)),
      expectedMemberCount: members.length,
      observedMemberCount: observed,
      recordedAttemptCount: usageResults.filter(({ state }) =>
        state === "complete" || state === "partial").length,
      totals: combineInspectionUsageTotals(usageResults, incompleteUsage),
      limitations: usageLimitations,
    }),
    limitations: locatedLimitations,
  });
}

function aggregateRunOverviewState(
  states: readonly InspectionRunResult["coverage"]["state"][],
): InspectionRunResult["coverage"]["state"] {
  if (states.length === 0 || states.every((state) => state === "complete")) return "complete";
  if (states.every((state) => state === "unavailable")) return "unavailable";
  if (states.every((state) => state === "not-recorded")) return "not-recorded";
  if (states.every((state) => state === "invalid")) return "invalid";
  return "partial";
}

function assertionScore(entries: readonly {
  readonly contribution: { readonly state: string; readonly points?: number; readonly earned?: number };
}[]): InspectionAttemptResult["score"] {
  let possible = 0;
  let earned = 0;
  let scored = 0;
  let unavailable = 0;
  for (const { contribution } of entries) {
    if (contribution.state === "earned" && typeof contribution.points === "number" && typeof contribution.earned === "number") {
      possible += contribution.points;
      earned += contribution.earned;
      scored += 1;
    } else if (contribution.state === "unavailable" && typeof contribution.points === "number") {
      possible += contribution.points;
      unavailable += 1;
    }
  }
  return scored === 0 && unavailable === 0
    ? Object.freeze({ state: "not-scored" as const })
    : unavailable > 0
      ? Object.freeze({ state: "unavailable" as const, earned, possible, unavailable })
      : Object.freeze({ state: "complete" as const, earned, possible });
}

function attemptEvidenceCoverage(
  resolved: ResolvedInspectionAttempt,
): InspectionAttemptResult["evidenceCoverage"] {
  const entries = new Map<
    string,
    InspectionAttemptResult["evidenceCoverage"][number]
  >();
  const visit = (value: InspectionJson): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value !== "object" || value === null) return;
    const record = value as Readonly<Record<string, InspectionJson>>;
    const coverage = record.evidenceCoverage;
    if (typeof coverage === "object" && coverage !== null && !Array.isArray(coverage)) {
      for (const [channel, raw] of Object.entries(coverage)) {
        if (!isAttemptCoverageChannel(channel)) continue;
        const detail = typeof raw === "object" && raw !== null && !Array.isArray(raw)
          ? raw as Readonly<Record<string, InspectionJson>>
          : undefined;
        const status = typeof raw === "string"
          ? raw
          : typeof detail?.status === "string"
            ? detail.status
            : typeof detail?.state === "string"
              ? detail.state
              : undefined;
        if (status === undefined) continue;
        if (status !== "complete" && status !== "partial" && status !== "unavailable") continue;
        const reason = typeof detail?.reason === "string" ? detail.reason : undefined;
        const item = Object.freeze({
          channel,
          status,
          ...(reason === undefined ? {} : { reason }),
        });
        entries.set(`${channel}\u0000${status}\u0000${reason ?? ""}`, item);
      }
    }
    Object.values(record).forEach(visit);
  };
  for (const attachment of resolved.origin.attachments) {
    if (attachment.physical.ownerKind !== "attempt" || attachment.physical.ownerAttemptId !== resolved.attempt.attemptId) continue;
    visit(attachment.value);
  }
  return Object.freeze([...entries.values()]);
}

function attemptLimitations(
  resolved: ResolvedInspectionAttempt,
  entries: readonly {
    readonly materials: {
      readonly coverage: AssertionCoverage;
      readonly limitations: readonly AssertionLimitation[];
    };
  }[],
): InspectionAttemptResult["limitations"] {
  const limitations: InspectionAttemptResult["limitations"][number][] = [];
  for (const entry of entries) {
    const coverage = entry.materials.coverage;
    switch (coverage.state) {
      case "complete": break;
      case "partial":
        limitations.push(Object.freeze({
          owner: "assertion-material",
          state: coverage.state,
          reason: coverage.reason,
          limitations: entry.materials.limitations,
        }));
        break;
      case "unavailable":
        limitations.push(Object.freeze({
          owner: "assertion-material",
          state: coverage.state,
          reason: coverage.reason,
          limitations: entry.materials.limitations,
        }));
        break;
      case "not-applicable":
        limitations.push(Object.freeze({
          owner: "assertion-material",
          state: coverage.state,
          reason: coverage.reason,
          limitations: entry.materials.limitations,
        }));
        break;
    }
  }
  const coverage = attemptEvidenceCoverage(resolved);
  if (Array.isArray(coverage)) {
    for (const entry of coverage) {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry) || entry.status === "complete") continue;
      limitations.push(entry);
    }
  }
  return Object.freeze(limitations);
}

function isAttemptCoverageChannel(
  value: string,
): value is InspectionAttemptResult["evidenceCoverage"][number]["channel"] {
  return value === "events" || value === "actions" || value === "messages" ||
    value === "usage" || value === "status" || value === "data";
}
function attemptUsage(resolved: ResolvedInspectionAttempt) {
  let inputTokens = 0;
  let outputTokens = 0;
  const visit = (value: InspectionJson): void => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (typeof value !== "object" || value === null) return;
    const record = value as Readonly<Record<string, InspectionJson>>;
    if (record.kind === "token-bucket" && typeof record.tokens === "number") {
      if (record.bucket === "input") inputTokens += record.tokens;
      if (record.bucket === "output") outputTokens += record.tokens;
    }
    Object.values(record).forEach(visit);
  };
  for (const attachment of resolved.origin.attachments) {
    if (attachment.physical.ownerKind === "attempt" && attachment.physical.ownerAttemptId === resolved.attempt.attemptId) visit(attachment.value);
  }
  return Object.freeze({ inputTokens, outputTokens });
}

function comparisonDocument(
  source: InspectionFactSource,
  all: readonly LoadedInspectionRun[],
  operation: Extract<InspectionOperation, { readonly kind: "runs.compare" }>,
): unknown {
  const left = selectRuns(all, operation.leftRunIds);
  const right = selectRuns(all, operation.rightRunIds);
  const leftMembers = comparisonMembers(all, left.selected);
  const rightMembers = comparisonMembers(all, right.selected);
  const leftKeys = leftMembers.map(({ key }) => key).sort();
  const rightKeys = rightMembers.map(({ key }) => key).sort();
  const exact = arraysEqual(leftKeys, rightKeys);
  const rightByKey = new Map(rightMembers.map((member) => [member.key, member] as const));
  const pairs = leftMembers.flatMap((member) => {
    const paired = rightByKey.get(member.key);
    return paired === undefined ? [] : [Object.freeze({ key: member.key, left: member, right: paired })];
  });
  const issues: InspectionJson[] = [
    ...left.missing.map((runId) => closeJson({ code: "selection-run-missing", side: "left", runId })),
    ...right.missing.map((runId) => closeJson({ code: "selection-run-missing", side: "right", runId })),
    ...(operation.mode === "exact" && !exact ? [closeJson({ code: "comparison-member-set-mismatch" })] : []),
  ];
  return Object.freeze({
    ...baseDocument(source, operation.kind, [...left.selected, ...right.selected], [...operation.leftRunIds, ...operation.rightRunIds], [...left.missing, ...right.missing], [
      ...leftMembers.map(({ locator }) => locator), ...rightMembers.map(({ locator }) => locator),
    ], issues),
    comparison: boundedJson(Object.freeze({
      mode: operation.mode,
      left: Object.freeze({ runs: left.selected.map(({ run }) => projectRunCore(run)), members: leftMembers }),
      right: Object.freeze({ runs: right.selected.map(({ run }) => projectRunCore(run)), members: rightMembers }),
      exactMemberSet: exact,
      pairs: operation.mode === "side-by-side" ? Object.freeze([]) : Object.freeze(pairs),
    })),
  });
}

function comparisonMembers(
  all: readonly LoadedInspectionRun[],
  runs: readonly LoadedInspectionRun[],
) {
  return runs.flatMap((run) => run.members.flatMap((member) => {
    if (member.attempt === null) return [];
    const slot = run.run.expectedSlots.find(({ slotId }) => slotId === member.slotId);
    const resolved = resolveInspectionMemberAttempt(all, run, member);
    if (slot === undefined || resolved === undefined) return [];
    return [Object.freeze({
      key: `${run.run.experimentId}\u0000${slot.evalId}\u0000${slot.attemptOrdinal}`,
      runId: run.run.runId, plannedAttemptId: slot.slotId, evalId: slot.evalId, attemptOrdinal: slot.attemptOrdinal,
      locator: resolved.locator,
    })];
  }));
}

function baseDocument(
  source: InspectionFactSource,
  operation: InspectionOperationId,
  selectedInput: readonly LoadedInspectionRun[],
  requestedRunIds: readonly string[],
  missingRunIds: readonly string[],
  evidence: readonly string[],
  issues: readonly InspectionJson[] = [],
) {
  const selected = uniqueRuns(selectedInput);
  const cutoff = source.cutoff();
  return Object.freeze({
    protocol: QUERY_PROTOCOL,
    behaviorVersion: INSPECTION_BEHAVIOR_VERSION,
    outcome: "success" as const,
    operation,
    source: sourceProvenance(source, cutoff),
    publicationCutoff: Object.freeze({
      storeGeneration: cutoff.storeGeneration,
      revision: cutoff.revision,
    }),
    selection: Object.freeze({
      requestedRunIds: Object.freeze([...requestedRunIds]),
      selectedRunIds: Object.freeze(selected.map(({ run }) => run.runId)),
      missingRunIds: Object.freeze([...missingRunIds]),
    }),
    issues: Object.freeze(issues),
    evidence: Object.freeze({ refs: Object.freeze([...new Set(evidence)].sort()) }),
  });
}

function resultMetadata<Kind extends InspectionOperationId>(
  source: InspectionFactSource,
  operation: Kind,
  selectedInput: readonly LoadedInspectionRun[],
  requestedRunIds: readonly string[],
  missingRunIds: readonly string[],
  evidence: readonly string[],
): InspectionResultMetadata<Kind> {
  const selected = uniqueRuns(selectedInput);
  const cutoff = source.cutoff();
  return Object.freeze({
    protocol: QUERY_PROTOCOL,
    behaviorVersion: INSPECTION_BEHAVIOR_VERSION,
    outcome: "success" as const,
    operation,
    source: sourceProvenance(source, cutoff),
    publicationCutoff: Object.freeze({
      storeGeneration: cutoff.storeGeneration,
      revision: cutoff.revision,
    }),
    selection: Object.freeze({
      requestedRunIds: Object.freeze([...requestedRunIds]),
      selectedRunIds: Object.freeze(selected.map(({ run }) => run.runId)),
      missingRunIds: Object.freeze([...missingRunIds]),
    }),
    issues: Object.freeze([] as const),
    evidence: Object.freeze({
      refs: Object.freeze([...new Set(evidence)].sort()),
    }),
  });
}

function decodeRequiredResult<S extends Schema.ConstraintDecoder<unknown>>(
  operation: InspectionOperationId,
  schema: S,
  input: unknown,
): S["Type"] {
  const decoded = Schema.decodeUnknownResult(schema, {
    onExcessProperty: "error",
  })(input);
  if (Result.isFailure(decoded)) {
    throw new InspectionOperationError({
      code: "inspection-result-invalid",
      operation,
      reason: String(decoded.failure),
    });
  }
  return decoded.success;
}

function requireInspectionResultBudget<Value>(operation: InspectionOperationId, value: Value): Value {
  const byteLimit = operation === "experiment.get" ? INSPECTION_EXPERIMENT_RESULT_BYTE_LIMIT : operation === "attempt.usage" || operation === "attempt.reprice" ? INSPECTION_ATTEMPT_USAGE_RESULT_BYTE_LIMIT : INSPECTION_RESULT_BYTE_LIMIT;
  if (utf8ByteLength(JSON.stringify(value)) > byteLimit) {
    throw new InspectionOperationError({ code: "evidence-budget-exceeded", operation,
      reason: "Inspection result cannot fit in the result byte limit." });
  }
  return value;
}

function locators(runs: readonly LoadedInspectionRun[]): readonly string[] {
  return Object.freeze(runs.flatMap(({ attempts }) => attempts.map(({ attemptId }) => encodeAttemptLocator(attemptId))));
}

function uniqueRuns(
  runs: readonly LoadedInspectionRun[],
): readonly LoadedInspectionRun[] {
  return Object.freeze([...new Map(runs.map((run) => [run.run.runId, run] as const)).values()]);
}

function closeJson(value: unknown): InspectionJson {
  const closed = closeInspectionJson(value);
  if (isInspectionCodecError(closed)) throw closed;
  return closed as InspectionJson;
}

function boundedJson(value: unknown, byteLimit = INSPECTION_RESULT_BYTE_LIMIT): InspectionJson {
  const closed = closeJson(value);
  const byteLength = utf8ByteLength(JSON.stringify(closed));
  if (byteLength <= byteLimit) return closed;
  return closeJson(Object.freeze({
    state: "omitted",
    reason: "inspection-result-byte-limit",
    byteLimit,
  }));
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function sourceProvenance(
  source: InspectionFactSource,
  cutoff: ReturnType<InspectionFactSource["cutoff"]>,
): InspectionSourceProvenance {
  return Object.freeze({
    kind: source.kind,
    publicationCutoffIdentity: cutoff.identity,
  });
}

function evaluateInspectionOperation(
  operation: InspectionOperationId,
  evaluate: () => unknown,
): InspectionOperationDocument {
  try {
    const decoded = decodeInspectionDocument(evaluate());
    if (!decoded.success) {
      throw new InspectionOperationError({ code: "inspection-result-invalid", operation, reason: decoded.reason });
    }
    const value = decoded.value;
    if (value.outcome === "discovery" || value.outcome === "failure" || value.operation !== operation) {
      throw new InspectionOperationError({ code: "inspection-result-invalid", operation, reason: "expected matching operation document" });
    }
    return value;
  } catch (cause) {
    if (cause instanceof InspectionOperationError) throw cause;
    if (cause instanceof InspectionExecutionTraceError) throw executionTraceFailure(operation, cause);
    if (cause instanceof RecordIntegrityFailure) throw integrityFailure(operation, cause);
    if (isInspectionResultError(cause)) throw cause;
    throw operationFailure(operation, "Inspection operation failed", cause);
  }
}

function evaluateInspectionSuccess<Kind extends InspectionOperationId>(
  operation: Kind,
  evaluate: () => unknown,
): InspectionSuccessDocumentFor<Kind> {
  try {
    const decoded = decodeInspectionDocument(evaluate());
    if (!decoded.success) {
      throw new InspectionOperationError({ code: "inspection-result-invalid", operation, reason: decoded.reason });
    }
    const narrowed = narrowInspectionSuccess(decoded.value, operation);
    if (!narrowed.success) {
      throw new InspectionOperationError({ code: "inspection-result-invalid", operation, reason: narrowed.reason });
    }
    return narrowed.value;
  } catch (cause) {
    if (cause instanceof InspectionOperationError) throw cause;
    if (cause instanceof InspectionExecutionTraceError) throw executionTraceFailure(operation, cause);
    if (cause instanceof RecordIntegrityFailure) throw integrityFailure(operation, cause);
    if (isInspectionResultError(cause)) throw cause;
    throw operationFailure(operation, "Inspection operation failed", cause);
  }
}

function executionTraceFailure(
  operation: InspectionOperationId,
  cause: InspectionExecutionTraceError,
): InspectionOperationError {
  return new InspectionOperationError({
    code: cause.code,
    operation,
    reason: cause.message,
    cause,
  });
}

function isInspectionResultError(
  value: unknown,
): value is { readonly code: "inspection-result-invalid"; readonly reason: string } {
  return typeof value === "object" && value !== null &&
    Reflect.get(value, "code") === "inspection-result-invalid" &&
    typeof Reflect.get(value, "reason") === "string";
}

function selectionMissing(
  operation: InspectionOperationId,
  reason: string,
  cause?: unknown,
): InspectionOperationError {
  return new InspectionOperationError({
    code: "inspection-selection-missing",
    operation,
    reason,
    ...(cause === undefined ? {} : { cause }),
  });
}

function operationFailure(
  operation: InspectionOperationId,
  reason: string,
  cause?: unknown,
): InspectionOperationError {
  return new InspectionOperationError({
    code: "inspection-operation-failed",
    operation,
    reason,
    ...(cause === undefined ? {} : { cause }),
  });
}

function integrityFailure(
  operation: InspectionOperationId,
  cause: RecordIntegrityFailure,
): InspectionOperationError {
  return new InspectionOperationError({
    code: "inspection-record-integrity-failure",
    operation,
    reason: "The selected sealed Run does not form a closed Record publication.",
    identity: Object.freeze({ runId: cause.runId }),
  });
}
