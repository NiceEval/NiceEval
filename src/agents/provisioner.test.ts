import { describe, expect, it } from "vitest";
import { Cause, Effect, Option } from "effect";
import { defineSandboxCommand } from "../sandbox/commands.ts";
import { SandboxCommandExitError } from "../sandbox/operations.ts";
import { registerSandboxContent } from "../sandbox/content.ts";
import type { CommandResult, SandboxOperations } from "../sandbox/types.ts";
import { AgentEnsureError, ArtifactPrepareCoordinator, runAgentEnsure } from "./provisioner.ts";
import type { AgentEnsure, AgentInstaller } from "./types.ts";

const result = (exitCode = 0, stdout = ""): CommandResult => ({ exitCode, stdout, stderr: "" });
const stagedArtifact = (platform: { readonly os: string; readonly arch: string; readonly libc?: string }) => ({
  platform,
  content: registerSandboxContent(new URL(import.meta.url)),
  targetPath: "$HOME/.niceeval-agent-payload/fixture.tgz",
  install: { kind: "npm-tarball" as const },
});
const sandbox: SandboxOperations = {
  workdir: "/work",
  async runShell() {
    return result(0, "Linux\nx86_64\nldd (GNU libc)\n");
  },
  async runCommand() { return result(); },
  async runShellOrThrow(script) {
    const command = await this.runShell(script);
    if (command.exitCode !== 0) throw new SandboxCommandExitError(command);
    return { ...command, exitCode: 0 };
  },
  async runCommandOrThrow(command, args, options) {
    const output = await this.runCommand(command, args, options);
    if (output.exitCode !== 0) throw new SandboxCommandExitError(output);
    return { ...output, exitCode: 0 };
  },
  async readText() { return ""; },
  async writeText() {},
  async readBytes() { return new Uint8Array(); },
  async writeBytes() {},
  async pathExists() { return false; },
};

const context = (coordinator = new ArtifactPrepareCoordinator()) => ({
  fact: () => {},
  coordinator: Option.some(coordinator),
  signal: new AbortController().signal,
  progress: () => {},
});

async function ensureFailure(effect: Effect.Effect<unknown, AgentEnsureError>): Promise<AgentEnsureError> {
  const exit = await Effect.runPromiseExit(effect);
  if (exit._tag === "Success") throw new Error("expected Agent Ensure to fail");
  return Option.getOrThrow(Cause.failureOption(exit.cause));
}

