// 从归一化的 StreamEvent[] 折叠出结构化事实。
//   - deriveRunFacts:既有断言面消费的 legacy DerivedFacts(按 operationId 把 started+finished 折成 ToolCall);
//     它不承载新的 logical occurrence / lifecycle 契约；新的 Fact 路径必须调用
//     deriveLogicalToolOccurrences。
//   - buildO11ySummary:给人看的 o11y 摘要,同时是宿主侧 `t.o11y` 与落盘 o11y.json 的同一份算法。
// 一旦事件流归一好了,这两个折叠对所有 agent 通用。

import type {
  StreamEvent,
  DerivedFacts,
  ToolCall,
  SubagentCall,
  InputRequest,
  O11ySummary,
  TraceSpan,
  Usage,
  ToolName,
  JsonValue,
  EventPosition,
  LogicalToolLifecycle,
  LogicalToolOccurrence,
  LogicalToolOccurrenceDerivation,
  LogicalToolOccurrenceDeriveOptions,
  LogicalToolOccurrenceScopeTurn,
  OrphanToolOperationFinish,
} from "../types.ts";
import type {
  EventId,
  ItemId,
  PositiveSafeInteger,
  SessionScopeId,
  ToolOccurrenceId,
  TurnId,
} from "./record/model.ts";
import type {
  ObservedSourceEvent,
  ToolOccurrenceRelation,
} from "./observed.ts";

export interface ObservedSourceProjectionSegment {
  readonly sessionId: SessionScopeId;
  readonly turnId: TurnId;
  readonly items: readonly ObservedSourceEvent[];
}

export interface ObservedEventLedgerRow {
  readonly eventId: EventId;
  readonly itemId: ItemId;
  readonly sessionId: SessionScopeId;
  readonly turnId: TurnId;
  readonly sessionSequence: PositiveSafeInteger;
  readonly event: ObservedSourceEvent;
}

export interface ObservedToolOccurrenceLedgerRow {
  readonly toolOccurrenceId: ToolOccurrenceId;
  readonly sessionId: SessionScopeId;
  /** Logical Turn membership belongs only to the start event. */
  readonly homeTurnId: TurnId;
  readonly startEventId: EventId;
  readonly startSessionSequence: PositiveSafeInteger;
  readonly finish: null | {
    readonly eventId: EventId;
    /** The finish retains its actual physical Turn. */
    readonly turnId: TurnId;
    readonly sessionSequence: PositiveSafeInteger;
  };
}

export type ObservedSourceProjectionIssue =
  | "duplicate-event-id"
  | "duplicate-item-id"
  | "duplicate-session-sequence"
  | "non-increasing-segment-sequence"
  | "duplicate-tool-start"
  | "exact-finish-without-start"
  | "cross-session-tool-finish"
  | "non-later-tool-finish"
  | "duplicate-exact-tool-finish";

export type ObservedSourceProjection =
  | {
      readonly state: "available";
      readonly events: readonly ObservedEventLedgerRow[];
      readonly toolOccurrences: readonly ObservedToolOccurrenceLedgerRow[];
    }
  | {
      readonly state: "invalid";
      readonly issues: readonly ObservedSourceProjectionIssue[];
    };

interface MutableObservedToolOccurrence {
  readonly toolOccurrenceId: ToolOccurrenceId;
  readonly sessionId: SessionScopeId;
  readonly homeTurnId: TurnId;
  readonly startEventId: EventId;
  readonly startSessionSequence: PositiveSafeInteger;
  finish: ObservedToolOccurrenceLedgerRow["finish"];
}

/**
 * The sole pure projector for current observed source rows. It validates
 * source-owned identity and lifecycle without access to Adapter operation IDs.
 */
