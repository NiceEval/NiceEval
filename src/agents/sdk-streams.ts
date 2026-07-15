// SDK 原生事件流 → 标准 StreamEvent 的官方转换器(+ 通用 SSE 读帧器)。
//
// 定位:各 agent SDK 的流式协议(Claude Agent SDK 的 `SDKMessage`、pi-agent-core 的
// `AgentEvent`、Codex SDK 的 `ThreadEvent`)是 SDK 定义的通用协议,不是某个应用的私有格式——
// 这层映射知识属于 niceeval 官方包,adapter 里只该剩传输粘合(应用把流放在哪个端点、
// 审批走什么端点)。类型全部用结构化的 *Like 声明(同 fromAiSdk 的先例),不依赖任何 SDK 包。
//
// 用法(以 Claude Agent SDK 为例):
//
// ```typescript
// import { sseJsonFrames, fromClaudeSdkMessages } from "niceeval/adapter";
//
// const frames = sseJsonFrames<SDKMessage>(res.body);
// const stream = fromClaudeSdkMessages();
// for (;;) {
//   const frame = await frames.next();
//   if (frame === null) break;
//   events.push(...stream.add(frame));   // 逐帧翻译;认不出的帧返回 []
// }
// return { status: stream.failed ? "failed" : "completed", events, usage: stream.usage };
// ```

import type { JsonValue, StreamEvent, ToolName, Usage } from "../types.ts";
import { normalizeToolName } from "../o11y/tool-names.ts";
import { CODEX_TOOL_ALIASES } from "../o11y/parsers/codex.ts";

// ───────────────────────── 通用 SSE 读帧器 ─────────────────────────

export interface SseFrameCursor<T> {
  /** 下一个 `data:` JSON 帧;流结束返回 null。`data: [DONE]` 哨兵帧自动跳过。 */
  next(): Promise<T | null>;
}

/** 标准 SSE(`data: {...}\n\n`)→ 逐帧 JSON。各 adapter 不用再手写 buffer 状态机。 */
export function sseJsonFrames<T>(body: ReadableStream<Uint8Array>): SseFrameCursor<T> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  async function next(): Promise<T | null> {
    for (;;) {
      const sepIndex = buffer.indexOf("\n\n");
      if (sepIndex !== -1) {
        const rawEvent = buffer.slice(0, sepIndex);
        buffer = buffer.slice(sepIndex + 2);
        const line = rawEvent.split("\n").find((l) => l.startsWith("data: "));
        if (!line) continue;
        const payload = line.slice("data: ".length);
        if (payload === "[DONE]") continue;
        return JSON.parse(payload) as T;
      }
      const { value, done } = await reader.read();
      if (done) return null;
      buffer += decoder.decode(value, { stream: true });
    }
  }

  return { next };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

// ───────────────────────── Claude Agent SDK:SDKMessage ─────────────────────────

/** 只声明转换器要读的字段;真实的 SDKMessage 直接喂进来即可。 */
export interface ClaudeSdkMessageLike {
  type: string;
  subtype?: string;
  session_id?: string;
  tool_use_id?: string;
  is_error?: boolean;
  num_turns?: number;
  total_cost_usd?: number;
  usage?: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null };
  message?: { content?: unknown };
  [key: string]: unknown;
}

export interface ClaudeSdkStream {
  /** 逐帧喂 `SDKMessage`,返回这一帧派生的标准事件;认不出的帧(stream_event 等)返回 []。 */
  add(message: ClaudeSdkMessageLike): StreamEvent[];
  /** `system`/`init` 帧带回的 session_id(首帧之后可读),回写 `ctx.session.id` 用。 */
  readonly sessionId: string | undefined;
  /** `result` 帧的聚合用量。 */
  readonly usage: Usage | undefined;
  /** `result` 帧报了 is_error。 */
  readonly failed: boolean;
  /**
   * 拒绝审批后续读前登记:该 tool_use 的 `tool_result` / `permission_denied` 落成
   * `status: "rejected"`(而不是 failed),且两种帧只产一条 action.result。
   */
  markRejected(toolUseId: string): void;
}

