// cases: docs/engineering/testing/unit/sandbox.md

import { describe, expect, it } from "vitest";
import { defineSandboxCommand, sandboxCommandIdentityOf, type SandboxCommandContext, type SandboxCommandTarget } from "./commands.ts";
import { SandboxCommandExitError } from "./operations.ts";
import { checkout, installTool } from "./prepare-commands.ts";
import type { CommandOptions, CommandResult } from "./types.ts";

const COMMIT = "9e107d9d372bb6826bd81d3542a419d6d6f4b2e9";

function result(exitCode = 0, stdout = ""): CommandResult {
  return { exitCode, stdout, stderr: "" };
}

function context(facts: Array<readonly [string, string | number | boolean]> = []): SandboxCommandContext {
  return {
    phase: "prepare",
    owner: { kind: "eval", id: "fixture/eval" },
    attempt: { id: "attempt-1", index: 0 },
    signal: new AbortController().signal,
    progress: () => {},
    diagnostic: () => {},
    facts: (key, value) => { facts.push([key, value]); },
    onCleanup: () => {},
  };
}

function checkoutTarget(repo: string): {
  readonly target: SandboxCommandTarget;
  readonly calls: Array<readonly [string, readonly string[]]>;
} {
  const calls: Array<readonly [string, readonly string[]]> = [];
  let mirrorReady = false;
  const runCommand = async (command: string, args: readonly string[] = []): Promise<CommandResult> => {
    calls.push([command, args]);
    if (command !== "git") return result();
    if (args.includes("--is-bare-repository")) return mirrorReady ? result(0, "true\n") : result(128);
    if (args.includes("get-url")) return mirrorReady ? result(0, `${repo}\n`) : result(2);
    if (args.includes("clone")) {
      mirrorReady = true;
      return result();
    }
    if (args.includes("rev-parse")) return mirrorReady ? result(0, `${COMMIT}\n`) : result(128);
    return result();
  };
  const target: SandboxCommandTarget = {
    workdir: "/work",
    runCommand,
    async runShell() { return result(); },
    async runCommandOrThrow(command: string, args: readonly string[] = [], _options?: CommandOptions) {
      const output = await runCommand(command, args);
      if (output.exitCode !== 0) throw new SandboxCommandExitError(output);
      return { ...output, exitCode: 0 as const };
    },
    async runShellOrThrow() { return { ...result(), exitCode: 0 as const }; },
    async readText() { return ""; },
    async writeText() {},
    async readBytes() { return new Uint8Array(); },
    async writeBytes() {},
    async pathExists() { return false; },
    async copyPath() {},
    async putContent() {},
  };
  return { target, calls };
}

