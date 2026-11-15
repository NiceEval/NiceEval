import type { InspectionSuccessDocumentFor } from "@niceeval/inspection/public.ts";
import { closeAdapterIdentity } from "../../data/adapter-identity.ts";
import { availableValue, type AttemptSummaryData, unavailableValue } from "../details/compute.ts";

export interface AttemptPageModel {
  readonly verdictCauses: InspectionSuccessDocumentFor<"attempt.get">["attempt"]["verdictCauses"] | undefined;
  readonly diagnostics: InspectionSuccessDocumentFor<"attempt.get">["attempt"]["diagnostics"] | undefined;
  readonly locator: string;
  readonly runId: string;
  readonly experimentId: string;
  readonly evalId: string;
  readonly summary: AttemptSummaryData;
  readonly assertionEntryIds: readonly string[];
  readonly traceItemIds: readonly string[];
  readonly toolOccurrenceIds: readonly string[];
  readonly commandIds: readonly string[];
}

export function closeAttemptPage(
  attempt: InspectionSuccessDocumentFor<"attempt.get">,
  trace: InspectionSuccessDocumentFor<"attempt.trace">,
): AttemptPageModel {
  const slot = attempt.attempt.originRun.plannedAttempts.find(
    ({ plannedAttemptId }) => plannedAttemptId === attempt.attempt.core.plannedAttemptId,
  );
  const score = attempt.attempt.score;
  const totalScore = score.state === "complete" ? score.earned : undefined;
  return {
    locator: attempt.attempt.locator,
    verdictCauses: attempt.attempt.verdictCauses,
    diagnostics: attempt.attempt.diagnostics,
    runId: attempt.attempt.originRun.runId,
    experimentId: attempt.attempt.originRun.experimentId,
    evalId: attempt.attempt.core.evalId,
    summary: {
      experimentId: attempt.attempt.originRun.experimentId,
      adapter: closeAdapterIdentity(attempt.attempt.originRun.context.execution.adapter),
      identity: {
        runId: attempt.attempt.originRun.runId,
        evalId: attempt.attempt.core.evalId,
        attempt: slot === undefined ? unavailableValue<number>() : availableValue(slot.attemptOrdinal),
      },
      verdict: attempt.attempt.verdict ?? "unknown",
      startedAt: new Date(attempt.attempt.originRun.startedAt).toISOString(),
      durationMs: unavailableValue<number>(),
      capabilities: {
        source: attempt.attempt.sections.sources.state,
        execution: attempt.attempt.sections.trace.state,
        timing: attempt.attempt.sections.timing.state,
        diff: attempt.attempt.sections.diff.state,
      },
      totalScore,
    },
    assertionEntryIds: attempt.attempt.assertions.entries.map(({ entryId }) => entryId),
    traceItemIds: trace.trace.identityIndex.itemIds,
    toolOccurrenceIds: trace.trace.identityIndex.toolOccurrenceIds.ids,
    commandIds: trace.trace.identityIndex.commandIds,
  };
}