export function projectObservedSourceEvents(
  segments: readonly ObservedSourceProjectionSegment[],
): ObservedSourceProjection {
  const issues = new Set<ObservedSourceProjectionIssue>();
  const eventIds = new Set<EventId>();
  const itemIds = new Set<ItemId>();
  const sequenceBySession = new Map<SessionScopeId, Set<number>>();
  const sessionOrder = new Map<SessionScopeId, number>();
  const events: ObservedEventLedgerRow[] = [];

  for (const segment of segments) {
    if (!sessionOrder.has(segment.sessionId)) {
      sessionOrder.set(segment.sessionId, sessionOrder.size);
    }
    let previousSequence = 0;
    const sessionSequences = sequenceBySession.get(segment.sessionId) ?? new Set<number>();
    sequenceBySession.set(segment.sessionId, sessionSequences);
    for (const event of segment.items) {
      if (eventIds.has(event.eventId)) issues.add("duplicate-event-id");
      if (itemIds.has(event.itemId)) issues.add("duplicate-item-id");
      if (sessionSequences.has(event.sessionSequence)) issues.add("duplicate-session-sequence");
      if (event.sessionSequence <= previousSequence) issues.add("non-increasing-segment-sequence");
      eventIds.add(event.eventId);
      itemIds.add(event.itemId);
      sessionSequences.add(event.sessionSequence);
      previousSequence = event.sessionSequence;
      events.push(Object.freeze({
        eventId: event.eventId,
        itemId: event.itemId,
        sessionId: segment.sessionId,
        turnId: segment.turnId,
        sessionSequence: event.sessionSequence,
        event,
      }));
    }
  }

  const orderedEvents = [...events].sort((left, right) =>
    (sessionOrder.get(left.sessionId) ?? Number.MAX_SAFE_INTEGER) -
      (sessionOrder.get(right.sessionId) ?? Number.MAX_SAFE_INTEGER) ||
    left.sessionSequence - right.sessionSequence
  );
  const occurrences = new Map<ToolOccurrenceId, MutableObservedToolOccurrence>();
  for (const row of orderedEvents) {
    if (row.event.kind === "tool-start") {
      if (occurrences.has(row.event.toolOccurrenceId)) {
        issues.add("duplicate-tool-start");
        continue;
      }
      occurrences.set(row.event.toolOccurrenceId, {
        toolOccurrenceId: row.event.toolOccurrenceId,
        sessionId: row.sessionId,
        homeTurnId: row.turnId,
        startEventId: row.eventId,
        startSessionSequence: row.sessionSequence,
        finish: null,
      });
      continue;
    }
    if (row.event.kind !== "tool-finish" || row.event.occurrence.state !== "exact") continue;
    applyExactFinish(occurrences, row, row.event.occurrence, issues);
  }

  if (issues.size > 0) {
    return Object.freeze({ state: "invalid" as const, issues: Object.freeze([...issues].sort()) });
  }
  return Object.freeze({
    state: "available" as const,
    events: Object.freeze(orderedEvents),
    toolOccurrences: Object.freeze([...occurrences.values()]
      .map((occurrence) => Object.freeze({ ...occurrence }))),
  });
}

function applyExactFinish(
  occurrences: Map<ToolOccurrenceId, MutableObservedToolOccurrence>,
  row: ObservedEventLedgerRow,
  relation: Extract<ToolOccurrenceRelation, { readonly state: "exact" }>,
  issues: Set<ObservedSourceProjectionIssue>,
): void {
  const occurrence = occurrences.get(relation.toolOccurrenceId);
  if (occurrence === undefined) {
    issues.add("exact-finish-without-start");
    return;
  }
  if (occurrence.sessionId !== row.sessionId) {
    issues.add("cross-session-tool-finish");
    return;
  }
  if (occurrence.startSessionSequence >= row.sessionSequence) {
    issues.add("non-later-tool-finish");
    return;
  }
  if (occurrence.finish !== null) {
    issues.add("duplicate-exact-tool-finish");
    return;
  }
  occurrence.finish = Object.freeze({
    eventId: row.eventId,
    turnId: row.turnId,
    sessionSequence: row.sessionSequence,
  });
}

// ───────────────────────── 小工具 ─────────────────────────

/** 把 JsonValue 当对象取字段;非对象返回 undefined。 */
function field(input: JsonValue | undefined, key: string): JsonValue | undefined {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return (input as globalThis.Record<string, JsonValue>)[key];
  }
  return undefined;
}

/** 按候选 key 顺序取第一个字符串。 */
function pickString(input: JsonValue | undefined, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = field(input, k);
    if (typeof v === "string" && v) return v;
  }
  return undefined;
}

