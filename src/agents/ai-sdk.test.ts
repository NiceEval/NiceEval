import { describe, expect, it } from "vitest";

import { aiSdkAgent, fromAiSdk } from "./ai-sdk.ts";
import type { AiSdkGenerateContext, AiSdkResultLike, AiSdkTracing } from "./ai-sdk.ts";
import type { AgentContext } from "../types.ts";
import { createAgentSession } from "../context/session.ts";

describe("fromAiSdk", () => {
  it("v5+ content parts:保留真实顺序,tool-error 映射成 failed", () => {
    const { events } = fromAiSdk({
      steps: [
        {
          content: [
            { type: "reasoning", text: "先查天气" },
            { type: "tool-call", toolCallId: "call_1", toolName: "get_weather", input: { city: "Brooklyn" } },
            { type: "tool-result", toolCallId: "call_1", output: { temp: 21 } },
            { type: "tool-call", toolCallId: "call_2", toolName: "web_search", input: { query: "穿衣" } },
            { type: "tool-error", toolCallId: "call_2", error: new Error("rate limited") },
          ],
        },
        { content: [{ type: "text", text: "布鲁克林 21 度。" }] },
      ],
    });

    expect(events.map((e) => e.type)).toEqual([
      "thinking",
      "action.called",
      "action.result",
      "action.called",
      "action.result",
      "message",
    ]);
    expect(events[1]).toMatchObject({ callId: "call_1", name: "get_weather", tool: "unknown" });
    expect(events[3]).toMatchObject({ callId: "call_2", name: "web_search", tool: "web_search" });
    expect(events[4]).toMatchObject({ status: "failed", output: { error: "rate limited" } });
    expect(events[5]).toMatchObject({ role: "assistant", text: "布鲁克林 21 度。" });
  });

  it("v4 退路:认 args / result / promptTokens 旧命名", () => {
    const { events, usage } = fromAiSdk({
      steps: [
        {
          text: "算好了,是 42。",
          toolCalls: [{ toolCallId: "c1", toolName: "calculate", args: { expression: "6*7" } }],
          toolResults: [{ toolCallId: "c1", result: { value: 42 } }],
        },
      ],
      usage: { promptTokens: 100, completionTokens: 20 },
    });

    expect(events).toEqual([
      { type: "action.called", callId: "c1", name: "calculate", input: { expression: "6*7" }, tool: "unknown" },
      { type: "action.result", callId: "c1", output: { value: 42 }, status: "completed" },
      { type: "message", role: "assistant", text: "算好了,是 42。" },
    ]);
    expect(usage).toEqual({ inputTokens: 100, outputTokens: 20, requests: 1 });
  });

  it("没有 steps:退回顶层 text / toolCalls / toolResults", () => {
    const { events } = fromAiSdk({
      text: "你好!",
      toolCalls: [{ toolCallId: "c1", toolName: "read_file", input: { path: "a.ts" } }],
      toolResults: [{ toolCallId: "c1", output: "content" }],
    });

    expect(events.map((e) => e.type)).toEqual(["action.called", "action.result", "message"]);
    expect(events[0]).toMatchObject({ tool: "file_read" });
  });

  it("usage:totalUsage 优先于 usage,cachedInputTokens 进 cacheReadTokens,requests = step 数", () => {
    const { usage } = fromAiSdk({
      steps: [{ text: "a" }, { text: "b" }],
      totalUsage: { inputTokens: 300, outputTokens: 50, cachedInputTokens: 120 },
      usage: { inputTokens: 1, outputTokens: 1 },
    });

    expect(usage).toEqual({ inputTokens: 300, outputTokens: 50, requests: 2, cacheReadTokens: 120 });
  });

  it("全零 usage 视为缺失(别让 maxTokens 拿 0 假通过时看起来像有数据)", () => {
    const { usage } = fromAiSdk({ steps: [{ text: "hi" }], usage: {} });
    expect(usage).toBeUndefined();
  });

  it("空文本 / 空白 step 不产 message 事件", () => {
    const { events } = fromAiSdk({ steps: [{ text: "  " }, { content: [{ type: "text", text: "" }] }] });
    expect(events).toEqual([]);
  });

  it("无 approval 请求时 status 是 completed", () => {
    const { status } = fromAiSdk({ steps: [{ content: [{ type: "text", text: "你好" }] }] });
    expect(status).toBe("completed");
  });

  it("v7 tool-approval-request:input.requested + waiting,与 tool-call part 按 callId 去重", () => {
    const { events, status } = fromAiSdk({
      steps: [
        {
          content: [
            { type: "tool-call", toolCallId: "call_1", toolName: "send_email", input: { to: "a@b.c" } },
            {
              type: "tool-approval-request",
              approvalId: "appr_1",
              toolCall: { toolCallId: "call_1", toolName: "send_email", input: { to: "a@b.c" } },
            },
          ],
        },
      ],
    });

    expect(status).toBe("waiting");
    expect(events.map((e) => e.type)).toEqual(["action.called", "input.requested"]);
    expect(events[0]).toMatchObject({ callId: "call_1", name: "send_email" });
    expect(events[1]).toMatchObject({
      request: {
        id: "appr_1",
        action: "send_email",
        input: { to: "a@b.c" },
        options: [{ id: "approve" }, { id: "deny" }],
      },
    });
  });

  it("automatic 的 approval 请求不吐 input.requested(SDK 自动裁决,不等人)", () => {
    const { events, status } = fromAiSdk({
      steps: [
        {
          content: [
            {
              type: "tool-approval-request",
              approvalId: "appr_1",
              isAutomatic: true,
              toolCall: { toolCallId: "call_1", toolName: "send_email", input: {} },
            },
          ],
        },
      ],
    });

    expect(status).toBe("completed");
    expect(events.map((e) => e.type)).toEqual(["action.called"]);
  });

  it("approval resume:responseMessages 里的执行结果补成 action.result,排在本轮事件之前", () => {
    const { events, status } = fromAiSdk({
      steps: [{ content: [{ type: "text", text: "邮件已发送。" }] }],
      responseMessages: [
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "call_1",
              toolName: "send_email",
              output: { type: "json", value: { delivered: true } },
            },
          ],
        },
        { role: "assistant", content: [{ type: "text", text: "邮件已发送。" }] },
      ],
    });

    expect(status).toBe("completed");
    expect(events).toEqual([
      { type: "action.result", callId: "call_1", output: { delivered: true }, status: "completed" },
      { type: "message", role: "assistant", text: "邮件已发送。" },
    ]);
  });

  it("approval 拒绝:execution-denied 映射成 rejected", () => {
    const { events } = fromAiSdk({
      steps: [{ content: [{ type: "text", text: "好的,不发了。" }] }],
      responseMessages: [
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "call_1",
              toolName: "send_email",
              output: { type: "execution-denied", reason: "用户拒绝" },
            },
          ],
        },
      ],
    });

    expect(events[0]).toEqual({
      type: "action.result",
      callId: "call_1",
      output: { reason: "用户拒绝" },
      status: "rejected",
    });
  });

  it("steps 里已有的 tool-result 不因 responseMessages 重复(普通工具循环两边都有)", () => {
    const { events } = fromAiSdk({
      steps: [
        {
          content: [
            { type: "tool-call", toolCallId: "c1", toolName: "get_weather", input: { city: "北京" } },
            { type: "tool-result", toolCallId: "c1", output: { temp: 26 } },
            { type: "text", text: "北京 26 度。" },
          ],
        },
      ],
      responseMessages: [
        {
          role: "tool",
          content: [
            { type: "tool-result", toolCallId: "c1", toolName: "get_weather", output: { type: "json", value: { temp: 26 } } },
          ],
        },
      ],
    });

    expect(events.filter((e) => e.type === "action.result")).toHaveLength(1);
  });

  it("aiSdkAgent:ctx.session.id 未记录时开新会话线,同 id 续接同一份历史", async () => {
    const seen: unknown[][] = [];
    const agent = aiSdkAgent({
      generate: async ({ messages }: AiSdkGenerateContext) => {
        seen.push([...messages]);
        const result: AiSdkResultLike = {
          steps: [{ content: [{ type: "text", text: `回复#${seen.length}` }] }],
          responseMessages: [{ role: "assistant", content: `回复#${seen.length}` }],
        };
        return result;
      },
    });

    const ctx = fakeCtx();
    await agent.send({ text: "第一轮" }, ctx);
    expect(ctx.session.id).toBeDefined();
    const turn2 = await agent.send({ text: "第二轮" }, fakeCtx({ id: ctx.session.id }));

    expect(turn2.status).toBe("completed");
    // 第二轮的历史 = 用户#1 + 助手#1 + 用户#2
    expect(seen[1]).toEqual([
      { role: "user", content: "第一轮" },
      { role: "assistant", content: "回复#1" },
      { role: "user", content: "第二轮" },
    ]);

    // 新会话线:历史必须是干净的
    const ctx3 = fakeCtx();
    await agent.send({ text: "新会话" }, ctx3);
    expect(ctx3.session.id).not.toBe(ctx.session.id);
    expect(seen[2]).toEqual([{ role: "user", content: "新会话" }]);
  });

  it("aiSdkAgent:approval 停轮 → waiting;下一轮 responses 翻译成 tool-approval-response", async () => {
    const seen: unknown[][] = [];
    let call = 0;
    const agent = aiSdkAgent({
      generate: async ({ messages }: AiSdkGenerateContext) => {
        seen.push([...messages]);
        call++;
        if (call === 1) {
          return {
            steps: [
              {
                content: [
                  { type: "tool-call", toolCallId: "c1", toolName: "send_email", input: { to: "a@b.c" } },
                  { type: "tool-approval-request", approvalId: "appr_1", toolCall: { toolCallId: "c1", toolName: "send_email", input: { to: "a@b.c" } } },
                ],
              },
            ],
            responseMessages: [{ role: "assistant", content: [] }],
          } satisfies AiSdkResultLike;
        }
        return {
          steps: [{ content: [{ type: "text", text: "邮件已发送。" }] }],
          responseMessages: [],
        } satisfies AiSdkResultLike;
      },
    });

    const ctx = fakeCtx();
    const first = await agent.send({ text: "发邮件" }, ctx);
    expect(first.status).toBe("waiting");
    expect(first.events.some((e) => e.type === "input.requested")).toBe(true);

    const second = await agent.send(
      { text: "approve", responses: [{ requestId: "appr_1", optionId: "approve" }] },
      fakeCtx({ id: ctx.session.id }),
    );
    expect(second.status).toBe("completed");
    // 第二轮历史的最后一条是翻译好的裁决(tool 消息),不是用户文本
    const last = (seen[1] as { role: string; content: unknown }[]).at(-1);
    expect(last).toEqual({
      role: "tool",
      content: [{ type: "tool-approval-response", approvalId: "appr_1", approved: true }],
    });
  });

  it("aiSdkAgent:approval resume 优先按 requestId 从 input.responses 读裁决,而不是猜 input.text", async () => {
    const seen: unknown[][] = [];
    let call = 0;
    const agent = aiSdkAgent({
      generate: async ({ messages }: AiSdkGenerateContext) => {
        seen.push([...messages]);
        call++;
        if (call === 1) {
          return {
            steps: [
              {
                content: [
                  { type: "tool-call", toolCallId: "c1", toolName: "send_email", input: { to: "a@b.c" } },
                  { type: "tool-approval-request", approvalId: "appr_1", toolCall: { toolCallId: "c1", toolName: "send_email", input: { to: "a@b.c" } } },
                ],
              },
            ],
            responseMessages: [{ role: "assistant", content: [] }],
          } satisfies AiSdkResultLike;
        }
        return {
          steps: [{ content: [{ type: "text", text: "好的,没有发送。" }] }],
          responseMessages: [],
        } satisfies AiSdkResultLike;
      },
    });

    const ctx = fakeCtx();
    await agent.send({ text: "发邮件" }, ctx);

    // input.text 读起来像批准,但 responses 结构化裁决说 deny——必须以 responses 为准。
    const second = await agent.send(
      { text: "approve", responses: [{ requestId: "appr_1", optionId: "deny" }] },
      fakeCtx({ id: ctx.session.id }),
    );
    expect(second.status).toBe("completed");
    const last = (seen[1] as { role: string; content: unknown }[]).at(-1);
    expect(last).toEqual({
      role: "tool",
      content: [{ type: "tool-approval-response", approvalId: "appr_1", approved: false }],
    });
  });

  it("aiSdkAgent:approval 停轮期间的 send 没带对位 responses → 直接报错(不从文本猜)", async () => {
    const agent = aiSdkAgent({
      generate: async () => ({
        steps: [
          {
            content: [
              { type: "tool-call", toolCallId: "c1", toolName: "send_email", input: {} },
              { type: "tool-approval-request", approvalId: "appr_1", toolCall: { toolCallId: "c1", toolName: "send_email", input: {} } },
            ],
          },
        ],
        responseMessages: [{ role: "assistant", content: [] }],
      } satisfies AiSdkResultLike),
    });

    const ctx = fakeCtx();
    const first = await agent.send({ text: "发邮件" }, ctx);
    expect(first.status).toBe("waiting");
    await expect(agent.send({ text: "approve" }, fakeCtx({ id: ctx.session.id }))).rejects.toThrow(/t\.respond/);
  });

  it("aiSdkAgent:tracing 管线——每轮拿 per-attempt 端点建集成经 ctx.telemetry 交给 generate,轮末 flush", async () => {
    const endpoints: string[] = [];
    const flushed: string[] = [];
    const tracing: AiSdkTracing = {
      telemetryForEndpoint(endpoint) {
        endpoints.push(endpoint);
        return {
          settings: { integrations: ["fake-integration"] },
          flush: async () => { flushed.push(endpoint); },
        };
      },
    };
    let seenTelemetry: unknown;
    const agent = aiSdkAgent({
      tracing,
      generate: async ({ telemetry }) => {
        seenTelemetry = telemetry;
        return { text: "ok" };
      },
    });

    const turn = await agent.send(
      { text: "hi" },
      { ...fakeCtx(), telemetry: { endpoint: "http://127.0.0.1:4318/v1/traces" } },
    );
    expect(turn.status).toBe("completed");
    expect(seenTelemetry).toEqual({ integrations: ["fake-integration"] });
    expect(endpoints).toEqual(["http://127.0.0.1:4318/v1/traces"]);
    expect(flushed).toEqual(["http://127.0.0.1:4318/v1/traces"]);
  });

  it("aiSdkAgent:generate 抛错也要 flush(本轮已产生的 span 不能丢)", async () => {
    let flushes = 0;
    const tracing: AiSdkTracing = {
      telemetryForEndpoint: () => ({
        settings: { integrations: [] },
        flush: async () => { flushes++; },
      }),
    };
    const agent = aiSdkAgent({
      tracing,
      generate: async () => { throw new Error("upstream timeout"); },
    });

    const turn = await agent.send({ text: "hi" }, { ...fakeCtx(), telemetry: { endpoint: "http://e/v1/traces" } });
    expect(turn.status).toBe("failed");
    expect(flushes).toBe(1);
  });

  it("aiSdkAgent:没配 tracing 时 generate 的 telemetry 恒为 undefined", async () => {
    let seenTelemetry: unknown = "sentinel";
    const agent = aiSdkAgent({
      generate: async ({ telemetry }) => {
        seenTelemetry = telemetry;
        return { text: "ok" };
      },
    });
    await agent.send({ text: "hi" }, fakeCtx());
    expect(seenTelemetry).toBeUndefined();
  });

  it("aiSdkAgent:generate 抛错 / 空结果 → failed + error 事件", async () => {
    const boom = aiSdkAgent({ generate: async () => { throw new Error("上游超时"); } });
    const failed = await boom.send({ text: "hi" }, fakeCtx());
    expect(failed.status).toBe("failed");
    expect(failed.events[0]).toMatchObject({ type: "error", message: "上游超时" });

    const empty = aiSdkAgent({ generate: async () => ({ steps: [{ text: "" }] }) });
    const emptyTurn = await empty.send({ text: "hi" }, fakeCtx());
    expect(emptyTurn.status).toBe("failed");
  });

  it("v7 usage:cache tokens 从 inputTokenDetails 读", () => {
    const { usage } = fromAiSdk({
      steps: [{ text: "hi" }],
      usage: { inputTokens: 100, outputTokens: 20, inputTokenDetails: { cacheReadTokens: 40, cacheWriteTokens: 8 } },
    });

    expect(usage).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      requests: 1,
      cacheReadTokens: 40,
      cacheWriteTokens: 8,
    });
  });
});

/** 省略 `id`(或不给参数)= 全新会话线;传 `id` = 这条线已经 capture 过这个 id(续接轮)。 */
function fakeCtx(opts: { id?: string } = {}): AgentContext {
  const session = createAgentSession();
  if (opts.id) session.capture(opts.id);
  return {
    signal: new AbortController().signal,
    model: undefined,
    flags: {},
    sandbox: undefined as unknown as AgentContext["sandbox"],
    session,
    log: () => {},
  };
}
