// cases: docs/engineering/testing/unit/eval.md
import { describe, expect, it } from "vitest";
import { createEvalContext, type ContextState } from "./context.ts";
import { commandSucceeded, includes, makeAssertion } from "../expect/index.ts";
import { EvalRequirementFailed } from "./control-flow.ts";
import { deriveDiffData } from "../assertions/diff.ts";
import { completeEvidenceCoverage } from "../assertions/coverage.ts";
import { assertionSummaryLines, primaryAssertionSummary } from "../assertions/display.ts";
import { defineSandboxCommand } from "../sandbox/commands.ts";
import type { Agent, AgentContext, DiffArtifact, InputRequest, InputResponse, RespondAnswer, Sandbox, StreamEvent, Turn, TurnInput } from "../types.ts";

function hitlAnswerTypeContract(request: InputRequest): void {
  const optionAnswer: RespondAnswer = { request, optionId: "approve" };
  const textAnswer: RespondAnswer = { request, text: "please revise" };
  const optionResponse: InputResponse = { requestId: "req-1", optionId: "approve" };
  const textResponse: InputResponse = { requestId: "req-1", text: "please revise" };
  void [optionAnswer, textAnswer, optionResponse, textResponse];

  // @ts-expect-error optionId 与 text 必须恰好出现一项。
  const missingAnswer: RespondAnswer = { request };
  // @ts-expect-error optionId 与 text 不能同时出现。
  const ambiguousAnswer: RespondAnswer = { request, optionId: "approve", text: "approve" };
  // @ts-expect-error adapter 收到的 InputResponse 也使用同一个 XOR。
  const missingResponse: InputResponse = { requestId: "req-1" };
  // @ts-expect-error adapter 收到的 InputResponse 不能同时携带两种回答。
  const ambiguousResponse: InputResponse = { requestId: "req-1", optionId: "approve", text: "approve" };
  void [missingAnswer, ambiguousAnswer, missingResponse, ambiguousResponse];
}
void hitlAnswerTypeContract;

// 计算工具 + 最终回复"1 + 1 = **2** 哦!😊"——复现截图里的场景:助手回复明明包含 "2",
// 但 t.check(t.reply, includes("2")) 却失败。
function calculatorAgent(): Agent {
  const identity = { agent: "calculator", version: "0.0.0-test", revision: "1" } as const;
  return {
    name: "calculator",
    // 测试注入了真实的 fake sandbox,kind: "sandbox" 让 t.sandbox 过沙箱能力守卫。
    kind: "sandbox",
    ensure: [{
      identity,
      probe: defineSandboxCommand(
        { id: "test.agent.calculator.probe", revision: "1", inputs: identity },
        async () => {},
      ),
    }],
    installers: [],
    evidenceCoverage: completeEvidenceCoverage,
    async send(_input: TurnInput, ctx: AgentContext): Promise<Turn> {
      ctx.session.capture("sess-1");
      const events: StreamEvent[] = [
        { type: "operation.started", operationId: "c1", operation: { kind: "tool", name: "calculate", input: { expr: "1+1" }, tool: undefined } },
        { type: "operation.finished", operationId: "c1", kind: "tool", output: { result: 2 }, status: "completed" },
        { type: "message", role: "assistant", text: "1 + 1 = **2** 哦!😊" },
      ];
      return { events, status: "completed", usage: { inputTokens: 10, outputTokens: 5, requests: 1 } };
    },
  };
}

type FakeSandbox = Sandbox & {
  calls: {
    uploadDirectory: [string | URL, string | undefined][];
    downloadDirectory: [string, string | URL][];
  };
};

function fakeSandbox(): FakeSandbox {
  const calls: FakeSandbox["calls"] = { uploadDirectory: [], downloadDirectory: [] };
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
    uploadDirectory: async (sourceDir, targetDir) => {
      calls.uploadDirectory.push([sourceDir, targetDir]);
    },
    stop: async () => {},
    sandboxId: "fake",
    otlpHost: null,
    downloadFile: async () => {},
    uploadFile: async () => {},
    downloadDirectory: async (sourceDir, targetDir) => {
      calls.downloadDirectory.push([sourceDir, targetDir]);
    },
    calls,
  };
}

