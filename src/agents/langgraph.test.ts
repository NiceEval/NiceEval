import { describe, expect, it } from "vitest";

import { fromLangGraphEvents } from "./langgraph.ts";

describe("fromLangGraphEvents", () => {
  it("messages+tools 全链:content blocks → 事件,tools started/finished 按 call id 配对,usage 在 finish 上", () => {
    const s = fromLangGraphEvents();

    // messages finish:reasoning / text / tool_call blocks 按原始顺序落事件
    expect(
      s.add({
        channel: "messages",
        event: "finish",
        data: {
          message: {
            role: "assistant",
            content: [
              { type: "reasoning", reasoning: "先查天气" },
              { type: "text", text: "我来查一下" },
              { type: "tool_call", id: "call_1", name: "get_weather", args: { city: "北京" } },
            ],
            usage_metadata: { input_tokens: 100, output_tokens: 20 },
          },
        },
      }),
    ).toEqual([
      { type: "thinking", text: "先查天气" },
      { type: "message", role: "assistant", text: "我来查一下" },
      { type: "action.called", callId: "call_1", name: "get_weather", input: { city: "北京" }, tool: "unknown" },
    ]);
    expect(s.usage).toEqual({ inputTokens: 100, outputTokens: 20, requests: 1 });

    // tools/started 描述同一次调用:按 call ID 去重,不重发 action.called
    expect(
      s.add({ channel: "tools", event: "started", data: { id: "call_1", name: "get_weather", input: { city: "北京" } } }),
    ).toEqual([]);

    expect(s.add({ channel: "tools", event: "finished", data: { id: "call_1", output: { temp: 21 } } })).toEqual([
      { type: "action.result", callId: "call_1", output: { temp: 21 }, status: "completed" },
    ]);

    expect(s.add({ channel: "lifecycle", event: "completed" })).toEqual([]);
    expect(s.status).toBe("completed");
  });

  it("messages partial(逐 token 增量)整个忽略;user 消息也落 message 事件", () => {
    const s = fromLangGraphEvents();
    expect(s.add({ channel: "messages", event: "partial", data: { message: { role: "assistant", content: "我" } } })).toEqual([]);
    expect(s.add({ channel: "messages", event: "finish", data: { message: { role: "user", content: "东京天气" } } })).toEqual([
      { type: "message", role: "user", text: "东京天气" },
    ]);
    expect(s.usage).toBeUndefined(); // 协议没报 usage 就不编造
  });

  it("tools/started 单独出现也成对;error → failed,markRejected 后 → rejected", () => {
    const s = fromLangGraphEvents();
    expect(s.add({ channel: "tools", event: "started", data: { id: "c1", name: "search_docs", input: { q: "x" } } })).toEqual([
      { type: "action.called", callId: "c1", name: "search_docs", input: { q: "x" }, tool: "unknown" },
    ]);
    expect(s.add({ channel: "tools", event: "error", data: { id: "c1", error: "boom" } })).toEqual([
      { type: "action.result", callId: "c1", output: "boom", status: "failed" },
    ]);

    s.add({ channel: "tools", event: "started", data: { id: "c2", name: "send_email", input: {} } });
    s.markRejected("c2");
    expect(s.add({ channel: "tools", event: "error", data: { id: "c2", error: "denied" } })).toEqual([
      { type: "action.result", callId: "c2", output: "denied", status: "rejected" },
    ]);
  });

  it("interrupt → input.requested + waiting;HITL 请求形状映射 action/input/display/options", () => {
    const s = fromLangGraphEvents();
    const events = s.add({
      channel: "lifecycle",
      event: "interrupted",
      data: {
        interrupts: [
          {
            id: "int_1",
            value: {
              action_request: { action: "send_email", args: { to: "a@b.c" } },
              description: "需要人工批准发送邮件",
              config: { allow_accept: true, allow_ignore: true },
            },
          },
        ],
      },
    });
    expect(events).toEqual([
      {
        type: "input.requested",
        request: {
          id: "int_1",
          action: "send_email",
          input: { to: "a@b.c" },
          display: "需要人工批准发送邮件",
          options: [{ id: "accept" }, { id: "ignore" }],
        },
      },
    ]);
    expect(s.status).toBe("waiting");

    // 同一 interrupt 也从 input 通道到达:按 id 去重,只产一条请求事件
    expect(s.add({ channel: "input", data: { id: "int_1", value: "approve?" } })).toEqual([]);
  });

  it("input 通道的字符串 interrupt value → prompt", () => {
    const s = fromLangGraphEvents();
    expect(s.add({ channel: "input", data: { id: "q1", value: "要继续吗?" } })).toEqual([
      { type: "input.requested", request: { id: "q1", prompt: "要继续吗?" } },
    ]);
  });

  it("lifecycle failed → status failed + error 事件", () => {
    const s = fromLangGraphEvents();
    expect(s.add({ channel: "lifecycle", event: "failed", data: { error: { message: "graph exploded" } } })).toEqual([
      { type: "error", message: "graph exploded" },
    ]);
    expect(s.status).toBe("failed");
  });

  it("subgraph namespace → subagent 层级:首见补 called,该层 lifecycle 闭合成 completed", () => {
    const s = fromLangGraphEvents();

    // 嵌套 namespace 的首个事件:自外向内逐级补 subagent.called(段内 : 后缀不进展示名)
    const events = s.add({
      channel: "tools",
      event: "started",
      namespace: ["research:ckpt-1", "web:ckpt-2"],
      data: { id: "t1", name: "fetch_page", input: { url: "https://x" } },
    });
    expect(events).toEqual([
      { type: "subagent.called", callId: "research:ckpt-1", name: "research" },
      { type: "subagent.called", callId: "research:ckpt-1/web:ckpt-2", name: "web" },
      { type: "action.called", callId: "t1", name: "fetch_page", input: { url: "https://x" }, tool: "unknown" },
    ]);

    // 内层 lifecycle completed 只闭合内层
    expect(s.add({ channel: "lifecycle", event: "completed", namespace: ["research:ckpt-1", "web:ckpt-2"] })).toEqual([
      { type: "subagent.completed", callId: "research:ckpt-1/web:ckpt-2", status: "completed" },
    ]);

    // 根图 completed:仍未闭合的层级一起闭合
    expect(s.add({ channel: "lifecycle", event: "completed" })).toEqual([
      { type: "subagent.completed", callId: "research:ckpt-1", status: "completed" },
    ]);
    expect(s.status).toBe("completed");
  });

  it("subgraph lifecycle failed 闭合成 failed,并先闭合更深的打开层级", () => {
    const s = fromLangGraphEvents();
    s.add({ channel: "messages", event: "finish", namespace: ["a", "b"], data: { message: { role: "assistant", content: "hi" } } });
    expect(s.add({ channel: "lifecycle", event: "failed", namespace: ["a"], data: { error: "sub failed" } })).toEqual([
      { type: "subagent.completed", callId: "a/b", status: "failed" },
      { type: "subagent.completed", callId: "a", status: "failed" },
    ]);
  });

  it("seq 乱序帧:超前暂存,缺口补齐按 seq 顺序放出;落后的重复帧丢弃", () => {
    const s = fromLangGraphEvents();
    const msg = (seq: number, text: string) => ({
      seq,
      channel: "messages" as const,
      event: "finish",
      data: { message: { role: "assistant", content: text } },
    });

    expect(s.add(msg(1, "一"))).toEqual([{ type: "message", role: "assistant", text: "一" }]);
    // seq 3 超前:暂存
    expect(s.add(msg(3, "三"))).toEqual([]);
    // seq 2 补上缺口:2、3 按协议顺序一起放出
    expect(s.add(msg(2, "二"))).toEqual([
      { type: "message", role: "assistant", text: "二" },
      { type: "message", role: "assistant", text: "三" },
    ]);
    // 重连补发的旧帧(seq 已消费):丢弃
    expect(s.add(msg(2, "二"))).toEqual([]);
  });

  it("end() 放出 seq 缺口后仍压着的乱序帧", () => {
    const s = fromLangGraphEvents();
    const msg = (seq: number, text: string) => ({
      seq,
      channel: "messages" as const,
      event: "finish",
      data: { message: { role: "assistant", content: text } },
    });
    s.add(msg(1, "一"));
    expect(s.add(msg(4, "四"))).toEqual([]); // seq 2、3 永远没来
    expect(s.add(msg(3, "三"))).toEqual([]);
    expect(s.end()).toEqual([
      { type: "message", role: "assistant", text: "三" },
      { type: "message", role: "assistant", text: "四" },
    ]);
  });

  it("values / updates 等其它通道与无 channel 帧返回 []", () => {
    const s = fromLangGraphEvents();
    expect(s.add({ channel: "values", data: { messages: [] } })).toEqual([]);
    expect(s.add({ channel: "updates", data: {} })).toEqual([]);
    expect(s.add({ data: {} })).toEqual([]);
  });
});
