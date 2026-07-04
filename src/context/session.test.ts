import { describe, expect, it } from "vitest";

import { createAgentSession } from "./session.ts";

// createAgentSession() 是 ctx.session 的实现——一条会话线的存取器(见
// docs-site/zh/concepts/adapter.mdx 的 AgentSession 契约)。这里直接测存取器本身;
// 端到端的「同一条线同一个 ctx.session」由 SessionManager / RunSession 保证。

describe("createAgentSession", () => {
  describe("history()", () => {
    it("新线 get() 是空数组;commit 之后同一条线的 get() 能看见", () => {
      const session = createAgentSession();
      const history = session.history<{ role: string; text: string }>();
      expect(history.get()).toEqual([]);

      history.commit([{ role: "user", text: "hi" }, { role: "assistant", text: "hello" }]);
      expect(history.get()).toEqual([{ role: "user", text: "hi" }, { role: "assistant", text: "hello" }]);
    });

    it("不同会话线的历史互相隔离", () => {
      const a = createAgentSession();
      a.history<{ n: number }>().commit([{ n: 1 }]);

      const b = createAgentSession();
      expect(b.history<{ n: number }>().get()).toEqual([]); // 全新会话线,看不到 a 的历史
    });
  });

  describe("capture() / id", () => {
    it("新线 id 是 undefined;capture 之后同一条线的下一轮带上", () => {
      const session = createAgentSession();
      expect(session.id).toBeUndefined(); // 第一轮:新会话线的自然结果
      session.capture("sess-1");
      expect(session.id).toBe("sess-1");
    });

    it("first-writer-wins:后续 capture 不覆盖已记录的 id", () => {
      const session = createAgentSession();
      session.capture("sess-new");
      session.capture("sess-forked"); // 后端可能因 fork 换了新 id,不覆盖正在续接的线
      expect(session.id).toBe("sess-new");
    });

    it("空值 / undefined 被忽略,不落地", () => {
      const session = createAgentSession();
      session.capture(undefined);
      session.capture("");
      expect(session.id).toBeUndefined();
      session.capture("sess-1");
      expect(session.id).toBe("sess-1");
    });

    it("不同会话线互相隔离", () => {
      const a = createAgentSession();
      const b = createAgentSession();
      a.capture("sess-a");
      expect(a.id).toBe("sess-a");
      expect(b.id).toBeUndefined(); // b 是新线,看不到 a 的 id
    });
  });

  describe("hold() / take()", () => {
    it("take() 只消费一次;没有 hold 过就是 undefined", () => {
      const session = createAgentSession();
      expect(session.take<{ toolCallId: string }>()).toBeUndefined();
      session.hold({ toolCallId: "c1" });
      expect(session.take<{ toolCallId: string }>()).toEqual({ toolCallId: "c1" });
      expect(session.take<{ toolCallId: string }>()).toBeUndefined();
    });

    it("不要求会话有 id:第一轮就能 hold(服务端无状态的接口也能停轮)", () => {
      const session = createAgentSession();
      session.hold({ x: 1 });
      expect(session.id).toBeUndefined();
      expect(session.take<{ x: number }>()).toEqual({ x: 1 });
    });

    it("按会话线隔离,不同线互不干扰", () => {
      const a = createAgentSession();
      const b = createAgentSession();
      a.hold({ v: "A" });
      b.hold({ v: "B" });
      expect(b.take<{ v: string }>()).toEqual({ v: "B" });
      expect(a.take<{ v: string }>()).toEqual({ v: "A" });
    });
  });

  describe("state", () => {
    it("起始是 {},框架从不写入——可以被 adapter 当逃生舱自由读写", () => {
      const session = createAgentSession();
      expect(session.state).toEqual({});
      (session.state as Record<string, unknown>).foo = "bar";
      expect(session.state.foo).toBe("bar");
    });
  });
});
