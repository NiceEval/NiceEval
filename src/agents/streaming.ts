// 官方的「拼装方式」件:把一个手写 send 里反复出现的三类事收成可复用的小东西,
// 而不是每接一个新后端就重写一遍循环 + Map + if/else。
//
// 背景(见 docs/adapters/authoring.md「三段式」一节):一轮交互里真正互不相干的事只有三类——
//   1. 怎么把输入发出去(transport)——真做不掉,adapter 只写这个;
//   2. 原始数据怎么变成 StreamEvent[]——按数据到达形状分「整段落地」(sdk-streams.ts 的
//      fromXxxEvents,已有)和「逐 token / 逐参数增量」(deltaStream,这里新增)两种官方 reducer;
//   3. 会话续接(serverSession / clientHistory)与 HITL 暂停恢复(pausable)——这两件事完全是
//      控制流层面的模式,和任何具体协议无关,之前每个 adapter 都在手写一份「Map<sessionId,…>
//      + 下一轮先看是不是在等审批」,这里收成官方件。
//
// driveFrameStream 把「逐帧喂 reducer + 处理特殊传输帧 + 检测 HITL 暂停信号」这个循环收成
// 一个函数——claude-sdk / codex-sdk / pi-sdk 三个示例里几乎相同的 drainStream,现在只需要
// 传一个 onFrame 钩子声明「这一帧要不要额外处理」,不用每次重写循环本身。

import { randomUUID } from "node:crypto";

import type { AgentContext, InputRequest, JsonValue, StreamEvent, Turn, Usage } from "../types.ts";
import type { SseFrameCursor } from "./sdk-streams.ts";

// ───────────────────────── driveFrameStream:通用逐帧驱动循环 ─────────────────────────

/** sdk-streams.ts 里 ClaudeSdkStream / PiAgentStream / CodexThreadStream 共享的最小形状。 */
export interface FrameReducer<Frame> {
  add(frame: Frame): StreamEvent[];
  readonly usage?: Usage;
  readonly failed?: boolean;
}

/**
 * 处理一帧「reducer 词汇之外」的事:抓会话 id、识别传输层错误帧、判断是否该在这一帧暂停等人。
 * 返回 `undefined` 什么都不做(reducer 派生的事件已经在 `derived` 里,由 driveFrameStream 收集);
 * 返回 `{ pause }` 立即停止读流、附加一条 `input.requested`、把 status 置为 `"waiting"`；
 * 返回 `{ fail }` 记一条 error 事件,继续读完(有的错误后面还有收尾帧)。
 */
export type FrameHook<Frame> = (
  frame: Frame,
  derived: readonly StreamEvent[],
  ctx: AgentContext,
) => void | { pause: InputRequest } | { fail: string };

/**
 * 逐帧驱动一个 reducer,直到流结束或命中 `onFrame` 的暂停信号。
 * 暂停时不关闭 cursor——调用方（多半配 `pausable()`）留着它,下一轮直接接着读同一条流,
 * 不重新发起请求。
 *
 * reducer 的帧类型(`RFrame`)允许只覆盖流(`Frame`)的一个子集:adapter 常在 SDK 原生帧之外
 * 混入自己的传输帧(session / server_error…),这些由 `onFrame` 处理,reducer 对认不出的帧
 * 本来就返回 `[]`——所以两个类型参数独立推导,不强求 cursor 和 reducer 同型。
 */
export async function driveFrameStream<Frame, RFrame = Frame>(
  cursor: SseFrameCursor<Frame>,
  reducer: FrameReducer<RFrame>,
  ctx: AgentContext,
  onFrame?: FrameHook<Frame>,
): Promise<Turn> {
  const events: StreamEvent[] = [];
  let transportFailed = false;

  for (;;) {
    const frame = await cursor.next();
    if (frame === null) break;

    // 契约:reducer 对不认识的帧返回 [](传输帧走 onFrame),所以这里按 RFrame 喂是安全的。
    const derived = reducer.add(frame as unknown as RFrame);
    events.push(...derived);

    const outcome = onFrame?.(frame, derived, ctx);
    if (outcome && "pause" in outcome) {
      events.push({ type: "input.requested", request: outcome.pause });
      return { status: "waiting", events, usage: reducer.usage };
    }
    if (outcome && "fail" in outcome) {
      transportFailed = true;
      events.push({ type: "error", message: outcome.fail });
    }
  }

  return { status: transportFailed || reducer.failed ? "failed" : "completed", events, usage: reducer.usage };
}

// ───────────────────────── pausable:HITL 挂起状态,不用手写 Map ─────────────────────────

