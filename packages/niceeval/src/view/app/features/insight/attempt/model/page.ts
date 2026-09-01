import type { InspectionSuccessDocumentFor } from "@niceeval/inspection/public.ts";
import {
  availableValue,
  type AttemptSectionAvailability,
  type AttemptSummaryData,
  unavailableValue,
} from "../details/compute.ts";

type TraceEvidenceState = InspectionSuccessDocumentFor<"attempt.trace">["trace"]["conversation"]["state"];

function traceEvidenceAvailability(state: TraceEvidenceState): AttemptSectionAvailability {
  if (state === "complete") return "available";
  if (state === "partial") return "partial";
  return state === "not-recorded" ? "not-recorded" : "unavailable";
}

export interface AttemptPageModel {
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
  const slot = attempt.attempt.originRun.expectedSlots.find(({ slotId }) =>
    slotId === attempt.attempt.core.slotId);
  const score = attempt.attempt.score;
  const totalScore = score.state === "complete" ? score.earned : undefined;
  return Object.freeze({
    locator: attempt.attempt.locator,
    runId: attempt.attempt.originRun.runId,
    experimentId: attempt.attempt.originRun.experimentId,
    evalId: attempt.attempt.core.evalId,
    summary: Object.freeze({
      experimentId: attempt.attempt.originRun.experimentId,
      identity: Object.freeze({
        runId: attempt.attempt.originRun.runId,
        evalId: attempt.attempt.core.evalId,
        attempt: slot === undefined
          ? unavailableValue<number>()
          : availableValue(slot.attemptOrdinal),
      }),
      verdict: attempt.attempt.verdict ?? "unknown",
      startedAt: new Date(attempt.attempt.originRun.startedAt).toISOString(),
      durationMs: unavailableValue<number>(),
      capabilities: Object.freeze({
        source: attempt.attempt.sections.sources.state,
        execution: traceEvidenceAvailability(trace.trace.conversation.state),
        timing: attempt.attempt.sections.timing.state,
        diff: attempt.attempt.sections.diff.state,
      }),
      ...(totalScore === undefined ? {} : { totalScore }),
    }),
    assertionEntryIds: Object.freeze(attempt.attempt.assertions.entries.map(({ entryId }) => entryId)),
    traceItemIds: Object.freeze([...trace.trace.identityIndex.itemIds]),
    toolOccurrenceIds: Object.freeze([...trace.trace.identityIndex.toolOccurrenceIds.ids]),
    commandIds: Object.freeze([...trace.trace.identityIndex.commandIds]),
  });
}
