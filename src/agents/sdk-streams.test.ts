import { describe, expect, it } from "vitest";

import { fromClaudeSdkMessages, fromCodexThreadEvents, fromPiAgentEvents, sseJsonFrames } from "./sdk-streams.ts";

function sseBody(frames: unknown[]): ReadableStream<Uint8Array> {
  const text = frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join("") + "data: [DONE]\n\n";
  return new Response(text).body!;
}

describe("sseJsonFrames", () => {
  it("逐帧解析 data: JSON,跳过 [DONE],流结束返回 null", async () => {
    const cursor = sseJsonFrames<{ n: number }>(sseBody([{ n: 1 }, { n: 2 }]));
    expect(await cursor.next()).toEqual({ n: 1 });
    expect(await cursor.next()).toEqual({ n: 2 });
    expect(await cursor.next()).toBeNull();
  });
});

describe("fromClaudeSdkMessages", () => {
  it("system/init → sessionId;assistant/user → 事件对;result → usage", () => {
    const s = fromClaudeSdkMessages();
    expect(s.add({ type: "system", subtype: "init", session_id: "sess-1" })).toEqual([]);
    expect(s.sessionId).toBe("sess-1");

    const called = s.add({
      type: "assistant",
      message: { content: [{ type: "text", text: "查一下" }, { type: "tool_use", id: "tu1", name: "get_weather", input: { city: "北京" } }] },
    });
    expect(called).toEqual([
      { type: "message", role: "assistant", text: "查一下" },
      { type: "action.called", callId: "tu1", name: "get_weather", input: { city: "北京" } },
    ]);

    expect(s.add({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tu1", content: "晴 21 度" }] } })).toEqual([
      { type: "action.result", callId: "tu1", output: "晴 21 度", status: "completed" },
    ]);

    s.add({ type: "result", is_error: false, num_turns: 2, total_cost_usd: 0.01, usage: { input_tokens: 100, output_tokens: 20 } });
    expect(s.usage).toMatchObject({ inputTokens: 100, outputTokens: 20, requests: 2, costUSD: 0.01 });
    expect(s.failed).toBe(false);
  });

  it("markRejected:tool_result 落成 rejected;permission_denied 与 tool_result 只产一条", () => {
    const s = fromClaudeSdkMessages();
    s.markRejected("tu1");
    expect(s.add({ type: "system", subtype: "permission_denied", tool_use_id: "tu1" })).toEqual([
      { type: "action.result", callId: "tu1", status: "rejected" },
    ]);
    // SDK 若随后也发 tool_result,不重复
    expect(s.add({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tu1", content: "denied" }] } })).toEqual([]);
  });

  it("assistant 的 thinking 块 → thinking 事件,与 text/tool_use 保持原始顺序", () => {
    const s = fromClaudeSdkMessages();
    expect(
      s.add({
        type: "assistant",
        message: {
          content: [
            { type: "thinking", thinking: "先查天气", signature: "sig-1" },
            { type: "text", text: "我来查" },
            { type: "tool_use", id: "tu1", name: "get_weather", input: { city: "北京" } },
          ],
        },
      }),
    ).toEqual([
      { type: "thinking", text: "先查天气" },
      { type: "message", role: "assistant", text: "我来查" },
      { type: "action.called", callId: "tu1", name: "get_weather", input: { city: "北京" } },
    ]);
  });

  it("stream_event 等未知帧返回 []", () => {
    expect(fromClaudeSdkMessages().add({ type: "stream_event" })).toEqual([]);
  });
});

describe("fromPiAgentEvents", () => {
  it("message_end → message/thinking + usage 累加;tool_execution_* → 事件对", () => {
    const s = fromPiAgentEvents();
    expect(s.add({ type: "tool_execution_start", toolCallId: "c1", toolName: "get_weather", args: { city: "上海" } })).toEqual([
      { type: "action.called", callId: "c1", name: "get_weather", input: { city: "上海" } },
    ]);
    expect(s.add({ type: "tool_execution_end", toolCallId: "c1", result: { temp: 18 }, isError: false })).toEqual([
      { type: "action.result", callId: "c1", output: { temp: 18 }, status: "completed" },
    ]);
    const msgEvents = s.add({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "thinking", thinking: "想想" }, { type: "text", text: "18 度" }],
        usage: { input: 10, output: 5, cacheRead: 1, cacheWrite: 2, cost: { total: 0.001 } },
      },
    });
    expect(msgEvents).toEqual([
      { type: "message", role: "assistant", text: "18 度" },
      { type: "thinking", text: "想想" },
    ]);
    expect(s.usage).toMatchObject({ inputTokens: 10, outputTokens: 5, requests: 1 });
  });

  it("markRejected:isError 的 tool_execution_end 落成 rejected 而非 failed", () => {
    const s = fromPiAgentEvents();
    s.markRejected("c9");
    expect(s.add({ type: "tool_execution_end", toolCallId: "c9", isError: true })).toEqual([
      { type: "action.result", callId: "c9", output: undefined, status: "rejected" },
    ]);
  });

  it("三段式聚合成一条:start/delta 不产事件,end 帧的完整 content 只落一条", () => {
    const s = fromPiAgentEvents();
    expect(s.add({ type: "message_start", message: { role: "assistant", content: [] } })).toEqual([]);
    expect(s.add({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "18" } })).toEqual([]);
    expect(s.add({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: " 度" } })).toEqual([]);
    // end 帧带完整 content:以它为准,增量不重复落地
    expect(s.add({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "18 度" }] } })).toEqual([
      { type: "message", role: "assistant", text: "18 度" },
    ]);
  });

  it("end 帧缺 content 时用累加的 text/thinking 增量兜底", () => {
    const s = fromPiAgentEvents();
    s.add({ type: "message_start", message: { role: "assistant" } });
    s.add({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "想" } });
    s.add({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "想" } });
    s.add({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 1, delta: "18 度" } });
    expect(s.add({ type: "message_end", message: { role: "assistant" } })).toEqual([
      { type: "message", role: "assistant", text: "18 度" },
      { type: "thinking", text: "想想" },
    ]);
  });

  it("只有 start/delta 的截断流不产半条消息,下一条消息不串入旧增量", () => {
    const s = fromPiAgentEvents();
    expect(s.add({ type: "message_start", message: { role: "assistant" } })).toEqual([]);
    expect(s.add({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "半截" } })).toEqual([]);
    // 流在这里断掉:没有 message_end,什么都不落地。新消息开始后旧增量作废。
    expect(s.add({ type: "message_start", message: { role: "assistant" } })).toEqual([]);
    expect(s.add({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "新消息" }] } })).toEqual([
      { type: "message", role: "assistant", text: "新消息" },
    ]);
  });

  it("失败状态帧:stopReason error/aborted → error 事件 + failed", () => {
    const s = fromPiAgentEvents();
    expect(s.failed).toBe(false);
    expect(
      s.add({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "试到一半" }], stopReason: "error", errorMessage: "boom" } }),
    ).toEqual([
      { type: "message", role: "assistant", text: "试到一半" },
      { type: "error", message: "boom" },
    ]);
    expect(s.failed).toBe(true);

    const aborted = fromPiAgentEvents();
    expect(aborted.add({ type: "message_end", message: { role: "assistant", stopReason: "aborted" } })).toEqual([
      { type: "error", message: "pi agent stopReason=aborted" },
    ]);
    expect(aborted.failed).toBe(true);
  });

  it("正常收尾(stopReason stop/toolUse)不置 failed", () => {
    const s = fromPiAgentEvents();
    s.add({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "好了" }], stopReason: "stop" } });
    expect(s.failed).toBe(false);
  });
});