/** command 可能是 string 或 string[],归一成一行命令文本。 */
function pickCommand(input: JsonValue | undefined): string | undefined {
  const cmd = field(input, "command") ?? field(input, "cmd");
  if (typeof cmd === "string") return cmd;
  if (Array.isArray(cmd)) return cmd.filter((p) => typeof p === "string").join(" ");
  const program = field(input, "program");
  const args = field(input, "args");
  if (typeof program === "string" && Array.isArray(args)) {
    return `${program} ${args.filter((p) => typeof p === "string").join(" ")}`;
  }
  return undefined;
}

/** 从工具结果 output 里抠 exit_code(codex shell 结果常嵌在 output / metadata 里)。 */
function pickExitCode(output: JsonValue | undefined): number | undefined {
  const direct = field(output, "exit_code") ?? field(output, "exitCode");
  if (typeof direct === "number") return direct;
  const meta = field(output, "metadata");
  const nested = field(meta, "exit_code") ?? field(meta, "exitCode");
  if (typeof nested === "number") return nested;
  return undefined;
}

// ───────────────────────── deriveRunFacts ─────────────────────────

export function deriveRunFacts(events: readonly StreamEvent[]): DerivedFacts {
  // 折叠是逐条按发生顺序进行的:started 追加一条新操作,finished 回填「当前还没配上 finished 的
  // 同 operationId 操作」。operationId 只在一个 started→finished 配对内保证稳定,不保证跨轮唯一。
  // 同一个 id 在 finished 后再次 started 是一条新操作，不覆盖前一轮记录。
  const toolCalls: ToolCall[] = [];
  const openToolByOperationId = new Map<string, number>();
  const subagentCalls: SubagentCall[] = [];
  const openSubagentByOperationId = new Map<string, number>();
  const inputRequests: InputRequest[] = [];
  let messageCount = 0;
  let compactions = 0;
  let contextInjections = 0;

  for (const ev of events) {
    switch (ev.type) {
      case "message":
        messageCount += 1;
        break;

      case "context.injected":
        contextInjections += 1;
        break;

      case "operation.started": {
        if (ev.operation.kind === "tool") {
          openToolByOperationId.set(ev.operationId, toolCalls.length);
          toolCalls.push({
            operationId: ev.operationId,
            name: ev.operation.tool ?? "unknown",
            originalName: ev.operation.name,
            input: ev.operation.input,
            status: "pending",
          });
        } else {
          openSubagentByOperationId.set(ev.operationId, subagentCalls.length);
          subagentCalls.push({
            operationId: ev.operationId,
            name: ev.operation.name,
            remoteUrl: ev.operation.remoteUrl,
            status: "pending",
          });
        }
        break;
      }

      case "operation.finished": {
        if (ev.kind === "tool") {
          const idx = openToolByOperationId.get(ev.operationId);
          if (idx !== undefined) {
            toolCalls[idx].output = ev.output;
            toolCalls[idx].status = ev.status;
            openToolByOperationId.delete(ev.operationId);
          } else {
            toolCalls.push({
              operationId: ev.operationId,
              name: "unknown",
              input: null,
              output: ev.output,
              status: ev.status,
            });
          }
        } else {
          const idx = openSubagentByOperationId.get(ev.operationId);
          if (idx !== undefined) {
            subagentCalls[idx].output = ev.output;
            subagentCalls[idx].status = ev.status;
            openSubagentByOperationId.delete(ev.operationId);
          } else {
            subagentCalls.push({
              operationId: ev.operationId,
              name: "unknown",
              output: ev.output,
              status: ev.status,
            });
          }
        }
        break;
      }

      case "input.requested":
        inputRequests.push(ev.request);
        break;

      case "compaction":
        compactions += 1;
        break;

      default:
        break;
    }
  }

  // parked:最后一条「有意义」的事件是 input.requested(忽略 thinking / compaction 这类尾随噪声)。
  let parked = false;
  for (let i = events.length - 1; i >= 0; i--) {
    const t = events[i].type;
    if (t === "thinking" || t === "compaction") continue;
    parked = t === "input.requested";
    break;
  }

  return {
    toolCalls,
    subagentCalls,
    inputRequests,
    parked,
    messageCount,
    compactions,
    contextInjections,
  };
}

// ───────────────────────── logical tool occurrences ─────────────────────────

interface PendingLogicalToolOccurrence {
  readonly occurrence: Omit<LogicalToolOccurrence, "lifecycle">;
  finished?: ToolOperationFinish;
  /** 同一 operationId 在前一笔未结束时再次 started，无法可靠把后续 finish 交给任一笔。 */
  ambiguous?: boolean;
}

