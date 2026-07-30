// cases: docs/engineering/testing/unit/adapters.md
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Sandbox } from "../sandbox/types.ts";
import {
  AGENT_ARTIFACT_PREPARE_ACTIVITY,
  AGENT_ENSURE_FACT,
  AGENT_VERSION_ACTUAL_FACT,
  ArtifactPrepareCoordinator,
  agentInstallIdentityInput,
  assertStableAgentIdentity,
  defineAgentProvisioner,
  ensureAgent,
} from "./provisioner.ts";
import type {
  AgentArtifactPlatform,
  AgentCheckResult,
  AgentProvisioner,
  AgentStagedArtifact,
} from "./types.ts";

type FactEntry = { key: string; value: string | number | boolean };

function scriptedProvisioner(steps: {
  identity?: { agent: string; version: string; revision: string };
  mode?: AgentProvisioner["mode"];
  check: readonly AgentCheckResult[];
  install?: (sandbox: Sandbox, artifact?: AgentStagedArtifact) => Promise<void>;
  prepare?: (platform: AgentArtifactPlatform) => Promise<AgentStagedArtifact>;
}): AgentProvisioner & { checks: Sandbox[]; installs: number; prepares: number } {
  const state = { checks: [] as Sandbox[], installs: 0, prepares: 0 };
  const provisioner = defineAgentProvisioner({
    identity: steps.identity ?? { agent: "fixture", version: "1.0.0", revision: "r1" },
    mode: steps.mode,
    async check(sandbox) {
      state.checks.push(sandbox);
      const hit = steps.check[state.checks.length - 1];
      if (hit === undefined) throw new Error("unexpected check");
      return hit;
    },
    async install(sandbox, artifact) {
      state.installs += 1;
      if (steps.install === undefined) throw new Error("unexpected install");
      await steps.install(sandbox, artifact);
    },
    prepare: steps.prepare
      ? async (platform) => {
          state.prepares += 1;
          return steps.prepare!(platform);
        }
      : undefined,
  });
  return Object.defineProperties(provisioner, {
    checks: { get: () => state.checks },
    installs: { get: () => state.installs },
    prepares: { get: () => state.prepares },
  }) as AgentProvisioner & { checks: Sandbox[]; installs: number; prepares: number };
}

function recordingSandbox(opts?: {
  network?: { dns: string; extraHosts: string[] };
  onUpload?: (path: string, content: Buffer) => void;
  onShell?: (script: string) => { stdout: string; stderr: string; exitCode: number } | void;
}): Sandbox & {
  shells: string[];
  uploads: Array<{ path: string; bytes: number }>;
  network: { dns: string; extraHosts: string[] };
} {
  const network = {
    dns: opts?.network?.dns ?? "192.0.2.1",
    extraHosts: opts?.network?.extraHosts ?? ["broken.example:127.0.0.1"],
  };
  const shells: string[] = [];
  const uploads: Array<{ path: string; bytes: number }> = [];
  const unexpected = (name: string) => {
    throw new Error(`unexpected call: ${name}`);
  };
  return {
    workdir: "/work",
    sandboxId: "sbx-ensure-1",
    otlpHost: null,
    network,
    shells,
    uploads,
    runCommand: async () => unexpected("runCommand"),
    runShell: async (script) => {
      shells.push(script);
      const scripted = opts?.onShell?.(script);
      if (scripted) return scripted;
      if (script.includes('printf \'%s\' "$HOME"') || script.includes("printf '%s' \"$HOME\"")) {
        return { stdout: "/home/node", stderr: "", exitCode: 0 };
      }
      // Ensure 在 prepare 之前探测**沙箱**平台(不是宿主)。
      if (script.includes("uname -s")) {
        return { stdout: "Linux\nx86_64\nldd (Ubuntu GLIBC 2.39) 2.39\n", stderr: "", exitCode: 0 };
      }
      if (script.startsWith("mkdir -p")) return { stdout: "", stderr: "", exitCode: 0 };
      throw new Error(`unexpected call: runShell(${script.slice(0, 80)})`);
    },
    readFile: async () => unexpected("readFile"),
    fileExists: async () => unexpected("fileExists"),
    writeFiles: async () => unexpected("writeFiles"),
    uploadFiles: async () => unexpected("uploadFiles"),
    uploadDirectory: async () => unexpected("uploadDirectory"),
    stop: async () => unexpected("stop"),
    downloadFile: async () => unexpected("downloadFile"),
    uploadFile: async (path, content) => {
      uploads.push({ path, bytes: content.length });
      opts?.onUpload?.(path, content);
    },
    downloadDirectory: async () => unexpected("downloadDirectory"),
  };
}