describe("fromCodexThreadEvents", () => {
  it("thread.started → threadId;agent_message/reasoning → 消息;turn.failed → error", () => {
    const s = fromCodexThreadEvents();
    s.add({ type: "thread.started", thread_id: "t-1" });
    expect(s.threadId).toBe("t-1");
    expect(s.add({ type: "item.completed", item: { type: "agent_message", text: "改好了" } })).toEqual([
      { type: "message", role: "assistant", text: "改好了" },
    ]);
    expect(s.add({ type: "item.completed", item: { type: "reasoning", text: "先看文件" } })).toEqual([
      { type: "thinking", text: "先看文件" },
    ]);
    expect(s.failed).toBe(false);
    expect(s.add({ type: "turn.failed", error: { message: "boom" } })).toEqual([{ type: "error", message: "boom" }]);
    expect(s.failed).toBe(true);
  });

  it("command_execution:started 发 called,completed 只补 result(按 exit_code 判状态)", () => {
    const s = fromCodexThreadEvents();
    expect(s.add({ type: "item.started", item: { type: "command_execution", id: "c1", command: "ls" } })).toEqual([
      { type: "action.called", callId: "c1", name: "command_execution", input: { command: "ls" }, tool: "shell" },
    ]);
    expect(
      s.add({ type: "item.completed", item: { type: "command_execution", id: "c1", command: "ls", exit_code: 0, aggregated_output: "a.txt" } }),
    ).toEqual([{ type: "action.result", callId: "c1", output: { output: "a.txt", exit_code: 0 }, status: "completed" }]);
  });

  it("只有 completed 的工具项也成对;失败 exit_code → failed", () => {
    const s = fromCodexThreadEvents();
    expect(s.add({ type: "item.completed", item: { type: "command_execution", id: "c2", command: "false", exit_code: 1 } })).toEqual([
      { type: "action.called", callId: "c2", name: "command_execution", input: { command: "false" }, tool: "shell" },
      { type: "action.result", callId: "c2", output: { output: null, exit_code: 1 }, status: "failed" },
    ]);
  });

  it("mcp_tool_call 带 server 前缀;turn.completed 聚合 usage", () => {
    const s = fromCodexThreadEvents();
    expect(s.add({ type: "item.completed", item: { type: "mcp_tool_call", id: "m1", server: "kb", tool: "search", arguments: { q: "x" } } })).toEqual([
      { type: "action.called", callId: "m1", name: "kb.search", input: { q: "x" }, tool: "web_search" },
      { type: "action.result", callId: "m1", output: null, status: "completed" },
    ]);
    expect(s.usage).toBeUndefined();
    s.add({ type: "turn.completed", usage: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 7 } });
    expect(s.usage).toEqual({ inputTokens: 100, outputTokens: 7, cacheReadTokens: 40, requests: 1 });
  });

  it("file_change 每个文件一对 called/result", () => {
    const s = fromCodexThreadEvents();
    expect(
      s.add({ type: "item.completed", item: { type: "file_change", id: "p1", changes: [{ path: "a.ts", kind: "update" }] } }),
    ).toEqual([
      { type: "action.called", callId: "p1#0", name: "file_change", input: { path: "a.ts", kind: "update" }, tool: "file_edit" },
      { type: "action.result", callId: "p1#0", output: { path: "a.ts", kind: "update" }, status: "completed" },
    ]);
  });
});
