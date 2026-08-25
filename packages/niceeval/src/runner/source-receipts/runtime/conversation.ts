import type { ResolvedEvidenceCoverage } from "../../../assertions/coverage.ts";
import type { ObservedTurnSnapshot } from "../../../o11y/observed.ts";
import { MAX_CONVERSATION_TURNS } from "../../../record/family/source-receipt/limits.ts";
import type {
  ObservabilityEntityIdForKind,
  SessionScopeId,
  TurnId,
} from "../../../record/family/source-receipt/model.ts";
import type { ConversationTurn } from "../model.ts";
import {
  producerCaptureSealInvalid,
  producerEntityIdInvalid,
  requiredPositive,
} from "../support.ts";
import { sourceSegmentId } from "./receipt-helpers.ts";
import {
  markRuntimeFailure,
  registerRuntimeEntity,
  runtimeState,
  type RunnerAttemptObservabilityRuntime,
  type RunnerAttemptObservabilityRuntimeState,
} from "./state.ts";

export function captureRunnerPhysicalConversationTurn(input: {
  readonly runtime: RunnerAttemptObservabilityRuntime;
  readonly turnId: TurnId;
  readonly outcome: ConversationTurn["outcome"];
  readonly observed: ObservedTurnSnapshot;
  readonly adapterStatus?: "completed" | "failed" | "waiting";
  readonly evidenceCoverage?: ResolvedEvidenceCoverage;
}): void {
  const runtime = runtimeState(input.runtime);
  if (runtime === undefined || runtime.failure !== undefined || runtime.snapshot !== undefined) return;
  const captured = runtime.conversationTurns.find((turn) => turn.turnId === input.turnId);
  if (captured === undefined && runtime.conversationTurns.length >= MAX_CONVERSATION_TURNS) return;
  if (captured === undefined || captured.outcome !== undefined) {
    markRuntimeFailure(runtime, producerCaptureSealInvalid("attempt"));
    return;
  }
  captured.outcome = input.outcome;
  if (
    input.observed.turnId !== input.turnId ||
    input.observed.sessionId !== captured.sessionId ||
    captured.observed !== undefined
  ) {
    markRuntimeFailure(runtime, producerCaptureSealInvalid("attempt"));
    return;
  }
  captured.observed = input.observed;
  registerObservedTurn(runtime, input.observed);
  if (input.adapterStatus !== undefined && input.evidenceCoverage !== undefined) {
    captured.adapterStatus = input.adapterStatus;
    captured.evidenceCoverage = input.evidenceCoverage;
    if (input.evidenceCoverage.usage.status === "unavailable") {
      runtime.usageLimitations.addUnsupported("usage-observation");
    } else if (input.evidenceCoverage.usage.status === "partial") {
      runtime.usageLimitations.addCaptureFailed("usage-capture", "usage-observation");
    }
  } else if (input.outcome === "interrupted") {
    runtime.conversationLimitations.addCaptureInterrupted("adapter", "conversation-item");
  } else {
    runtime.conversationLimitations.addCaptureFailed("adapter", "conversation-item");
  }
}

export function beginRunnerPhysicalConversationTurn(
  runtimeHandle: RunnerAttemptObservabilityRuntime,
  turnId: TurnId,
  sessionId: SessionScopeId,
): boolean {
  const runtime = runtimeState(runtimeHandle);
  if (runtime === undefined || runtime.failure !== undefined || runtime.snapshot !== undefined) return false;
  if (runtime.conversationTurns.length >= MAX_CONVERSATION_TURNS) {
    runtime.conversationLimitations.addCap(
      "conversation-item",
      runtime.conversationTurns.length,
    );
    return false;
  }
  if (!registerRuntimeEntity(runtime, "turn", turnId)) return false;
  if (!runtime.registeredSessionScopes.has(sessionId)) {
    if (!registerRuntimeEntity(runtime, "session-scope", sessionId)) return false;
    runtime.registeredSessionScopes.add(sessionId);
  }
  const segmentId = sourceSegmentId();
  if (segmentId === undefined) {
    markRuntimeFailure(runtime, producerEntityIdInvalid("turn"));
    return false;
  }
  runtime.conversationTurns.push({
    turnId,
    sessionId,
    segmentId,
    sequence: requiredPositive(runtime.conversationTurns.length + 1),
    usage: [],
  });
  return true;
}

function registerObservedTurn(
  runtime: RunnerAttemptObservabilityRuntimeState,
  observed: ObservedTurnSnapshot,
): void {
  const register = <Kind extends "item" | "event" | "tool-occurrence" | "session-scope">(
    kind: Kind,
    id: ObservabilityEntityIdForKind<Kind>,
  ): boolean => registerRuntimeEntity(runtime, kind, id);

  if (!runtime.registeredSessionScopes.has(observed.sessionId)) {
    if (!register("session-scope", observed.sessionId)) return;
    runtime.registeredSessionScopes.add(observed.sessionId);
  }
  for (const event of observed.items) {
    if (!register("item", event.itemId) || !register("event", event.eventId)) return;
    if (event.kind !== "tool-start") continue;
    if (runtime.registeredToolOccurrences.has(event.toolOccurrenceId)) {
      markRuntimeFailure(runtime, producerEntityIdInvalid("tool-occurrence"));
      return;
    }
    if (!register("tool-occurrence", event.toolOccurrenceId)) return;
    runtime.registeredToolOccurrences.add(event.toolOccurrenceId);
  }
}
