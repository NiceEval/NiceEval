// cases: docs/engineering/testing/unit/assertions.md
// ToolMatch/SubagentMatch 的 match 小语言单测(定稿见
// docs/feature/assertions/library/scoped-assertions.md「匹配条件的字段全集」)。覆盖:
// input/output/count/remoteUrl/status 各字段的独立形态与命中语义,以及旧「RegExp input
// 落入深比对分支、枚举其自身空可枚举属性、静默匹配一切调用」的回归锁定。

import { describe, expect, it } from "vitest";
import { AssertionCollector } from "./collector.ts";
import { completeEvidenceCoverage, downgradeEvidenceCoverage } from "./coverage.ts";
import { deriveDiffData, emptyDiffData } from "./diff.ts";
import * as Scoped from "./scoped.ts";
import { deriveRunFacts } from "../o11y/derive.ts";
import type { AssertionResult, DiffArtifact, AssertionEvaluationContext, StreamEvent, SubagentMatch } from "../types.ts";

function ctxWith(over: Partial<AssertionEvaluationContext> = {}): AssertionEvaluationContext {
  const events = (over.events ?? []) as StreamEvent[];
  return {
    events,
    facts: deriveRunFacts(events),
    diff: emptyDiffData(),
    scripts: {},
    usage: { inputTokens: 0, outputTokens: 0 },
    status: "completed",
    evidenceCoverage: completeEvidenceCoverage,
    readFile: async () => undefined,
    ...over,
  };
}

const INCOMPLETE_ACTIONS = downgradeEvidenceCoverage(completeEvidenceCoverage, {
  actions: { status: "partial", reason: "stream reconnected" },
});
const INCOMPLETE_STATUS = downgradeEvidenceCoverage(completeEvidenceCoverage, {
  status: { status: "partial", reason: "adapter omitted terminal status" },
});

async function evaluate(spec: ReturnType<typeof Scoped.calledTool>, ctx: AssertionEvaluationContext): Promise<AssertionResult> {
  const collector = new AssertionCollector();
  collector.record(spec);
  const [result] = await collector.finalize(ctx);
  return result!;
}

describe("状态正断言的覆盖折叠", () => {
  it("已观察到 succeeded / parked 时，即使 status 通道不完整也通过；缺口只阻止未命中被判失败", async () => {
    const succeeded = await evaluate(Scoped.succeeded(), ctxWith({ evidenceCoverage: INCOMPLETE_STATUS }));
    const parked = await evaluate(
      Scoped.parked(),
      ctxWith({
        events: [{ type: "input.requested", request: { prompt: "approve deployment?" } }],
        status: "waiting",
        evidenceCoverage: INCOMPLETE_STATUS,
      }),
    );
    const notSucceeded = await evaluate(Scoped.succeeded(), ctxWith({ status: "failed", evidenceCoverage: INCOMPLETE_STATUS }));
    const notParked = await evaluate(Scoped.parked(), ctxWith({ evidenceCoverage: INCOMPLETE_STATUS }));

    expect(succeeded.outcome).toBe("passed");
    expect(parked.outcome).toBe("passed");
    expect(notSucceeded.outcome).toBe("unavailable");
    expect(notParked.outcome).toBe("unavailable");
  });
});