function snapshotNetwork(sandbox: { network: { dns: string; extraHosts: string[] } }) {
  return JSON.stringify(sandbox.network);
}

describe("Ensure 检查命中、staged 安装、复检失败", () => {
  it("检查通过 → 记录检查命中的安装事实，不调用 install", async () => {
    const facts: FactEntry[] = [];
    const sandbox = recordingSandbox();
    const beforeNet = snapshotNetwork(sandbox);
    const provisioner = scriptedProvisioner({
      mode: "verifyOnly",
      check: [{ ok: true, actualVersion: "1.0.0" }],
    });

    const result = await ensureAgent(provisioner, sandbox, {
      fact: (key, value) => facts.push({ key, value }),
    });

    expect(result.outcome).toBe("hit");
    expect(provisioner.installs).toBe(0);
    expect(provisioner.checks).toHaveLength(1);
    expect(facts).toEqual([
      { key: AGENT_ENSURE_FACT, value: "hit" },
      { key: AGENT_VERSION_ACTUAL_FACT, value: "1.0.0" },
    ]);
    expect(snapshotNetwork(sandbox)).toBe(beforeNet);
  });

  it("检查失败 → staged install（经文件 API）→ 同一 check 复检", async () => {
    const dir = await mkdtemp(join(tmpdir(), "niceeval-ensure-"));
    const localPath = join(dir, "payload.tgz");
    await writeFile(localPath, "staged-bytes");
    const artifact: AgentStagedArtifact = {
      digest: "abc",
      platform: { os: "linux", arch: "x64" },
      localPath,
      sandboxPath: "/home/node/.niceeval-agent-payload/fixture.tgz",
    };
    const facts: FactEntry[] = [];
    const sandbox = recordingSandbox();
    const beforeNet = snapshotNetwork(sandbox);
    const provisioner = scriptedProvisioner({
      mode: "staged",
      check: [
        { ok: false, detail: "missing" },
        { ok: true, actualVersion: "1.0.0" },
      ],
      prepare: async () => artifact,
      install: async (sb, prepared) => {
        expect(prepared?.localPath).toBe(localPath);
        await sb.uploadFile(prepared!.sandboxPath!, Buffer.from("staged-bytes"));
      },
    });

    const result = await ensureAgent(provisioner, sandbox, {
      fact: (key, value) => facts.push({ key, value }),
      prepared: artifact,
    });

    expect(result.outcome).toBe("installed");
    expect(provisioner.installs).toBe(1);
    expect(provisioner.checks).toHaveLength(2);
    expect(sandbox.uploads).toEqual([{ path: artifact.sandboxPath, bytes: "staged-bytes".length }]);
    expect(facts.map((f) => f.key)).toEqual([AGENT_ENSURE_FACT, AGENT_VERSION_ACTUAL_FACT]);
    expect(facts[0]?.value).toBe("installed");
    expect(snapshotNetwork(sandbox)).toBe(beforeNet);
  });

  it("安装退出 0、复检仍失败 → agent.setup errored，附期望/实际", async () => {
    const provisioner = scriptedProvisioner({
      mode: "sandbox-network",
      check: [
        { ok: false, detail: "missing" },
        { ok: false, actualVersion: "0.9.0", detail: "version mismatch" },
      ],
      install: async () => {},
    });

    await expect(ensureAgent(provisioner, recordingSandbox())).rejects.toThrow(
      /phase=recheck[\s\S]*expected 1\.0\.0[\s\S]*actual 0\.9\.0/,
    );
  });

  it("verifyOnly 检查失败立即 errored，不联网、不改文件系统", async () => {
    const sandbox = recordingSandbox();
    const provisioner = scriptedProvisioner({
      mode: "verifyOnly",
      check: [{ ok: false, detail: "missing bin" }],
      install: async () => {
        throw new Error("should not install");
      },
    });

    await expect(ensureAgent(provisioner, sandbox)).rejects.toThrow(/phase=verifyOnly/);
    expect(provisioner.installs).toBe(0);
    expect(sandbox.uploads).toEqual([]);
    expect(sandbox.shells).toEqual([]);
  });

  it("三种安装模式失败后不静默降级到另一种", async () => {
    const verifyOnly = scriptedProvisioner({
      mode: "verifyOnly",
      check: [{ ok: false, detail: "missing" }],
      install: async () => {},
    });
    await expect(ensureAgent(verifyOnly, recordingSandbox())).rejects.toThrow(/verifyOnly/);
    expect(verifyOnly.installs).toBe(0);

    const staged = scriptedProvisioner({
      mode: "staged",
      check: [{ ok: false, detail: "missing" }],
      prepare: async () => {
        throw new Error("prepare boom");
      },
      install: async () => {},
    });
    await expect(ensureAgent(staged, recordingSandbox())).rejects.toThrow(/prepare boom/);
    expect(staged.installs).toBe(0);
  });
});

