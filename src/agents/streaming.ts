// 官方的「拼装方式」件:把一个手写 send 里反复出现的事收成可复用的小东西,
// 而不是每接一个新后端就重写一遍循环 + Map + if/else。
//
// 背景(见 docs-site/zh/how-to/write-send.mdx):一轮交互里真正互不相干的事只有几类——
//   1. 怎么把输入发出去(transport)——真做不掉,adapter 只写这个;
//   2. 原始数据怎么变成 StreamEvent[]——按数据到达形状分「整段落地」(sdk-streams.ts 的
//      fromXxxEvents,已有)和「逐 token / 逐参数增量」(deltaStream,这里新增)两种官方 reducer;
//   3. 会话续接与 HITL 暂停恢复——这两件事完全是控制流层面的模式,和任何具体协议无关,
//      存取器直接挂在 ctx.session 上(history()/id+capture()、hold()/take()),adapter 取用即可,
//      不需要额外声明什么(见 src/context/session.ts 的 createAgentSession)。
//
// driveFrameStream 把「逐帧喂 reducer + 处理特殊传输帧 + 检测 HITL 暂停信号」这个循环收成
// 一个函数——claude-sdk / codex-sdk / pi-sdk 三个示例里几乎相同的 drainStream,现在只需要
// 传一个 onFrame 钩子声明「这一帧要不要额外处理」,不用每次重写循环本身。

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
 * 暂停时不关闭 cursor——调用方多半用 `ctx.session.hold(cursor)` 存住它,回答轮
 * `ctx.session.take()` 取回,下一轮直接接着读同一条流,不重新发起请求。
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

    const verdict = onFrame?.(frame, derived, ctx);
    if (verdict && "pause" in verdict) {
      events.push({ type: "input.requested", request: verdict.pause });
      return { status: "waiting", events, usage: reducer.usage };
    }
    if (verdict && "fail" in verdict) {
      transportFailed = true;
      events.push({ type: "error", message: verdict.fail });
    }
  }

  return { status: transportFailed || reducer.failed ? "failed" : "completed", events, usage: reducer.usage };
}

// 会话续接(id/capture、history)与 HITL 停轮现场(hold/take)不再是这里的可选「拼装件」——
// 它们是 ctx.session(AgentSession)本身的存取器,任何 adapter 直接取用,不需要额外声明什么。
// 见 docs-site/zh/explanation/adapter.mdx 与 src/context/session.ts 的 createAgentSession。

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
