// cases: docs/engineering/testing/unit/eval.md
import { describe, expect, it } from "vitest";

import { createAgentSession, SessionManager } from "./session.ts";
import type { Agent, Sandbox, StreamEvent, Turn, TurnInput } from "../types.ts";
import { isSendFailure, makeSendFailure, type SendFailure, type SendFailureClassifier } from "./send-failures.ts";
import { completeEvidenceCoverage } from "../scoring/coverage.ts";

// createAgentSession() 是 ctx.session 的实现——一条会话线的存取器(见
// docs-site/zh/explanation/adapter.mdx 的 AgentSession 契约)。这里直接测存取器本身;
// 端到端的「同一条线同一个 ctx.session」由 SessionManager / RunSession 保证。

function fakeSandbox(): Sandbox {
  return {
    workdir: "/sandbox/work",
    runCommand: async () => { throw new Error("not implemented"); },
    runShell: async () => { throw new Error("not implemented"); },
    runCommandOrThrow: async () => { throw new Error("not implemented"); },
    runShellOrThrow: async () => { throw new Error("not implemented"); },
    readText: async () => "",
    writeText: async () => {},
    readBytes: async () => new Uint8Array(),
    writeBytes: async () => {},
    pathExists: async () => false,
    uploadDirectory: async () => {},
    stop: async () => {},
    sandboxId: "fake",
    otlpHost: null,
    downloadFile: async () => {},
    uploadFile: async () => {},
    downloadDirectory: async () => {},
  };
}

function agentReturning(turn: Turn): Agent {
  return {
    name: "fake-agent",
    kind: "direct",
    evidenceCoverage: completeEvidenceCoverage,
    async send(_input: TurnInput): Promise<Turn> {
      return turn;
    },
  };
}

function makeManager(turn: Turn) {
  const lines: string[] = [];
  const manager = new SessionManager({
    agent: agentReturning(turn),
    sandbox: fakeSandbox(),
    flags: {},
    signal: new AbortController().signal,
    log: (msg) => lines.push(msg),
  });
  return { manager, lines };
}

// send 重试(见 docs/feature/error-classification):agent 按调用次数依次抛/返回预设结果，
// 可选挂一个 classifySendFailure 分类器——用来证明重试真的经由 SessionManager 生效,
// 而不只是 send-retry.ts 单元层的行为。
function scriptedRetryAgent(
  outcomes: Array<Turn | SendFailure>,
  classifySendFailure?: SendFailureClassifier,
): Agent & { calls: TurnInput[] } {
  const calls: TurnInput[] = [];
  let i = 0;
  const agent: Agent = {
    name: "scripted-retry",
    kind: "direct",
    evidenceCoverage: completeEvidenceCoverage,
    async send(input: TurnInput): Promise<Turn> {
      calls.push(input);
      const outcome = outcomes[Math.min(i, outcomes.length - 1)]!;
      i++;
      if (isSendFailure(outcome)) throw outcome;
      return outcome;
    },
    classifySendFailure,
  };
  return Object.assign(agent, { calls });
}

/** 退避睡眠瞬间返回 + 固定抖动为 0:单测不用真的等 5~20s 的退避窗口。 */
function makeRetryManager(agent: Agent, overrides: Partial<ConstructorParameters<typeof SessionManager>[0]> = {}) {
  const lines: string[] = [];
  const manager = new SessionManager({
    agent,
    sandbox: fakeSandbox(),
    flags: {},
    signal: new AbortController().signal,
    log: (msg) => lines.push(msg),
    retryRandom: () => 0,
    retrySleep: async () => {},
    ...overrides,
  });
  return { manager, lines };
}

