// cases: docs/engineering/unit-tests/adapters/cases.md
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AgentContext } from "../types.ts";
import { uiMessageStreamAgent, type UIMessageLike, type UIMessagePartLike } from "./ui-message-stream.ts";
import { createAgentSession } from "../context/session.ts";

// ─────────────────── mock `ai`:协议语义的最小 reducer(readUIMessageStream 同款行为) ───────────────────
// 只实现测试用到的 chunk 类型;seed(resume 的 message)上的 parts 原样保留、按 toolCallId 更新。

vi.mock("ai", () => ({
  readUIMessageStream: ({ message, stream }: { message?: UIMessageLike; stream: ReadableStream<Record<string, unknown>> }) =>
    (async function* () {
      const msg: UIMessageLike = message
        ? { ...message, parts: message.parts.map((p) => ({ ...p })) }
        : { id: "m1", role: "assistant", parts: [] };
      const toolPart = (toolCallId: string) =>
        msg.parts.find((p) => (p as UIMessagePartLike).toolCallId === toolCallId) as UIMessagePartLike | undefined;
      const reader = stream.getReader();
      for (;;) {
        const { value: c, done } = await reader.read();
        if (done) break;
        const chunk = c as Record<string, unknown>;
        switch (chunk.type) {
          case "text-delta": {
            const last = msg.parts.at(-1);
            if (last?.type === "text") last.text = (last.text ?? "") + (chunk.delta as string);
            else msg.parts.push({ type: "text", text: chunk.delta as string });
            break;
          }
          case "tool-input-available":
            msg.parts.push({
              type: `tool-${chunk.toolName as string}`,
              state: "input-available",
              toolCallId: chunk.toolCallId as string,
              input: chunk.input,
            });
            break;
          case "tool-output-available": {
            const p = toolPart(chunk.toolCallId as string);
            if (p) {
              p.state = "output-available";
              p.output = chunk.output;
            }
            break;
          }
          case "tool-approval-request": {
            const p = toolPart(chunk.toolCallId as string);
            if (p) {
              p.state = "approval-requested";
              p.approval = { id: chunk.approvalId as string };
            }
            break;
          }
          default:
            break; // start / finish / error 等对归约无影响
        }
      }
      yield msg;
    })(),
}));

// ─────────────────── fetch mock:每次调用吐一段脚本化的 SSE ───────────────────