interface ToolOperationFinish {
  readonly status: "completed" | "failed" | "rejected";
  readonly position: EventPosition;
  readonly output: LogicalToolOccurrence["output"];
}

/**
 * 从一条 Turn 的有序事件流关联 logical tool occurrence。
 *
 * occurrence identity 锚定在 started 的 session/turn/event position；operationId 只在一笔
 * 未结束 operation 的 started → finished 配对期间使用。orphan finished 因而只作为协议诊断
 * 返回，不能伪造 input、command 或可匹配的 occurrence。
 */
export function deriveLogicalToolOccurrences(
  events: readonly StreamEvent[],
  options: LogicalToolOccurrenceDeriveOptions,
): LogicalToolOccurrenceDerivation {
  assertOccurrenceScope(options);

  const firstEventOrdinal = options.firstEventOrdinal ?? 0;
  assertNonNegativeSafeInteger(firstEventOrdinal, "firstEventOrdinal");

  const pending: PendingLogicalToolOccurrence[] = [];
  const openByOperationId = new Map<string, PendingLogicalToolOccurrence>();
  const ambiguousOperationIds = new Set<string>();
  const orphanFinishes: OrphanToolOperationFinish[] = [];

  for (let eventIndex = 0; eventIndex < events.length; eventIndex += 1) {
    const event = events[eventIndex]!;
    const position = eventPosition(options.turnOrdinal, firstEventOrdinal + eventIndex);

    if (event.type === "operation.started" && event.operation.kind === "tool") {
      const occurrence: PendingLogicalToolOccurrence = {
        occurrence: {
          id: logicalOccurrenceId(options, position),
          session: options.session,
          turn: options.turn,
          name: event.operation.tool === undefined
            ? { original: event.operation.name }
            : { original: event.operation.name, canonical: event.operation.tool },
          input: evidenceForEventValue(event, "input", event.operation.input),
          output: { state: "unavailable", reason: "tool-output-not-finished" },
          ...(event.operation.command === undefined ? {} : { command: event.operation.command }),
          start: position,
        },
      };

      const alreadyOpen = openByOperationId.get(event.operationId);
      if (ambiguousOperationIds.has(event.operationId)) {
        occurrence.ambiguous = true;
      } else if (alreadyOpen !== undefined) {
        // operationId 只允许在前一笔结束后复用。重叠复用时不能可靠配对，宁可让 lifecycle
        // unavailable，也不把一个 finish 错写给另一笔 occurrence。
        alreadyOpen.ambiguous = true;
        occurrence.ambiguous = true;
        openByOperationId.delete(event.operationId);
        ambiguousOperationIds.add(event.operationId);
      } else {
        openByOperationId.set(event.operationId, occurrence);
      }
      pending.push(occurrence);
      continue;
    }

    if (event.type === "operation.finished" && event.kind === "tool") {
      const finished: ToolOperationFinish = {
        status: event.status,
        position,
        output: event.output === undefined
          ? { state: "unavailable", reason: "tool-output-absent" }
          : evidenceForEventValue(event, "output", event.output),
      };
      const started = openByOperationId.get(event.operationId);
      if (started === undefined || ambiguousOperationIds.has(event.operationId)) {
        orphanFinishes.push({
          session: options.session,
          turn: options.turn,
          operationId: event.operationId,
          status: finished.status,
          position: finished.position,
        });
      } else {
        started.finished = finished;
        openByOperationId.delete(event.operationId);
      }
    }
  }

  return {
    occurrences: pending.map((item) => ({
      ...item.occurrence,
      output: outputFor(item, options.outcome),
      lifecycle: lifecycleFor(item, options.outcome),
    })),
    orphanFinishes,
  };
}

function evidenceForEventValue(
  event: StreamEvent,
  field: string,
  value: JsonValue,
): LogicalToolOccurrence["input"] {
  const redacted = opaquePointersFor(event.redacted, field);
  if (redacted.length > 0) {
    return Object.freeze({
      state: "partial" as const,
      value,
      opaquePointers: redacted,
      reason: "redacted" as const,
    });
  }
  const truncated = opaquePointersFor(event.truncated?.map((entry) => entry.path), field);
  if (truncated.length > 0) {
    return Object.freeze({
      state: "partial" as const,
      value,
      opaquePointers: truncated,
      reason: "truncated" as const,
    });
  }
  return Object.freeze({ state: "complete" as const, value });
}