describe("Agent identity / artifact identity", () => {
  it("identity 与制品 digest/platform 正交进入指纹投影", () => {
    const identity = { agent: "codex", version: "0.144.1", revision: "2" };
    const base = agentInstallIdentityInput(identity);
    const withArtifact = agentInstallIdentityInput(identity, {
      digest: "deadbeef",
      platform: { os: "linux", arch: "x64", libc: "gnu" },
    });
    expect(base).toEqual({ agent: "codex", version: "0.144.1", revision: "2" });
    expect(withArtifact.artifactDigest).toBe("deadbeef");
    expect(withArtifact.artifactPlatform).toBe("linux-x64-gnu");
    expect(Object.keys(withArtifact).sort()).toEqual(
      ["agent", "artifactDigest", "artifactPlatform", "revision", "version"].sort(),
    );
  });

  it("无精确版本的 latest 安装启动期报错", () => {
    expect(() => assertStableAgentIdentity({ agent: "codex", version: "latest", revision: "1" })).toThrow(
      /exact pin|精确版本/,
    );
    expect(() =>
      defineAgentProvisioner({
        identity: { agent: "codex", version: "latest", revision: "1" },
        mode: "verifyOnly",
        check: async () => ({ ok: true }),
        install: async () => {},
      }),
    ).toThrow(/exact pin|精确版本/);
  });

  it("实际版本落 attempt facts，不能替代规划期指纹", async () => {
    const facts: FactEntry[] = [];
    const identity = { agent: "fixture", version: "1.0.0", revision: "r1" };
    const provisioner = scriptedProvisioner({
      identity,
      mode: "verifyOnly",
      check: [{ ok: true, actualVersion: "1.0.0-runtime" }],
    });
    await ensureAgent(provisioner, recordingSandbox(), {
      fact: (key, value) => facts.push({ key, value }),
    });
    const planned = agentInstallIdentityInput(identity);
    expect(planned.version).toBe("1.0.0");
    expect(facts).toContainEqual({ key: AGENT_VERSION_ACTUAL_FACT, value: "1.0.0-runtime" });
    expect(planned.version).not.toBe(facts.find((f) => f.key === AGENT_VERSION_ACTUAL_FACT)?.value);
  });
});