/**
 * Claude Agent SDK 消息流(`system` / `assistant` / `user` / `result`)→ 标准事件。
 * `assistant` 的 text/thinking/tool_use 块 → message / thinking / action.called;`user` 的
 * tool_result 块 → action.result;`system`/`permission_denied` → rejected;`stream_event`
 * (逐 token 渲染)整个忽略。HITL 的停轮判定(哪个工具被门控)是应用侧的知识,不在这里——
 * 扫描 add() 返回的 action.called 自行决定。
 */
export function fromClaudeSdkMessages(): ClaudeSdkStream {
  let sessionId: string | undefined;
  let usage: Usage | undefined;
  let failed = false;
  const resolvedCallIds = new Set<string>();
  const rejected = new Set<string>();

  const toolResultText = (content: unknown): string | undefined => {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .filter((b): b is { type: "text"; text: string } => isRecord(b) && b.type === "text" && typeof b.text === "string")
        .map((b) => b.text)
        .join("");
    }
    return undefined;
  };

  return {
    get sessionId() {
      return sessionId;
    },
    get usage() {
      return usage;
    },
    get failed() {
      return failed;
    },
    markRejected(toolUseId) {
      rejected.add(toolUseId);
    },
    add(frame) {
      const events: StreamEvent[] = [];
      switch (frame.type) {
        case "system": {
          if (frame.subtype === "init" && typeof frame.session_id === "string") {
            sessionId ??= frame.session_id;
          } else if (frame.subtype === "permission_denied" && typeof frame.tool_use_id === "string") {
            if (!resolvedCallIds.has(frame.tool_use_id)) {
              resolvedCallIds.add(frame.tool_use_id);
              events.push({ type: "action.result", callId: frame.tool_use_id, status: "rejected" });
            }
          }
          break;
        }
        case "assistant": {
          const content: unknown[] = Array.isArray(frame.message?.content) ? frame.message.content : [];
          for (const block of content) {
            if (!isRecord(block)) continue;
            if (block.type === "text" && typeof block.text === "string" && block.text) {
              events.push({ type: "message", role: "assistant", text: block.text });
            } else if (block.type === "thinking" && typeof block.thinking === "string" && block.thinking) {
              events.push({ type: "thinking", text: block.thinking });
            } else if (block.type === "tool_use" && typeof block.id === "string" && typeof block.name === "string") {
              events.push({ type: "action.called", callId: block.id, name: block.name, input: block.input as JsonValue });
            }
          }
          break;
        }
        case "user": {
          const content: unknown[] = Array.isArray(frame.message?.content) ? frame.message.content : [];
          for (const block of content) {
            if (!isRecord(block) || block.type !== "tool_result" || typeof block.tool_use_id !== "string") continue;
            if (resolvedCallIds.has(block.tool_use_id)) continue;
            resolvedCallIds.add(block.tool_use_id);
            events.push({
              type: "action.result",
              callId: block.tool_use_id,
              output: toolResultText(block.content) as JsonValue,
              status: rejected.has(block.tool_use_id) ? "rejected" : block.is_error ? "failed" : "completed",
            });
          }
          break;
        }
        case "result": {
          failed = frame.is_error === true;
          if (frame.usage) {
            usage = {
              inputTokens: frame.usage.input_tokens,
              outputTokens: frame.usage.output_tokens,
              cacheReadTokens: frame.usage.cache_read_input_tokens ?? undefined,
              cacheWriteTokens: frame.usage.cache_creation_input_tokens ?? undefined,
              requests: frame.num_turns,
              costUSD: frame.total_cost_usd,
            };
          }
          break;
        }
        // stream_event(逐 token 渲染)与其它系统/生命周期消息:无对应 StreamEvent。
        default:
          break;
      }
      return events;
    },
  };
}

// ───────────────────────── pi-agent-core:AgentEvent ─────────────────────────