function makeContext(agent: Agent, sandbox = fakeSandbox(), evalBaseDir?: string, evaluationKind?: "pass" | "points") {
  return createEvalContext({
    agent,
    sandbox,
    flags: {},
    signal: new AbortController().signal,
    log: () => {},
    judge: undefined,
    evalBaseDir,
    evaluationKind,
  });
}

function assertionEvaluationContext(state: ContextState) {
  return {
    events: [],
    facts: { toolCalls: [], subagentCalls: [], inputRequests: [], parked: false, messageCount: 0, compactions: 0, contextInjections: 0 },
    diff: state.late.diff,
    scripts: state.late.scripts,
    usage: { inputTokens: 0, outputTokens: 0 },
    status: "completed" as const,
    evidenceCoverage: completeEvidenceCoverage,
    readFile: async () => undefined,
  };
}

/** 记录沙箱侧一切写入与命令 env 的 fake:用来证明「沙箱里零框架痕迹」。 */
function tracingSandbox() {
  const files = new Map<string, string>();
  const commands: { line: string; env?: globalThis.Record<string, string> }[] = [];
  const sandbox = {
    ...fakeSandbox(),
    async writeText(path: string, content: string): Promise<void> {
      files.set(path, content);
    },
    async writeBytes(path: string, content: Uint8Array): Promise<void> {
      files.set(path, Buffer.from(content).toString());
    },
    async runShell(script: string, opts?: { env?: globalThis.Record<string, string> }) {
      commands.push({ line: script, ...(opts?.env ? { env: opts.env } : {}) });
      return { stdout: "", stderr: "", exitCode: 0 };
    },
    async runCommand(cmd: string, args: string[] = [], opts?: { env?: globalThis.Record<string, string> }) {
      commands.push({ line: [cmd, ...args].join(" "), ...(opts?.env ? { env: opts.env } : {}) });
      return { stdout: "", stderr: "", exitCode: 0 };
    },
  } as FakeSandbox;
  return { sandbox, files, commands };
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
      evidenceCoverage: completeEvidenceCoverage,
      readFile: async () => undefined,
    });
    expect(result.outcome).toBe("passed");
    expect(result.outcome === "passed" ? result.score : -1).toBe(1);
    expect(result.outcome === "passed" ? result.evidence : "?").toBeUndefined();
  });

  it("t.require 两种题型都透传原引用；失败记录 gate + stopOnFailure 并抛控制流信号", async () => {
    for (const evaluationKind of ["pass", "points"] as const) {
      const passed = makeContext(calculatorAgent(), fakeSandbox(), undefined, evaluationKind);
      const original = { stable: true };
      const same = await passed.context.require(
        original,
        makeAssertion({ name: "same reference", score: (value) => (value === original ? 1 : 0) }),
      );
      expect(same).toBe(original);
      const [passingResult] = await passed.state.collector.finalize(assertionEvaluationContext(passed.state));
      expect(passingResult).toMatchObject({ severity: "gate", outcome: "passed", stopOnFailure: true });

      const failed = makeContext(calculatorAgent(), fakeSandbox(), undefined, evaluationKind);
      await expect(failed.context.require(original, includes("never"))).rejects.toBeInstanceOf(EvalRequirementFailed);
      const [failingResult] = await failed.state.collector.finalize(assertionEvaluationContext(failed.state));
      expect(failingResult).toMatchObject({ severity: "gate", outcome: "failed", stopOnFailure: true });
      expect(failingResult).toHaveProperty("received");
    }
  });

  it("作用域句柄只在 stopOnFailure 链的位置中止；atLeast 失败仍保持 soft", async () => {
    const { context, state } = makeContext(calculatorAgent());
    await context.send("1+1=?");

    context.calledTool("missing").gate();
    context.check(context.reply, includes("2"));
    await expect(context.calledTool("missing").atLeast(1).stopOnFailure()).rejects.toBeInstanceOf(
      EvalRequirementFailed,
    );

    const results = await state.collector.finalize(assertionEvaluationContext(state));
    expect(results).toHaveLength(3);
    expect(results[0]).toMatchObject({ severity: "gate", outcome: "failed" });
    expect(results[0]).not.toHaveProperty("stopOnFailure");
    expect(results[1]).toMatchObject({ outcome: "passed" });
    expect(results[2]).toMatchObject({ severity: "soft", threshold: 1, outcome: "failed", stopOnFailure: true });
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
      evidenceCoverage: completeEvidenceCoverage,
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
      evidenceCoverage: completeEvidenceCoverage,
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

  // 回归:MemoryBench dogfooding 里摘录落在 uv 装包噪声上(memory/commandsucceeded-received-excerpt-not-tail.md)。
  it("t.check(CommandResult, …) 的摘录取被测命令输出的末尾:包装器噪声(stderr)不挤掉 runner 尾部 summary", async () => {
    const { context, state } = makeContext(calculatorAgent());
    const commandResult = {
      // uv 这类包装器把装包进度流到 stderr(时间上在前),runner 自己的 summary 收在 stdout 末尾。
      stdout: `${"collecting tests/test_api.py …\n".repeat(300)}FAILED tests/test_api.py::test_rate_limit - assert 429 == 200\n===== 2 failed, 14 passed in 3.41s =====\n`,
      stderr: `${"Downloading pygments (1.2MiB)\n".repeat(200)}Prepared 5 packages in 95ms\nInstalled 5 packages in 10ms\n`,
      exitCode: 1,
      command: "uv run pytest",
    };
    context.check(commandResult, commandSucceeded());

    const [result] = await state.collector.finalize({
      events: [],
      facts: { toolCalls: [], subagentCalls: [], inputRequests: [], parked: false, messageCount: 0, compactions: 0, contextInjections: 0 },
      diff: state.late.diff,
      scripts: state.late.scripts,
      usage: { inputTokens: 0, outputTokens: 0 },
      status: "completed",
      evidenceCoverage: completeEvidenceCoverage,
      readFile: async () => undefined,
    });
    if (result.outcome !== "failed") throw new Error("fixture 应判 failed");
    const [firstLine] = result.received!.split("\n");
    expect(firstLine).toContain("2 failed, 14 passed in 3.41s");
    expect(firstLine).not.toContain("Prepared 5 packages"); // 装包噪声不占摘录
    expect(firstLine).not.toContain("Downloading pygments");

    // 终端摘要行(human 面 100 字符预算,从头收口)必须仍带着 summary——摘录本身要放得进这一行,
    // 否则收口只留中段,尾部计数丢在看不见的地方。
    const summary = primaryAssertionSummary([result], "failed", "pass")!;
    const lines = assertionSummaryLines(summary);
    expect(lines.join("\n")).toContain("2 failed, 14 passed in 3.41s");
  });

  it("t.events reflects the turn's events after send(), not an empty run", async () => {
    const { context } = makeContext(calculatorAgent());
    await context.send("1+1=?");
    expect(context.events.length).toBeGreaterThan(0);
    expect(context.events.some((e) => e.type === "message" && e.role === "assistant")).toBe(true);
  });

  it("t.o11y 每次读取现算:send 前是空摘要,两轮之后反映累计到最近一次 send 的行为", async () => {
    const { context } = makeContext(calculatorAgent());

    expect(context.o11y.totalToolCalls).toBe(0);
    await context.send("1+1=?");
    expect(context.o11y.totalToolCalls).toBe(1);
    expect(context.o11y.totalTurns).toBe(1);
    await context.send("再来一次");
    // 同一个 getter,读取时点不同就是不同的值——它不是 send 时算好的快照。
    expect(context.o11y.totalToolCalls).toBe(2);
    expect(context.o11y.totalTurns).toBe(2);
  });

  it("direct Agent 的 t.o11y 与 sandbox Agent 同一行为(摘要住宿主侧,与有没有沙箱无关)", async () => {
    const calculator = calculatorAgent();
    const direct: Agent = {
      name: calculator.name,
      kind: "direct",
      evidenceCoverage: completeEvidenceCoverage,
      send: calculator.send,
    };
    const { context: sandboxCtx } = makeContext(calculator);
    const { context: directCtx } = makeContext(direct);

    await sandboxCtx.send("1+1=?");
    await directCtx.send("1+1=?");

    expect(directCtx.o11y).toEqual(sandboxCtx.o11y);
    expect(directCtx.o11y.totalToolCalls).toBe(1);
  });

  it("跑完一轮 send 与用户命令后,沙箱里没有任何框架文件,命令 env 里也没有任何框架变量", async () => {
    const fixture = tracingSandbox();
    const { context } = makeContext(calculatorAgent(), fixture.sandbox);

    await context.send("1+1=?");
    await context.sandbox.runShell("pytest -q");
    await context.sandbox.runCommand("npm", ["test"], { env: { CI: "1" } });

    expect([...fixture.files.keys()]).toEqual([]);
    for (const command of fixture.commands) {
      expect(Object.keys(command.env ?? {}).filter((k) => /niceeval/i.test(k))).toEqual([]);
    }
    // 行为断言的数据只在宿主侧,一份也没送进沙箱。
    expect(context.o11y.totalToolCalls).toBe(1);
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

    await context.sandbox.downloadDirectory("dist", "../out/attempt");

    expect(sandbox.calls.downloadDirectory).toEqual([
      ["dist", "/repo/evals/out/attempt"],
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
    kind: "direct",
    evidenceCoverage: completeEvidenceCoverage,
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
  it("requireInputRequest 的 input 使用递归 JsonMatch", async () => {
    const agent = scriptedAgent([
      waitingTurn({ id: "req_1", input: { commands: [{ argv: ["npm", "test"], retries: 2 }] } }),
    ]);
    const { context } = makeContext(agent);
    await context.send("run checks");

    const request = context.requireInputRequest({
      input: { commands: [{ argv: ["npm", /test/], retries: (value) => value === 2 }] },
    });
    expect(request.id).toBe("req_1");
  });

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

  it("dynamic callers cannot omit or combine the two answer branches", async () => {
    const agent = scriptedAgent([
      waitingTurn({ id: "req_1", action: "send_email", options: [{ id: "approve" }, { id: "deny" }] }),
    ]);
    const { context } = makeContext(agent);
    await context.send("draft an email");
    const request = context.requireInputRequest();

    await expect(context.respond({ request } as never)).rejects.toThrow(/恰好|exactly one/);
    await expect(context.respond({ request, optionId: "approve", text: "approve" } as never)).rejects.toThrow(/恰好|exactly one/);
    expect(agent.received).toHaveLength(1);
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

function baseAssertionEvaluationContext(state: ContextState) {
  return {
    events: [],
    facts: { toolCalls: [], subagentCalls: [], inputRequests: [], parked: false, messageCount: 0, compactions: 0, contextInjections: 0 },
    diff: state.late.diff,
    scripts: state.late.scripts,
    usage: { inputTokens: 0, outputTokens: 0 },
    status: "completed" as const,
    evidenceCoverage: completeEvidenceCoverage,
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
          { type: "operation.started", operationId: "c1", operation: { kind: "tool", name: "read", input: { path: "INDEX.md" } } },
          { type: "operation.finished", operationId: "c1", kind: "tool", output: "index contents", status: "completed" },
          { type: "message", role: "assistant", text: "读完了 INDEX,继续" },
        ],
      },
      {
        status: "completed",
        events: [
          { type: "operation.started", operationId: "c1", operation: { kind: "tool", name: "write", input: { path: "note.md" } } },
          { type: "operation.finished", operationId: "c1", kind: "tool", output: "ok", status: "completed" },
          { type: "message", role: "assistant", text: "答复" },
        ],
      },
    ]);
    const { context, state } = makeContext(agent);
    await context.send("第一轮"); // 读 INDEX
    await context.send("第二轮"); // 续轮,复用 callId c1

    context.calledTool("read", { input: { path: "INDEX.md" } });

    const [result] = await state.collector.finalize(baseAssertionEvaluationContext(state));
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

    const [result] = await state.collector.finalize(baseAssertionEvaluationContext(state));
    expect(result.name).toBe("parked");
    expect(result.outcome).toBe("passed");
  });

  it("turn.noFailedActions() looks only at this turn's own tool calls", async () => {
    const agent = scriptedAgent([
      {
        status: "completed",
        events: [
          { type: "operation.started", operationId: "c1", operation: { kind: "tool", name: "shell", input: { cmd: "false" } } },
          { type: "operation.finished", operationId: "c1", kind: "tool", output: {}, status: "failed" },
        ],
      },
    ]);
    const { context, state } = makeContext(agent);
    const turn = await context.send("run a command");
    turn.noFailedActions();

    const [result] = await state.collector.finalize(baseAssertionEvaluationContext(state));
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

    const [tokens, cost] = await state.collector.finalize(baseAssertionEvaluationContext(state));
    expect(tokens.name).toBe("maxTokens(1000)");
    expect(tokens.outcome).toBe("passed");
    expect(cost.name).toBe("maxCost(0.01)");
    expect(cost.outcome).toBe("failed");
  });

  it("turn.loadedSkill() reads the skill.loaded event scoped to this turn", async () => {
    const agent = scriptedAgent([
      {
        status: "completed",
        events: [{ type: "skill.loaded", skill: "pdf-export", operationId: "c1" }],
      },
    ]);
    const { context, state } = makeContext(agent);
    const turn = await context.send("export as pdf");
    turn.loadedSkill("pdf-export");

    const [result] = await state.collector.finalize(baseAssertionEvaluationContext(state));
    expect(result.outcome).toBe("passed");
  });

  // Skill 加载是一等事件,不是「名字叫 load_skill 的工具调用」——adapter 负责归一
  // (claude-code parser 就把 Skill tool_use 直接吐成 skill.loaded)。伪装成工具调用的
  // 加载断言侧看不见,这是 adapter 违约,不是断言该兜的底(见 docs/feature/adapters/architecture/events.md)。
  it("turn.loadedSkill() does not match a tool call that merely happens to be named load_skill", async () => {
    const agent = scriptedAgent([
      {
        status: "completed",
        events: [{ type: "operation.started", operationId: "c1", operation: { kind: "tool", name: "load_skill", input: { skill: "pdf-export" } } }],
      },
    ]);
    const { context, state } = makeContext(agent);
    const turn = await context.send("export as pdf");
    turn.loadedSkill("pdf-export");

    const [result] = await state.collector.finalize(baseAssertionEvaluationContext(state));
    expect(result.outcome).toBe("failed");
  });
});

describe("t.send() · failed Turn 是可评分领域结果", () => {
  it("原样返回 failed，不被执行错误路径强制抛出", async () => {
    const agent: Agent = {
      name: "task-failed",
      kind: "direct",
      evidenceCoverage: completeEvidenceCoverage,
      async send(): Promise<Turn> {
        return { status: "failed", events: [{ type: "error", message: "tests failed" }] };
      },
    };
    const { context } = makeContext(agent);
    const turn = await context.send("do it");
    expect(turn.status).toBe("failed");
    turn.succeeded();
  });
});

describe("t.sandbox.diff 的内容读取:被省略的内容如实报不可用", () => {
  const windows: DiffArtifact = [
    {
      window: "s1/t1",
      changes: {
        "src/app.ts": { status: "modified", before: "callback(x)\n", after: "await x\n" },
        "dist/bundle.wasm": { status: "added", elided: { reason: "binary", afterBytes: 3_145_728 } },
        "data/dump.sql": { status: "modified", elided: { reason: "oversized-text", beforeBytes: 2_097_153, afterBytes: 4_194_304 } },
      },
    },
  ];

  function contextWithDiff() {
    const made = makeContext(calculatorAgent());
    made.state.late.diff = deriveDiffData(windows);
    return made;
  }

  it("内联的文件照常读到终态内容", () => {
    const { context } = contextWithDiff();
    expect(context.sandbox.diff.get("src/app.ts")).toBe("await x\n");
    expect(context.sandbox.diff.get("never/touched.ts")).toBeUndefined();
    expect(context.sandbox.diff.isEmpty()).toBe(false);
  });

  it("内容被省略的文件不回落成 undefined,而是抛出点名原因、字节数与替代做法的错误", () => {
    const { context } = contextWithDiff();
    expect(() => context.sandbox.diff.get("dist/bundle.wasm")).toThrow(/binary \(after 3145728 bytes\)/);
    expect(() => context.sandbox.diff.get("data/dump.sql")).toThrow(/oversized-text \(before 2097153 bytes, after 4194304 bytes\)/);
    expect(() => context.sandbox.diff.get("data/dump.sql")).toThrow(/t\.sandbox\.readText/);
  });

  it("matches:命中即 true;没命中但有条目内容被省略时抛错,不静默返回 false", () => {
    const { context } = contextWithDiff();
    expect(context.sandbox.diff.matches(/await x/)).toBe(true);
    expect(context.sandbox.diff.matches(/bundle\.wasm/)).toBe(true); // 路径命中不需要内容
    expect(() => context.sandbox.diff.matches(/console\.log/)).toThrow(/no inline content/);
  });
});