describe("断网题不改网络", () => {
  it("故障 DNS / extra_hosts 在 Ensure 前后逐字保持；staged 只经文件 API", async () => {
    const dir = await mkdtemp(join(tmpdir(), "niceeval-ensure-net-"));
    const localPath = join(dir, "a.tgz");
    await writeFile(localPath, "x");
    const artifact: AgentStagedArtifact = {
      digest: "d",
      platform: { os: "linux", arch: "arm64" },
      localPath,
      sandboxPath: "/tmp/a.tgz",
    };
    const sandbox = recordingSandbox({
      network: { dns: "192.0.2.1", extraHosts: ["bad:10.0.0.1"] },
    });
    const before = snapshotNetwork(sandbox);
    const provisioner = scriptedProvisioner({
      mode: "staged",
      check: [{ ok: false }, { ok: true, actualVersion: "1.0.0" }],
      prepare: async () => artifact,
      install: async (sb, prepared) => {
        await sb.uploadFile(prepared!.sandboxPath!, Buffer.from("x"));
      },
    });

    await ensureAgent(provisioner, sandbox, { prepared: artifact });
    expect(snapshotNetwork(sandbox)).toBe(before);
    expect(sandbox.uploads).toHaveLength(1);
    expect(sandbox.shells.every((s) => !/dns|extra_hosts|apt|curl/i.test(s))).toBe(true);
  });

  it("删除 staged 路径后同类题失败在 agent.setup", async () => {
    const provisioner = scriptedProvisioner({
      mode: "staged",
      check: [{ ok: false, detail: "missing" }],
      prepare: async () => {
        throw new Error("staged path removed");
      },
      install: async () => {
        throw new Error("should not reach install without artifact");
      },
    });
    await expect(ensureAgent(provisioner, recordingSandbox())).rejects.toThrow(/staged path removed/);
    expect(provisioner.installs).toBe(0);
  });
});

describe("Sandbox 复用命中与 environment 隔离", () => {
  it("第一次安装后第二次 ensure 只 check 命中", async () => {
    let present = false;
    const checks: boolean[] = [];
    const provisioner = defineAgentProvisioner({
      identity: { agent: "fixture", version: "1.0.0", revision: "r1" },
      mode: "sandbox-network",
      check: async () => {
        checks.push(present);
        return present ? { ok: true, actualVersion: "1.0.0" } : { ok: false, detail: "missing" };
      },
      install: async () => {
        present = true;
      },
    });
    const sandbox = recordingSandbox();

    const first = await ensureAgent(provisioner, sandbox);
    const second = await ensureAgent(provisioner, sandbox);
    expect(first.outcome).toBe("installed");
    expect(second.outcome).toBe("hit");
    expect(checks).toEqual([false, true, true]);
  });

  it("不同 identity 的 prepare cache 不串组；同 key single-flight", async () => {
    const activities: string[] = [];
    const timing = {
      async activity<T>(key: string, _attrs: unknown, run: () => Promise<T>): Promise<T> {
        activities.push(key);
        return run();
      },
    };
    const coordinator = new ArtifactPrepareCoordinator(timing);
    const dir = await mkdtemp(join(tmpdir(), "niceeval-art-"));
    await mkdir(dir, { recursive: true });
    const localA = join(dir, "a.tgz");
    const localB = join(dir, "b.tgz");
    await writeFile(localA, "a");
    await writeFile(localB, "b");

    let prepareA = 0;
    const a = defineAgentProvisioner({
      identity: { agent: "codex", version: "1.0.0", revision: "1" },
      mode: "staged",
      check: async () => ({ ok: true, actualVersion: "1.0.0" }),
      install: async () => {},
      prepare: async (platform) => {
        prepareA += 1;
        return { digest: "a", platform, localPath: localA };
      },
    });
    const b = defineAgentProvisioner({
      identity: { agent: "codex", version: "2.0.0", revision: "1" },
      mode: "staged",
      check: async () => ({ ok: true, actualVersion: "2.0.0" }),
      install: async () => {},
      prepare: async (platform) => ({ digest: "b", platform, localPath: localB }),
    });

    const platform = { os: "linux", arch: "x64" } satisfies AgentArtifactPlatform;
    const [one, two, other] = await Promise.all([
      coordinator.prepare(a, platform),
      coordinator.prepare(a, platform),
      coordinator.prepare(b, platform),
    ]);
    expect(one).toBe(two);
    expect(prepareA).toBe(1);
    expect(other.digest).toBe("b");
    expect(activities.every((k) => k === AGENT_ARTIFACT_PREPARE_ACTIVITY)).toBe(true);
  });
});

