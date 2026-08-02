// cases: docs/engineering/testing/unit/reports.md
// deriveRunFacts 的折叠单测(定稿见 docs/feature/adapters/architecture/events.md「派生事实」)。
// 覆盖:started 尚未等到 finished 折叠成 pending(工具调用与子 agent 委派都适用)、配上 finished 后
// 取其状态、只有 finished 没配上 started 时的占位兜底不受影响、`contextInjections`
// 精确计数事件流里的 `context.injected` 事件次数。

import { describe, expect, it } from "vitest";
import type { StreamEvent } from "../types.ts";
import { deriveRunFacts } from "./derive.ts";

// 编译期协议：只接受闭合 operation ADT，不保留旧事件，也不允许 kind 与字段串支。
const compileTimeEventContract = (): void => {
  const tool: StreamEvent = {
    type: "operation.started",
    operationId: "tool-1",
    operation: { kind: "tool", name: "read", input: { path: "a" } },
  };
  void tool;
  type OldAction = { type: `action.${"called"}`; callId: string; name: string; input: Record<string, never> };
  const legacy = { type: ["action", "called"].join(".") as OldAction["type"], callId: "c1", name: "read", input: {} } as OldAction;
  // @ts-expect-error 旧事件协议不得继续编译
  const oldAction: StreamEvent = legacy;
  const mixedStarted: StreamEvent = {
    type: "operation.started",
    operationId: "s1",
    operation: {
      kind: "subagent",
      name: "worker",
      // @ts-expect-error subagent started 不携带工具 input
      input: {},
    },
  };
  const rejectedSubagent: StreamEvent = {
    type: "operation.finished",
    operationId: "s1",
    kind: "subagent",
    // @ts-expect-error subagent finished 没有 rejected 状态
    status: "rejected",
  };
  void oldAction;
  void mixedStarted;
  void rejectedSubagent;
};
void compileTimeEventContract;

describe("deriveRunFacts:pending 折叠", () => {
  it("tool operation.started 尚未等到 finished 时,ToolCall.status 是 pending", () => {
    const events: StreamEvent[] = [
      { type: "operation.started", operationId: "c1", operation: { kind: "tool", name: "send_email", input: { to: "a@b.com" } } },
    ];
    const facts = deriveRunFacts(events);
    expect(facts.toolCalls).toHaveLength(1);
    expect(facts.toolCalls[0]!.status).toBe("pending");
    expect(facts.toolCalls[0]!.output).toBeUndefined();
  });

  it.each(["completed", "failed", "rejected"] as const)(
    "tool operation.finished(status=%s)到达后折叠为终态",
    (status) => {
      const events: StreamEvent[] = [
        { type: "operation.started", operationId: "c1", operation: { kind: "tool", name: "send_email", input: {} } },
        { type: "operation.finished", operationId: "c1", kind: "tool", output: { ok: status === "completed" }, status },
      ];
      const facts = deriveRunFacts(events);
      expect(facts.toolCalls[0]!.status).toBe(status);
    },
  );

  it("subagent operation.started 尚未等到 finished 时同样是 pending", () => {
    const events: StreamEvent[] = [{ type: "operation.started", operationId: "s1", operation: { kind: "subagent", name: "researcher" } }];
    const facts = deriveRunFacts(events);
    expect(facts.subagentCalls).toHaveLength(1);
    expect(facts.subagentCalls[0]!.status).toBe("pending");
  });

  it.each(["completed", "failed"] as const)(
    "subagent operation.finished(status=%s)到达后折叠为终态",
    (status) => {
      const events: StreamEvent[] = [
        { type: "operation.started", operationId: "s1", operation: { kind: "subagent", name: "researcher" } },
        { type: "operation.finished", operationId: "s1", kind: "subagent", output: {}, status },
      ];
      const facts = deriveRunFacts(events);
      expect(facts.subagentCalls[0]!.status).toBe(status);
    },
  );

  it("只有 tool finished、没配上 started 时仍产生 tool 占位兜底", () => {
    const events: StreamEvent[] = [{ type: "operation.finished", operationId: "c-orphan", kind: "tool", output: "x", status: "completed" }];
    const facts = deriveRunFacts(events);
    expect(facts.toolCalls[0]!.status).toBe("completed");
    expect(facts.toolCalls[0]!.name).toBe("unknown");
  });
  it("finished.kind 与 started.operation.kind 不同，不会跨 kind 错配", () => {
    const facts = deriveRunFacts([
      { type: "operation.started", operationId: "same", operation: { kind: "tool", name: "shell", input: {} } },
      { type: "operation.finished", operationId: "same", kind: "subagent", status: "failed" },
    ]);
    expect(facts.toolCalls).toMatchObject([{ operationId: "same", status: "pending" }]);
    expect(facts.subagentCalls).toMatchObject([{ operationId: "same", name: "unknown", status: "failed" }]);
  });
});

describe("deriveRunFacts:operationId 跨轮复用不覆盖", () => {
  // 回归:adapter 常按轮各自编号(OpenAI 兼容 / transcript 归一复用 c1/c2…)。同一 operationId 在其
  // finished 之后再次 started 是新的一次调用——旧折叠按单一 Map 会被后一轮覆盖,跨轮聚合断言
  // (t.calledTool)于是「只扫最后一轮」,前几轮的工具调用被抹掉(定稿见 events.md 不变量 2)。
  it("同一 operationId 完成后在后一轮再次 started,折叠成两条独立调用而非覆盖", () => {
    const events: StreamEvent[] = [
      // 第一轮:读 init、读 INDEX(都用 c1/c2 编号)
      { type: "operation.started", operationId: "c1", operation: { kind: "tool", name: "read", input: { path: "init.md" } } },
      { type: "operation.finished", operationId: "c1", kind: "tool", output: "init contents", status: "completed" },
      { type: "operation.started", operationId: "c2", operation: { kind: "tool", name: "read", input: { path: "INDEX.md" } } },
      { type: "operation.finished", operationId: "c2", kind: "tool", output: "index contents", status: "completed" },
      { type: "message", role: "assistant", text: "第一轮做完" },
      // 第二轮:续轮,adapter 从 c1 重新编号
      { type: "operation.started", operationId: "c1", operation: { kind: "tool", name: "write", input: { path: "note.md" } } },
      { type: "operation.finished", operationId: "c1", kind: "tool", output: "ok", status: "completed" },
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

  it("subagent 折叠同理:同一 operationId 完成后再次 started 起新记录", () => {
    const events: StreamEvent[] = [
      { type: "operation.started", operationId: "s1", operation: { kind: "subagent", name: "researcher" } },
      { type: "operation.finished", operationId: "s1", kind: "subagent", output: "round1", status: "completed" },
      { type: "operation.started", operationId: "s1", operation: { kind: "subagent", name: "writer" } },
      { type: "operation.finished", operationId: "s1", kind: "subagent", output: "round2", status: "completed" },
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