describe("calledTool:input 顶层三种形态", () => {
  const events: StreamEvent[] = [
    { type: "operation.started", operationId: "c1", operation: { kind: "tool", name: "get_weather", input: { city: "Brooklyn" } } },
    { type: "operation.finished", operationId: "c1", kind: "tool", output: { tempF: 72 }, status: "completed" },
    { type: "operation.started", operationId: "c2", operation: { kind: "tool", name: "get_weather", input: { city: "Chicago" } } },
    { type: "operation.finished", operationId: "c2", kind: "tool", output: { tempF: 40 }, status: "completed" },
  ];

  it("顶层 RegExp 测序列化后的完整输入,精确命中匹配的那一笔", async () => {
    const r = await evaluate(Scoped.calledTool("get_weather", { input: /Brooklyn/, count: 1 }), ctxWith({ events }));
    expect(r.outcome).toBe("passed");
  });

  it("回归:顶层 RegExp 不静默匹配一切——不匹配任何调用的正则必须 failed,而不是把 RegExp 当 plain object 深比对出一个空条件恒真", async () => {
    const r = await evaluate(Scoped.calledTool("get_weather", { input: /Denver/ }), ctxWith({ events }));
    expect(r.outcome).toBe("failed");
  });

  it("顶层谓词函数拿原始输入值自行判断", async () => {
    const r = await evaluate(
      Scoped.calledTool("get_weather", { input: (input) => (input as { city?: string })?.city === "Chicago" }),
      ctxWith({ events }),
    );
    expect(r.outcome).toBe("passed");
  });

  it("对象形态仍是深度部分匹配(既有行为不受顶层 RegExp/谓词分支影响)", async () => {
    const passing = await evaluate(Scoped.calledTool("get_weather", { input: { city: "Brooklyn" } }), ctxWith({ events }));
    expect(passing.outcome).toBe("passed");
    const failing = await evaluate(Scoped.calledTool("get_weather", { input: { city: "Miami" } }), ctxWith({ events }));
    expect(failing.outcome).toBe("failed");
  });

  it("对象值位置的 RegExp 仍然生效(如 { command: /curl/ })", async () => {
    const shellEvents: StreamEvent[] = [
      { type: "operation.started", operationId: "c1", operation: { kind: "tool", name: "shell", input: { command: "curl https://x" } } },
      { type: "operation.finished", operationId: "c1", kind: "tool", output: "ok", status: "completed" },
    ];
    const r = await evaluate(Scoped.calledTool("shell", { input: { command: /curl/ } }), ctxWith({ events: shellEvents }));
    expect(r.outcome).toBe("passed");
    const miss = await evaluate(Scoped.notCalledTool("shell", { input: { command: /npm i/ } }), ctxWith({ events: shellEvents }));
    expect(miss.outcome).toBe("passed");
  });
});

