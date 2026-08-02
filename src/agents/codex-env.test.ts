// cases: docs/engineering/testing/unit/adapters.md
// bug: memory/codex-agent-process-env-not-forwarded.md
import { describe, expect, it } from "vitest";
import { createAgentSession } from "../context/session.ts";
import type { CommandOptions, CommandResult, Sandbox, SandboxAgentContext } from "../types.ts";
import { codexAgent, type CodexConfig } from "./codex.ts";
import { DEFAULT_CODEX_CLI_VERSION } from "./coding-cli-versions.ts";

interface ShellCall {
  readonly script: string;
  readonly options?: CommandOptions;
}

function fixture(): {
  readonly sandbox: Sandbox;
  readonly context: SandboxAgentContext;
  readonly calls: ShellCall[];
} {
  const calls: ShellCall[] = [];
  const stdout = [
    JSON.stringify({ type: "thread.started", thread_id: "thread-space-a" }),
    JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } }),
  ].join("\n");
  const sandbox = {
    workdir: "/workspace",
    sandboxId: "codex-env-fixture",
    runShell: async (script: string, options?: CommandOptions): Promise<CommandResult> => {
      calls.push({ script, options });
      return { stdout, stderr: "", exitCode: 0 };
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
});