describe("Agent Ensure · 目标平台与自带运行时制品", () => {
  it("prepare 拿到的是沙箱平台，不是宿主平台", async () => {
    const seen: AgentArtifactPlatform[] = [];
    const provisioner = defineAgentProvisioner({
      identity: { agent: "codex", version: "1.0.0", revision: "1" },
      mode: "staged",
      check: (() => {
        let n = 0;
        return async () => (n++ === 0 ? { ok: false, detail: "missing" } : { ok: true, actualVersion: "1.0.0" });
      })(),
      install: async () => {},
      prepare: async (platform) => {
        seen.push(platform);
        return { digest: "d", platform, localPath: "/dev/null" };
      },
    });
    const sandbox = recordingSandbox({
      onShell: (script) =>
        script.includes("uname -s")
          ? { stdout: "Linux\naarch64\nmusl libc (aarch64)\n", stderr: "", exitCode: 0 }
          : undefined,
    });

    await ensureAgent(provisioner, sandbox, { coordinator: new ArtifactPrepareCoordinator() });

    expect(seen).toEqual([{ os: "linux", arch: "arm64", libc: "musl" }]);
  });

  it("self-contained 制品解压 + 链接安装，沙箱里不需要 npm", async () => {
    const dir = await mkdtemp(join(tmpdir(), "niceeval-selfcontained-"));
    const localPath = join(dir, "codex-native.tgz");
    await writeFile(localPath, "tarball-bytes");

    const scripts: string[] = [];
    const sandbox = recordingSandbox({
      onShell: (script) => {
        scripts.push(script);
        if (script.includes("uname -s")) {
          return { stdout: "Linux\nx86_64\nldd (GNU libc) 2.39\n", stderr: "", exitCode: 0 };
        }
        if (script.includes("command -v npm")) throw new Error("must not probe npm for self-contained artifacts");
        if (script.includes("tar -xzf")) return { stdout: "", stderr: "", exitCode: 0 };
        if (script.includes("SRC=")) return { stdout: "", stderr: "", exitCode: 0 };
        return undefined;
      },
    });

    const { createNpmCliProvisioner } = await import("./npm-staged.ts");
    let checked = 0;
    const provisioner = createNpmCliProvisioner({
      identity: { agent: "codex", version: "1.0.0", revision: "1" },
      packageName: "@openai/codex",
      bin: "codex",
      platformPackage: () => ({ spec: "@openai/codex@1.0.0-linux-x64", binPath: "vendor/x86_64-unknown-linux-musl/bin/codex" }),
      prepare: async (platform) => ({
        digest: (await import("./provisioner.ts")).sha256Hex("tarball-bytes"),
        platform,
        localPath,
        install: { kind: "self-contained", binPath: "vendor/x86_64-unknown-linux-musl/bin/codex" },
      }),
    });
    // check：第一次未命中触发安装，第二次命中
    const original = provisioner.check.bind(provisioner);
    const patched: AgentProvisioner = {
      ...provisioner,
      check: async (sb) => (checked++ === 0 ? { ok: false, detail: "missing" } : { ok: true, actualVersion: "1.0.0" }),
    };
    void original;

    await ensureAgent(patched, sandbox, { coordinator: new ArtifactPrepareCoordinator() });

    const extract = scripts.find((s) => s.includes("tar -xzf"));
    expect(extract).toBeDefined();
    expect(extract).toContain("--strip-components=1");
    expect(extract).toContain("vendor/x86_64-unknown-linux-musl/bin/codex");
    expect(scripts.some((s) => s.includes("npm install -g"))).toBe(false);
  });
});