describe("calledTool:output 四种值语义", () => {
  it("对象深度部分匹配", async () => {
    const events: StreamEvent[] = [
      { type: "operation.started", operationId: "c1", operation: { kind: "tool", name: "get_weather", input: {} } },
      { type: "operation.finished", operationId: "c1", kind: "tool", output: { tempF: 72, humidity: 50 }, status: "completed" },
    ];
    const r = await evaluate(Scoped.calledTool("get_weather", { output: { tempF: 72 } }), ctxWith({ events }));
    expect(r.outcome).toBe("passed");
  });

  it("RegExp 对字符串输出测试", async () => {
    const events: StreamEvent[] = [
      { type: "operation.started", operationId: "c1", operation: { kind: "tool", name: "shell", input: { command: "curl https://example.com/tutorials/x" } } },
      { type: "operation.finished", operationId: "c1", kind: "tool", output: "fetched tutorials/x", status: "completed" },
    ];
    const r = await evaluate(
      Scoped.calledTool("shell", { input: { command: /curl/ }, output: /tutorials\// }),
      ctxWith({ events }),
    );
    expect(r.outcome).toBe("passed");
  });

  it("谓词函数拿原始输出自行判断", async () => {
    const events: StreamEvent[] = [
      { type: "operation.started", operationId: "c1", operation: { kind: "tool", name: "get_weather", input: {} } },
      { type: "operation.finished", operationId: "c1", kind: "tool", output: { tempF: 72 }, status: "completed" },
    ];
    const r = await evaluate(
      Scoped.calledTool("get_weather", { output: (output: unknown) => (output as { tempF?: number })?.tempF! > 70 }),
      ctxWith({ events }),
    );
    expect(r.outcome).toBe("passed");
  });

  it("其余值严格相等", async () => {
    const events: StreamEvent[] = [
      { type: "operation.started", operationId: "c1", operation: { kind: "tool", name: "count_items", input: {} } },
      { type: "operation.finished", operationId: "c1", kind: "tool", output: 42, status: "completed" },
    ];
    const passing = await evaluate(Scoped.calledTool("count_items", { output: 42 }), ctxWith({ events }));
    expect(passing.outcome).toBe("passed");
    const failing = await evaluate(Scoped.calledTool("count_items", { output: 43 }), ctxWith({ events }));
    expect(failing.outcome).toBe("failed");
  });

  it("嵌套位置的非 plain-object 不会因空可枚举键匹配一切", async () => {
    const events: StreamEvent[] = [
      { type: "operation.started", operationId: "c1", operation: { kind: "tool", name: "get_weather", input: {} } },
      { type: "operation.finished", operationId: "c1", kind: "tool", output: new Date("2026-01-01") as never, status: "completed" },
    ];
    const r = await evaluate(Scoped.calledTool("get_weather", { output: new Date("2026-01-01") }), ctxWith({ events }));
    expect(r.outcome).toBe("failed");
  });
});

describe("event:count 谓词", () => {
  const events: StreamEvent[] = [
    { type: "message", role: "assistant", text: "one" },
    { type: "message", role: "assistant", text: "two" },
  ];

  it("谓词命中与未命中按事件计数判定", async () => {
    const hit = await evaluate(Scoped.eventOfType("message", { count: (n) => n >= 2 }), ctxWith({ events }));
    const miss = await evaluate(Scoped.eventOfType("message", { count: (n) => n === 1 }), ctxWith({ events }));
    expect(hit.outcome).toBe("passed");
    expect(miss.outcome).toBe("failed");
  });
});

describe("calledTool:count 数字精确 vs 谓词", () => {
  const twoCalls: StreamEvent[] = [
    { type: "operation.started", operationId: "c1", operation: { kind: "tool", name: "file_read", input: { path: "a" } } },
    { type: "operation.finished", operationId: "c1", kind: "tool", output: "a", status: "completed" },
    { type: "operation.started", operationId: "c2", operation: { kind: "tool", name: "file_read", input: { path: "b" } } },
    { type: "operation.finished", operationId: "c2", kind: "tool", output: "b", status: "completed" },
  ];

  it("谓词命中次数自行判定:complete 通道下满足即 passed", async () => {
    const r = await evaluate(Scoped.calledTool("file_read", { count: (n) => n >= 2 }), ctxWith({ events: twoCalls }));
    expect(r.outcome).toBe("passed");
  });

  it("谓词不满足且 complete 通道:failed(不是 unavailable)", async () => {
    const r = await evaluate(Scoped.calledTool("file_read", { count: (n) => n >= 3 }), ctxWith({ events: twoCalls }));
    expect(r.outcome).toBe("failed");
  });

  it("谓词不满足且通道非 complete:unavailable——谓词 count 从不算「确凿超出」", async () => {
    const r = await evaluate(
      Scoped.calledTool("file_read", { count: (n) => n === 1 }),
      ctxWith({ events: twoCalls, evidenceCoverage: INCOMPLETE_ACTIONS }),
    );
    expect(r.outcome).toBe("unavailable");
  });

  it("数字精确 count 在实测超出时是确凿失败,即使通道非 complete", async () => {
    const r = await evaluate(
      Scoped.calledTool("file_read", { count: 1 }),
      ctxWith({ events: twoCalls, evidenceCoverage: INCOMPLETE_ACTIONS }),
    );
    expect(r.outcome).toBe("failed");
  });
});

describe("calledTool:status 四态含 pending", () => {
  it("称职 HITL 场景:called 但尚无 result 的调用以 pending 状态被断言命中", async () => {
    const events: StreamEvent[] = [
      { type: "operation.started", operationId: "c1", operation: { kind: "tool", name: "send_email", input: { to: "a@b.com" } } },
    ];
    const r = await evaluate(Scoped.calledTool("send_email", { status: "pending", count: 1 }), ctxWith({ events }));
    expect(r.outcome).toBe("passed");
  });

  it("被拒绝后状态是 rejected,不是 pending 也不是 failed", async () => {
    const events: StreamEvent[] = [
      { type: "operation.started", operationId: "c1", operation: { kind: "tool", name: "send_email", input: {} } },
      { type: "operation.finished", operationId: "c1", kind: "tool", status: "rejected" },
    ];
    const r = await evaluate(Scoped.calledTool("send_email", { status: "rejected" }), ctxWith({ events }));
    expect(r.outcome).toBe("passed");
    const stillPending = await evaluate(Scoped.calledTool("send_email", { status: "pending" }), ctxWith({ events }));
    expect(stillPending.outcome).toBe("failed");
  });

  it("不带 status 过滤时匹配任意状态", async () => {
    const events: StreamEvent[] = [
      { type: "operation.started", operationId: "c1", operation: { kind: "tool", name: "send_email", input: {} } },
    ];
    const r = await evaluate(Scoped.calledTool("send_email"), ctxWith({ events }));
    expect(r.outcome).toBe("passed");
  });
});

describe("calledSubagent:remoteUrl 三种形态与 output", () => {
  const events: StreamEvent[] = [
    { type: "operation.started", operationId: "s1", operation: { kind: "subagent", name: "weather", remoteUrl: "https://weather.example/agent" } },
    { type: "operation.finished", operationId: "s1", kind: "subagent", output: "72F and sunny", status: "completed" },
  ];

  it("字符串精确匹配", async () => {
    const r = await evaluate(
      Scoped.calledSubagent("weather", { remoteUrl: "https://weather.example/agent" }),
      ctxWith({ events }),
    );
    expect(r.outcome).toBe("passed");
  });

  it("RegExp 测试", async () => {
    const r = await evaluate(Scoped.calledSubagent("weather", { remoteUrl: /weather\.example/ }), ctxWith({ events }));
    expect(r.outcome).toBe("passed");
  });

  it("谓词函数自行判断,并与 output 一起 AND", async () => {
    const r = await evaluate(
      Scoped.calledSubagent("weather", {
        remoteUrl: (url) => url === "https://weather.example/agent",
        output: /72F/,
      }),
      ctxWith({ events }),
    );
    expect(r.outcome).toBe("passed");
  });

  it("subagent operation.started 尚无 finished 时以 pending 状态被断言命中", async () => {
    const pendingEvents: StreamEvent[] = [{ type: "operation.started", operationId: "s2", operation: { kind: "subagent", name: "researcher" } }];
    const r = await evaluate(Scoped.calledSubagent("researcher", { status: "pending" }), ctxWith({ events: pendingEvents }));
    expect(r.outcome).toBe("passed");
  });
});

describe("notInDiff:内容被省略的条目上「没出现」证明不了", () => {
  const inlined: DiffArtifact = [
    { window: "s1/t1", changes: { "src/app.ts": { status: "modified", before: "callback(x)\n", after: "await x\n" } } },
  ];
  const withElided: DiffArtifact = [
    {
      window: "s1/t1",
      changes: {
        "src/app.ts": { status: "modified", before: "callback(x)\n", after: "await x\n" },
        "assets/logo.png": { status: "added", elided: { reason: "binary", afterBytes: 2048 } },
        "data/dump.sql": { status: "added", elided: { reason: "oversized-text", afterBytes: 4 * 1024 * 1024 } },
      },
    },
  ];

  it("内容全部内联:命中窗口终态内容 → failed,扫不到反例 → passed", async () => {
    const hit = await evaluate(Scoped.notInDiff(/await x/), ctxWith({ diff: deriveDiffData(inlined) }));
    expect(hit.outcome).toBe("failed");
    const clean = await evaluate(Scoped.notInDiff(/console\.log/), ctxWith({ diff: deriveDiffData(inlined) }));
    expect(clean.outcome).toBe("passed");
  });

  it("确凿反例仍然 failed:内容被省略不把已命中的证据变成不可用", async () => {
    const r = await evaluate(Scoped.notInDiff(/logo\.png/), ctxWith({ diff: deriveDiffData(withElided) }));
    expect(r.outcome).toBe("failed");
    expect(r.outcome === "failed" ? r.received : "").toContain("assets/logo.png");
  });

  it("扫不到反例但有条目内容被省略 → unavailable,reason 点名缺内容的路径", async () => {
    const r = await evaluate(Scoped.notInDiff(/console\.log/), ctxWith({ diff: deriveDiffData(withElided) }));
    expect(r.outcome).toBe("unavailable");
    if (r.outcome !== "unavailable") return;
    expect(r.reason).toContain("diff-content-elided");
    expect(r.reason).toContain("assets/logo.png");
    expect(r.reason).toContain("data/dump.sql");
  });

  it("存在性与 status 断言不受内容省略影响", async () => {
    const diff = deriveDiffData(withElided);
    expect((await evaluate(Scoped.fileChanged("assets/logo.png"), ctxWith({ diff }))).outcome).toBe("passed");
    expect((await evaluate(Scoped.fileChanged("data/dump.sql"), ctxWith({ diff }))).outcome).toBe("passed");
  });
});

// 类型契约(编译期,随 pnpm typecheck):SubagentMatch.status 没有 rejected 成员——子 agent 委派
// 没有 rejected 状态(assertions.md「类型层证明」)。成员全集不是运行时行为,没有运行时断言可写。
const subagentMatchHasNoRejected: SubagentMatch = {
  // @ts-expect-error SubagentMatch 的 status 只有 pending | completed | failed,没有 rejected
  status: "rejected",
};
void subagentMatchHasNoRejected;