describe("SessionManager · send 执行失败重试", () => {
  const rateLimited = makeSendFailure({
    acceptance: "rejected",
    message: "admission rejected",
    cause: { status: 429 },
    events: [{ type: "error", message: "provider busy" }],
    usage: { inputTokens: 2, outputTokens: 1 },
  });
  const succeeded: Turn = { status: "completed", events: [{ type: "message", role: "assistant", text: "done" }] };

  it("重试成功后逻辑事件零污染，物理失败进入 retryAttempts 且 usage 聚合", async () => {
    const agent = scriptedRetryAgent([rateLimited, succeeded]);
    const { manager } = makeRetryManager(agent);

    const turn = await manager.send(manager.primary, "hi");

    expect(agent.calls).toHaveLength(2); // 确实重试了一次(第 1 次失败 + 第 2 次成功)
    expect(turn.status).toBe("completed");
    expect(manager.primary.turnCount).toBe(1); // 会话记账不因重试翻倍
    expect(manager.allEvents.filter((e) => e.type === "error")).toHaveLength(0); // 失败尝试的事件不落账
    expect(manager.allEvents.filter((e) => e.type === "message" && e.role === "user")).toHaveLength(1); // userEvent 不重放
    expect(manager.retryAttempts).toMatchObject([{
      sessionIndex: 1,
      turnIndex: 1,
      sendAttempt: 0,
      failure: { acceptance: "rejected", message: "admission rejected" },
      classification: { retryable: true, scope: "attempt", reason: "rate_limit" },
      events: [{ type: "error", message: "provider busy" }],
      usage: { inputTokens: 2, outputTokens: 1 },
    }]);
    expect(manager.usage).toMatchObject({ inputTokens: 2, outputTokens: 1 });
  });

  it("adapter classifySendFailure 可识别自家协议 code", async () => {
    const queueFull = makeSendFailure({ acceptance: "rejected", message: "queue full", cause: { code: "ACME_QUEUE_FULL" } });
    const agent = scriptedRetryAgent([queueFull, succeeded], (failure) =>
      (failure.cause as { code?: string }).code === "ACME_QUEUE_FULL"
        ? { retryable: true, reason: "acme_queue_full" }
        : undefined);
    const { manager } = makeRetryManager(agent);

    const turn = await manager.send(manager.primary, "hi");

    expect(agent.calls).toHaveLength(2);
    expect(turn.status).toBe("completed");
  });

  it("退避期间释放/收回并发槽位", async () => {
    const agent = scriptedRetryAgent([rateLimited, succeeded]);
    const slotCalls: string[] = [];
    const concurrencySlot = {
      release: async () => {
        slotCalls.push("release");
      },
      reacquire: async () => {
        slotCalls.push("reacquire");
      },
    };
    const { manager } = makeRetryManager(agent, { concurrencySlot });

    await manager.send(manager.primary, "hi");

    expect(slotCalls).toEqual(["release", "reacquire"]);
  });

  it("可信 failed Turn 是可评分领域结果，不分类、不重试", async () => {
    const domainFailure: Turn = { status: "failed", events: [{ type: "error", message: "tests failed" }] };
    const agent = scriptedRetryAgent([domainFailure, succeeded], () => ({ retryable: true, reason: "must-not-run" }));
    const { manager } = makeRetryManager(agent);

    const turn = await manager.send(manager.primary, "hi");

    expect(agent.calls).toHaveLength(1); // 没有发生重试
    expect(turn.status).toBe("failed");
    expect(manager.retryAttempts).toEqual([]);
  });
});

describe("SessionManager.send() 进度行", () => {
  it("failed 轮:进度行末尾追加最后一条 error 事件的 message", async () => {
    const events: StreamEvent[] = [
      { type: "message", role: "assistant", text: "" },
      { type: "error", message: "402 Insufficient Balance" },
    ];
    const { manager, lines } = makeManager({ events, status: "failed" });
    await manager.send(manager.primary, "hi");

    const progressLine = lines.find((l) => l.includes("← failed"));
    expect(progressLine).toContain("402 Insufficient Balance");
  });

  it("failed 轮但没有 error 事件:不追加空后缀,行尾保持原格式", async () => {
    const { manager, lines } = makeManager({ events: [], status: "failed" });
    await manager.send(manager.primary, "hi");

    const progressLine = lines.find((l) => l.includes("← failed"));
    expect(progressLine).toMatch(/\ds$/); // 以 "Ns" 收尾,没有多余的 " · " 后缀
  });

  it("completed 轮:即使事件里混了 error 事件也不提取原因(只在 failed 时生效)", async () => {
    const events: StreamEvent[] = [{ type: "error", message: "不该出现在这里" }];
    const { manager, lines } = makeManager({ events, status: "completed" });
    await manager.send(manager.primary, "hi");

    const progressLine = lines.find((l) => l.includes("← completed"));
    expect(progressLine).not.toContain("不该出现在这里");
  });

  it("原因文本压成单行并截断到 120 字符", async () => {
    const long = "x".repeat(200);
    const events: StreamEvent[] = [{ type: "error", message: long }];
    const { manager, lines } = makeManager({ events, status: "failed" });
    await manager.send(manager.primary, "hi");

    const progressLine = lines.find((l) => l.includes("← failed"))!;
    const suffix = progressLine.split(" · ").at(-1)!;
    expect(suffix.length).toBeLessThanOrEqual(120);
    expect(suffix.endsWith("…")).toBe(true);
  });
});

/** 逐 send 依次吐出预设 Turn(不重试,纯序列 —— 与 scriptedRetryAgent 不同,不接分类器)。 */
function sequentialAgent(turns: Turn[]): Agent {
  let i = 0;
  return {
    name: "sequential-agent",
    kind: "direct",
    evidenceCoverage: completeEvidenceCoverage,
    async send(): Promise<Turn> {
      const turn = turns[Math.min(i, turns.length - 1)] as Turn;
      i++;
      return turn;
    },
  };
}

