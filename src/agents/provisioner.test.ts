import { describe, expect, it } from "vitest";
import { defineSandboxCommand } from "../sandbox/commands.ts";
import type { Sandbox } from "../sandbox/types.ts";
import { ArtifactPrepareCoordinator, runAgentEnsure } from "./provisioner.ts";
import type { AgentEnsure, AgentInstaller } from "./types.ts";

const sandbox = {
  workdir: "/work",
  sandboxId: "ensure-fixture",
  otlpHost: null,
  async runShell() {
    return { exitCode: 0, stdout: "Linux\nx86_64\nldd (GNU libc)\n", stderr: "" };
  },
} as unknown as Sandbox;

describe("Runner-owned Agent Ensure", () => {
  it("probe miss 只由精确 identity installer 安装，并复检同一 probe", async () => {
    let present = false;
    let installs = 0;
    const identity = { agent: "fixture", version: "1.0.0", revision: "1" } as const;
    const ensure: AgentEnsure = {
      identity,
      probe: defineSandboxCommand({ id: "fixture.probe", revision: "1", inputs: identity }, async () => {
        if (!present) throw new Error("missing");
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
    await runAgentEnsure([ensure], [installer], sandbox, { fact: (key, value) => facts.push([key, value]) });
    expect(installs).toBe(1);
    expect(facts).toContainEqual(["agent.ensure", "installed"]);

    await runAgentEnsure([ensure], [installer], sandbox);
    expect(installs).toBe(1);
  });

  it("没有精确 identity installer 时不猜测近似版本", async () => {
    const ensure: AgentEnsure = {
      identity: { agent: "fixture", version: "1.0.0", revision: "1" },
      probe: defineSandboxCommand({ id: "fixture.probe", revision: "1", inputs: {} }, async () => {
        throw new Error("missing");
      }),
    };
    const wrong: AgentInstaller = {
      identity: { agent: "fixture", version: "1.0.1", revision: "1" },
      installMode: "verify-only",
    };
    await expect(runAgentEnsure([ensure], [wrong], sandbox)).rejects.toThrow(/fixture/);
  });

  it("staged prepare 必须由目标平台显式给出，不再默认宿主平台", async () => {
    const coordinator = new ArtifactPrepareCoordinator();
    const installer: Extract<AgentInstaller, { installMode: "staged" }> = {
      identity: { agent: "fixture", version: "1.0.0", revision: "1" },
      installMode: "staged",
      async prepareArtifact(platform) {
        return { digest: "digest", platform, localPath: "/tmp/payload" };
      },
      async install() {},
    };
    const artifact = await coordinator.prepare(installer, { os: "linux", arch: "arm64", libc: "musl" });
    expect(artifact.platform).toEqual({ os: "linux", arch: "arm64", libc: "musl" });
  });
});
