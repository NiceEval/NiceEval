// cases: docs/engineering/testing/unit/eval.md
import { describe, expect, it } from "vitest";
import { createEvalContext, type ContextState } from "./context.ts";
import { commandSucceeded, includes } from "../expect/index.ts";
import { completeCoverage, resolveAgentCoverage } from "../scoring/coverage.ts";
import { SEND_MAX_ATTEMPTS } from "./send-retry.ts";
import type { Agent, AgentContext, InputRequest, Sandbox, StreamEvent, Turn, TurnInput } from "../types.ts";

// 计算工具 + 最终回复"1 + 1 = **2** 哦!😊"——复现截图里的场景:助手回复明明包含 "2",
// 但 t.check(t.reply, includes("2")) 却失败。
function calculatorAgent(): Agent {
  return {
    name: "calculator",
    // 测试注入了真实的 fake sandbox,kind: "sandbox" 让 t.sandbox 过沙箱能力守卫。
    kind: "sandbox",
    coverage: completeCoverage,
    async send(_input: TurnInput, ctx: AgentContext): Promise<Turn> {
      ctx.session.capture("sess-1");
      const events: StreamEvent[] = [
        { type: "action.called", callId: "c1", name: "calculate", input: { expr: "1+1" }, tool: undefined },
        { type: "action.result", callId: "c1", output: { result: 2 }, status: "completed" },
        { type: "message", role: "assistant", text: "1 + 1 = **2** 哦!😊" },
      ];
      return { events, status: "completed", usage: { inputTokens: 10, outputTokens: 5, requests: 1 } };
    },
  };
}

type FakeSandbox = Sandbox & {
  calls: {
    uploadDirectory: [string, string | undefined][];
    downloadDirectory: [string, string | undefined][];
  };
};

function fakeSandbox(): FakeSandbox {
  const calls: FakeSandbox["calls"] = { uploadDirectory: [], downloadDirectory: [] };
  return {
    workdir: "/sandbox/work",
    runCommand: async () => { throw new Error("not implemented"); },
    runShell: async () => { throw new Error("not implemented"); },
    readFile: async () => "",
    fileExists: async () => false,
    writeFiles: async () => {},
    uploadFiles: async () => {},
    uploadDirectory: async (localDir, targetDir) => {
      calls.uploadDirectory.push([localDir, targetDir]);
    },
    stop: async () => {},
    sandboxId: "fake",
    otlpHost: null,
    downloadFile: async () => Buffer.from(""),
    uploadFile: async () => {},
    downloadDirectory: async (localDir, targetDir) => {
      calls.downloadDirectory.push([localDir, targetDir]);
    },
    calls,
  };
}

function makeContext(agent: Agent, sandbox = fakeSandbox(), evalBaseDir?: string) {
  return createEvalContext({
    agent,
    sandbox,
    flags: {},
    signal: new AbortController().signal,
    log: () => {},
    judge: undefined,
    evalBaseDir,
  });
}

