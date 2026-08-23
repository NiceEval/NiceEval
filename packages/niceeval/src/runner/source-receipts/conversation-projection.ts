import { redactSensitiveText } from "../../sandbox/redaction.ts";
import type { StreamEvent } from "../../types.ts";
import {
  MAX_CONVERSATION_ITEMS,
  MAX_CONVERSATION_TEXT_BYTES,
  MAX_CONVERSATION_TURNS,
} from "../../record/family/source-receipt/limits.ts";
import {
  makeBoundedSafeText,
  makeSafeIdentifier,
  makeSourceNativeToolName,
  type CallId,
  type ItemId,
  type PositiveSafeInteger,
  type SafeIdentifier,
  type SourceNativeToolName,
} from "../../record/family/source-receipt/model.ts";
import type { ConversationItem } from "./model.ts";
import type {
  EventProjectionRuntime,
  ProjectedConversationTurn,
} from "./projection-runtime.ts";
import { retainSafeText, type RetainedText } from "./projection-text.ts";
import {
  RunnerCollectionLimitations,
  requiredPositive,
} from "./support.ts";

function retainConversationText(
  value: string,
  runtime: EventProjectionRuntime,
  limitations: RunnerCollectionLimitations,
): RetainedText | undefined {
  const redacted = redactSensitiveText(value, runtime.sensitiveValues);
  if (redacted !== value) limitations.addRedacted("conversation-text");
  return retainSafeText(redacted, MAX_CONVERSATION_TEXT_BYTES);
}

function jsonConversationSummary(
  value: unknown,
  runtime: EventProjectionRuntime,
  limitations: RunnerCollectionLimitations,
): RetainedText | undefined {
  let summary: string | undefined;
  try {
    const encoded = JSON.stringify(value);
    summary = typeof encoded === "string" ? encoded : undefined;
  } catch {
    return undefined;
  }
  return summary === undefined
    ? undefined
    : retainConversationText(summary, runtime, limitations);
}

function safeIdentifier(value: string): SafeIdentifier | undefined {
  return makeSafeIdentifier(value);
}

function sourceNativeToolName(value: string): SourceNativeToolName | undefined {
  return makeSourceNativeToolName(value);
}