export interface Pausable<TState> {
  /** 有没有一条挂起的等待线,取到就立即清除(下一轮 `t.respond` 只消费一次)。 */
  take(ctx: AgentContext): TState | undefined;
  /** 记一条挂起状态,供下一轮 `take()` 取回。要求 `ctx.session.id` 已经写回。 */
  hold(ctx: AgentContext, state: TState): void;
}

/**
 * `t.respond(...)` 对 adapter 而言就是一次带 resume 的普通 `send`——adapter 自己要认出
 * "这轮是不是在接上次挂起的地方"。以前每个 HITL adapter 都手写一个模块级
 * `Map<sessionId, PendingState>`,这里收成一个官方件:key 是 `ctx.session.id`,
 * `take()`/`hold()` 各调一次,不用重复写 Map 的取存逻辑。
 */
export function pausable<TState>(): Pausable<TState> {
  const pending = new Map<string, TState>();
  return {
    take(ctx) {
      const id = ctx.session.id;
      if (!id) return undefined;
      const state = pending.get(id);
      if (state !== undefined) pending.delete(id);
      return state;
    },
    hold(ctx, state) {
      if (!ctx.session.id) {
        throw new Error("pausable().hold() 需要 ctx.session.id 已经写回——HITL 暂停只会发生在会话开始之后。");
      }
      pending.set(ctx.session.id, state);
    },
  };
}

// ───────────────────────── serverSession:会话续接,服务端存历史 ─────────────────────────

export interface ServerSession {
  /** 这轮请求该带的会话 id:非 isNew 且已经有 id 才有,新会话线一律 `undefined`。 */
  id(ctx: AgentContext): string | undefined;
  /**
   * 后端回传了会话 id 就调一次:只在「这条会话线的第一轮、且还没写过」时才真正落地,
   * 防止 resume 轮被后端返回的（可能因 fork 而变化的）id 意外覆盖。
   */
  capture(ctx: AgentContext, id: string | undefined): void;
}

/**
 * 会话续接的两种标准范式之一:**服务端记历史**——接口收一个会话 id(各 SDK 的原生
 * session / thread、OpenAI Responses API 都是),客户端只带 id 不带历史。
 * 和 {@link clientHistory}(另一种范式:客户端带全量历史)形状对称:模块级声明一个
 * 策略对象,send 里各调一对方法——发请求时带 `session.id(ctx)`,拿到回传 id 时
 * `session.capture(ctx, id)` 写回。这两个判断以前每个 adapter 手写一份,还容易写错
 * (isNew 轮误带 id、resume 轮被 fork 后的新 id 覆盖),收成官方件后不用再想。
 */
export function serverSession(): ServerSession {
  return {
    id(ctx) {
      return !ctx.session.isNew && ctx.session.id ? ctx.session.id : undefined;
    },
    capture(ctx, id) {
      if (ctx.session.isNew && !ctx.session.id && id) ctx.session.id = id;
    },
  };
}

// ───────────────────────── clientHistory:会话续接,客户端带全量历史 ─────────────────────────

export interface ClientHistory<TMsg> {
  /** 取这条会话线目前存的历史(isNew 时是空数组);顺带把 `ctx.session.id` 落地(新会话自动分配)。 */
  get(ctx: AgentContext): TMsg[];
  /** 这轮结束后,把最新的完整消息列表写回,供下一轮 `get()` 用。 */
  commit(ctx: AgentContext, messages: TMsg[]): void;
}

/**
 * 服务端无状态、每轮要发完整历史的后端(OpenAI Chat Completions 这类)通用的会话存储。
 * `uiMessageStreamAgent` 内部就是这个模式的一个特化(`TMsg = UIMessageLike`)——这里把它
 * 从协议里解耦出来,任何自己的消息类型都能用。存/取只关心"这条会话线的完整消息数组",
 * 至于"新一轮该怎么从旧历史生成新历史"(追加一条 user 消息、还是原地改写最后一条做 HITL
 * 续跑)留给调用方,因为这一步天然是协议特定的。
 */
export function clientHistory<TMsg>(opts?: { newId?: () => string }): ClientHistory<TMsg> {
  const newId = opts?.newId ?? randomUUID;
  const sessions = new Map<string, TMsg[]>();
  return {
    get(ctx) {
      const id = !ctx.session.isNew && ctx.session.id ? ctx.session.id : newId();
      ctx.session.id = id;
      return sessions.get(id) ?? [];
    },
    commit(ctx, messages) {
      if (!ctx.session.id) throw new Error("clientHistory().commit() 需要先调用过 get() 落地 ctx.session.id。");
      sessions.set(ctx.session.id, messages);
    },
  };
}