describe("createEvalContext / TestContext live state", () => {
  it("t.reply reflects the assistant's reply after send(), not the empty initial value", async () => {
    const { context } = makeContext(calculatorAgent());
    await context.send("1+1=?");
    expect(context.reply).toBe("1 + 1 = **2** 哦!😊");
  });

  it("t.check(t.reply, includes(...)) passes when the reply contains the needle", async () => {
    const { context, state } = makeContext(calculatorAgent());
    await context.send("1+1=?");
    context.check(context.reply, includes("2"));

    const [result] = await state.collector.finalize({
      events: [],
      facts: { toolCalls: [], subagentCalls: [], inputRequests: [], parked: false, messageCount: 0, compactions: 0, contextInjections: 0 },
      diff: state.late.diff,
      scripts: state.late.scripts,
      usage: { inputTokens: 0, outputTokens: 0 },
      status: "completed",
      coverage: resolveAgentCoverage(completeCoverage),
      readFile: async () => undefined,
    });
    expect(result.outcome).toBe("passed");
    expect(result.outcome === "passed" ? result.score : -1).toBe(1);
    expect(result.outcome === "passed" ? result.evidence : "?").toBeUndefined();
  });

  it("t.check(...) attaches the actually-checked value as evidence when it fails", async () => {
    const { context, state } = makeContext(calculatorAgent());
    await context.send("1+1=?");
    context.check(context.reply, includes("banana"));

    const [result] = await state.collector.finalize({
      events: [],
      facts: { toolCalls: [], subagentCalls: [], inputRequests: [], parked: false, messageCount: 0, compactions: 0, contextInjections: 0 },
      diff: state.late.diff,
      scripts: state.late.scripts,
      usage: { inputTokens: 0, outputTokens: 0 },
      status: "completed",
      coverage: resolveAgentCoverage(completeCoverage),
      readFile: async () => undefined,
    });
    expect(result.outcome).toBe("failed");
    expect(result.outcome === "failed" ? result.received : undefined).toBe("1 + 1 = **2** 哦!😊");
  });

  it("t.check(CommandResult, …) 失败时 received 塌成退出码+输出尾部,evidence 是命令行", async () => {
    const { context, state } = makeContext(calculatorAgent());
    const commandResult = {
      stdout: `\n> test\n> pytest tests/\n${"collecting …\n".repeat(200)}1 failed, 5 passed in 12.72s\n`,
      stderr: "",
      exitCode: 1,
      command: "npm run test",
    };
    context.check(commandResult, commandSucceeded());

    const [result] = await state.collector.finalize({
      events: [],
      facts: { toolCalls: [], subagentCalls: [], inputRequests: [], parked: false, messageCount: 0, compactions: 0, contextInjections: 0 },
      diff: state.late.diff,
      scripts: state.late.scripts,
      usage: { inputTokens: 0, outputTokens: 0 },
      status: "completed",
      coverage: resolveAgentCoverage(completeCoverage),
      readFile: async () => undefined,
    });
    expect(result.outcome).toBe("failed");
    if (result.outcome !== "failed") return;
    const [firstLine] = result.received!.split("\n");
    expect(firstLine).toMatch(/^exit 1 · "…/);
    expect(firstLine).toContain("1 failed, 5 passed in 12.72s"); // 摘要面只保留的这一行自含失败计数
    expect(firstLine!.length).toBeLessThan(200);
    expect(result.received).toContain("output tail:"); // 更长尾部保留换行,attempt 首页展开
    expect(result.evidence).toBe("npm run test");
  });

  it("t.events reflects the turn's events after send(), not an empty snapshot", async () => {
    const { context } = makeContext(calculatorAgent());
    await context.send("1+1=?");
    expect(context.events.length).toBeGreaterThan(0);
    expect(context.events.some((e) => e.type === "message" && e.role === "assistant")).toBe(true);
  });

  it("t.sessionId reflects the id the agent assigned during send()", async () => {
    const { context } = makeContext(calculatorAgent());
    await context.send("1+1=?");
    expect(context.sessionId).toBe("sess-1");
  });

  it("exposes sandbox workdir to eval authors", () => {
    const { context } = makeContext(calculatorAgent());
    expect(context.sandbox.workdir).toBe("/sandbox/work");
  });

  it("resolves uploadDirectory local paths relative to the eval file directory", async () => {
    const sandbox = fakeSandbox();
    const { context } = makeContext(calculatorAgent(), sandbox, "/repo/evals/nested");

    await context.sandbox.uploadDirectory("../fixtures/app", "src");

    expect(sandbox.calls.uploadDirectory).toEqual([
      ["/repo/evals/fixtures/app", "src"],
    ]);
  });

  it("resolves downloadDirectory local paths relative to the eval file directory", async () => {
    const sandbox = fakeSandbox();
    const { context } = makeContext(calculatorAgent(), sandbox, "/repo/evals/nested");

    await context.sandbox.downloadDirectory("../out/attempt", "dist");

    expect(sandbox.calls.downloadDirectory).toEqual([
      ["/repo/evals/out/attempt", "dist"],
    ]);
  });
});

// agent 按调用次数依次吐出预设的 Turn 序列,同时记下每次收到的 TurnInput——
// 用来断言 t.respond()/t.respondAll() 到 adapter 的 input.responses 长什么样。
function scriptedAgent(turns: Turn[]): Agent & { received: TurnInput[] } {
  const received: TurnInput[] = [];
  let i = 0;
  const agent: Agent = {
    name: "scripted",
    kind: "remote",
    coverage: completeCoverage,
    async send(input: TurnInput) {
      received.push(input);
      const turn = turns[Math.min(i, turns.length - 1)] as Turn;
      i++;
      return turn;
    },
  };
  return Object.assign(agent, { received });
}

function waitingTurn(...requests: InputRequest[]): Turn {
  return {
    status: "waiting",
    events: requests.map((request) => ({ type: "input.requested" as const, request })),
  };
}

function completedTurn(text = "ok"): Turn {
  return { status: "completed", events: [{ type: "message", role: "assistant", text }] };
}

describe("t.respond() / t.respondAll(): structured InputResponse", () => {
  it("string arg hitting a pending request's option becomes { requestId, optionId }", async () => {
    const agent = scriptedAgent([
      waitingTurn({ id: "req_1", action: "send_email", options: [{ id: "approve" }, { id: "deny" }] }),
      completedTurn(),
    ]);
    const { context } = makeContext(agent);
    await context.send("draft an email");
    await context.respond("approve");

    expect(agent.received[1]?.text).toBe("approve");
    expect(agent.received[1]?.responses).toEqual([{ requestId: "req_1", optionId: "approve" }]);
  });

  it("string arg that matches no option becomes free-text { requestId, text }", async () => {
    const agent = scriptedAgent([
      waitingTurn({ id: "req_1", action: "send_email", options: [{ id: "approve" }, { id: "deny" }] }),
      completedTurn(),
    ]);
    const { context } = makeContext(agent);
    await context.send("draft an email");
    await context.respond("change the recipient to ceo@corp.com");

    expect(agent.received[1]?.responses).toEqual([
      { requestId: "req_1", text: "change the recipient to ceo@corp.com" },
    ]);
  });

  it("string arg throws a clear error when multiple requests are pending (needs object form to disambiguate)", async () => {
    const agent = scriptedAgent([
      waitingTurn(
        { id: "req_1", action: "edit_a", options: [{ id: "approve" }, { id: "deny" }] },
        { id: "req_2", action: "edit_b", options: [{ id: "approve" }, { id: "deny" }] },
      ),
      completedTurn(),
    ]);
    const { context } = makeContext(agent);
    await context.send("apply two edits");

    await expect(context.respond("approve")).rejects.toThrow(/字符串回答无法对位|cannot be matched/);
    // 报错但响应已发出同样违约:agent 只收到最初那一次 send,没有第二次输入。
    expect(agent.received).toHaveLength(1);
  });

  it("object form { request, optionId } disambiguates when multiple requests are pending", async () => {
    const agent = scriptedAgent([
      waitingTurn(
        { id: "req_1", action: "edit_a", options: [{ id: "approve" }, { id: "deny" }] },
        { id: "req_2", action: "edit_b", options: [{ id: "approve" }, { id: "deny" }] },
      ),
      completedTurn(),
    ]);
    const { context } = makeContext(agent);
    await context.send("apply two edits");
    const req2 = context.requireInputRequest({ action: "edit_b" });
    await context.respond({ request: req2, optionId: "deny" });

    expect(agent.received[1]?.text).toBe("deny");
    expect(agent.received[1]?.responses).toEqual([{ requestId: "req_2", optionId: "deny" }]);
  });

  it("object form with an optionId not present in the request's options throws instead of silently forwarding", async () => {
    const agent = scriptedAgent([
      waitingTurn({ id: "req_1", action: "send_email", options: [{ id: "approve" }, { id: "deny" }] }),
      completedTurn(),
    ]);
    const { context } = makeContext(agent);
    await context.send("draft an email");
    const req = context.requireInputRequest();

    await expect(context.respond({ request: req, optionId: "yolo" })).rejects.toThrow(/req_1/);
    // 校验先于发送:没有第二次 send 发生。
    expect(agent.received.length).toBe(1);
  });

  it("respondAll(optionId) answers every pending request and joins input.text with \\n", async () => {
    const agent = scriptedAgent([
      waitingTurn(
        { id: "req_1", action: "edit_a", options: [{ id: "approve" }, { id: "deny" }] },
        { id: "req_2", action: "edit_b", options: [{ id: "approve" }, { id: "deny" }] },
      ),
      completedTurn(),
    ]);
    const { context } = makeContext(agent);
    await context.send("apply two edits");
    await context.respondAll("approve");

    expect(agent.received[1]?.text).toBe("approve\napprove");
    expect(agent.received[1]?.responses).toEqual([
      { requestId: "req_1", optionId: "approve" },
      { requestId: "req_2", optionId: "approve" },
    ]);
  });

  it("respondAll(optionId) validates the option against every pending request before sending anything", async () => {
    const agent = scriptedAgent([
      waitingTurn(
        { id: "req_1", action: "edit_a", options: [{ id: "approve" }, { id: "deny" }] },
        { id: "req_2", action: "edit_b", options: [{ id: "yes" }, { id: "no" }] },
      ),
      completedTurn(),
    ]);
    const { context } = makeContext(agent);
    await context.send("apply two edits");

    await expect(context.respondAll("approve")).rejects.toThrow(/req_2/);
    expect(agent.received.length).toBe(1);
  });

  it("TurnInput.responses reaches the adapter unchanged (not derived/guessed on the adapter side)", async () => {
    const agent = scriptedAgent([
      waitingTurn({ id: "req_1", action: "send_email", options: [{ id: "approve" }, { id: "deny" }] }),
      completedTurn(),
    ]);
    const { context } = makeContext(agent);
    await context.send("draft an email");
    const req = context.requireInputRequest();
    await context.respond({ request: req, text: "wait, add a subject line first" });

    expect(agent.received[1]?.responses).toEqual([
      { requestId: "req_1", text: "wait, add a subject line first" },
    ]);
  });
});

function baseScoringContext(state: ContextState) {
  return {
    events: [],
    facts: { toolCalls: [], subagentCalls: [], inputRequests: [], parked: false, messageCount: 0, compactions: 0, contextInjections: 0 },
    diff: state.late.diff,
    scripts: state.late.scripts,
    usage: { inputTokens: 0, outputTokens: 0 },
    status: "completed" as const,
    coverage: resolveAgentCoverage(completeCoverage),
    readFile: async () => undefined,
  };
}

describe("t.* 作用域断言聚合全部轮次(callId 跨轮复用)", () => {
  // 回归:续轮场景下 adapter 常按轮各自编号(复用 c1)。第一轮读了 INDEX,第二轮才给答复;
  // t.calledTool 聚合全部轮次,应命中第一轮的 read——旧折叠按 callId 覆盖会让它「只扫最后一轮」而 miss。
  it("t.calledTool 命中发生在第一轮、callId 被第二轮复用的工具调用", async () => {
    const agent = scriptedAgent([
      {
        status: "completed",
        events: [
          { type: "action.called", callId: "c1", name: "read", input: { path: "INDEX.md" } },
          { type: "action.result", callId: "c1", output: "index contents", status: "completed" },
          { type: "message", role: "assistant", text: "读完了 INDEX,继续" },
        ],
      },
      {
        status: "completed",
        events: [
          { type: "action.called", callId: "c1", name: "write", input: { path: "note.md" } },
          { type: "action.result", callId: "c1", output: "ok", status: "completed" },
          { type: "message", role: "assistant", text: "答复" },
        ],
      },
    ]);
    const { context, state } = makeContext(agent);
    await context.send("第一轮"); // 读 INDEX
    await context.send("第二轮"); // 续轮,复用 callId c1

    context.calledTool("read", { input: { path: "INDEX.md" } });

    const [result] = await state.collector.finalize(baseScoringContext(state));
    expect(result.name).toBe("calledTool(read)");
    expect(result.outcome).toBe("passed");
  });
});

describe("TurnHandle scoped assertions (parked/loadedSkill/noFailedActions/maxTokens/maxCost)", () => {
  it("mirror t/session scope: turn.parked() reflects this turn's own waiting status", async () => {
    const agent = scriptedAgent([
      waitingTurn({ id: "req_1", action: "send_email", options: [{ id: "approve" }] }),
    ]);
    const { context, state } = makeContext(agent);
    const turn = await context.send("draft an email");
    turn.parked();

    const [result] = await state.collector.finalize(baseScoringContext(state));
    expect(result.name).toBe("parked");
    expect(result.outcome).toBe("passed");
  });

  it("turn.noFailedActions() looks only at this turn's own tool calls", async () => {
    const agent = scriptedAgent([
      {
        status: "completed",
        events: [
          { type: "action.called", callId: "c1", name: "shell", input: { cmd: "false" } },
          { type: "action.result", callId: "c1", output: {}, status: "failed" },
        ],
      },
    ]);
    const { context, state } = makeContext(agent);
    const turn = await context.send("run a command");
    turn.noFailedActions();

    const [result] = await state.collector.finalize(baseScoringContext(state));
    expect(result.name).toBe("noFailedActions");
    expect(result.outcome).toBe("failed");
  });

  it("turn.maxTokens()/turn.maxCost() read this turn's own Turn.usage, not the session total", async () => {
    const agent = scriptedAgent([
      { status: "completed", events: [{ type: "message", role: "assistant", text: "ok" }], usage: { inputTokens: 100, outputTokens: 50, costUSD: 0.02 } },
    ]);
    const { context, state } = makeContext(agent);
    const turn = await context.send("hi");
    turn.maxTokens(1000);
    turn.maxCost(0.01);

    const [tokens, cost] = await state.collector.finalize(baseScoringContext(state));
    expect(tokens.name).toBe("maxTokens(1000)");
    expect(tokens.outcome).toBe("passed");
    expect(cost.name).toBe("maxCost(0.01)");
    expect(cost.outcome).toBe("failed");
  });

  it("turn.loadedSkill() reads the skill.loaded event scoped to this turn", async () => {
    const agent = scriptedAgent([
      {
        status: "completed",
        events: [{ type: "skill.loaded", skill: "pdf-export", callId: "c1" }],
      },
    ]);
    const { context, state } = makeContext(agent);
    const turn = await context.send("export as pdf");
    turn.loadedSkill("pdf-export");

    const [result] = await state.collector.finalize(baseScoringContext(state));
    expect(result.outcome).toBe("passed");
  });

  // Skill 加载是一等事件,不是「名字叫 load_skill 的工具调用」——adapter 负责归一
  // (claude-code parser 就把 Skill tool_use 直接吐成 skill.loaded)。伪装成工具调用的
  // 加载断言侧看不见,这是 adapter 违约,不是断言该兜的底(见 docs/feature/adapters/architecture/events.md)。
  it("turn.loadedSkill() does not match a tool call that merely happens to be named load_skill", async () => {
    const agent = scriptedAgent([
      {
        status: "completed",
        events: [{ type: "action.called", callId: "c1", name: "load_skill", input: { skill: "pdf-export" } }],
      },
    ]);
    const { context, state } = makeContext(agent);
    const turn = await context.send("export as pdf");
    turn.loadedSkill("pdf-export");

    const [result] = await state.collector.finalize(baseScoringContext(state));
    expect(result.outcome).toBe("failed");
  });
});

// turn 级重试封顶后,agent.send() 最终返回的失败 Turn 照旧走 expectOk() → TurnFailed
// (docs/feature/error-classification/README.md「挂载点与重试范围」);这里端到端证明
// send-retry.ts 的耗尽摘要确实经 turnErrorText 同源浮到 TurnFailed 的 message 上。
describe("t.send(...).expectOk() · turn 级重试耗尽", () => {
  it("连续撞限流耗尽 send 级预算后,TurnFailed 的 message 带重试摘要", async () => {
    let calls = 0;
    const agent: Agent = {
      name: "always-rate-limited",
      kind: "remote",
      async send(): Promise<Turn> {
        calls++;
        return { status: "failed", events: [{ type: "error", message: "rate limited, please retry later" }] };
      },
    };
    const { context } = createEvalContext({
      agent,
      sandbox: fakeSandbox(),
      flags: {},
      signal: new AbortController().signal,
      log: () => {},
      judge: undefined,
      retryRandom: () => 0,
      retrySleep: async () => {},
    });

    const turn = await context.send("do it");
    expect(calls).toBe(SEND_MAX_ATTEMPTS); // 重试封顶后才浮出,不是第一次失败就返回
    expect(() => turn.expectOk()).toThrow(/rate_limit/);
    expect(() => turn.expectOk()).toThrow(/retries exhausted|重试已耗尽/);
  });

  it("不可重试的失败没有重试摘要后缀(与「诚实的 errored」用例一致)", async () => {
    let calls = 0;
    const agent: Agent = {
      name: "stream-drop",
      kind: "remote",
      async send(): Promise<Turn> {
        calls++;
        return { status: "failed", events: [{ type: "error", message: "stream reset mid-response after 3 tool calls" }] };
      },
    };
    const { context } = createEvalContext({
      agent,
      sandbox: fakeSandbox(),
      flags: {},
      signal: new AbortController().signal,
      log: () => {},
      judge: undefined,
    });

    const turn = await context.send("do it");
    expect(calls).toBe(1); // 没有重试
    expect(() => turn.expectOk()).toThrow(/stream reset mid-response after 3 tool calls/);
    expect(() => turn.expectOk()).not.toThrow(/exhausted|耗尽/);
  });
});
