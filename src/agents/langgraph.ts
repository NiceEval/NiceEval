// LangGraph 官方 event streaming 协议 → 标准 StreamEvent 的官方转换器。
//
// 定位:LangGraph 可以进程内运行,也可以部署在自建 HTTP 服务或 Agent Server 后——
// 本文件只认协议帧本身,不绑定任何 transport,也不提供 langGraphAgent() 工厂
// (契约见 docs/feature/adapters/sdk/langgraph/README.md)。会话操作属于应用 adapter:
// `thread_id` 由 adapter 写回 `ctx.session.id`,`input.responses` 由 adapter 按应用协议
// 翻译成 `Command(resume=...)`,都不进转换器。类型全部用结构化 *Like 声明(同
// sdk-streams.ts 的先例),不依赖 LangGraph SDK 包。
//
// 用法(以 SSE transport 为例):
//
// ```typescript
// import { sseJsonFrames, fromLangGraphEvents } from "niceeval/adapter";
//
// const frames = sseJsonFrames<LangGraphEventLike>(res.body);
// const stream = fromLangGraphEvents();
// for (;;) {
//   const frame = await frames.next();
//   if (frame === null) break;
//   events.push(...stream.add(frame));   // 逐帧翻译;认不出的帧返回 []
// }
// events.push(...stream.end());          // 放出 seq 缺口后仍压着的乱序帧
// return { status: stream.status ?? "completed", events, usage: stream.usage };
// ```

import type { InputRequest, JsonValue, StreamEvent, Usage } from "../types.ts";
import { normalizeToolName } from "../o11y/tool-names.ts";

/**
 * `messages` channel 消息里的 content block(LangChain 标准 content blocks 的结构化子集,
 * 只声明转换器要读的字段)。`type: "text"` 读 `text`,`type: "reasoning"` 读 `reasoning`
 * (兼容放在 `text` 里的变体),`type: "tool_call"` 读 `id` / `name` / `args`。
 */
export interface LangGraphContentBlockLike {
  type: string;
  text?: string;
  reasoning?: string;
  id?: string;
  name?: string;
  args?: unknown;
  [key: string]: unknown;
}

/**
 * LangGraph 事件流协议帧(只声明转换器要读的字段;真实协议帧直接喂进来即可)。
 * `channel` 是事件通道(messages / tools / input / lifecycle,其余通道无对应标准事件),
 * `event` 是通道内事件名,`namespace` 是 subgraph / subagent 层级(自外向内;缺省或空数组
 * = 根图),`seq` 是协议全序号(见 {@link fromLangGraphEvents} 的顺序恢复语义)。
 */
export interface LangGraphEventLike {
  /** 协议全序号。乱序到达按它恢复顺序;已消费过的 seq(重连补发)按重复丢弃。 */
  seq?: number;
  /** 事件通道:"messages" | "tools" | "input" | "lifecycle";其它通道(values / updates …)忽略。 */
  channel?: string;
  /**
   * 通道内事件名:messages 的 "partial"(增量,忽略)与 "finish"(完整消息 + usage);
   * tools 的 "started" / "finished" / "error";lifecycle 的 "completed" / "failed" / "interrupted"。
   */
  event?: string;
  /** subgraph / subagent 层级(自外向内),如 `["research", "web"]`;段内 `:` 后缀(checkpoint id)不进展示名。 */
  namespace?: readonly string[];
  /** 通道载荷。 */
  data?: Record<string, unknown> | null;
  [key: string]: unknown;
}