export interface PiAgentEventLike {
  type: string;
  toolCallId?: string;
  toolName?: string;
  args?: unknown;
  result?: unknown;
  isError?: boolean;
  /** content 在 user 消息上是 string、assistant 消息上是 parts 数组——按 unknown 收,防御式解析。 */
  message?: {
    role?: string;
    content?: unknown;
    /** assistant 消息的收尾原因;"error" / "aborted" 表示这条消息以失败告终。 */
    stopReason?: string;
    /** stopReason 为 "error" 时的错误说明。 */
    errorMessage?: string;
    usage?: { input: number; output: number; cacheRead: number; cacheWrite: number; cost: { total: number } };
  };
  /** `message_update` 帧携带的增量事件(text_delta / thinking_delta 等)——只读 type/delta,防御式解析。 */
  assistantMessageEvent?: { type?: string; delta?: unknown; [key: string]: unknown };
  [key: string]: unknown;
}

export interface PiAgentStream {
  /** 逐帧喂 `AgentEvent`,返回这一帧派生的标准事件;生命周期帧(turn_start 等)返回 []。 */
  add(event: PiAgentEventLike): StreamEvent[];
  /** assistant `message_end` 逐条累加的用量。 */
  readonly usage: Usage | undefined;
  /** assistant 消息以 stopReason "error" / "aborted" 收尾过。 */
  readonly failed: boolean;
  /** 拒绝审批后续读前登记:该调用 `tool_execution_end` 的 isError 判成 "rejected" 而非 "failed"。 */
  markRejected(toolCallId: string): void;
}

/**
 * pi-agent-core 事件流(`message_start` / `message_update` / `message_end` /
 * `tool_execution_start` / `tool_execution_end`)→ 标准事件。消息三段式聚合成一条:
 * message_start 清空增量缓冲、message_update 的 text_delta / thinking_delta 逐段累加、
 * message_end 落地成 message / thinking(优先取 end 帧的完整 content,缺了用累加的增量兜底);
 * 只有 start/delta 的截断流不产出半条消息。message_end 同时累加 usage;assistant 消息以
 * stopReason "error" / "aborted" 收尾时记失败(`failed`)并发一条 error 事件。
 * tool_execution_start/end → action.called / action.result。
 */
export function fromPiAgentEvents(): PiAgentStream {
  let usage: Usage | undefined;
  let failed = false;
  // message_start/update 累加的增量缓冲;message_end 落地后清空,截断流(无 end)不落地。
  let deltaText = "";
  let deltaThinking = "";
  const rejected = new Set<string>();

  const partText = (event: PiAgentEventLike, type: "text" | "thinking"): string => {
    if (event.message?.role !== "assistant" || !Array.isArray(event.message.content)) return "";
    return event.message.content
      .filter((part): part is Record<string, unknown> => isRecord(part) && part.type === type)
      .map((part) => {
        const v = type === "text" ? part.text : part.thinking;
        return typeof v === "string" ? v : "";
      })
      .join("");
  };

  return {
    get usage() {
      return usage;
    },
    get failed() {
      return failed;
    },
    markRejected(toolCallId) {
      rejected.add(toolCallId);
    },
    add(event) {
      const events: StreamEvent[] = [];
      switch (event.type) {
        case "message_start": {
          // 新消息开始:上一条没等到 message_end 的增量作废(不落地半条消息)。
          deltaText = "";
          deltaThinking = "";
          break;
        }
        case "message_update": {
          const e = event.assistantMessageEvent;
          if (isRecord(e) && typeof e.delta === "string") {
            if (e.type === "text_delta") deltaText += e.delta;
            else if (e.type === "thinking_delta") deltaThinking += e.delta;
          }
          break;
        }
        case "message_end": {
          // 优先取 end 帧的完整 content;缺了(部分传输只带增量)用累加的 delta 兜底。
          const text = partText(event, "text") || (event.message?.role === "assistant" ? deltaText : "");
          if (text) events.push({ type: "message", role: "assistant", text });
          const thinking = partText(event, "thinking") || (event.message?.role === "assistant" ? deltaThinking : "");
          if (thinking) events.push({ type: "thinking", text: thinking });
          deltaText = "";
          deltaThinking = "";
          if (event.message?.role === "assistant") {
            const stopReason = event.message.stopReason;
            if (stopReason === "error" || stopReason === "aborted") {
              failed = true;
              events.push({ type: "error", message: event.message.errorMessage ?? `pi agent stopReason=${stopReason}` });
            }
          }
          const u = event.message?.role === "assistant" ? event.message.usage : undefined;
          if (u) {
            usage = {
              inputTokens: (usage?.inputTokens ?? 0) + u.input,
              outputTokens: (usage?.outputTokens ?? 0) + u.output,
              cacheReadTokens: (usage?.cacheReadTokens ?? 0) + u.cacheRead,
              cacheWriteTokens: (usage?.cacheWriteTokens ?? 0) + u.cacheWrite,
              requests: (usage?.requests ?? 0) + 1,
              costUSD: (usage?.costUSD ?? 0) + u.cost.total,
            };
          }
          break;
        }
        case "tool_execution_start": {
          if (typeof event.toolCallId === "string" && typeof event.toolName === "string") {
            events.push({ type: "action.called", callId: event.toolCallId, name: event.toolName, input: event.args as JsonValue });
          }
          break;
        }
        case "tool_execution_end": {
          if (typeof event.toolCallId === "string") {
            const status = event.isError ? (rejected.has(event.toolCallId) ? "rejected" : "failed") : "completed";
            events.push({ type: "action.result", callId: event.toolCallId, output: event.result as JsonValue, status });
          }
          break;
        }
        // agent_start / turn_start / turn_end / tool_execution_update / agent_end:
        // 无对应 StreamEvent(消息文本统一在 message_end 落地)。
        default:
          break;
      }
      return events;
    },
  };
}

