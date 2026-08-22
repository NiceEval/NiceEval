// LangGraph Agent Streaming Protocol → NiceEval standard StreamEvent.
//
// The converter consumes the official protocol envelope itself. It is
// transport-neutral and intentionally does not depend on @langchain/protocol at
// runtime: callers can pass GraphRunStream ProtocolEvent values or decoded
// Agent Protocol Event values unchanged.

import type { JsonValue, StreamEvent, Usage } from "../types.ts";
import { normalizeToolName } from "../o11y/tool-names.ts";

/** Structural subset of the official protocol event params. */
export interface LangGraphEventParamsLike {
  namespace?: readonly string[];
  timestamp?: string | number;
  node?: string;
  data?: unknown;
}

/**
 * Structural subset of `@langchain/protocol` Event and LangGraph v3
 * ProtocolEvent. Unknown methods and extension fields are ignored safely.
 */
export interface LangGraphEventLike {
  type: string;
  event_id?: string;
  seq?: number;
  method?: string;
  params?: LangGraphEventParamsLike;
}

/** Official content-block fields used by the messages channel. */
export interface LangGraphContentBlockLike {
  type: string;
  text?: string;
  reasoning?: string;
  id?: string | null;
  name?: string | null;
  args?: unknown;
}

export interface LangGraphStream {
  /** Add one raw official event and return newly translated standard events. */
  add(event: LangGraphEventLike): StreamEvent[];
  /** Flush a final sequence gap and terminate this one-run converter. */
  end(): StreamEvent[];
  readonly usage: Usage | undefined;
  readonly status: "completed" | "failed" | "waiting" | undefined;
  /** Mark a tool error in this run as a human rejection. */
  markRejected(toolCallId: string): void;
}

function isRecord(value: unknown): value is globalThis.Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function namespaceOf(event: LangGraphEventLike): string[] {
  return Array.isArray(event.params?.namespace)
    ? event.params.namespace.filter((value): value is string => typeof value === "string" && value.length > 0)
    : [];
}

function dataOf(event: LangGraphEventLike): globalThis.Record<string, unknown> {
  return isRecord(event.params?.data) ? event.params.data : {};
}

function segmentName(segment: string): string {
  const separator = segment.indexOf(":");
  return separator > 0 ? segment.slice(0, separator) : segment;
}

/**
 * Translate one official LangGraph run. Create a fresh instance for every
 * initial or resumed run: seq, lifecycle, usage and dedupe state are run-local.
 */
