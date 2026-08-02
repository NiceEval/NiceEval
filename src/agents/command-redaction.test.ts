// cases: docs/engineering/testing/unit/adapters.md
// bug: memory/command-evidence-known-secret-redaction.md
import { describe, expect, it } from "vitest";
import type { CommandOptions, CommandResult, Sandbox, SandboxAgentSetupContext } from "../types.ts";
import { codexAgent } from "./codex.ts";
import { claudeCodeAgent } from "./claude-code.ts";
import { hermesAgent } from "./hermes.ts";
import { openClawAgent } from "./openclaw.ts";

interface ShellCall {
  readonly script: string;
  readonly options?: CommandOptions;
}

function setupFixture(): {
  sandbox: Sandbox;
  context: SandboxAgentSetupContext;
  calls: ShellCall[];
} {
  const calls: ShellCall[] = [];
  const success = (): CommandResult => ({ stdout: "", stderr: "", exitCode: 0 });
  const sandbox = {
    workdir: "/workspace",
    sandboxId: "synthetic-redaction-fixture",
    runShell: async (script: string, options?: CommandOptions) => {
      calls.push({ script, options });
      return success();
    },
  } as unknown as Sandbox;
  const context = {
    sandbox,
    signal: new AbortController().signal,
    flags: {},
    session: {},
    progress() {},
    diagnostic() {},
    fact() {},
    log() {},
    reportSetup() {},
  } as unknown as SandboxAgentSetupContext;
  return { sandbox, context, calls };
}

async function runSetup(
  agent: ReturnType<typeof codexAgent>,
  sandbox: Sandbox,
  context: SandboxAgentSetupContext,
): Promise<void> {
  if (agent.kind !== "sandbox") throw new Error("fixture requires a sandbox agent");
  await agent.setup?.(sandbox, context);
}

function expectSensitiveCall(calls: readonly ShellCall[], value: string): void {
  const call = calls.find((entry) => entry.script.includes(value));
  expect(call, "setup 应执行含合成敏感值的原始配置命令").toBeDefined();
  expect(call?.options?.sensitiveValues).toContain(value);
}

describe("官方 adapter 的命令证据敏感值 provenance", () => {
  it("Codex/Claude MCP 的 HTTP header 与 stdio env 值随实际配置命令登记", async () => {
    const header = "Bearer synthetic-http-header-for-test";
    const envValue = "synthetic-stdio-env-for-test";

    for (const agent of [
      codexAgent({
        mcpServers: [
          { name: "remote", url: "https://mcp.example.test", headers: { Authorization: header } },
          { name: "local", command: "node", env: { MCP_TOKEN: envValue } },
        ],
      }),
      claudeCodeAgent({
        mcpServers: [
          { name: "remote", url: "https://mcp.example.test", headers: { Authorization: header } },
          { name: "local", command: "node", env: { MCP_TOKEN: envValue } },
        ],
      }),
    ]) {
      const fixture = setupFixture();
      await runSetup(agent, fixture.sandbox, fixture.context);
      expectSensitiveCall(fixture.calls, header);
      expectSensitiveCall(fixture.calls, envValue);
    }
  });

  it("Hermes/OpenClaw 写入模型凭据的 heredoc 同时登记同一已知值", async () => {
    const apiKey = "synthetic-model-api-key-for-test";
    for (const agent of [
      hermesAgent({ apiKey, baseUrl: "https://model.example.test" }),
      openClawAgent({ apiKey, baseUrl: "https://model.example.test" }),
    ]) {
      const fixture = setupFixture();
      await runSetup(agent, fixture.sandbox, fixture.context);
      expectSensitiveCall(fixture.calls, apiKey);
    }
  });
});