// ───────────────────────── Codex SDK:ThreadEvent ─────────────────────────

export interface CodexThreadEventLike {
  type: string;
  thread_id?: string;
  item?: { type?: string; text?: string; message?: string; [key: string]: unknown };
  error?: { message: string };
  [key: string]: unknown;
}

export interface CodexThreadStream {
  /**
   * 逐帧喂 `ThreadEvent`,返回标准事件:消息类(agent_message → message、reasoning → thinking、
   * error item / turn.failed → error)+ 工具项(command_execution / mcp_tool_call / web_search /
   * file_change → action.called + action.result,附规范工具名 `tool`,如 command_execution →
   * `"shell"`,供 `calledTool("shell")` 这类跨 agent 断言命中)。usage 从 `turn.completed` 聚合,经 `usage` 读。
   * 断言依据全部来自这条流;codex CLI 的原生 OTLP span 只用于瀑布图(spanMapper: mapCodexSpans)。
   */
  add(event: CodexThreadEventLike): StreamEvent[];
  /** `thread.started` 带回的 thread_id,回写 `ctx.session.id` 用。 */
  readonly threadId: string | undefined;
  /** `turn.completed` 聚合的用量(input/cached/output tokens)。 */
  readonly usage: Usage | undefined;
  /** turn.failed / error item 出现过。 */
  readonly failed: boolean;
}