describe("内置 prepare 命令", () => {
  it("checkout 以 repo/ref/into 固定 identity，在同一 Sandbox 的第二次调用复用 bare mirror", async () => {
    const repo = "https://github.com/acme/fixture-repo.git";
    const command = checkout({ repo, ref: COMMIT, into: "fixture" });
    expect(sandboxCommandIdentityOf(command)).toEqual({
      id: "niceeval.sandbox.checkout",
      revision: "1",
      inputs: { repo, ref: COMMIT, into: "fixture" },
    });

    const { target, calls } = checkoutTarget(repo);
    const facts: Array<readonly [string, string | number | boolean]> = [];
    await command(target, context(facts));
    const firstCloneCount = calls.filter(([name, args]) => name === "git" && args.includes("clone")).length;
    expect(firstCloneCount).toBe(1);
    expect(calls).toContainEqual(["git", ["-C", "/work/fixture", "checkout", "--quiet", "--force", "--detach", COMMIT]]);
    expect(facts).toEqual([[expect.stringMatching(/^sandbox\.checkout\.[0-9a-f]{16}\.commit$/), COMMIT]]);

    await command(target, context());
    const secondCloneCount = calls.filter(([name, args]) => name === "git" && args.includes("clone")).length;
    expect(secondCloneCount).toBe(1);
  });

  it("checkout 对缓存损坏或 remote 不匹配按首跑重建，而不是把错误缓存静默带入 workdir", async () => {
    const repo = "https://github.com/acme/fixture-repo.git";
    const { target, calls } = checkoutTarget(repo);
    await checkout({ repo, ref: COMMIT })(target, context());
    // Fake 中第二次现有 mirror 的 origin 与声明不同，因而必须重新 clone。
    const mismatchTarget = { ...target, runCommand: async (command: string, args: readonly string[] = []) => {
      if (command === "git" && args.includes("get-url")) return result(0, "https://github.com/acme/other.git\n");
      return target.runCommand(command, args);
    } } as SandboxCommandTarget;
    await checkout({ repo, ref: COMMIT })(mismatchTarget, context());
    expect(calls.filter(([name, args]) => name === "git" && args.includes("clone"))).toHaveLength(2);
  });

  it("checkout 在动态 JS 输入边界拒绝嵌入凭据、越界目录和未知字段", () => {
    expect(() => checkout({ repo: "https://token@example.com/acme/private.git", ref: COMMIT })).toThrow(/must not embed credentials/);
    expect(() => checkout({ repo: "https://github.com/acme/repo.git", ref: COMMIT, into: "../outside" })).toThrow(/must not escape/);
    expect(() => checkout({ repo: "https://github.com/acme/repo.git", ref: "" })).toThrow(/non-empty string/);
    expect(() => checkout({ repo: "https://github.com/acme/repo.git", ref: COMMIT, extra: true } as never)).toThrow(/extra is not supported/);
  });

  it("installTool probe 命中时不安装，未命中恰好安装一次并以同一 probe 复检", async () => {
    let installed = false;
    let probes = 0;
    let installs = 0;
    const probe = defineSandboxCommand({ id: "fixture.probe", revision: "1", inputs: { version: "1.2.3" } }, async () => {
      probes += 1;
      if (!installed) throw new SandboxCommandExitError(result(1));
    });
    const install = defineSandboxCommand({ id: "fixture.install", revision: "1", inputs: { version: "1.2.3" } }, async () => {
      installs += 1;
      installed = true;
    });
    const command = installTool({ tool: "fixture", identity: { version: "1.2.3" }, probe, install });
    expect(sandboxCommandIdentityOf(command)).toEqual({
      id: "niceeval.sandbox.install-tool",
      revision: "1",
      inputs: {
        tool: "fixture",
        identity: { version: "1.2.3" },
        probe: { id: "fixture.probe", revision: "1", inputs: { version: "1.2.3" } },
        install: { id: "fixture.install", revision: "1", inputs: { version: "1.2.3" } },
      },
    });

    const { target } = checkoutTarget("https://github.com/acme/fixture-repo.git");
    await command(target, context());
    expect({ probes, installs }).toEqual({ probes: 2, installs: 1 });
    await command(target, context());
    expect({ probes, installs }).toEqual({ probes: 3, installs: 1 });
  });

  it("installTool 复检仍未命中与 probe 的 transport failure 都不会伪装成成功", async () => {
    let installs = 0;
    const alwaysMiss = defineSandboxCommand({ id: "fixture.miss", revision: "1", inputs: {} }, async () => {
      throw new SandboxCommandExitError(result(1));
    });
    const install = defineSandboxCommand({ id: "fixture.install", revision: "1", inputs: {} }, async () => { installs += 1; });
    const { target } = checkoutTarget("https://github.com/acme/fixture-repo.git");
    await expect(installTool({ tool: "fixture", identity: {}, probe: alwaysMiss, install })(target, context()))
      .rejects.toThrow(/probe still did not pass/);
    expect(installs).toBe(1);

    let transportInstalls = 0;
    const transport = defineSandboxCommand({ id: "fixture.transport", revision: "1", inputs: {} }, async () => {
      throw new Error("connection dropped");
    });
    const neverRun = defineSandboxCommand({ id: "fixture.never", revision: "1", inputs: {} }, async () => { transportInstalls += 1; });
    await expect(installTool({ tool: "fixture", identity: {}, probe: transport, install: neverRun })(target, context()))
      .rejects.toThrow(/connection dropped/);
    expect(transportInstalls).toBe(0);
  });

  it("installTool 在动态 JS 输入边界只接受 stable probe/install，并把其 identity 纳入 identity", () => {
    const stable = defineSandboxCommand({ id: "fixture", revision: "1", inputs: {} }, async () => {});
    expect(() => installTool({ tool: "fixture", identity: {}, probe: async () => {}, install: stable } as never)).toThrow(/must be a StableSandboxCommand/);
    expect(() => installTool({ tool: "fixture", identity: undefined as never, probe: stable, install: stable })).toThrow(/pure identity data/);
    expect(() => installTool({ tool: "fixture", identity: {}, probe: stable, install: stable, extra: true } as never)).toThrow(/extra is not supported/);
  });
});