/**
 * Event truncation paths begin with the event field (`input`, `output`) and
 * use dots for nested JSON segments.  Project them into the field-relative
 * JSON-pointer form that Match diagnostics can retain.  Accepting an already
 * pointer-shaped producer path makes redaction declarations equally precise.
 */
function opaquePointersFor(paths: readonly string[] | undefined, field: string): readonly string[] {
  if (paths === undefined || paths.length === 0) return Object.freeze([]);
  const pointers = new Set<string>();
  for (const path of paths) {
    const pointer = fieldRelativePointer(path, field);
    if (pointer !== undefined) pointers.add(pointer);
  }
  return Object.freeze([...pointers]);
}

function fieldRelativePointer(path: string, field: string): string | undefined {
  const dotPath = path.startsWith("operation.") ? path.slice("operation.".length) : path;
  if (dotPath === field) return "/";
  if (dotPath.startsWith(`${field}.`)) {
    return `/${dotPath.slice(field.length + 1).split(".").map(escapeJsonPointer).join("/")}`;
  }
  if (!path.startsWith("/")) return undefined;
  const segments = path.slice(1).split("/");
  if (segments[0] !== field) return undefined;
  return segments.length === 1 ? "/" : `/${segments.slice(1).join("/")}`;
}

function escapeJsonPointer(segment: string): string {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}

function outputFor(
  occurrence: PendingLogicalToolOccurrence,
  outcome: LogicalToolOccurrenceDeriveOptions["outcome"],
): LogicalToolOccurrence["output"] {
  if (occurrence.finished !== undefined && !occurrence.ambiguous) return occurrence.finished.output;
  if (outcome !== undefined && !occurrence.ambiguous) {
    return Object.freeze({ state: "unavailable" as const, reason: "tool-output-pending" });
  }
  return Object.freeze({ state: "unavailable" as const, reason: "tool-output-missing-lifecycle-evidence" });
}

function lifecycleFor(
  occurrence: PendingLogicalToolOccurrence,
  outcome: LogicalToolOccurrenceDeriveOptions["outcome"],
): LogicalToolLifecycle {
  if (occurrence.finished !== undefined && !occurrence.ambiguous) {
    return {
      state: "available",
      status: occurrence.finished.status,
      finish: occurrence.finished.position,
    };
  }
  // A trustworthy Turn outcome closes the response boundary, not every external tool call.
  // A visible, unambiguous start without a finish is therefore a pending call. Only a
  // genuinely partial stream (no outcome) or an ambiguous pairing remains opaque.
  if (outcome !== undefined && !occurrence.ambiguous) {
    return { state: "available", status: "pending" };
  }
  return {
    state: "opaque",
    reason: outcome === undefined ? "partial-stream" : "missing-lifecycle-evidence",
  };
}

function assertOccurrenceScope(options: LogicalToolOccurrenceDeriveOptions): void {
  if (options.session.length === 0) throw new Error("Logical tool occurrence session must not be empty.");
  if (options.turn.length === 0) throw new Error("Logical tool occurrence turn must not be empty.");
  assertNonNegativeSafeInteger(options.turnOrdinal, "turnOrdinal");
}

function assertNonNegativeSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Logical tool occurrence ${name} must be a non-negative safe integer.`);
  }
}

function eventPosition(turnOrdinal: number, eventOrdinal: number): EventPosition {
  assertNonNegativeSafeInteger(eventOrdinal, "eventOrdinal");
  return { turnOrdinal, eventOrdinal };
}

function logicalOccurrenceId(
  options: LogicalToolOccurrenceDeriveOptions,
  start: EventPosition,
): string {
  // JSON array encoding avoids delimiter collision when adapter-provided session / turn IDs contain punctuation.
  return JSON.stringify(["niceeval.logical-tool-occurrence/1", options.session, options.turn, start.turnOrdinal, start.eventOrdinal]);
}

/**
 * Projects a frozen scope into logical tool occurrences.  Pairing is scoped
 * per Session, never across sessions, because operationId is only stable for
 * one started → finished lifecycle in one session.  A finish in a later Turn
 * therefore closes an earlier open start in that same session.
 */
export function deriveScopedLogicalToolOccurrences(
  turns: readonly LogicalToolOccurrenceScopeTurn[],
): LogicalToolOccurrenceDerivation {
  const occurrences: LogicalToolOccurrence[] = [];
  const orphanFinishes: OrphanToolOperationFinish[] = [];
  const bySession = new Map<string, LogicalToolOccurrenceScopeTurn[]>();
  for (const turn of turns) {
    const prior = bySession.get(turn.session);
    if (prior === undefined) bySession.set(turn.session, [turn]);
    else prior.push(turn);
  }

  for (const sessionTurns of bySession.values()) {
    const ordered = [...sessionTurns].sort((left, right) => left.turnOrdinal - right.turnOrdinal);
    const pending: PendingScopedOccurrence[] = [];
    const openByOperationId = new Map<string, PendingScopedOccurrence>();
    const ambiguousOperationIds = new Set<string>();

    for (const turn of ordered) {
      assertOccurrenceScope(turn);
      const firstEventOrdinal = turn.firstEventOrdinal ?? 0;
      assertNonNegativeSafeInteger(firstEventOrdinal, "firstEventOrdinal");
      for (let eventIndex = 0; eventIndex < turn.events.length; eventIndex += 1) {
        const event = turn.events[eventIndex]!;
        const position = eventPosition(turn.turnOrdinal, firstEventOrdinal + eventIndex);
        if (event.type === "operation.started" && event.operation.kind === "tool") {
          const occurrence: PendingScopedOccurrence = {
            occurrence: {
              id: logicalOccurrenceId(turn, position),
              session: turn.session,
              turn: turn.turn,
              name: event.operation.tool === undefined
                ? { original: event.operation.name }
                : { original: event.operation.name, canonical: event.operation.tool },
              input: evidenceForEventValue(event, "input", event.operation.input),
              output: { state: "unavailable", reason: "tool-output-not-finished" },
              ...(event.operation.command === undefined ? {} : { command: event.operation.command }),
              start: position,
            },
            lastOutcome: turn.outcome,
          };
          const alreadyOpen = openByOperationId.get(event.operationId);
          if (ambiguousOperationIds.has(event.operationId)) {
            occurrence.ambiguous = true;
          } else if (alreadyOpen !== undefined) {
            alreadyOpen.ambiguous = true;
            occurrence.ambiguous = true;
            openByOperationId.delete(event.operationId);
            ambiguousOperationIds.add(event.operationId);
          } else {
            openByOperationId.set(event.operationId, occurrence);
          }
          pending.push(occurrence);
          continue;
        }
        if (event.type === "operation.finished" && event.kind === "tool") {
          const finished: ToolOperationFinish = {
            status: event.status,
            position,
            output: event.output === undefined
              ? { state: "unavailable", reason: "tool-output-absent" }
              : evidenceForEventValue(event, "output", event.output),
          };
          const started = openByOperationId.get(event.operationId);
          if (started === undefined || ambiguousOperationIds.has(event.operationId)) {
            orphanFinishes.push({
              session: turn.session,
              turn: turn.turn,
              operationId: event.operationId,
              status: finished.status,
              position: finished.position,
            });
          } else {
            started.finished = finished;
            openByOperationId.delete(event.operationId);
          }
        }
      }
      for (const open of openByOperationId.values()) open.lastOutcome = turn.outcome;
    }

    for (const item of pending) {
      occurrences.push(Object.freeze({
        ...item.occurrence,
        output: outputFor(item, item.lastOutcome),
        lifecycle: lifecycleFor(item, item.lastOutcome),
      }));
    }
  }
  return Object.freeze({
    occurrences: Object.freeze(occurrences),
    orphanFinishes: Object.freeze(orphanFinishes),
  });
}

interface PendingScopedOccurrence extends PendingLogicalToolOccurrence {
  lastOutcome: LogicalToolOccurrenceDeriveOptions["outcome"];
}

// ───────────────────────── extractUsageFromSpans ─────────────────────────

/**
 * adapter 未报 usage 时的兜底:从 OTLP span 属性里提取 token 用量。
 * 按 OpenTelemetry GenAI 语义约定累加所有模型调用 span 的用量字段。
 * 返回 undefined 表示 span 里也没有用量信息。
 */
export function extractUsageFromSpans(spans: readonly TraceSpan[]): Usage | undefined {
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheCreationTokens = 0;

  for (const span of spans) {
    const a = span.attributes ?? {};
    // OpenTelemetry GenAI 语义约定(新旧两套 key 都认);cache_read/cache_creation 是
    // 常见 vendor instrumentation(如 Anthropic OTel 插桩)对同一约定族的扩展属性。
    inputTokens += numAttr(a, "gen_ai.usage.input_tokens", "gen_ai.usage.prompt_tokens");
    outputTokens += numAttr(a, "gen_ai.usage.output_tokens", "gen_ai.usage.completion_tokens");
    cacheReadTokens += numAttr(a, "gen_ai.usage.cache_read_input_tokens");
    cacheCreationTokens += numAttr(a, "gen_ai.usage.cache_creation_input_tokens");
  }

  if (inputTokens === 0 && outputTokens === 0) return undefined;
  const u: Usage = { inputTokens, outputTokens };
  if (cacheReadTokens > 0) u.cacheReadTokens = cacheReadTokens;
  if (cacheCreationTokens > 0) u.cacheCreationTokens = cacheCreationTokens;
  return u;
}

function numAttr(attrs: globalThis.Record<string, JsonValue>, ...keys: string[]): number {
  for (const k of keys) {
    const v = attrs[k];
    if (typeof v === "number" && v > 0) return v;
  }
  return 0;
}

// ───────────────────────── buildO11ySummary ─────────────────────────

export function buildO11ySummary(events: readonly StreamEvent[]): O11ySummary {
  const toolCalls: Partial<globalThis.Record<ToolName, number>> = {};
  let totalToolCalls = 0;
  const filesRead = new Set<string>();
  const filesModified = new Set<string>();
  const shellCommands: { command: string; exitCode?: number; success?: boolean }[] = [];
  const webFetches: { url: string; status?: number; success?: boolean }[] = [];
  const errors: string[] = [];
  let thinkingBlocks = 0;
  let compactions = 0;
  let totalTurns = 0;

  for (const ev of events) {
    switch (ev.type) {
      case "message":
        if (ev.role === "assistant") totalTurns += 1;
        break;

      case "thinking":
        thinkingBlocks += 1;
        break;

      case "compaction":
        compactions += 1;
        break;

      case "error":
        if (ev.message) errors.push(ev.message);
        break;

      default:
        break;
    }
  }

  // 人读摘要直接消费同一份严格配对后的 ToolCall，避免按 operationId 全局索引时把跨轮复用
  // 或 finished-before-started 容错事件错配给另一条操作。没有 originalName 的是孤儿 finished 占位。
  for (const call of deriveRunFacts(events).toolCalls) {
    if (call.originalName === undefined) continue;
    const canonical: ToolName = call.name;
    toolCalls[canonical] = (toolCalls[canonical] ?? 0) + 1;
    totalToolCalls += 1;

    if (canonical === "file_read") {
      const path = pickString(call.input, ["path", "file", "file_path", "filename"]);
      if (path) filesRead.add(path);
    } else if (canonical === "file_write" || canonical === "file_edit") {
      const path = pickString(call.input, ["path", "file", "file_path", "filename"]);
      if (path) filesModified.add(path);
    } else if (canonical === "shell") {
      const command = pickCommand(call.input);
      if (command) {
        const entry: { command: string; exitCode?: number; success?: boolean } = { command };
        if (call.status !== "pending") {
          entry.success = call.status === "completed";
          const exit = pickExitCode(call.output);
          if (exit !== undefined) entry.exitCode = exit;
        }
        shellCommands.push(entry);
      }
    } else if (canonical === "web_fetch") {
      const url = pickString(call.input, ["url", "uri", "endpoint", "href"]);
      if (url) {
        const entry: { url: string; status?: number; success?: boolean } = { url };
        if (call.status !== "pending") {
          entry.success = call.status === "completed";
          const status = field(call.output, "status");
          if (typeof status === "number") entry.status = status;
        }
        webFetches.push(entry);
      }
    }
  }

  return {
    totalTurns,
    toolCalls,
    totalToolCalls,
    filesRead: Array.from(filesRead),
    filesModified: Array.from(filesModified),
    shellCommands,
    webFetches,
    errors,
    thinkingBlocks,
    compactions,
  };
}