function eventCannotBePersisted(
  event: { readonly redacted?: readonly string[]; readonly truncated?: readonly unknown[] },
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

function hasConversationCapacity(input: {
  readonly itemCount: number;
  readonly hasTurn: boolean;
  readonly limitations: RunnerCollectionLimitations;
}): boolean {
  if (input.itemCount >= MAX_CONVERSATION_ITEMS) {
    input.limitations.addCap("conversation-item", input.itemCount);
    return false;
  }
  if (!input.hasTurn && input.itemCount >= MAX_CONVERSATION_TURNS) {
    input.limitations.addCap("conversation-item", input.itemCount);
    return false;
  }
  return true;
}

function appendConversationTextLimitation(
  item: ConversationItem | undefined,
  text: RetainedText,
  limitations: RunnerCollectionLimitations,
): void {
  if (item !== undefined && text.omittedBytes !== undefined) {
    limitations.addConversationTextTruncated(
      item.itemId,
      text.retainedBytes,
      text.omittedBytes,
    );
  }
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
  const append = (
    create: (ids: {
      readonly itemId: ItemId;
      readonly turnId: ProjectedConversationTurn["turnId"];
      readonly sequence: PositiveSafeInteger;
    }) => ConversationItem,
  ): ConversationItem | undefined => {
    const itemCount = runtime.conversationTurns.reduce((count, entry) => count + entry.items.length, 0);
    if (!hasConversationCapacity({ itemCount, hasTurn: true, limitations })) return undefined;
    const itemId = runtime.mintEntity("item");
    if (itemId === undefined) return undefined;
    const item = create(Object.freeze({
      itemId,
      turnId: turn.turnId,
      sequence: requiredPositive(itemCount + 1),
    }));
    turn.items.push(item);
    return item;
  };

  for (const event of events) {
    if (eventCannotBePersisted(event, limitations)) continue;
    switch (event.type) {
      case "message": {
        const text = retainConversationText(event.text, runtime, limitations);
        if (text === undefined) {
          limitations.addUnsupported("conversation-item");
          break;
        }
        const item = append((ids) => Object.freeze({
          ...ids,
          kind: "message" as const,
          role: event.role,
          text: text.text,
          refs: Object.freeze([]),
        }));
        appendConversationTextLimitation(item, text, limitations);
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
          const item = append((ids) => Object.freeze({
            ...ids,
            kind: "tool-call" as const,
            callId,
            tool,
            inputSummary: summary.text,
            refs: Object.freeze([]),
          }));
          if (item !== undefined) openTools.set(event.operationId, callId);
          appendConversationTextLimitation(item, summary, limitations);
          break;
        }
        const label = safeIdentifier(event.operation.name);
        if (label === undefined) {
          limitations.addUnsupported("conversation-item");
          break;
        }
        const item = append((ids) => Object.freeze({
          ...ids,
          kind: "subagent" as const,
          state: "started" as const,
          label,
          summary: makeBoundedSafeText("Subagent started.", MAX_CONVERSATION_TEXT_BYTES)!,
          refs: Object.freeze([]),
        }));
        if (item !== undefined) openSubagents.set(event.operationId, label);
        break;
      }
      case "operation.finished": {
        if (event.kind === "tool") {
          const callId = openTools.get(event.operationId);
          const summary = event.output === undefined
            ? undefined
            : jsonConversationSummary(event.output, runtime, limitations);
          if (callId === undefined || summary === undefined) {
            limitations.addUnsupported("conversation-item");
            break;
          }
          const item = append((ids) => Object.freeze({
            ...ids,
            kind: "tool-result" as const,
            callId,
            outcome: event.status,
            outputSummary: summary.text,
            refs: Object.freeze([]),
          }));
          if (item !== undefined) openTools.delete(event.operationId);
          appendConversationTextLimitation(item, summary, limitations);
          break;
        }
        const label = openSubagents.get(event.operationId);
        if (label === undefined) {
          limitations.addUnsupported("conversation-item");
          break;
        }
        const item = append((ids) => Object.freeze({
          ...ids,
          kind: "subagent" as const,
          state: event.status,
          label,
          summary: makeBoundedSafeText(
            event.status === "completed" ? "Subagent completed." : "Subagent failed.",
            MAX_CONVERSATION_TEXT_BYTES,
          )!,
          refs: Object.freeze([]),
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
        append((ids) => Object.freeze({
          ...ids,
          kind: "skill-load" as const,
          skill,
          outcome: "loaded" as const,
          refs: Object.freeze([]),
        }));
        break;
      }
      case "input.requested": {
        const source = event.request.prompt ?? event.request.display;
        const summary = source === undefined
          ? (event.request.input === undefined
            ? undefined
            : jsonConversationSummary(event.request.input, runtime, limitations))
          : retainConversationText(source, runtime, limitations);
        if (summary === undefined) {
          limitations.addUnsupported("conversation-item");
          break;
        }
        const item = append((ids) => Object.freeze({
          ...ids,
          kind: "input-request" as const,
          state: "requested" as const,
          promptSummary: summary.text,
          responseSummary: null,
          refs: Object.freeze([]),
        }));
        appendConversationTextLimitation(item, summary, limitations);
        limitations.addCaptureFailed("adapter", "conversation-item");
        break;
      }
      case "context.injected": {
        const source = event.source;
        const summary = retainConversationText(event.text, runtime, limitations);
        if (
          summary === undefined ||
          (source !== "system" && source !== "memory" && source !== "skill" && source !== "user")
        ) {
          limitations.addUnsupported("conversation-item");
          break;
        }
        const item = append((ids) => Object.freeze({
          ...ids,
          kind: "context-injection" as const,
          source,
          summary: summary.text,
          refs: Object.freeze([]),
        }));
        appendConversationTextLimitation(item, summary, limitations);
        break;
      }
      case "error": {
        const summary = retainConversationText(event.message, runtime, limitations);
        if (summary === undefined) {
          limitations.addUnsupported("conversation-item");
          break;
        }
        const item = append((ids) => Object.freeze({
          ...ids,
          kind: "conversation-error" as const,
          code: makeSafeIdentifier("stream-error")!,
          summary: summary.text,
          refs: Object.freeze([]),
        }));
        appendConversationTextLimitation(item, summary, limitations);
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
