import type { ResolvedEvidenceCoverage } from "../../../assertions/coverage.ts";
import type { StreamEvent } from "../../../types.ts";
import { MAX_CONVERSATION_TURNS } from "../../../record/family/source-receipt/limits.ts";
import type { TurnId } from "../../../record/family/source-receipt/model.ts";
import type { ConversationTurn } from "../model.ts";
import { normalizeConversationTurn } from "../event-projection.ts";
import {
  producerCaptureSealInvalid,
  producerEntityIdInvalid,
  requiredPositive,
} from "../support.ts";
import { sourceSegmentId } from "./receipt-helpers.ts";
import {
  eventProjectionRuntime,
  markRuntimeFailure,
  registerRuntimeEntity,
  runtimeState,
  type RunnerAttemptObservabilityRuntime,
} from "./state.ts";

/** Finishes the receipt slot allocated before the Adapter send began. */
export function captureRunnerPhysicalConversationTurn(input: {
  readonly runtime: RunnerAttemptObservabilityRuntime;
  readonly turnId: TurnId;
  readonly outcome: ConversationTurn["outcome"];
  readonly events: readonly StreamEvent[];
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
  normalizeConversationTurn(eventProjectionRuntime(runtime), captured, input.events);
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

/** Allocates the stable physical-send identity before Adapter invocation. */
export function beginRunnerPhysicalConversationTurn(
  runtimeHandle: RunnerAttemptObservabilityRuntime,
  turnId: TurnId,
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
  const segmentId = sourceSegmentId();
  if (segmentId === undefined) {
    markRuntimeFailure(runtime, producerEntityIdInvalid("turn"));
    return false;
  }
  runtime.conversationTurns.push({
    turnId,
    segmentId,
    sequence: requiredPositive(runtime.conversationTurns.length + 1),
    items: [],
    usage: [],
  });
  return true;
}