export function createLangGraphEventStream(): LangGraphStream {
  let usage: Usage | undefined;
  let status: "completed" | "failed" | "waiting" | undefined;
  let ended = false;

  const startedCallIds = new Set<string>();
  const resolvedCallIds = new Set<string>();
  const rejectedCallIds = new Set<string>();
  const requestedInputIds = new Set<string>();
  const openNamespaces = new Set<string>();
  const closedNamespaces = new Set<string>();
  const messageRoles = new Map<string, "assistant" | "user">();
  const messageBlocks = new Map<string, Map<string, globalThis.Record<string, unknown>>>();
  const toolOutputDeltas = new Map<string, string>();

  let nextSeq: number | undefined;
  const pendingBySeq = new Map<number, LangGraphEventLike>();

  const assertOpen = (operation: string): void => {
    if (ended) throw new Error(`LangGraph event stream already ended; cannot ${operation}`);
  };

  const addUsage = (raw: unknown): void => {
    if (!isRecord(raw)) return;
    const number = (...keys: string[]): number => {
      for (const key of keys) {
        const value = raw[key];
        if (typeof value === "number" && Number.isFinite(value)) return value;
      }
      return 0;
    };
    const rawInput = number("input_tokens", "inputTokens");
    const output = number("output_tokens", "outputTokens");
    const inputDetails = isRecord(raw.input_token_details) ? raw.input_token_details : undefined;
    const outputDetails = isRecord(raw.output_token_details) ? raw.output_token_details : undefined;
    const cacheRead = typeof inputDetails?.cache_read === "number" ? inputDetails.cache_read : 0;
    const cacheCreation = typeof inputDetails?.cache_creation === "number" ? inputDetails.cache_creation : 0;
    const reasoning = typeof outputDetails?.reasoning === "number" ? outputDetails.reasoning : 0;
    usage = {
      inputTokens: (usage?.inputTokens ?? 0) + Math.max(0, rawInput - cacheRead - cacheCreation),
      outputTokens: (usage?.outputTokens ?? 0) + output,
      ...(cacheRead > 0 || usage?.cacheReadTokens !== undefined
        ? { cacheReadTokens: (usage?.cacheReadTokens ?? 0) + cacheRead }
        : {}),
      ...(cacheCreation > 0 || usage?.cacheCreationTokens !== undefined
        ? { cacheCreationTokens: (usage?.cacheCreationTokens ?? 0) + cacheCreation }
        : {}),
      ...(reasoning > 0 || usage?.reasoningTokens !== undefined
        ? { reasoningTokens: (usage?.reasoningTokens ?? 0) + reasoning }
        : {}),
      requests: (usage?.requests ?? 0) + 1,
    };
  };

  const emitStarted = (
    events: StreamEvent[],
    callId: string,
    name: string,
    input: unknown,
  ): void => {
    if (startedCallIds.has(callId)) return;
    startedCallIds.add(callId);
    events.push({
      type: "operation.started",
      operationId: callId,
      operation: {
        kind: "tool",
        name,
        input: (input ?? null) as JsonValue,
        tool: normalizeToolName(name),
      },
    });
  };

  const emitFinished = (
    events: StreamEvent[],
    callId: string,
    output: unknown,
    terminalStatus: "completed" | "failed" | "rejected",
  ): void => {
    if (resolvedCallIds.has(callId)) return;
    resolvedCallIds.add(callId);
    events.push({
      type: "operation.finished",
      operationId: callId,
      kind: "tool",
      ...(output === undefined ? {} : { output: output as JsonValue }),
      status: terminalStatus,
    });
  };

  const emitInputRequested = (
    events: StreamEvent[],
    interruptId: string,
    payload: unknown,
  ): void => {
    if (requestedInputIds.has(interruptId)) return;
    requestedInputIds.add(interruptId);
    const request: {
      id?: string;
      prompt?: string;
      display?: string;
      action?: string;
      input?: JsonValue;
      options?: { id: string; label?: string }[];
    } = { id: interruptId };
    if (typeof payload === "string") {
      request.prompt = payload;
    } else if (isRecord(payload)) {
      const actionRequest = isRecord(payload.action_request) ? payload.action_request : undefined;
      const action = str(actionRequest?.action);
      if (action !== undefined) request.action = action;
      if (actionRequest?.args !== undefined) request.input = actionRequest.args as JsonValue;
      const display = str(payload.description) ?? str(payload.display);
      if (display !== undefined) request.display = display;
      const prompt = str(payload.prompt) ?? str(payload.question);
      if (prompt !== undefined) request.prompt = prompt;
      const config = isRecord(payload.config) ? payload.config : undefined;
      if (config !== undefined) {
        const options = (
          [
            ["allow_accept", "accept"],
            ["allow_edit", "edit"],
            ["allow_respond", "respond"],
            ["allow_ignore", "ignore"],
          ] as const
        )
          .filter(([flag]) => config[flag] === true)
          .map(([, id]) => ({ id }));
        if (options.length > 0) request.options = options;
      }
      if (
        request.action === undefined &&
        request.input === undefined &&
        request.display === undefined &&
        request.prompt === undefined
      ) {
        request.input = payload as JsonValue;
      }
    } else if (payload !== undefined) {
      request.input = payload as JsonValue;
    }
    events.push({ type: "input.requested", request });
  };

  const ensureNamespace = (events: StreamEvent[], namespace: readonly string[]): void => {
    for (let index = 1; index <= namespace.length; index += 1) {
      const path = namespace.slice(0, index).join("/");
      if (openNamespaces.has(path) || closedNamespaces.has(path)) continue;
      openNamespaces.add(path);
      events.push({
        type: "operation.started",
        operationId: path,
        operation: { kind: "subagent", name: segmentName(namespace[index - 1]!) },
      });
    }
  };

  const closeNamespace = (
    events: StreamEvent[],
    path: string,
    terminalStatus: "completed" | "failed",
  ): void => {
    if (!openNamespaces.has(path)) return;
    const descendants = [...openNamespaces]
      .filter((candidate) => candidate.startsWith(`${path}/`))
      .sort((left, right) => right.split("/").length - left.split("/").length);
    for (const descendant of descendants) {
      openNamespaces.delete(descendant);
      closedNamespaces.add(descendant);
      events.push({
        type: "operation.finished",
        operationId: descendant,
        kind: "subagent",
        status: terminalStatus,
      });
    }
    openNamespaces.delete(path);
    closedNamespaces.add(path);
    events.push({
      type: "operation.finished",
      operationId: path,
      kind: "subagent",
      status: terminalStatus,
    });
  };

  const closeAllNamespaces = (events: StreamEvent[], terminalStatus: "completed" | "failed"): void => {
    for (const path of [...openNamespaces].sort(
      (left, right) => right.split("/").length - left.split("/").length,
    )) {
      if (openNamespaces.has(path)) closeNamespace(events, path, terminalStatus);
    }
  };

  const messageKey = (event: LangGraphEventLike, namespace: readonly string[]): string =>
    `${namespace.join("/")}\u0000${event.params?.node ?? ""}`;

  const blockKey = (index: unknown): string | undefined =>
    typeof index === "string" || typeof index === "number" ? String(index) : undefined;

  const emitContentBlock = (
    events: StreamEvent[],
    role: "assistant" | "user",
    block: globalThis.Record<string, unknown>,
  ): void => {
    if (block.type === "text" && typeof block.text === "string" && block.text.length > 0) {
      events.push({ type: "message", role, text: block.text });
      return;
    }
    if (block.type === "reasoning") {
      const reasoning = str(block.reasoning) ?? str(block.text);
      if (reasoning !== undefined) events.push({ type: "thinking", text: reasoning });
      return;
    }
    if (block.type === "tool_call" && role === "assistant") {
      const callId = str(block.id);
      const name = str(block.name);
      if (callId !== undefined && name !== undefined) emitStarted(events, callId, name, block.args);
    }
  };

  const handleMessages = (
    events: StreamEvent[],
    event: LangGraphEventLike,
    namespace: readonly string[],
  ): void => {
    const data = dataOf(event);
    const kind = str(data.event);
    const key = messageKey(event, namespace);
    switch (kind) {
      case "message-start": {
        const role = data.role === "human" ? "user" : data.role === "ai" ? "assistant" : undefined;
        if (role !== undefined) messageRoles.set(key, role);
        messageBlocks.set(key, new Map());
        break;
      }
      case "content-block-start": {
        const index = blockKey(data.index);
        if (index !== undefined && isRecord(data.content)) {
          const blocks = messageBlocks.get(key) ?? new Map();
          blocks.set(index, { ...data.content });
          messageBlocks.set(key, blocks);
        }
        break;
      }
      case "content-block-delta": {
        const index = blockKey(data.index);
        if (index === undefined || !isRecord(data.delta)) break;
        const blocks = messageBlocks.get(key) ?? new Map();
        const block = blocks.get(index) ?? {};
        if (data.delta.type === "text-delta" && typeof data.delta.text === "string") {
          block.text = `${typeof block.text === "string" ? block.text : ""}${data.delta.text}`;
        } else if (data.delta.type === "reasoning-delta" && typeof data.delta.reasoning === "string") {
          block.reasoning = `${typeof block.reasoning === "string" ? block.reasoning : ""}${data.delta.reasoning}`;
        } else if (data.delta.type === "block-delta" && isRecord(data.delta.fields)) {
          Object.assign(block, data.delta.fields);
        } else if (data.delta.type === "data-delta" && typeof data.delta.data === "string") {
          block.base64 = `${typeof block.base64 === "string" ? block.base64 : ""}${data.delta.data}`;
        }
        blocks.set(index, block);
        messageBlocks.set(key, blocks);
        break;
      }
      case "content-block-finish": {
        const index = blockKey(data.index);
        const accumulated = index === undefined ? undefined : messageBlocks.get(key)?.get(index);
        const finalized = isRecord(data.content) ? data.content : accumulated;
        const role = messageRoles.get(key);
        if (finalized !== undefined && role !== undefined) emitContentBlock(events, role, finalized);
        if (index !== undefined) messageBlocks.get(key)?.delete(index);
        break;
      }
      case "message-finish":
        addUsage(data.usage);
        messageRoles.delete(key);
        messageBlocks.delete(key);
        break;
      case "error": {
        const message = str(data.message);
        if (message !== undefined) events.push({ type: "error", message });
        messageRoles.delete(key);
        messageBlocks.delete(key);
        break;
      }
      default:
        break;
    }
  };

  const handleTools = (events: StreamEvent[], event: LangGraphEventLike): void => {
    const data = dataOf(event);
    const kind = str(data.event);
    const callId = str(data.tool_call_id);
    if (callId === undefined) return;
    switch (kind) {
      case "tool-started": {
        const name = str(data.tool_name);
        if (name !== undefined) emitStarted(events, callId, name, data.input);
        break;
      }
      case "tool-output-delta":
        if (typeof data.delta === "string") {
          toolOutputDeltas.set(callId, `${toolOutputDeltas.get(callId) ?? ""}${data.delta}`);
        }
        break;
      case "tool-finished": {
        const output = data.output ?? toolOutputDeltas.get(callId);
        toolOutputDeltas.delete(callId);
        emitFinished(events, callId, output, "completed");
        break;
      }
      case "tool-error": {
        toolOutputDeltas.delete(callId);
        const rejected = rejectedCallIds.has(callId);
        emitFinished(
          events,
          callId,
          rejected ? undefined : str(data.message),
          rejected ? "rejected" : "failed",
        );
        break;
      }
      default:
        break;
    }
  };

  const handleLifecycle = (
    events: StreamEvent[],
    event: LangGraphEventLike,
    namespace: readonly string[],
  ): void => {
    const data = dataOf(event);
    const lifecycle = str(data.event);
    if (namespace.length > 0) {
      const path = namespace.join("/");
      if (lifecycle === "completed" || lifecycle === "failed") closeNamespace(events, path, lifecycle);
      else if (lifecycle === "interrupted") status = "waiting";
      return;
    }
    if (lifecycle === "completed") {
      status = "completed";
      closeAllNamespaces(events, "completed");
    } else if (lifecycle === "failed") {
      status = "failed";
      const message = str(data.error);
      if (message !== undefined) events.push({ type: "error", message });
      closeAllNamespaces(events, "failed");
    } else if (lifecycle === "interrupted") {
      status = "waiting";
    }
  };

  const translate = (event: LangGraphEventLike): StreamEvent[] => {
    const events: StreamEvent[] = [];
    if (event.type !== "event") return events;
    const namespace = namespaceOf(event);
    switch (event.method) {
      case "messages":
        ensureNamespace(events, namespace);
        handleMessages(events, event, namespace);
        break;
      case "tools":
        ensureNamespace(events, namespace);
        handleTools(events, event);
        break;
      case "input.requested": {
        ensureNamespace(events, namespace);
        const data = dataOf(event);
        const interruptId = str(data.interrupt_id);
        if (interruptId !== undefined) emitInputRequested(events, interruptId, data.payload);
        break;
      }
      case "lifecycle":
        ensureNamespace(events, namespace);
        handleLifecycle(events, event, namespace);
        break;
      default:
        // values, updates, checkpoints, tasks and extensions have no standard
        // NiceEval event, including no inferred namespace operation. Their seq
        // still advances in add().
        break;
    }
    return events;
  };

  return {
    get usage() {
      return usage;
    },
    get status() {
      return status;
    },
    markRejected(toolCallId) {
      assertOpen("mark a rejected tool call");
      rejectedCallIds.add(toolCallId);
    },
    add(event) {
      assertOpen("add an event");
      const seq = Number.isSafeInteger(event.seq) && (event.seq ?? -1) >= 0 ? event.seq : undefined;
      if (seq === undefined) return translate(event);
      if (nextSeq === undefined) nextSeq = seq;
      if (seq < nextSeq || pendingBySeq.has(seq)) return [];
      pendingBySeq.set(seq, event);
      const events: StreamEvent[] = [];
      while (nextSeq !== undefined) {
        const next = pendingBySeq.get(nextSeq);
        if (next === undefined) break;
        pendingBySeq.delete(nextSeq);
        nextSeq += 1;
        events.push(...translate(next));
      }
      return events;
    },
    end() {
      if (ended) return [];
      ended = true;
      const events: StreamEvent[] = [];
      for (const [, event] of [...pendingBySeq.entries()].sort(([left], [right]) => left - right)) {
        events.push(...translate(event));
      }
      pendingBySeq.clear();
      return events;
    },
  };
}