// ───────────────────────── deltaStream:逐 token / 逐参数增量累加器 ─────────────────────────

/**
 * 一帧原始数据翻成的操作。多数「返回是流」的后端,拆到最细就是这几种原子操作的排列——
 * 文本要拼接、工具参数要拼接、工具调用与结果要配对、usage 是旁路数字、error 是终态信号。
 * `toOps` 的活只是「这一帧对应哪个/哪些操作」,累加(buffer-by-id、什么时候落地成
 * StreamEvent)由 deltaStream 统一做,不用每个后端各写一遍状态机。
 */
export type DeltaOp =
  | { readonly kind: "text-delta"; readonly text: string }
  | { readonly kind: "message-end" }
  | { readonly kind: "thinking-delta"; readonly text: string }
  | { readonly kind: "tool-call-start"; readonly callId: string; readonly name: string }
  | { readonly kind: "tool-args-delta"; readonly callId: string; readonly delta: string }
  /** 该调用的参数已经拼完,落地成 `action.called`(此时通常还没有结果——纯补全式流
   *  一般由调用方在流外真正执行工具;流内也执行的后端随后再喂一条 "tool-result"）。 */
  | { readonly kind: "tool-call-end"; readonly callId: string }
  | { readonly kind: "tool-result"; readonly callId: string; readonly output?: JsonValue; readonly status?: "completed" | "failed" | "rejected" }
  | { readonly kind: "usage"; readonly usage: Usage }
  | { readonly kind: "error"; readonly message: string };

export interface DeltaStreamSpec<Frame> {
  /** 一帧 → 0~N 个操作(多数协议一帧一个操作;usage 常与收尾帧同帧,可以一次返回两个)。 */
  toOps(frame: Frame): DeltaOp[];
}

interface ToolBuffer {
  name: string;
  args: string;
}

/**
 * 逐 token / 逐参数增量的通用累加器(delta streaming——OpenAI/Anthropic 原始流式 API、
 * 手写的 token-by-token SSE 后端都是这个形状)。文本按 delta 拼接、遇 `message-end` 落地成
 * 一条 `message`;工具参数按 `callId` 拼接、遇 `tool-call-end` 落地成 `action.called`
 * (JSON 解析失败就把拼出来的原始字符串塞进 `input`,不吞错误);`tool-result` 独立到达,
 * 与「整段落地」的 `fromXxxEvents()` 系列同一个 `FrameReducer` 形状,可以直接喂
 * `driveFrameStream`。
 */
export function deltaStream<Frame>(spec: DeltaStreamSpec<Frame>): FrameReducer<Frame> {
  let textBuffer = "";
  let thinkingBuffer = "";
  const toolBuffers = new Map<string, ToolBuffer>();
  let usage: Usage | undefined;
  let failed = false;

  function flushText(events: StreamEvent[]) {
    if (textBuffer) events.push({ type: "message", role: "assistant", text: textBuffer });
    textBuffer = "";
    if (thinkingBuffer) events.push({ type: "thinking", text: thinkingBuffer });
    thinkingBuffer = "";
  }

  return {
    get usage() {
      return usage;
    },
    get failed() {
      return failed;
    },
    add(frame) {
      const events: StreamEvent[] = [];
      for (const op of spec.toOps(frame)) {
        switch (op.kind) {
          case "text-delta":
            textBuffer += op.text;
            break;
          case "thinking-delta":
            thinkingBuffer += op.text;
            break;
          case "message-end":
            flushText(events);
            break;
          case "tool-call-start":
            toolBuffers.set(op.callId, { name: op.name, args: "" });
            break;
          case "tool-args-delta": {
            const buf = toolBuffers.get(op.callId);
            if (buf) buf.args += op.delta;
            break;
          }
          case "tool-call-end": {
            const buf = toolBuffers.get(op.callId);
            toolBuffers.delete(op.callId);
            let input: JsonValue = null;
            if (buf?.args) {
              try {
                input = JSON.parse(buf.args) as JsonValue;
              } catch {
                input = buf.args; // 拼不出合法 JSON 也别吞掉,原样交给断言/人去看
              }
            }
            events.push({ type: "action.called", callId: op.callId, name: buf?.name ?? "unknown", input });
            break;
          }
          case "tool-result":
            events.push({ type: "action.result", callId: op.callId, output: op.output, status: op.status ?? "completed" });
            break;
          case "usage":
            usage = op.usage;
            break;
          case "error":
            failed = true;
            flushText(events);
            events.push({ type: "error", message: op.message });
            break;
        }
      }
      return events;
    },
  };
}
