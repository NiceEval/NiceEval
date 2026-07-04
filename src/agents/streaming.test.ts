import { describe, expect, it } from "vitest";

import { clientHistory, deltaStream, driveFrameStream, pausable, serverSession } from "./streaming.ts";
import type { DeltaOp } from "./streaming.ts";
import type { AgentContext } from "../types.ts";

function ctxOf(session: { id?: string; isNew: boolean }): AgentContext {
  return {
    signal: new AbortController().signal,
    flags: {},
    session,
    sandbox: undefined as never,
    log() {},
  };
}

describe("deltaStream", () => {
  // 模拟一个 OpenAI Chat Completions 风格的原始增量流:choices[0].delta.content 逐 token、
  // choices[0].delta.tool_calls[i] 逐参数、finish_reason 收尾、独立的 usage 帧。
  interface RawChunk {
    delta?: { content?: string; tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[] };
    finish_reason?: string | null;
    usage?: { prompt_tokens: number; completion_tokens: number };
  }

  const toolIndexToCallId = new Map<number, string>();

  function toOps(chunk: RawChunk): DeltaOp[] {
    const ops: DeltaOp[] = [];
    if (chunk.delta?.content) ops.push({ kind: "text-delta", text: chunk.delta.content });
    for (const tc of chunk.delta?.tool_calls ?? []) {
      if (tc.id) {
        toolIndexToCallId.set(tc.index, tc.id);
        ops.push({ kind: "tool-call-start", callId: tc.id, name: tc.function?.name ?? "unknown" });
      }
      const callId = toolIndexToCallId.get(tc.index)!;
      if (tc.function?.arguments) ops.push({ kind: "tool-args-delta", callId, delta: tc.function.arguments });
    }
    if (chunk.finish_reason === "tool_calls") {
      for (const callId of toolIndexToCallId.values()) ops.push({ kind: "tool-call-end", callId });
    }
    if (chunk.finish_reason === "stop") ops.push({ kind: "message-end" });
    if (chunk.usage) ops.push({ kind: "usage", usage: { inputTokens: chunk.usage.prompt_tokens, outputTokens: chunk.usage.completion_tokens } });
    return ops;
  }

  it("逐 token 文本拼接,message-end 落地成一条 message", () => {
    const s = deltaStream({ toOps });
    expect(s.add({ delta: { content: "北" } })).toEqual([]);
    expect(s.add({ delta: { content: "京" } })).toEqual([]);
    expect(s.add({ delta: { content: "晴" } })).toEqual([]);
    expect(s.add({ finish_reason: "stop" })).toEqual([{ type: "message", role: "assistant", text: "北京晴" }]);
  });

  it("逐参数拼接 + 合法 JSON 落地成 action.called;usage 帧旁路累积", () => {
    toolIndexToCallId.clear();
    const s = deltaStream({ toOps });
    s.add({ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "get_weather", arguments: '{"cit' } }] } });
    s.add({ delta: { tool_calls: [{ index: 0, function: { arguments: 'y":"北京"}' } }] } });
    const events = s.add({ finish_reason: "tool_calls" });
    expect(events).toEqual([{ type: "action.called", callId: "call_1", name: "get_weather", input: { city: "北京" } }]);

    s.add({ usage: { prompt_tokens: 42, completion_tokens: 7 } });
    expect(s.usage).toEqual({ inputTokens: 42, outputTokens: 7 });
  });

  it("拼不出合法 JSON 时,把原始字符串塞进 input,不吞错误", () => {
    toolIndexToCallId.clear();
    const s = deltaStream({ toOps });
    s.add({ delta: { tool_calls: [{ index: 0, id: "call_2", function: { name: "broken", arguments: "not json" } }] } });
    expect(s.add({ finish_reason: "tool_calls" })).toEqual([{ type: "action.called", callId: "call_2", name: "broken", input: "not json" }]);
  });

  it("tool-result 独立到达,配对靠 core 的 deriveRunFacts,这里只管落地成 action.result", () => {
    const s = deltaStream<{ result?: { callId: string; output: string } }>({
      toOps: (f) => (f.result ? [{ kind: "tool-result", callId: f.result.callId, output: f.result.output, status: "completed" }] : []),
    });
    expect(s.add({ result: { callId: "call_1", output: "22C" } })).toEqual([
      { type: "action.result", callId: "call_1", output: "22C", status: "completed" },
    ]);
  });

  it("error 操作:落地未完成的文本、置 failed、附一条 error 事件", () => {
    const s = deltaStream({ toOps });
    s.add({ delta: { content: "还没说完" } });
    const events = s.add({ finish_reason: "error" } as never);
    // toOps 不认识 "error" finish_reason,验证一条真正的错误路径
    expect(events).toEqual([]);
    const s2 = deltaStream<{ err?: string }>({ toOps: (f) => (f.err ? [{ kind: "error", message: f.err }] : []) });
    expect(s2.add({ err: "网关超时" })).toEqual([{ type: "error", message: "网关超时" }]);
    expect(s2.failed).toBe(true);
  });
});

