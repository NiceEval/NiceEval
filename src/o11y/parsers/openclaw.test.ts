import { describe, expect, it } from "vitest";

import { parseOpenClawTranscript, parseOpenClaw, parseOpenClawRunJson } from "./openclaw.ts";

function jsonl(lines: unknown[]): string {
  return lines.map((l) => JSON.stringify(l)).join("\n");
}

describe("parseOpenClawTranscript", () => {
  it("空 / 无内容 → 空事件流,parseSuccess true", () => {
    expect(parseOpenClawTranscript(undefined)).toEqual({
      events: [],
      usage: { inputTokens: 0, outputTokens: 0 },
      compactions: 0,
      parseSuccess: true,
    });
    expect(parseOpenClawTranscript("  \n ").events).toEqual([]);
  });

  it("assistant 的 text/thinking/toolCall parts + toolResult 按 call ID 配对,usage 逐消息累加", () => {
    const raw = jsonl([
      { role: "user", content: "改一下配置" },
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "先看文件" },
          { type: "text", text: "我来改" },
          { type: "toolCall", id: "tc_1", name: "read", arguments: { path: "a.ts" } },
        ],
        usage: { input: 100, output: 20, cacheRead: 5, cacheWrite: 3, cost: { total: 0.01 } },
      },
      { role: "toolResult", toolCallId: "tc_1", content: [{ type: "text", text: "file body" }], isError: false },
      {
        role: "assistant",
        content: [{ type: "text", text: "改好了" }],
        usage: { input: 50, output: 10, cacheRead: 0, cacheWrite: 0, cost: { total: 0.002 } },
      },
    ]);

    const parsed = parseOpenClawTranscript(raw);
    expect(parsed.events).toEqual([
      { type: "message", role: "user", text: "改一下配置" },
      { type: "thinking", text: "先看文件" },
      { type: "message", role: "assistant", text: "我来改" },
      { type: "action.called", callId: "tc_1", name: "read", input: { path: "a.ts" }, tool: "file_read" },
      { type: "action.result", callId: "tc_1", output: "file body", status: "completed" },
      { type: "message", role: "assistant", text: "改好了" },
    ]);
    expect(parsed.usage).toEqual({
      inputTokens: 150,
      outputTokens: 30,
      cacheReadTokens: 5,
      cacheWriteTokens: 3,
      requests: 2,
      costUSD: 0.012,
    });
    expect(parsed.parseSuccess).toBe(true);
  });

  it("{ type: 'message', message: {...} } 包装条目与 snake_case 变体也认", () => {
    const raw = jsonl([
      {
        type: "message",
        message: {
          role: "assistant",
          content: [{ type: "tool_call", tool_call_id: "c9", toolName: "exec", input: { cmd: "ls" } }],
        },
      },
      { type: "message", message: { role: "tool", tool_call_id: "c9", output: "a.txt", is_error: true } },
    ]);
    expect(parseOpenClaw(raw)).toEqual([
      { type: "action.called", callId: "c9", name: "exec", input: { cmd: "ls" }, tool: "shell" },
      { type: "action.result", callId: "c9", output: "a.txt", status: "failed" },
    ]);
  });

  it("compaction 条目计数,error 条目落 error 事件", () => {
    const parsed = parseOpenClawTranscript(
      jsonl([
        { type: "compaction", reason: "context-limit" },
        { type: "error", message: "boom" },
      ]),
    );
    expect(parsed.events).toEqual([
      { type: "compaction", reason: "context-limit" },
      { type: "error", message: "boom" },
    ]);
    expect(parsed.compactions).toBe(1);
  });

  it("坏 JSON 行不中断解析,标 parseSuccess: false 但保留其余行的事件", () => {
    const raw = `{"role":"assistant","content":[{"type":"text","text":"hi"}]}\nnot-json\n`;
    const parsed = parseOpenClawTranscript(raw);
    expect(parsed.parseSuccess).toBe(false);
    expect(parsed.events).toEqual([{ type: "message", role: "assistant", text: "hi" }]);
  });

  it("字符串形态的 arguments 先按 JSON 解;解不开原样保留", () => {
    const raw = jsonl([
      {
        role: "assistant",
        content: [{ type: "toolCall", id: "c1", name: "write", arguments: '{"path":"b.ts"}' }],
      },
    ]);
    expect(parseOpenClaw(raw)).toEqual([
      { type: "action.called", callId: "c1", name: "write", input: { path: "b.ts" }, tool: "file_write" },
    ]);
  });
});

describe("parseOpenClawRunJson", () => {
  it("整段 pretty-print JSON 封包:text / sessionId / usage / failed", () => {
    const stdout = JSON.stringify(
      {
        sessionId: "sess-42",
        result: { text: "done" },
        usage: { input_tokens: 10, output_tokens: 3 },
        status: "ok",
      },
      null,
      2,
    );
    expect(parseOpenClawRunJson(stdout)).toEqual({
      text: "done",
      sessionId: "sess-42",
      usage: { inputTokens: 10, outputTokens: 3 },
      failed: false,
    });
  });

  it("混日志行的 stdout:取最后一个完整 JSON 对象;payloads[].text 拼接", () => {
    const stdout = [
      "starting agent...",
      JSON.stringify({ payloads: [{ text: "第一段" }, { text: "第二段" }], sessionKey: "k1" }),
    ].join("\n");
    expect(parseOpenClawRunJson(stdout)).toEqual({
      text: "第一段\n第二段",
      sessionId: "k1",
      failed: false,
    });
  });

  it("error 字段 / status=error / success=false → failed", () => {
    expect(parseOpenClawRunJson(JSON.stringify({ error: "rate limited" })).failed).toBe(true);
    expect(parseOpenClawRunJson(JSON.stringify({ status: "error" })).failed).toBe(true);
    expect(parseOpenClawRunJson(JSON.stringify({ success: false })).failed).toBe(true);
  });

  it("解析不出 JSON → 空摘要,failed 交给调用方 exitCode", () => {
    expect(parseOpenClawRunJson("plain text output")).toEqual({ failed: false });
    expect(parseOpenClawRunJson(undefined)).toEqual({ failed: false });
  });
});
