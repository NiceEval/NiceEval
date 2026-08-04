// cases: docs/engineering/testing/unit/adapters.md
// bug: memory/codex-agent-process-env-not-forwarded.md, memory/sandbox-path-managed-pathprepend.md
import { describe, expect, it } from "vitest";
import { createAgentSession } from "../context/session.ts";
import type { CommandOptions, CommandResult, Sandbox, SandboxAgentContext } from "../types.ts";
import { codexAgent, type CodexConfig } from "./codex.ts";
import { DEFAULT_CODEX_CLI_VERSION } from "./coding-cli-versions.ts";
import { resolveSendFailureClass } from "../context/send-failures.ts";

interface ShellCall {
  readonly script: string;
  readonly options?: CommandOptions;
}

function fixture(stdout = [
  JSON.stringify({ type: "thread.started", thread_id: "thread-space-a" }),
  JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } }),
].join("\n"), exitCode = 0, stderr = ""): {
  readonly sandbox: Sandbox;
  readonly context: SandboxAgentContext;
  readonly calls: ShellCall[];
} {
  const calls: ShellCall[] = [];
  const sandbox = {
    workdir: "/workspace",
    sandboxId: "codex-env-fixture",
    runShell: async (script: string, options?: CommandOptions): Promise<CommandResult> => {
      calls.push({ script, options });
      return { stdout, stderr, exitCode };
    },
  } as unknown as Sandbox;
  const context: SandboxAgentContext = {
    sandbox,
    signal: new AbortController().signal,
    flags: {},
    session: createAgentSession(),
    progress() {},
    diagnostic() {},
    fact() {},
    log() {},
  };
  return { sandbox, context, calls };
}

describe("codexAgent process env", () => {
  it("工厂声明精确的 Agent Ensure UI progress 文案", () => {
    const agent = codexAgent();
    if (agent.kind !== "sandbox") throw new Error("codexAgent must be a sandbox agent");

    expect(agent.ensure[0]?.progress).toEqual({
      checking: `checking Codex CLI ${DEFAULT_CODEX_CLI_VERSION}`,
      ready: `Codex CLI ${DEFAULT_CODEX_CLI_VERSION} ready`,
    });
    expect(agent.installers[0]?.progress).toEqual({
      installing: `installing official OpenAI Codex CLI ${DEFAULT_CODEX_CLI_VERSION}`,
    });
  });

  it("config.env.PATH 在 codexAgent() 构造时同步报错，指向 pathPrepend", () => {
    expect(() => codexAgent({ env: { PATH: "/opt/tools/bin" } })).toThrow(/pathPrepend/);
    expect(() => codexAgent({ env: { PATH: "/opt/tools/bin", NMEM_SPACE: "x" } })).toThrow(/pathPrepend/);
    // 不含 PATH 的 env 不受影响。
    expect(() => codexAgent({ env: { NMEM_SPACE: "x" } })).not.toThrow();
  });

  it("首轮与 resume 只经 Sandbox options 注入同一环境，并登记全部潜在敏感值", async () => {
    const apiKey = "synthetic-codex-key";
    const space = "memorybench-nowledge-space-a";
    const pluginToken = "synthetic-nowledge-token";
    const env = Object.freeze({ NMEM_SPACE: space, NOWLEDGE_TOKEN: pluginToken });
    const config: CodexConfig = { apiKey, env };
    const agent = codexAgent(config);
    const { context, calls } = fixture();
    if (agent.kind !== "sandbox") throw new Error("codexAgent must be a sandbox agent");

    await agent.send({ text: "first turn" }, context);
    await agent.send({ text: "resume turn" }, context);

    expect(calls).toHaveLength(2);
    expect(calls[0]?.script).toContain(" exec --json ");
    expect(calls[1]?.script).toContain(" exec resume thread-space-a ");
    for (const call of calls) {
      expect(call.options?.env).toEqual({
        NMEM_SPACE: space,
        NOWLEDGE_TOKEN: pluginToken,
        CODEX_API_KEY: apiKey,
      });
      expect(call.options?.sensitiveValues).toEqual(expect.arrayContaining([apiKey, space, pluginToken]));
      expect(call.script).not.toContain("NMEM_SPACE");
      expect(call.script).not.toContain(space);
      expect(call.script).not.toContain(pluginToken);
      expect(call.script).not.toContain(apiKey);
    }
    expect(env).toEqual({ NMEM_SPACE: space, NOWLEDGE_TOKEN: pluginToken });
  });

  it("明确的 model-at-capacity admission 只在没有 started evidence 时放行重试", async () => {
    const agent = codexAgent({ apiKey: "synthetic-codex-key" });
    if (agent.kind !== "sandbox") throw new Error("codexAgent must be a sandbox agent");
    const rejected = fixture(
      JSON.stringify({ type: "turn.failed", error: { code: "model_at_capacity", message: "model is at capacity" } }),
      1,
    );
    await expect(agent.send({ text: "first turn" }, rejected.context)).rejects.toMatchObject({ acceptance: "rejected" });
    try {
      await agent.send({ text: "first turn" }, rejected.context);
    } catch (error) {
      expect(resolveSendFailureClass(error as never, { adapter: agent.classifySendFailure })).toEqual({
        retryable: true,
        reason: "model_capacity",
      });
    }

    const started = fixture([
      JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "partial" } }),
      JSON.stringify({ type: "turn.failed", error: { code: "model_at_capacity", message: "model is at capacity" } }),
    ].join("\n"), 1);
    await expect(agent.send({ text: "first turn" }, started.context)).rejects.toMatchObject({ acceptance: "started" });

    const nativeText = fixture("", 1, "model is at capacity");
    await expect(agent.send({ text: "first turn" }, nativeText.context)).rejects.toMatchObject({ acceptance: "rejected" });

    const unknownRaw = fixture(JSON.stringify({ type: "notice", message: "model is at capacity" }), 1);
    await expect(agent.send({ text: "first turn" }, unknownRaw.context)).rejects.toMatchObject({ acceptance: "unknown" });
    const ordinaryText = fixture("ordinary output: model is at capacity", 1);
    await expect(agent.send({ text: "first turn" }, ordinaryText.context)).rejects.toMatchObject({ acceptance: "unknown" });
    const structuredMessage = fixture(
      JSON.stringify({ type: "turn.failed", error: { message: "model is at capacity" } }),
      1,
    );
    await expect(agent.send({ text: "first turn" }, structuredMessage.context)).rejects.toMatchObject({ acceptance: "rejected" });
  });

  it("只对稳定的原生 capacity 文本做无 started evidence 的窄回退", () => {
    const agent = codexAgent({ apiKey: "synthetic-codex-key" });
    expect(agent.classifySendFailure?.({
      type: "agent-send-failed",
      acceptance: "rejected",
      message: "model is at capacity",
    })).toEqual({ retryable: true, reason: "model_capacity" });
    expect(agent.classifySendFailure?.({
      type: "agent-send-failed",
      acceptance: "rejected",
      message: "capacity exceeded after partial answer",
      events: [{ type: "message", role: "assistant", text: "partial" }],
    })).toBeUndefined();
    expect(agent.classifySendFailure?.({
      type: "agent-send-failed",
      acceptance: "rejected",
      message: "capacity exceeded",
    })).toBeUndefined();
  });
});
