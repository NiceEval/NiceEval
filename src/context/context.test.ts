import { describe, expect, it } from "vitest";
import { createEvalContext } from "./context.ts";
import { includes } from "../expect/index.ts";
import type { Agent, AgentContext, Sandbox, StreamEvent, Turn, TurnInput } from "../types.ts";

// 计算工具 + 最终回复"1 + 1 = **2** 哦!😊"——复现截图里的场景:助手回复明明包含 "2",
// 但 t.check(t.reply, includes("2")) 却失败。
function calculatorAgent(): Agent {
  return {
    name: "calculator",
    capabilities: { conversation: true, toolObservability: true },
    async send(_input: TurnInput, ctx: AgentContext): Promise<Turn> {
      ctx.session.id = "sess-1";
      const events: StreamEvent[] = [
        { type: "action.called", callId: "c1", name: "calculate", input: { expr: "1+1" }, tool: undefined },
        { type: "action.result", callId: "c1", output: { result: 2 }, status: "completed" },
        { type: "message", role: "assistant", text: "1 + 1 = **2** 哦!😊" },
      ];
      return { events, status: "completed", usage: { inputTokens: 10, outputTokens: 5, requests: 1 } };
    },
  };
}

type FakeSandbox = Sandbox & { calls: { uploadDirectory: [string, string | undefined][] } };

function fakeSandbox(): FakeSandbox {
  const calls: { uploadDirectory: [string, string | undefined][] } = { uploadDirectory: [] };
  return {
    workdir: "/sandbox/work",
    runCommand: async () => { throw new Error("not implemented"); },
    runShell: async () => { throw new Error("not implemented"); },
    readFile: async () => "",
    fileExists: async () => false,
    readSourceFiles: async () => Object.assign([], {
      text: () => "",
      code: () => "",
      fileMatching: () => undefined,
      fileMatchingAll: () => undefined,
      hasPath: () => false,
    }),
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
      facts: { toolCalls: [], subagentCalls: [], inputRequests: [], parked: false, messageCount: 0, compactions: 0 },
      diff: state.late.diff,
      scripts: state.late.scripts,
      usage: { inputTokens: 0, outputTokens: 0 },
      status: "completed",
      readFile: async () => undefined,
    });
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1);
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
});