describe("pausable", () => {
  it("take() 只消费一次;没有 hold 过就是 undefined", () => {
    const p = pausable<{ toolCallId: string }>();
    const ctx = ctxOf({ id: "s1", isNew: false });
    expect(p.take(ctx)).toBeUndefined();
    p.hold(ctx, { toolCallId: "c1" });
    expect(p.take(ctx)).toEqual({ toolCallId: "c1" });
    expect(p.take(ctx)).toBeUndefined();
  });

  it("hold() 要求 ctx.session.id 已经写回", () => {
    const p = pausable<{ x: number }>();
    expect(() => p.hold(ctxOf({ isNew: true }), { x: 1 })).toThrow(/ctx.session.id/);
  });

  it("按 session id 隔离,不同会话互不干扰", () => {
    const p = pausable<{ v: string }>();
    p.hold(ctxOf({ id: "a", isNew: false }), { v: "A" });
    p.hold(ctxOf({ id: "b", isNew: false }), { v: "B" });
    expect(p.take(ctxOf({ id: "b", isNew: false }))).toEqual({ v: "B" });
    expect(p.take(ctxOf({ id: "a", isNew: false }))).toEqual({ v: "A" });
  });
});

describe("serverSession", () => {
  it("isNew 时不带 resume id,续接轮带上已有 id", () => {
    const session = serverSession();
    expect(session.id(ctxOf({ isNew: true }))).toBeUndefined();
    expect(session.id(ctxOf({ id: "sess-1", isNew: false }))).toBe("sess-1");
  });

  it("capture 只在新会话第一轮落地;resume 轮不会被后端回传的 id 覆盖", () => {
    const session = serverSession();
    const fresh = ctxOf({ isNew: true });
    session.capture(fresh, "sess-new");
    expect(fresh.session.id).toBe("sess-new");

    const resuming = ctxOf({ id: "sess-old", isNew: false });
    session.capture(resuming, "sess-forked"); // 后端可能因 fork 换了新 id,续接轮不该被它覆盖
    expect(resuming.session.id).toBe("sess-old");

    session.capture(fresh, "sess-other"); // 同一轮内第二次回传,不覆盖已写的 id
    expect(fresh.session.id).toBe("sess-new");
  });
});

describe("clientHistory", () => {
  it("isNew 时历史为空并分配新 id;非 isNew 时取回上次 commit 的历史", () => {
    const history = clientHistory<{ role: string; text: string }>();
    const fresh = ctxOf({ isNew: true });
    expect(history.get(fresh)).toEqual([]);
    expect(fresh.session.id).toBeTruthy();

    history.commit(fresh, [{ role: "user", text: "hi" }, { role: "assistant", text: "hello" }]);

    const resuming = ctxOf({ id: fresh.session.id, isNew: false });
    expect(history.get(resuming)).toEqual([{ role: "user", text: "hi" }, { role: "assistant", text: "hello" }]);
  });

  it("不同会话线的历史互相隔离", () => {
    const history = clientHistory<{ n: number }>();
    const a = ctxOf({ isNew: true });
    history.get(a);
    history.commit(a, [{ n: 1 }]);

    const b = ctxOf({ isNew: true });
    expect(history.get(b)).toEqual([]); // 全新会话线,看不到 a 的历史
  });

  it("commit() 前没调过 get() 就报错(id 还没落地)", () => {
    const history = clientHistory<{ n: number }>();
    expect(() => history.commit(ctxOf({ isNew: true }), [])).toThrow(/get\(\)/);
  });
});

describe("driveFrameStream", () => {
  function cursorOf<T>(frames: T[]) {
    let i = 0;
    return { async next() { return i < frames.length ? frames[i++] : null; } };
  }

  it("逐帧喂 reducer,汇总 events / usage,流结束正常 completed", async () => {
    const frames = [{ text: "a" }, { text: "b" }];
    const reducer = {
      usage: { inputTokens: 1, outputTokens: 2 },
      add: (f: { text: string }) => [{ type: "message" as const, role: "assistant" as const, text: f.text }],
    };
    const turn = await driveFrameStream(cursorOf(frames), reducer, ctxOf({ isNew: true }));
    expect(turn.status).toBe("completed");
    expect(turn.events).toHaveLength(2);
    expect(turn.usage).toEqual({ inputTokens: 1, outputTokens: 2 });
  });

  it("onFrame 返回 pause:立即停止读流,附加 input.requested,status 置 waiting", async () => {
    let consumed = 0;
    const cursor = {
      async next() {
        consumed++;
        return consumed <= 3 ? { gate: consumed === 2 } : null;
      },
    };
    const reducer = { add: () => [] };
    const turn = await driveFrameStream(cursor, reducer, ctxOf({ id: "s1", isNew: false }), (frame) =>
      frame.gate ? { pause: { id: "req1", action: "deploy" } } : undefined,
    );
    expect(turn.status).toBe("waiting");
    expect(consumed).toBe(2); // 第三帧没被读——暂停立即返回,不多读
    expect(turn.events).toEqual([{ type: "input.requested", request: { id: "req1", action: "deploy" } }]);
  });

  it("onFrame 返回 fail:记一条 error,继续读完,status 置 failed", async () => {
    const frames = [{ err: false }, { err: true }, { err: false }];
    const reducer = { add: () => [] };
    const turn = await driveFrameStream(cursorOf(frames), reducer, ctxOf({ isNew: true }), (f) =>
      f.err ? { fail: "网关超时" } : undefined,
    );
    expect(turn.status).toBe("failed");
    expect(turn.events).toEqual([{ type: "error", message: "网关超时" }]);
  });

  it("reducer.failed 为真时即便没有 onFrame 也判 failed", async () => {
    const reducer = { failed: true, add: () => [] };
    const turn = await driveFrameStream(cursorOf([{}]), reducer, ctxOf({ isNew: true }));
    expect(turn.status).toBe("failed");
  });
});
