// cases: docs/engineering/testing/unit/reports.md
// deriveRunFacts 的折叠单测(定稿见 docs/feature/adapters/architecture/events.md「派生事实」)。
// 覆盖:called 尚未等到 result 折叠成 pending(工具调用与子 agent 委派都适用)、配上 result 后
// 取 result 的状态、只有 result 没配上 called 时的占位兜底不受影响、`contextInjections`
// 精确计数事件流里的 `context.injected` 事件次数。

import { describe, expect, it } from "vitest";
import type { StreamEvent } from "../types.ts";
import { deriveRunFacts } from "./derive.ts";

describe("deriveRunFacts:pending 折叠", () => {
  it("action.called 尚未等到 action.result 时,ToolCall.status 是 pending,不是 completed", () => {
    const events: StreamEvent[] = [
      { type: "action.called", callId: "c1", name: "send_email", input: { to: "a@b.com" } },
    ];
    const facts = deriveRunFacts(events);
    expect(facts.toolCalls).toHaveLength(1);
    expect(facts.toolCalls[0]!.status).toBe("pending");
    expect(facts.toolCalls[0]!.output).toBeUndefined();
  });

  it.each(["completed", "failed", "rejected"] as const)(
    "action.result(status=%s)到达后,折叠结果取 result 的状态,不再是 pending",
    (status) => {
      const events: StreamEvent[] = [
        { type: "action.called", callId: "c1", name: "send_email", input: {} },
        { type: "action.result", callId: "c1", output: { ok: status === "completed" }, status },
      ];
      const facts = deriveRunFacts(events);
      expect(facts.toolCalls[0]!.status).toBe(status);
    },
  );

  it("subagent.called 尚未等到 subagent.completed 时,SubagentCall.status 同样是 pending", () => {
    const events: StreamEvent[] = [{ type: "subagent.called", callId: "s1", name: "researcher" }];
    const facts = deriveRunFacts(events);
    expect(facts.subagentCalls).toHaveLength(1);
    expect(facts.subagentCalls[0]!.status).toBe("pending");
  });

  it.each(["completed", "failed"] as const)(
    "subagent.completed(status=%s)到达后,折叠结果取 result 的状态",
    (status) => {
      const events: StreamEvent[] = [
        { type: "subagent.called", callId: "s1", name: "researcher" },
        { type: "subagent.completed", callId: "s1", output: {}, status },
      ];
      const facts = deriveRunFacts(events);
      expect(facts.subagentCalls[0]!.status).toBe(status);
    },
  );

  it("只有 action.result、没配上 action.called 时,仍是占位兜底而不是 pending(core 容错分支不受影响)", () => {
    const events: StreamEvent[] = [{ type: "action.result", callId: "c-orphan", output: "x", status: "completed" }];
    const facts = deriveRunFacts(events);
    expect(facts.toolCalls[0]!.status).toBe("completed");
    expect(facts.toolCalls[0]!.name).toBe("unknown");
  });
});

describe("deriveRunFacts:callId 跨轮复用不覆盖", () => {
  // 回归:adapter 常按轮各自编号(OpenAI 兼容 / transcript 归一复用 c1/c2…)。同一 callId 在其
  // result 之后再次出现是新的一次调用——旧折叠按 callId 存 Map 会被后一轮覆盖,跨轮聚合断言
  // (t.calledTool)于是「只扫最后一轮」,前几轮的工具调用被抹掉(定稿见 events.md 不变量 2)。
  it("同一 callId 完成后在后一轮再次 called,折叠成两条独立调用而非覆盖成一条", () => {
    const events: StreamEvent[] = [
      // 第一轮:读 init、读 INDEX(都用 c1/c2 编号)
      { type: "action.called", callId: "c1", name: "read", input: { path: "init.md" } },
      { type: "action.result", callId: "c1", output: "init contents", status: "completed" },
      { type: "action.called", callId: "c2", name: "read", input: { path: "INDEX.md" } },
      { type: "action.result", callId: "c2", output: "index contents", status: "completed" },
      { type: "message", role: "assistant", text: "第一轮做完" },
      // 第二轮:续轮,adapter 从 c1 重新编号
      { type: "action.called", callId: "c1", name: "write", input: { path: "note.md" } },
      { type: "action.result", callId: "c1", output: "ok", status: "completed" },
      { type: "message", role: "assistant", text: "答复" },
    ];
    const facts = deriveRunFacts(events);
    expect(facts.toolCalls).toHaveLength(3); // 两轮共 3 次调用,后一轮不覆盖前一轮
    expect(facts.toolCalls.map((tc) => tc.originalName)).toEqual(["read", "read", "write"]);
    // 第一轮的两次 read 都在,且各配对到自己的 result(不是都取最后一条)
    expect(facts.toolCalls[0]!.input).toEqual({ path: "init.md" });
    expect(facts.toolCalls[0]!.output).toBe("init contents");
    expect(facts.toolCalls[1]!.input).toEqual({ path: "INDEX.md" });
    expect(facts.toolCalls[1]!.output).toBe("index contents");
  });

  it("subagent 折叠同理:同一 callId 完成后再次 called 起新记录", () => {
    const events: StreamEvent[] = [
      { type: "subagent.called", callId: "s1", name: "researcher" },
      { type: "subagent.completed", callId: "s1", output: "round1", status: "completed" },
      { type: "subagent.called", callId: "s1", name: "writer" },
      { type: "subagent.completed", callId: "s1", output: "round2", status: "completed" },
    ];
    const facts = deriveRunFacts(events);
    expect(facts.subagentCalls).toHaveLength(2);
    expect(facts.subagentCalls.map((sc) => sc.name)).toEqual(["researcher", "writer"]);
  });
});

describe("deriveRunFacts:contextInjections 计数", () => {
  it("统计事件流里 context.injected 事件的次数,不与 messageCount 混计", () => {
    const events: StreamEvent[] = [
      { type: "message", role: "user", text: "hi" },
      { type: "context.injected", text: "session start hook payload", source: "SessionStart" },
      { type: "context.injected", text: "another injection" },
      { type: "message", role: "assistant", text: "ok" },
    ];
    const facts = deriveRunFacts(events);
    expect(facts.contextInjections).toBe(2);
    expect(facts.messageCount).toBe(2);
  });

  it("没有 context.injected 事件时计数为 0,不是 undefined", () => {
    const facts = deriveRunFacts([{ type: "message", role: "user", text: "hi" }]);
    expect(facts.contextInjections).toBe(0);
  });
});
