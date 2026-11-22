import { randomUUID } from "node:crypto";

import { Effect, Result, Schema } from "effect";

import { makeSafeText, makeSafeIdentifier, type SafeIdentifier } from "../../../record/family/source-receipt/model.ts";
import type { AttemptDiagnostic, ConversationItem } from "../model.ts";
import type { NormalizedAgentTurnTerminal } from "../types.ts";
import { producerCaptureSealInvalid, type RunnerObservabilityProducerError } from "../support.ts";
import type { SourceReceiptLimitation } from "../../../record/family/source-receipt/index.ts";
import type { ResolvedEvidenceCoverageEntry } from "../../../assertions/coverage.ts";
import type { CapturedConversationTurn } from "./state.ts";

export function sourceSegmentId(): SafeIdentifier | undefined {
  try {
    return makeSafeIdentifier(`seg.${randomUUID().replaceAll("-", "")}`);
  } catch {
    return undefined;
  }
}

function terminalCoverageEntry(
  entry: ResolvedEvidenceCoverageEntry,
  limitations: SourceReceiptLimitation[],
): ResolvedEvidenceCoverageEntry {
  if (entry.status === "complete") return { status: "complete" };
  let reason = new TextDecoder("utf-8", { ignoreBOM: true })
    .decode(new TextEncoder().encode(entry.reason))
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/gu, "");
  if (reason.trim().length === 0) reason = "Coverage reason unavailable.";
  if (reason !== entry.reason) limitations.push({ code: "unsupported-input", target: "value-byte", omittedAtLeast: 1 });
  return { status: entry.status, reason };
}

export function agentTurnTerminal(
  turn: CapturedConversationTurn,
  limitations: SourceReceiptLimitation[] = [],
): NormalizedAgentTurnTerminal {
  const completion = turn.completion;
  if (completion.state === "observed" && completion.adapter.state === "recorded") {
    const adapter = completion.adapter;
    return {
      state: "recorded" as const,
      status: adapter.status,
      // Adapter-owned entries can retain mutable aliases beyond this receipt.
      evidenceCoverage: {
        events: terminalCoverageEntry(adapter.evidenceCoverage.events, limitations),
        actions: terminalCoverageEntry(adapter.evidenceCoverage.actions, limitations),
        messages: terminalCoverageEntry(adapter.evidenceCoverage.messages, limitations),
        usage: terminalCoverageEntry(adapter.evidenceCoverage.usage, limitations),
        status: terminalCoverageEntry(adapter.evidenceCoverage.status, limitations),
        data: terminalCoverageEntry(adapter.evidenceCoverage.data, limitations),
      },
    };
  }
  return {
    state: "unavailable" as const,
    reason:
      completion.state === "interrupted" || (completion.state === "observed" && completion.outcome === "interrupted")
        ? "send-interrupted"
        : "send-failed",
  };
}

export function segmentIds<Id extends string>(ids: readonly Id[]): Map<Id, SafeIdentifier> | undefined {
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
    case "message":
      return { ...base, kind: item.kind, role: item.role, text: item.text };
    case "tool-call":
      return {
        ...base,
        kind: item.kind,
        callId: item.callId,
        tool: item.tool,
        inputSummary: item.inputSummary,
      };
    case "tool-result":
      return {
        ...base,
        kind: item.kind,
        callId: item.callId,
        outcome: item.outcome,
        outputSummary: item.outputSummary,
      };
    case "thinking-summary":
      return { ...base, kind: item.kind, summary: item.summary };
    case "subagent":
      return { ...base, kind: item.kind, state: item.state, label: item.label, summary: item.summary };
    case "input-request":
      return {
        ...base,
        kind: item.kind,
        state: item.state,
        promptSummary: item.promptSummary,
        responseSummary: item.responseSummary,
      };
    case "skill-load":
      return {
        ...base,
        kind: item.kind,
        code: item.skill,
        summary: makeSafeText(item.outcome === "loaded" ? "Skill loaded." : "Skill load failed.")!,
      };
    case "context-injection":
      return { ...base, kind: item.kind, summary: item.summary };
    case "compaction":
      return { ...base, kind: item.kind, summary: item.summary };
    case "conversation-error":
      return { ...base, kind: item.kind, code: item.code, summary: item.summary };
  }
}

export function receiptDiagnosticRedaction(redaction: AttemptDiagnostic["redaction"]): object {
  if (redaction.state === "none") return { state: "none" as const };
  return {
    state: "applied" as const,
    replacements: redaction.summaryReplacements + redaction.causeReplacements + redaction.contextReplacements,
  };
}

export function decodeReceipt<Value, Encoded>(
  schema: Schema.Codec<Value, Encoded, never, never>,
  candidate: unknown,
  owner: "attempt" | "run",
): Effect.Effect<Value, RunnerObservabilityProducerError> {
  const decoded = Schema.decodeUnknownResult(Schema.toType(schema))(candidate);
  return Result.isFailure(decoded) ? Effect.fail(producerCaptureSealInvalid(owner)) : Effect.succeed(decoded.success);
}