/** {@link fromLangGraphEvents} 返回的流句柄。 */
export interface LangGraphStream {
  /**
   * 逐帧喂协议事件,返回这一帧派生的标准事件。带 seq 且超前于当前水位的帧被暂存,
   * 缺口补齐时按 seq 顺序一起放出;seq 落后于水位的帧视为重连补发的重复帧,丢弃。
   */
  add(event: LangGraphEventLike): StreamEvent[];
  /** 流结束时调用一次:把 seq 缺口后仍暂存的乱序帧按 seq 升序放出(缺帧不再等)。 */
  end(): StreamEvent[];
  /** message finish 逐条累加的用量;协议没报 usage 时是 undefined(不编造数值)。 */
  readonly usage: Usage | undefined;
  /**
   * lifecycle 映射的 Turn 状态:completed / failed 原样,interrupted → "waiting"
   * (HITL 停轮,adapter 据此挂起并等 `input.responses`)。没见过 lifecycle 帧时 undefined。
   */
  readonly status: "completed" | "failed" | "waiting" | undefined;
  /**
   * 拒绝审批后续读前登记:该 tool call 的 tools/error 落成 `status: "rejected"`
   * (人工拒绝)而不是 "failed"(执行故障)。
   */
  markRejected(toolCallId: string): void;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}

/** namespace 段的展示名:`node:checkpoint-id` 只留 node 名。 */
function segmentName(segment: string): string {
  const i = segment.indexOf(":");
  return i > 0 ? segment.slice(0, i) : segment;
}

/**
 * LangGraph 官方事件流(messages / tools / input / lifecycle 四通道)→ 标准事件。
 *
 * - `messages` 的 finish 帧:text block → message、reasoning block → thinking、
 *   tool_call block → action.called(与 tools/started 按 call ID 去重),usage 从
 *   消息的 usage_metadata 累加;partial(逐 token 增量)整个忽略。
 * - `tools` 的 started / finished / error → action.called / action.result,按 tool call ID 配对;
 *   error 默认 "failed",经 {@link LangGraphStream.markRejected} 登记过的落 "rejected"。
 * - `input` 帧与 lifecycle 的 interrupted → input.requested(同一 interrupt 出现在两处时按
 *   id 去重);interrupt 载荷里的 HITL 请求形状(action_request / description / config.allow_*)
 *   映射成 InputRequest 的 action / input / display / options。
 * - `lifecycle`(根 namespace)映射 `status`:completed / failed / interrupted("waiting");
 *   failed 帧的错误信息补一条 error 事件。
 * - `namespace` 非空的帧翻译前先为每级未见过的层级补 subagent.called(callId 是自外向内
 *   的路径,层级关系由路径前缀表达);该层级自己的 lifecycle completed / failed 闭合成
 *   subagent.completed,根图 completed / failed 时把仍未闭合的层级按同状态一起闭合
 *   (interrupted 不闭合——层级还要 resume)。
 * - 帧带 `seq` 时按 seq 恢复协议定义的事件顺序(超前暂存、缺口补齐放出、落后当重复丢弃),
 *   流结束调 {@link LangGraphStream.end} 放出仍压着的乱序帧。
 *
 * 工具名多为应用域内自定义名(canonical 落 "unknown" 即可),只认通用别名基表,
 * 不 opt-in 裸动词别名(同 fromAiSdk 的裁决,见 src/o11y/tool-names.ts)。
 */