/** Codex SDK 线程事件流(`thread.started` / `item.*` / `turn.completed` / `turn.failed`)→ 标准事件。 */
export function fromCodexThreadEvents(): CodexThreadStream {
  let threadId: string | undefined;
  let usage: Usage | undefined;
  let failed = false;
  // item.started 已发 action.called 的 id;item.completed 时不重发,只补 result。
  const startedCallIds = new Set<string>();
  let synth = 0;

  const callIdOf = (item: Record<string, unknown>, prefix: string): string => {
    const id = item.id;
    return typeof id === "string" || typeof id === "number" ? String(id) : `${prefix}_${++synth}`;
  };

  // 工具项 → action.called(+completed 时的 action.result)。与 o11y/parsers/codex.ts 的
  // transcript 映射保持同一套语义(字段名以 codex exec --json 的 ThreadItem 为准),
  // 包括规范工具名 tool:少了它 derive 只能落 name="unknown",calledTool("shell") 这类
  // 跨 agent 规范名断言在 SDK 流路径上会静默失配(2026-07-09 CI 实红)。
  const handleToolItem = (item: Record<string, unknown>, isCompleted: boolean): StreamEvent[] => {
    const events: StreamEvent[] = [];
    const emitCall = (callId: string, name: string, input: JsonValue, tool: ToolName): void => {
      if (startedCallIds.has(callId)) return;
      startedCallIds.add(callId);
      events.push({ type: "action.called", callId, name, input, tool });
    };

    switch (item.type) {
      case "command_execution": {
        const callId = callIdOf(item, "cmd");
        emitCall(callId, "command_execution", { command: item.command ?? null } as JsonValue, "shell");
        if (isCompleted) {
          const exit = item.exit_code;
          const success = exit === 0 || (exit == null && item.status !== "failed" && item.status !== "error");
          events.push({
            type: "action.result",
            callId,
            output: { output: (item.aggregated_output ?? null) as JsonValue, exit_code: (exit ?? null) as JsonValue },
            status: success ? "completed" : "failed",
          });
        }
        return events;
      }
      case "mcp_tool_call": {
        const callId = callIdOf(item, "mcp");
        const tool = String(item.tool ?? "unknown");
        const name = typeof item.server === "string" ? `${item.server}.${tool}` : tool;
        emitCall(callId, name, (item.arguments ?? null) as JsonValue, normalizeToolName(tool, CODEX_TOOL_ALIASES));
        if (isCompleted) {
          const success = !item.error && item.status !== "failed";
          events.push({ type: "action.result", callId, output: (item.result ?? null) as JsonValue, status: success ? "completed" : "failed" });
        }
        return events;
      }
      case "web_search": {
        const callId = callIdOf(item, "web");
        emitCall(callId, "web_search", { query: item.query ?? null } as JsonValue, "web_search");
        if (isCompleted) events.push({ type: "action.result", callId, output: null, status: "completed" });
        return events;
      }
      case "file_change": {
        // 补丁类只在 completed 落一次:changes 里每个文件一对 called/result。
        if (!isCompleted) return events;
        const baseId = callIdOf(item, "patch");
        const changes = Array.isArray(item.changes) ? item.changes : [];
        changes.forEach((ch, i) => {
          const callId = `${baseId}#${i}`;
          const change = isRecord(ch) ? { path: ch.path ?? null, kind: ch.kind ?? null } : {};
          events.push({ type: "action.called", callId, name: "file_change", input: change as JsonValue, tool: "file_edit" });
          events.push({ type: "action.result", callId, output: change as JsonValue, status: "completed" });
        });
        return events;
      }
      default:
        return events;
    }
  };

  return {
    get threadId() {
      return threadId;
    },
    get usage() {
      return usage;
    },
    get failed() {
      return failed;
    },
    add(event) {
      const events: StreamEvent[] = [];
      switch (event.type) {
        case "thread.started": {
          if (typeof event.thread_id === "string") threadId ??= event.thread_id;
          break;
        }
        case "item.started": {
          if (event.item) events.push(...handleToolItem(event.item, false));
          break;
        }
        case "item.completed": {
          const item = event.item;
          if (!item) break;
          if (item.type === "agent_message" && typeof item.text === "string" && item.text) {
            events.push({ type: "message", role: "assistant", text: item.text });
          } else if (item.type === "reasoning" && typeof item.text === "string" && item.text) {
            events.push({ type: "thinking", text: item.text });
          } else if (item.type === "error" && typeof item.message === "string") {
            failed = true;
            events.push({ type: "error", message: item.message });
          } else {
            events.push(...handleToolItem(item, true));
          }
          break;
        }
        case "turn.completed": {
          const u = event.usage;
          if (isRecord(u)) {
            const num = (v: unknown): number => (typeof v === "number" ? v : 0);
            usage = {
              inputTokens: (usage?.inputTokens ?? 0) + num(u.input_tokens),
              outputTokens: (usage?.outputTokens ?? 0) + num(u.output_tokens),
              cacheReadTokens: (usage?.cacheReadTokens ?? 0) + num(u.cached_input_tokens),
              requests: (usage?.requests ?? 0) + 1,
            };
          }
          break;
        }
        case "turn.failed": {
          failed = true;
          if (event.error?.message) events.push({ type: "error", message: event.error.message });
          break;
        }
        // item.updated(中间态)/ turn.started:忽略,等 completed。
        default:
          break;
      }
      return events;
    },
  };
}