describe("Runner-owned Agent Ensure", () => {
  it("probe miss 只由精确 identity installer 安装，并复检同一 probe", async () => {
    let present = false;
    let installs = 0;
    const identity = { agent: "fixture", version: "1.0.0", revision: "1" } as const;
    const ensure: AgentEnsure = {
      identity,
      probe: defineSandboxCommand({ id: "fixture.probe", revision: "1", inputs: identity }, async () => {
        if (!present) throw new SandboxCommandExitError(result(1));
      }),
    };
    const installer: AgentInstaller = {
      identity,
      installMode: "sandbox-network",
      async install() {
        installs += 1;
        present = true;
      },
    };

    const facts: Array<[string, string | number | boolean]> = [];
    await Effect.runPromise(runAgentEnsure([ensure], [installer], sandbox, {
      ...context(),
      fact: (key, value) => { facts.push([key, value]); },
    }));
    expect(installs).toBe(1);
    expect(facts).toContainEqual(["agent.ensure", "installed"]);

    await Effect.runPromise(runAgentEnsure([ensure], [installer], sandbox, context()));
    expect(installs).toBe(1);
  });

  it("没有精确 identity installer 时不猜测近似版本", async () => {
    const ensure: AgentEnsure = {
      identity: { agent: "fixture", version: "1.0.0", revision: "1" },
      probe: defineSandboxCommand({ id: "fixture.probe", revision: "1", inputs: {} }, async () => {
        throw new SandboxCommandExitError(result(1));
      }),
    };
    const wrong: AgentInstaller = {
      identity: { agent: "fixture", version: "1.0.1", revision: "1" },
      installMode: "verify-only",
    };
    await expect(Effect.runPromise(runAgentEnsure([ensure], [wrong], sandbox, context()))).rejects.toThrow(/fixture/);
  });

  it("staged prepare 必须由目标平台显式给出，不再默认宿主平台", async () => {
    const coordinator = new ArtifactPrepareCoordinator();
    const installer: Extract<AgentInstaller, { installMode: "staged" }> = {
      identity: { agent: "fixture", version: "1.0.0", revision: "1" },
      installMode: "staged",
      prepareArtifact({ targetPlatform }) {
        return stagedArtifact(targetPlatform);
      },
      async install() {},
    };
    const artifact = await Effect.runPromise(coordinator.prepare(
      installer,
      { os: "linux", arch: "arm64", libc: "musl" },
      new AbortController().signal,
    ));
    expect(artifact.platform).toEqual({ os: "linux", arch: "arm64", libc: "musl" });
  });

  it("staged payload 只接受登记过的文件内容，不把伪造 digest 或宿主路径交给 Attempt", async () => {
    const identity = { agent: "fixture", version: "1.0.0", revision: "content" } as const;
    const installer: Extract<AgentInstaller, { installMode: "staged" }> = {
      identity,
      installMode: "staged",
      prepareArtifact({ targetPlatform }) {
        return {
          platform: targetPlatform,
          content: {
            kind: "file",
            digest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
          } as never,
          targetPath: "$HOME/.niceeval-agent-payload/fixture.tgz",
          install: { kind: "npm-tarball" },
        };
      },
      async install() {},
    };

    await expect(ensureFailure(new ArtifactPrepareCoordinator().prepare(
      installer,
      { os: "linux", arch: "x64", libc: "gnu" },
      new AbortController().signal,
    ))).resolves.toMatchObject({ reason: "artifact-invalid", phase: "installer", identity });
  });

  it("verify-only probe 未命中立即失败，不探平台也不尝试安装", async () => {
    let platformProbes = 0;
    const verifySandbox: SandboxOperations = {
      ...sandbox,
      async runShell() {
        platformProbes += 1;
        return result(0, "Linux\nx86_64\nldd (GNU libc)\n");
      },
    };
    const identity = { agent: "fixture", version: "1.0.0", revision: "verify" } as const;
    const ensure: AgentEnsure = {
      identity,
      probe: defineSandboxCommand({ id: "fixture.verify", revision: "1", inputs: identity }, async () => {
        throw new SandboxCommandExitError(result(1));
      }),
    };
    const installer: AgentInstaller = { identity, installMode: "verify-only" };

    const failure = await ensureFailure(runAgentEnsure([ensure], [installer], verifySandbox, context()));

    expect(failure).toBeInstanceOf(AgentEnsureError);
    expect(failure).toMatchObject({ reason: "verify-only", phase: "installer" });
    expect(platformProbes).toBe(0);
  });

  it("install 返回成功但同一 probe 复检仍未命中时归 recheck-missed", async () => {
    const identity = { agent: "fixture", version: "2.0.0", revision: "recheck" } as const;
    const ensure: AgentEnsure = {
      identity,
      probe: defineSandboxCommand({ id: "fixture.recheck", revision: "1", inputs: identity }, async () => {
        throw new SandboxCommandExitError(result(1));
      }),
    };
    const installer: AgentInstaller = {
      identity,
      installMode: "sandbox-network",
      async install() {},
    };

    await expect(ensureFailure(runAgentEnsure([ensure], [installer], sandbox, context())))
      .resolves.toMatchObject({ reason: "recheck-missed", phase: "recheck", identity });
  });

  it("probe transport failure 不是普通 miss，不调用 installer", async () => {
    let installs = 0;
    const identity = { agent: "fixture", version: "3.0.0", revision: "transport" } as const;
    const ensure: AgentEnsure = {
      identity,
      probe: defineSandboxCommand({ id: "fixture.transport", revision: "1", inputs: identity }, async () => {
        throw new Error("transport disconnected");
      }),
    };
    const installer: AgentInstaller = {
      identity,
      installMode: "sandbox-network",
      async install() {
        installs += 1;
      },
    };

    await expect(ensureFailure(runAgentEnsure([ensure], [installer], sandbox, context())))
      .resolves.toMatchObject({ reason: "probe-failed", phase: "probe", identity });
    expect(installs).toBe(0);
  });

  it("同 identity 与目标平台的 staged payload 在 Run 内 single-flight", async () => {
    let prepares = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const identity = { agent: "fixture", version: "4.0.0", revision: "single-flight" } as const;
    const installer: Extract<AgentInstaller, { installMode: "staged" }> = {
      identity,
      installMode: "staged",
      async prepareArtifact({ targetPlatform }) {
        prepares += 1;
        await gate;
        return stagedArtifact(targetPlatform);
      },
      async install() {},
    };
    const coordinator = new ArtifactPrepareCoordinator();
    const platform = { os: "linux", arch: "x64", libc: "gnu" } as const;
    const signal = new AbortController().signal;

    const first = Effect.runPromise(coordinator.prepare(installer, platform, signal));
    const second = Effect.runPromise(coordinator.prepare(installer, platform, signal));
    expect(prepares).toBe(1);
    release();

    const [a, b] = await Promise.all([first, second]);
    expect(a).toBe(b);
    expect(prepares).toBe(1);
  });
});
