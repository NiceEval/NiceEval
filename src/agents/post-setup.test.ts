// cases: docs/engineering/testing/unit/sandbox.md
import { describe, expect, it } from "vitest";
import { createAgentSession } from "../context/session.ts";
import type { SandboxCommand } from "../sandbox/commands.ts";
import type { CommandResult, Sandbox } from "../sandbox/types.ts";
import type { AgentContext } from "./types.ts";
import { runPostSetupHooks, runPreTeardownHooks } from "./post-setup.ts";

const commandResult = (): CommandResult => ({ stdout: "", stderr: "", exitCode: 0 });

function sandbox(): Sandbox {
  return {
    workdir: "/workspace",
    sandboxId: "post-setup-test",
    otlpHost: null,
    async runCommand() { return commandResult(); },
    async runShell() { return commandResult(); },
    async runCommandOrThrow() { return { ...commandResult(), exitCode: 0 }; },
    async runShellOrThrow() { return { ...commandResult(), exitCode: 0 }; },
    async readText() { return ""; },
    async writeText() {},
    async readBytes() { return new Uint8Array(); },
    async writeBytes() {},
    async pathExists() { return false; },
    async uploadFile() {},
    async uploadDirectory() {},
    async downloadFile() {},
    async downloadDirectory() {},
    async stop() {},
  };
}

function context(): AgentContext {
  return {
    signal: new AbortController().signal,
    flags: {},
    experimentId: "compare/post-setup",
    evalId: "suite/example",
    attempt: { id: "suite/example", index: 2 },
    session: createAgentSession(),
    progress() {},
    diagnostic() {},
    fact() {},
    log() {},
  };
}

describe("agent postSetup SandboxCommand contract", () => {
  it("uses the narrow target and runs preTeardown plus registered cleanup in global LIFO order", async () => {
    const order: string[] = [];
    const phases: string[] = [];
    const setup = (label: string): SandboxCommand => async (target, ctx) => {
      order.push(label);
      phases.push(`${ctx.phase}:${ctx.owner.kind}:${ctx.owner.id}:${ctx.attempt.id}:${ctx.attempt.index}`);
      expect("stop" in target).toBe(false);
      expect("uploadFile" in target).toBe(false);
      ctx.onCleanup(async () => { order.push(`cleanup:${label}`); });
    };
    const teardown = (label: string): SandboxCommand => async (_target, ctx) => {
      order.push(label);
      ctx.onCleanup(async () => { order.push(`cleanup:${label}`); });
    };
    const sb = sandbox();
    const ctx = context();

    await runPostSetupHooks(sb, ctx, "fixture-agent", [setup("setup:one"), setup("setup:two")]);
    await runPreTeardownHooks(sb, ctx, "fixture-agent", [teardown("teardown:one"), teardown("teardown:two")]);
    await runPreTeardownHooks(sb, ctx, "fixture-agent", [teardown("not-run")]);

    expect(phases).toEqual([
      "agent.post-setup:agent:fixture-agent:suite/example:2",
      "agent.post-setup:agent:fixture-agent:suite/example:2",
    ]);
    expect(order).toEqual([
      "setup:one",
      "setup:two",
      "teardown:two",
      "teardown:one",
      "cleanup:teardown:one",
      "cleanup:teardown:two",
      "cleanup:setup:two",
      "cleanup:setup:one",
    ]);
  });

  it("continues the teardown chain after failures and consumes registered state", async () => {
    const order: string[] = [];
    const sb = sandbox();
    const setup: SandboxCommand = async (_target, ctx) => {
      ctx.onCleanup(async () => {
        order.push("cleanup:setup");
        throw new Error("cleanup failed");
      });
      throw new Error("setup failed");
    };
    const preTeardown: SandboxCommand[] = [
      async () => { order.push("teardown:first"); },
      async (_target, ctx) => {
        order.push("teardown:second");
        ctx.onCleanup(async () => { order.push("cleanup:teardown"); });
        throw new Error("teardown failed");
      },
    ];

    await expect(runPostSetupHooks(sb, context(), "fixture-agent", [setup])).rejects.toThrow("setup failed");
    await expect(runPreTeardownHooks(sb, context(), "fixture-agent", preTeardown))
      .rejects.toBeInstanceOf(AggregateError);
    expect(order).toEqual([
      "teardown:second",
      "teardown:first",
      "cleanup:teardown",
      "cleanup:setup",
    ]);

    await expect(runPreTeardownHooks(sb, context(), "fixture-agent", preTeardown)).resolves.toBeUndefined();
    expect(order).toHaveLength(4);
  });
});