export function fromLangGraphEvents(): LangGraphStream {
  let usage: Usage | undefined;
  let status: "completed" | "failed" | "waiting" | undefined;

  const startedCallIds = new Set<string>();
  const resolvedCallIds = new Set<string>();
  const rejected = new Set<string>();
  const requestedInputIds = new Set<string>();
  // namespace 路径(join("/"))→ 打开 / 闭合状态。Set 保持插入序,闭合时按深度倒序。
  const openNamespaces = new Set<string>();
  const closedNamespaces = new Set<string>();

  // seq 顺序恢复:以第一个带 seq 的帧为水位基准,超前的暂存,缺口补齐时连续放出。
  let nextSeq: number | undefined;
  const pendingBySeq = new Map<number, LangGraphEventLike>();

  let synth = 0;
  const synthCallId = (): string => `lg_${++synth}`;

  const addUsage = (raw: unknown): void => {
    if (!isRecord(raw)) return;
    const num = (...keys: string[]): number => {
      for (const k of keys) {
        const v = raw[k];
        if (typeof v === "number" && Number.isFinite(v)) return v;
      }
      return 0;
    };
    const input = num("input_tokens", "inputTokens");
    const output = num("output_tokens", "outputTokens");
    if (input === 0 && output === 0) return;
    const details = isRecord(raw.input_token_details) ? raw.input_token_details : undefined;
    const cacheRead = typeof details?.cache_read === "number" ? details.cache_read : 0;
    const cacheWrite = typeof details?.cache_creation === "number" ? details.cache_creation : 0;
    usage = {
      inputTokens: (usage?.inputTokens ?? 0) + input,
      outputTokens: (usage?.outputTokens ?? 0) + output,
      ...(cacheRead || usage?.cacheReadTokens
        ? { cacheReadTokens: (usage?.cacheReadTokens ?? 0) + cacheRead }
        : {}),
      ...(cacheWrite || usage?.cacheWriteTokens
        ? { cacheWriteTokens: (usage?.cacheWriteTokens ?? 0) + cacheWrite }
        : {}),
      requests: (usage?.requests ?? 0) + 1,
    };
  };

  const emitCalled = (
    events: StreamEvent[],
    callId: string,
    name: string,
    input: unknown,
  ): void => {
    // messages 的 tool_call block 与 tools/started 描述同一次调用,按 call ID 只发一条。
    if (startedCallIds.has(callId)) return;
    startedCallIds.add(callId);
    events.push({
      type: "action.called",
      callId,
      name,
      input: (input ?? null) as JsonValue,
      tool: normalizeToolName(name),
    });
  };

  const emitResult = (
    events: StreamEvent[],
    callId: string,
    output: unknown,
    status_: "completed" | "failed" | "rejected",
  ): void => {
    if (resolvedCallIds.has(callId)) return;
    resolvedCallIds.add(callId);
    events.push({
      type: "action.result",
      callId,
      ...(output !== undefined ? { output: output as JsonValue } : {}),
      status: status_,
    });
  };

  /** interrupt / input 载荷 → input.requested(同一 interrupt id 只发一条)。 */
  const emitInputRequested = (events: StreamEvent[], payload: Record<string, unknown>): void => {
    const id = str(payload.id) ?? str(payload.interrupt_id);
    if (id) {
      if (requestedInputIds.has(id)) return;
      requestedInputIds.add(id);
    }
    // interrupt 的载荷在 value 上;input 通道也可能直接给结构化字段。
    const value = "value" in payload ? payload.value : payload;
    const request: {
      id?: string;
      prompt?: string;
      display?: string;
      action?: string;
      input?: JsonValue;
      options?: { id: string; label?: string }[];
    } = {};
    if (id) request.id = id;
    if (typeof value === "string") {
      request.prompt = value;
    } else if (isRecord(value)) {
      // HITL 请求形状(prebuilt HumanInterrupt):action_request / description / config.allow_*。
      const actionRequest = isRecord(value.action_request) ? value.action_request : undefined;
      if (actionRequest) {
        const action = str(actionRequest.action);
        if (action) request.action = action;
        if (actionRequest.args !== undefined) request.input = actionRequest.args as JsonValue;
      }
      const display = str(value.description) ?? str(value.display);
      if (display) request.display = display;
      const prompt = str(value.prompt) ?? str(value.question);
      if (prompt) request.prompt = prompt;
      const config = isRecord(value.config) ? value.config : undefined;
      if (config) {
        const options = (
          [
            ["allow_accept", "accept"],
            ["allow_edit", "edit"],
            ["allow_respond", "respond"],
            ["allow_ignore", "ignore"],
          ] as const
        )
          .filter(([flag]) => config[flag] === true)
          .map(([, optionId]) => ({ id: optionId }));
        if (options.length) request.options = options;
      }
      // 认不出的结构化载荷原样携带,eval 仍可按参数匹配。
      if (
        request.action === undefined &&
        request.display === undefined &&
        request.prompt === undefined &&
        request.input === undefined
      ) {
        request.input = value as JsonValue;
      }
    }
    events.push({ type: "input.requested", request: request as InputRequest });
  };

  const emitInterrupts = (events: StreamEvent[], data: Record<string, unknown>): void => {
    const interrupts = Array.isArray(data.interrupts)
      ? data.interrupts
      : data.interrupt !== undefined
        ? [data.interrupt]
        : [data];
    for (const item of interrupts) {
      if (isRecord(item)) emitInputRequested(events, item);
      else if (typeof item === "string") emitInputRequested(events, { value: item });
    }
  };

  /** 为 namespace 的每级未见过的前缀补 subagent.called(层级由路径 callId 表达)。 */
  const ensureNamespace = (events: StreamEvent[], ns: readonly string[]): void => {
    for (let i = 1; i <= ns.length; i++) {
      const key = ns.slice(0, i).join("/");
      if (openNamespaces.has(key) || closedNamespaces.has(key)) continue;
      openNamespaces.add(key);
      events.push({ type: "subagent.called", callId: key, name: segmentName(ns[i - 1]!) });
    }
  };

  const closeNamespace = (
    events: StreamEvent[],
    key: string,
    status_: "completed" | "failed",
    output?: unknown,
  ): void => {
    if (!openNamespaces.has(key)) return;
    // 先闭合仍打开的更深层级(按深度倒序),再闭合自己——called/completed 嵌套配对。
    const descendants = [...openNamespaces]
      .filter((k) => k.startsWith(`${key}/`))
      .sort((a, b) => b.split("/").length - a.split("/").length);
    for (const child of descendants) {
      openNamespaces.delete(child);
      closedNamespaces.add(child);
      events.push({ type: "subagent.completed", callId: child, status: status_ });
    }
    openNamespaces.delete(key);
    closedNamespaces.add(key);
    events.push({
      type: "subagent.completed",
      callId: key,
      ...(output !== undefined ? { output: output as JsonValue } : {}),
      status: status_,
    });
  };

  const closeAllOpen = (events: StreamEvent[], status_: "completed" | "failed"): void => {
    const roots = [...openNamespaces].sort((a, b) => b.split("/").length - a.split("/").length);
    for (const key of roots) {
      if (!openNamespaces.has(key)) continue;
      closeNamespace(events, key, status_);
    }
  };

  const handleMessages = (events: StreamEvent[], frame: LangGraphEventLike): void => {
    // 逐 token 增量帧整个忽略:finish 帧带完整 content blocks(同 fromClaudeSdkMessages
    // 忽略 stream_event 的先例)。
    if (frame.event === "partial" || frame.event === "delta") return;
    const data = isRecord(frame.data) ? frame.data : {};
    const message = isRecord(data.message) ? data.message : data;
    const role = str(message.role) ?? "assistant";
    if (role !== "assistant" && role !== "user") return;

    const content = message.content;
    if (typeof content === "string") {
      if (content) events.push({ type: "message", role, text: content });
    } else if (Array.isArray(content)) {
      // 按 block 原始顺序落事件,不重排(events.md 不变量 1)。
      for (const block of content) {
        if (!isRecord(block)) continue;
        if (block.type === "text" && typeof block.text === "string" && block.text) {
          events.push({ type: "message", role, text: block.text });
        } else if (block.type === "reasoning") {
          const text = str(block.reasoning) ?? str(block.text);
          if (text) events.push({ type: "thinking", text });
        } else if (block.type === "tool_call" && role === "assistant") {
          const name = str(block.name) ?? "unknown";
          emitCalled(events, str(block.id) ?? synthCallId(), name, block.args);
        }
      }
    }
    // usage 在 message finish 上(usage_metadata;兼容 usage / data.usage 变体)。
    addUsage(message.usage_metadata ?? message.usage ?? data.usage);
  };

  const handleTools = (events: StreamEvent[], frame: LangGraphEventLike): void => {
    const data = isRecord(frame.data) ? frame.data : {};
    const explicitId = str(data.id) ?? str(data.tool_call_id) ?? str(data.call_id);
    switch (frame.event) {
      case "started": {
        const name = str(data.name) ?? "unknown";
        emitCalled(events, explicitId ?? synthCallId(), name, data.input ?? data.args);
        break;
      }
      case "finished": {
        const callId = explicitId ?? synthCallId();
        emitResult(events, callId, data.output ?? data.result, "completed");
        break;
      }
      case "error": {
        const callId = explicitId ?? synthCallId();
        const message = str(data.error) ?? (isRecord(data.error) ? str(data.error.message) : undefined) ?? str(data.message);
        emitResult(events, callId, message, rejected.has(callId) ? "rejected" : "failed");
        break;
      }
      default:
        break;
    }
  };

  const handleLifecycle = (
    events: StreamEvent[],
    frame: LangGraphEventLike,
    ns: readonly string[],
  ): void => {
    const data = isRecord(frame.data) ? frame.data : {};
    if (ns.length > 0) {
      // subgraph 生命周期:闭合对应 subagent 层级。interrupted 不闭合(层级还要 resume),
      // 但停轮请求与状态照常上浮——整条 run 一起停。
      if (frame.event === "completed" || frame.event === "failed") {
        closeNamespace(
          events,
          ns.join("/"),
          frame.event,
          data.output ?? data.result,
        );
      } else if (frame.event === "interrupted") {
        status = "waiting";
        emitInterrupts(events, data);
      }
      return;
    }
    switch (frame.event) {
      case "completed": {
        status = "completed";
        closeAllOpen(events, "completed");
        break;
      }
      case "failed": {
        status = "failed";
        const message =
          str(data.error) ??
          (isRecord(data.error) ? str(data.error.message) : undefined) ??
          str(data.message);
        if (message) events.push({ type: "error", message });
        closeAllOpen(events, "failed");
        break;
      }
      case "interrupted": {
        status = "waiting";
        emitInterrupts(events, data);
        break;
      }
      default:
        break;
    }
  };

  const translate = (frame: LangGraphEventLike): StreamEvent[] => {
    const events: StreamEvent[] = [];
    const ns = Array.isArray(frame.namespace)
      ? frame.namespace.filter((s): s is string => typeof s === "string" && s.length > 0)
      : [];
    ensureNamespace(events, ns);
    switch (frame.channel) {
      case "messages":
        handleMessages(events, frame);
        break;
      case "tools":
        handleTools(events, frame);
        break;
      case "input": {
        const data = isRecord(frame.data) ? frame.data : {};
        emitInputRequested(events, data);
        break;
      }
      case "lifecycle":
        handleLifecycle(events, frame, ns);
        break;
      // values / updates / debug 等其它通道:无对应 StreamEvent。
      default:
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
      rejected.add(toolCallId);
    },
    add(frame) {
      const seq = typeof frame.seq === "number" && Number.isFinite(frame.seq) ? frame.seq : undefined;
      if (seq === undefined) return translate(frame);
      if (nextSeq === undefined) nextSeq = seq;
      if (seq < nextSeq) return []; // 重连补发的旧帧:已消费,丢弃
      if (seq > nextSeq) {
        pendingBySeq.set(seq, frame); // 超前:暂存等缺口补齐
        return [];
      }
      const events = translate(frame);
      nextSeq += 1;
      while (pendingBySeq.has(nextSeq)) {
        const next = pendingBySeq.get(nextSeq)!;
        pendingBySeq.delete(nextSeq);
        events.push(...translate(next));
        nextSeq += 1;
      }
      return events;
    },
    end() {
      const events: StreamEvent[] = [];
      const remaining = [...pendingBySeq.entries()].sort(([a], [b]) => a - b);
      pendingBySeq.clear();
      for (const [seq, frame] of remaining) {
        events.push(...translate(frame));
        if (nextSeq === undefined || seq >= nextSeq) nextSeq = seq + 1;
      }
      return events;
    },
  };
}
