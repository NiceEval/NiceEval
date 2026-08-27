import { randomUUID } from "node:crypto";

import { Effect, Result, Schema } from "effect";

import { MAX_CONVERSATION_TEXT_BYTES } from "../../../record/family/source-receipt/limits.ts";
import {
  makeBoundedSafeText,
  makeSafeIdentifier,
  type SafeIdentifier,
} from "../../../record/family/source-receipt/model.ts";
import type { AttemptDiagnostic, ConversationItem } from "../model.ts";
import type { NormalizedAgentTurnTerminal } from "../types.ts";
import {
  producerCaptureSealInvalid,
  type RunnerObservabilityProducerError,
} from "../support.ts";
import type { CapturedConversationTurn } from "./state.ts";

export function sourceSegmentId(): SafeIdentifier | undefined {
  try {
    return makeSafeIdentifier(`seg.${randomUUID().replaceAll("-", "")}`);
  } catch {
    return undefined;
  }
}

export function agentTurnTerminal(
  turn: CapturedConversationTurn,
): NormalizedAgentTurnTerminal {
  if (turn.adapterStatus !== undefined && turn.evidenceCoverage !== undefined) {
    return Object.freeze({
      state: "recorded" as const,
      status: turn.adapterStatus,
      evidenceCoverage: Object.freeze({
        events: Object.freeze({ ...turn.evidenceCoverage.events }),
        actions: Object.freeze({ ...turn.evidenceCoverage.actions }),
        messages: Object.freeze({ ...turn.evidenceCoverage.messages }),
        usage: Object.freeze({ ...turn.evidenceCoverage.usage }),
        status: Object.freeze({ ...turn.evidenceCoverage.status }),
        data: Object.freeze({ ...turn.evidenceCoverage.data }),
      }),
    });
  }
  return Object.freeze({
    state: "unavailable" as const,
    reason: turn.outcome === "interrupted"
      ? "send-interrupted" as const
      : "send-failed" as const,
  });
}

export function segmentIds<Id extends string>(
  ids: readonly Id[],
): Map<Id, SafeIdentifier> | undefined {
  const result = new Map<Id, SafeIdentifier>();
  for (const id of ids) {
    const segmentId = sourceSegmentId();
    if (segmentId === undefined) return undefined;
    result.set(id, segmentId);
  }
  return result;
}

export function receiptConversationItem(item: ConversationItem): object {
  const base = { itemId: item.itemId, sequence: item.sequence };
  switch (item.kind) {
    case "message": return Object.freeze({ ...base, kind: item.kind, role: item.role, text: item.text });
    case "tool-call": return Object.freeze({ ...base, kind: item.kind, callId: item.callId, tool: item.tool, inputSummary: item.inputSummary });
    case "tool-result": return Object.freeze({ ...base, kind: item.kind, callId: item.callId, outcome: item.outcome, outputSummary: item.outputSummary });
    case "thinking-summary": return Object.freeze({ ...base, kind: item.kind, summary: item.summary });
    case "subagent": return Object.freeze({ ...base, kind: item.kind, state: item.state, label: item.label, summary: item.summary });
    case "input-request": return Object.freeze({ ...base, kind: item.kind, state: item.state, promptSummary: item.promptSummary, responseSummary: item.responseSummary });
    case "skill-load": return Object.freeze({
      ...base,
      kind: item.kind,
      code: item.skill,
      summary: makeBoundedSafeText(
        item.outcome === "loaded" ? "Skill loaded." : "Skill load failed.",
        MAX_CONVERSATION_TEXT_BYTES,
      )!,
    });
    case "context-injection": return Object.freeze({ ...base, kind: item.kind, summary: item.summary });
    case "compaction": return Object.freeze({ ...base, kind: item.kind, summary: item.summary });
    case "conversation-error": return Object.freeze({ ...base, kind: item.kind, code: item.code, summary: item.summary });
  }
}

export function receiptDiagnosticRedaction(
  redaction: AttemptDiagnostic["redaction"],
): object {
  if (redaction.state === "none") return Object.freeze({ state: "none" as const });
  return Object.freeze({
    state: "applied" as const,
    replacements: redaction.summaryReplacements + redaction.causeReplacements + redaction.contextReplacements,
  });
}

export function decodeReceipt<Value, Encoded>(
  schema: Schema.Codec<Value, Encoded, never, never>,
  candidate: unknown,
  owner: "attempt" | "run",
): Effect.Effect<Value, RunnerObservabilityProducerError> {
  const decoded = Schema.decodeUnknownResult(Schema.toType(schema))(candidate);
  return Result.isFailure(decoded)
    ? Effect.fail(producerCaptureSealInvalid(owner))
    : Effect.succeed(decoded.success);
}
