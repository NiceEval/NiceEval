import { redactSensitiveText } from "../../sandbox/redaction.ts";
import type { StreamEvent } from "../../types.ts";
import {
  makeSafeText,
  type SafeText,
  makeSafeIdentifier,
  makeSourceNativeToolName,
  type CallId,
  type ItemId,
  type PositiveSafeInteger,
  type SafeIdentifier,
  type SourceNativeToolName,
} from "../../record/family/source-receipt/model.ts";
import type { ConversationItem } from "./model.ts";
import type { EventProjectionRuntime, ProjectedConversationTurn } from "./projection-runtime.ts";
import { RunnerCollectionLimitations, requiredPositive } from "./support.ts";

function safeConversationText(
  value: string,
  runtime: EventProjectionRuntime,
  limitations: RunnerCollectionLimitations,
): SafeText | undefined {
  const redacted = redactSensitiveText(value, runtime.sensitiveValues);
  if (redacted !== value) limitations.addRedacted("conversation-text");
  return makeSafeText(redacted);
}

function jsonConversationSummary(
  value: unknown,
  runtime: EventProjectionRuntime,
  limitations: RunnerCollectionLimitations,
): SafeText | undefined {
  let summary: string | undefined;
  try {
    const encoded = JSON.stringify(value);
    summary = typeof encoded === "string" ? encoded : undefined;
  } catch {
    return undefined;
  }
  return summary === undefined ? undefined : safeConversationText(summary, runtime, limitations);
}

function safeIdentifier(value: string): SafeIdentifier | undefined {
  return makeSafeIdentifier(value);
}

function sourceNativeToolName(value: string): SourceNativeToolName | undefined {
  return makeSourceNativeToolName(value);
}

function eventCannotBePersisted(
  event: Pick<StreamEvent, "redacted" | "truncated">,
  limitations: RunnerCollectionLimitations,
): boolean {
  if ((event.redacted?.length ?? 0) > 0) {
    limitations.addRedacted("conversation-item", event.redacted!.length);
    return true;
  }
  if ((event.truncated?.length ?? 0) > 0) {
    limitations.addUnsupported("conversation-item");
    return true;
  }
  return false;
}