function sse(chunks: Array<Record<string, unknown>>): Response {
  const payload = [...chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`), "data: [DONE]\n\n"].join("");
  return new Response(payload, { status: 200, headers: { "content-type": "text/event-stream" } });
}

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);

function ctx(overrides: Partial<{ model: string }> = {}): AgentContext {
  return {
    signal: new AbortController().signal,
    model: overrides.model,
    flags: {},
    sandbox: undefined as never,
    // 同一个 ctx 重复用 = 同一条会话线(续接,同一个 ctx.session);新造 = 新线。
    session: createAgentSession(),
    progress: () => {},
    diagnostic: () => {},
    log: () => {},
  } as AgentContext;
}

function sentBody(call: number): { messages: UIMessageLike[] } & Record<string, unknown> {
  return JSON.parse(fetchMock.mock.calls[call]![1]!.body as string) as { messages: UIMessageLike[] };
}

afterEach(() => {
  fetchMock.mockReset();
});

describe("uiMessageStreamAgent", () => {
  it("声明全通道 complete,usage 例外(协议帧不带 token 计数)——官方 SDK 适配器的覆盖声明义务", () => {
    const agent = uiMessageStreamAgent({ name: "t", url: "http://x/api/chat" });
    expect(agent.coverage?.events?.status).toBe("complete");
    expect(agent.coverage?.actions?.status).toBe("complete");
    expect(agent.coverage?.messages?.status).toBe("complete");
    expect(agent.coverage?.status?.status).toBe("complete");
    expect(agent.coverage?.data?.status).toBe("complete");
    expect(agent.coverage?.usage?.status).toBe("unavailable");
  });

  it("纯文本轮:message 事件 + completed;第二轮重放全量历史(客户端带历史的协议语义)", async () => {
    const agent = uiMessageStreamAgent({ name: "t", url: "http://x/api/chat", body: (c) => ({ model: c.model }) });
    fetchMock.mockResolvedValueOnce(sse([{ type: "text-delta", delta: "你好" }, { type: "text-delta", delta: "!" }]));

    const c = ctx({ model: "m-1" });
    const turn = await agent.send({ text: "hi" }, c);
    expect(turn.status).toBe("completed");
    expect(turn.events).toEqual([{ type: "message", role: "assistant", text: "你好!" }]);
    expect(c.session.id).toBeTruthy();
    expect(sentBody(0).model).toBe("m-1");
    expect(sentBody(0).messages).toHaveLength(1);

    fetchMock.mockResolvedValueOnce(sse([{ type: "text-delta", delta: "again" }]));
    const turn2 = await agent.send({ text: "再说一次" }, c);
    // user, assistant, user —— 全量历史重放
    expect(sentBody(1).messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    // 回归:mock 的响应消息 id 每轮都是 "m1"(有的应用真的会这样)。全新轮的文本必须完整
    // 报出,不能被上一轮的已报进度按 id 误当成"已报过的前缀"截掉。
    expect(turn2.events).toEqual([{ type: "message", role: "assistant", text: "again" }]);
  });

  it("工具 part 到 output-available → action.called + action.result", async () => {
    const agent = uiMessageStreamAgent({ name: "t", url: "http://x/api/chat" });
    fetchMock.mockResolvedValueOnce(
      sse([
        { type: "tool-input-available", toolCallId: "c1", toolName: "get_weather", input: { city: "北京" } },
        { type: "tool-output-available", toolCallId: "c1", output: { temp: 21 } },
        { type: "text-delta", delta: "21 度" },
      ]),
    );
    const turn = await agent.send({ text: "天气" }, ctx());
    expect(turn.events).toEqual([
      { type: "action.called", callId: "c1", name: "get_weather", input: { city: "北京" } },
      { type: "action.result", callId: "c1", output: { temp: 21 }, status: "completed" },
      { type: "message", role: "assistant", text: "21 度" },
    ]);
  });

  it("HITL:approval-requested → waiting;approve 续跑改写 part 重放,拿到执行结果不重报旧事件", async () => {
    const agent = uiMessageStreamAgent({ name: "t", url: "http://x/api/chat" });
    fetchMock.mockResolvedValueOnce(
      sse([
        { type: "tool-input-available", toolCallId: "c1", toolName: "calculate", input: { expr: "1+1" } },
        { type: "tool-approval-request", toolCallId: "c1", approvalId: "ap1" },
      ]),
    );
    const c = ctx();
    const turn1 = await agent.send({ text: "算 1+1" }, c);
    expect(turn1.status).toBe("waiting");
    expect(turn1.events).toEqual([
      {
        type: "input.requested",
        request: { id: "ap1", action: "calculate", input: { expr: "1+1" }, options: [{ id: "approve" }, { id: "deny" }] },
      },
    ]);

    fetchMock.mockResolvedValueOnce(
      sse([{ type: "tool-output-available", toolCallId: "c1", output: 2 }, { type: "text-delta", delta: "= 2" }]),
    );
    const turn2 = await agent.send({ text: "approve", responses: [{ requestId: "ap1", optionId: "approve" }] }, c);
    expect(turn2.status).toBe("completed");
    expect(turn2.events).toEqual([
      { type: "action.called", callId: "c1", name: "calculate", input: { expr: "1+1" } },
      { type: "action.result", callId: "c1", output: 2, status: "completed" },
      { type: "message", role: "assistant", text: "= 2" },
    ]);
    // 续跑请求:不追加新 user 消息,pending part 已改写成 approval-responded approved:true
    const resumeBody = sentBody(1);
    expect(resumeBody.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    const mutated = resumeBody.messages[1]!.parts.find((p) => p.toolCallId === "c1")!;
    expect(mutated.state).toBe("approval-responded");
    expect(mutated.approval).toMatchObject({ id: "ap1", approved: true });
    expect(mutated.approval!.reason).toBeUndefined();
  });

  it("HITL:deny 合成 rejected 的工具对,并带上劝退重试的 reason", async () => {
    const agent = uiMessageStreamAgent({ name: "t", url: "http://x/api/chat", denyReason: "别重试" });
    fetchMock.mockResolvedValueOnce(
      sse([
        { type: "tool-input-available", toolCallId: "c1", toolName: "calculate", input: { expr: "1+1" } },
        { type: "tool-approval-request", toolCallId: "c1", approvalId: "ap1" },
      ]),
    );
    const c = ctx();
    await agent.send({ text: "算" }, c);

    fetchMock.mockResolvedValueOnce(sse([{ type: "text-delta", delta: "好的,不算了" }]));
    const turn2 = await agent.send({ text: "deny", responses: [{ requestId: "ap1", optionId: "deny" }] }, c);
    expect(turn2.status).toBe("completed");
    expect(turn2.events).toEqual([
      { type: "action.called", callId: "c1", name: "calculate", input: { expr: "1+1" } },
      { type: "action.result", callId: "c1", status: "rejected" },
      { type: "message", role: "assistant", text: "好的,不算了" },
    ]);
    const mutated = sentBody(1).messages[1]!.parts.find((p) => p.toolCallId === "c1")!;
    expect(mutated.approval).toMatchObject({ approved: false, reason: "别重试" });
  });

  it("HITL:优先按 requestId 从 input.responses 读裁决,而不是猜 input.text——两者矛盾时以 responses 为准", async () => {
    const agent = uiMessageStreamAgent({ name: "t", url: "http://x/api/chat" });
    fetchMock.mockResolvedValueOnce(
      sse([
        { type: "tool-input-available", toolCallId: "c1", toolName: "calculate", input: { expr: "1+1" } },
        { type: "tool-approval-request", toolCallId: "c1", approvalId: "ap1" },
      ]),
    );
    const c = ctx();
    await agent.send({ text: "算 1+1" }, c);

    fetchMock.mockResolvedValueOnce(sse([{ type: "text-delta", delta: "好的,不算了" }]));
    // input.text 读起来像批准,但 responses 结构化裁决说 deny——必须以 responses 为准。
    const turn2 = await agent.send({ text: "approve", responses: [{ requestId: "ap1", optionId: "deny" }] }, c);
    expect(turn2.events).toEqual([
      { type: "action.called", callId: "c1", name: "calculate", input: { expr: "1+1" } },
      { type: "action.result", callId: "c1", status: "rejected" },
      { type: "message", role: "assistant", text: "好的,不算了" },
    ]);
    const mutated = sentBody(1).messages[1]!.parts.find((p) => p.toolCallId === "c1")!;
    expect(mutated.approval).toMatchObject({ approved: false });
  });

  it("HITL:approval 停轮期间的 send 没带对位 responses → 直接报错(不从文本猜)", async () => {
    const agent = uiMessageStreamAgent({ name: "t", url: "http://x/api/chat" });
    fetchMock.mockResolvedValueOnce(
      sse([
        { type: "tool-input-available", toolCallId: "c1", toolName: "calculate", input: { expr: "1+1" } },
        { type: "tool-approval-request", toolCallId: "c1", approvalId: "ap1" },
      ]),
    );
    const c = ctx();
    await agent.send({ text: "算 1+1" }, c);

    await expect(agent.send({ text: "approve" }, c)).rejects.toThrow(/t\.respond/);
  });

  it("error 帧 → failed + error 事件", async () => {
    const agent = uiMessageStreamAgent({ name: "t", url: "http://x/api/chat" });
    fetchMock.mockResolvedValueOnce(sse([{ type: "text-delta", delta: "部分" }, { type: "error", errorText: "boom" }]));
    const turn = await agent.send({ text: "hi" }, ctx());
    expect(turn.status).toBe("failed");
    expect(turn.events.at(-1)).toEqual({ type: "error", message: "boom" });
  });

  it("非 2xx 响应:报错里带状态码和下一步提示", async () => {
    const agent = uiMessageStreamAgent({ name: "t", url: "http://x/api/chat" });
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 500 }));
    await expect(agent.send({ text: "hi" }, ctx())).rejects.toThrow(/500/);
  });
});