function makeManagerWithTurns(turns: Turn[], overrides: Partial<ConstructorParameters<typeof SessionManager>[0]> = {}) {
  const manager = new SessionManager({
    agent: sequentialAgent(turns),
    sandbox: fakeSandbox(),
    flags: {},
    signal: new AbortController().signal,
    log: () => {},
    ...overrides,
  });
  return manager;
}

// cases: docs/engineering/testing/unit/eval.md「多轮 Usage 累计的诚实口径」——
// adapter 未报告的字段(requests、cache 计数)累计后保持省略,不得以 0/每轮 +1 凑数,
// fixture 要区分「报了 0」与「没报」两态。
describe("SessionManager · 多轮 Usage 累计", () => {
  it("字段全程没有任何一轮上报时,累计结果保持省略(不拿 0/1 凑数)", async () => {
    const manager = makeManagerWithTurns([
      { status: "completed", events: [], usage: { inputTokens: 10, outputTokens: 5 } },
      { status: "completed", events: [], usage: { inputTokens: 20, outputTokens: 8 } },
    ]);
    await manager.send(manager.primary, "one");
    await manager.send(manager.primary, "two");

    expect(manager.usage.inputTokens).toBe(30);
    expect(manager.usage.outputTokens).toBe(13);
    // 两轮都没报 requests/cacheReadTokens:累计后整个字段缺席,不是 0。
    expect(manager.usage.requests).toBeUndefined();
    expect(manager.usage.cacheReadTokens).toBeUndefined();
    expect("requests" in manager.usage).toBe(false);
    expect("cacheReadTokens" in manager.usage).toBe(false);
  });

  it("某一轮真的报了显式 0 时如实计入并保留字段,与「没报」区分开", async () => {
    const manager = makeManagerWithTurns([
      { status: "completed", events: [], usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0 } },
      { status: "completed", events: [], usage: { inputTokens: 20, outputTokens: 8 } },
    ]);
    await manager.send(manager.primary, "one");
    await manager.send(manager.primary, "two");

    // 第一轮显式报了 cacheReadTokens: 0 —— 字段因此存在(值为 0),不是像 requests 那样整个缺席。
    expect(manager.usage.cacheReadTokens).toBe(0);
    expect("cacheReadTokens" in manager.usage).toBe(true);
  });

  it("requests 只在协议真实提供时累计,不同轮各自的计数原样相加", async () => {
    const manager = makeManagerWithTurns([
      { status: "completed", events: [], usage: { inputTokens: 1, outputTokens: 1, requests: 3 } },
      { status: "completed", events: [], usage: { inputTokens: 1, outputTokens: 1, requests: 4 } },
    ]);
    await manager.send(manager.primary, "one");
    await manager.send(manager.primary, "two");

    expect(manager.usage.requests).toBe(7);
  });
});

// turn 级 usage 挂接:该轮 Turn.usage 经 onTurn 回报给 runner,由 runner 挂上 TimingNode
// (src/runner/attempt.ts 的 onTurn → recorder.child({ usage })),show `--execution`/
// `--timing` 的 turn 头行读 TimingNode.usage(见 docs/feature/record/architecture.md
// 「result.json」TimingNode.usage,src/show/render.ts 的 turnUsageText)。这里只测
// session.ts 这一端:onTurn 收到的 usage 与该轮 Turn.usage 同值;没有 usage 的轮不传该字段。
describe("SessionManager · onTurn 回报的 usage(turn 挂接 TimingNode 的数据来源)", () => {
  it("轮带 usage 时,onTurn 收到的 info.usage 与 Turn.usage 同值", async () => {
    const turn: Turn = { status: "completed", events: [], usage: { inputTokens: 12, outputTokens: 34, costUSD: 0.01 } };
    const reported: Array<{ usage?: import("../types.ts").Usage }> = [];
    const manager = makeManagerWithTurns([turn], { onTurn: (info) => reported.push(info) });
    await manager.send(manager.primary, "hi");

    expect(reported).toHaveLength(1);
    expect(reported[0]!.usage).toEqual({ inputTokens: 12, outputTokens: 34, costUSD: 0.01 });
  });

  it("轮没有 usage 时,onTurn 的 info.usage 是 undefined(不拿空对象或 0 值凑数)", async () => {
    const turn: Turn = { status: "completed", events: [] };
    const reported: Array<globalThis.Record<string, unknown>> = [];
    const manager = makeManagerWithTurns([turn], { onTurn: (info) => reported.push(info) });
    await manager.send(manager.primary, "hi");

    expect(reported).toHaveLength(1);
    expect(reported[0]!.usage).toBeUndefined();
  });
});

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

});