/** Adapter boundary: raw terminal events do not survive this call. */
export function normalizeConversationTurn(
  runtime: EventProjectionRuntime,
  turn: ProjectedConversationTurn,
  events: readonly StreamEvent[],
): void {
  const limitations = runtime.conversationLimitations;
  const openTools = new Map<string, CallId>();
  const openSubagents = new Map<string, SafeIdentifier>();
  let itemCount = runtime.conversationTurns.reduce((count, entry) => count + entry.items.length, 0);
  const append = (
    create: (ids: {
      readonly itemId: ItemId;
      readonly turnId: ProjectedConversationTurn["turnId"];
      readonly sequence: PositiveSafeInteger;
    }) => ConversationItem,
  ): ConversationItem | undefined => {
    const itemId = runtime.mintEntity("item");
    if (itemId === undefined) return undefined;
    const item = create({
      itemId,
      turnId: turn.turnId,
      sequence: requiredPositive(++itemCount),
    });
    turn.items.push(item);
    return item;
  };

  for (const event of events) {
    if (eventCannotBePersisted(event, limitations)) continue;
    switch (event.type) {
      case "message": {
        const text = safeConversationText(event.text, runtime, limitations);
        if (text === undefined) {
          limitations.addUnsupported("conversation-item");
          break;
        }
        append((ids) => ({
          ...ids,
          kind: "message" as const,
          role: event.role,
          text,
          refs: [],
        }));
        break;
      }
      case "operation.started": {
        if (event.operation.kind === "tool") {
          const tool = sourceNativeToolName(event.operation.name);
          const summary = jsonConversationSummary(event.operation.input, runtime, limitations);
          const callId = runtime.mintEntity("call");
          if (tool === undefined || summary === undefined || callId === undefined) {
            limitations.addUnsupported("conversation-item");
            break;
          }
          const item = append((ids) => ({
            ...ids,
            kind: "tool-call" as const,
            callId,
            tool,
            inputSummary: summary,
            refs: [],
          }));
          if (item !== undefined) openTools.set(event.operationId, callId);
          break;
        }
        const label = safeIdentifier(event.operation.name);
        if (label === undefined) {
          limitations.addUnsupported("conversation-item");
          break;
        }
        const item = append((ids) => ({
          ...ids,
          kind: "subagent" as const,
          state: "started" as const,
          label,
          summary: makeSafeText("Subagent started.")!,
          refs: [],
        }));
        if (item !== undefined) openSubagents.set(event.operationId, label);
        break;
      }
      case "operation.finished": {
        if (event.kind === "tool") {
          const callId = openTools.get(event.operationId);
          const summary =
            event.output === undefined ? undefined : jsonConversationSummary(event.output, runtime, limitations);
          if (callId === undefined || summary === undefined) {
            limitations.addUnsupported("conversation-item");
            break;
          }
          const item = append((ids) => ({
            ...ids,
            kind: "tool-result" as const,
            callId,
            outcome: event.status,
            outputSummary: summary,
            refs: [],
          }));
          if (item !== undefined) openTools.delete(event.operationId);
          break;
        }
        const label = openSubagents.get(event.operationId);
        if (label === undefined) {
          limitations.addUnsupported("conversation-item");
          break;
        }
        const item = append((ids) => ({
          ...ids,
          kind: "subagent" as const,
          state: event.status,
          label,
          summary: makeSafeText(event.status === "completed" ? "Subagent completed." : "Subagent failed.")!,
          refs: [],
        }));
        if (item !== undefined) openSubagents.delete(event.operationId);
        break;
      }
      case "skill.loaded": {
        const skill = safeIdentifier(event.skill);
        if (skill === undefined) {
          limitations.addUnsupported("conversation-item");
          break;
        }
        append((ids) => ({
          ...ids,
          kind: "skill-load" as const,
          skill,
          outcome: "loaded" as const,
          refs: [],
        }));
        break;
      }
      case "input.requested": {
        const request = event.request;
        const source = event.request.prompt ?? event.request.display;
        function inputRequestSummary() {
          if (source !== undefined) return safeConversationText(source, runtime, limitations);
          if (request.input !== undefined) return jsonConversationSummary(request.input, runtime, limitations);
          return undefined;
        }
        const summary = inputRequestSummary();
        if (summary === undefined) {
          limitations.addUnsupported("conversation-item");
          break;
        }
        append((ids) => ({
          ...ids,
          kind: "input-request" as const,
          state: "requested" as const,
          promptSummary: summary,
          responseSummary: null,
          refs: [],
        }));
        limitations.addCaptureFailed("adapter", "conversation-item");
        break;
      }
      case "context.injected": {
        const source = event.source;
        const summary = safeConversationText(event.text, runtime, limitations);
        if (
          summary === undefined ||
          (source !== "system" && source !== "memory" && source !== "skill" && source !== "user")
        ) {
          limitations.addUnsupported("conversation-item");
          break;
        }
        append((ids) => ({
          ...ids,
          kind: "context-injection" as const,
          source,
          summary,
          refs: [],
        }));
        break;
      }
      case "error": {
        const summary = safeConversationText(event.message, runtime, limitations);
        if (summary === undefined) {
          limitations.addUnsupported("conversation-item");
          break;
        }
        append((ids) => ({
          ...ids,
          kind: "conversation-error" as const,
          code: makeSafeIdentifier("stream-error")!,
          summary,
          refs: [],
        }));
        break;
      }
      case "thinking":
      case "compaction":
        limitations.addUnsupported("conversation-item");
        break;
    }
  }
  if (openTools.size > 0 || openSubagents.size > 0) {
    limitations.addUnsupported("conversation-item", openTools.size + openSubagents.size);
  }
}
