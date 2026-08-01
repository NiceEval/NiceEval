// cases: docs/engineering/testing/unit/sandbox.md
// 覆盖类别:
// - sandbox case 五类(预制单 Sandbox / 自定义 case 的 identity·services·group keep·detached)
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineSandbox, dockerSandbox, e2bSandbox, localSandbox, vercelSandbox } from "../define.ts";
import {
  assertKeepAllowedForCase,
  clearCustomGroupKeepRegistry,
  createMaterializedCase,
  defineSandboxCase,
  destroyCustomGroupKeep,
  lookupCustomGroupKeep,
  planSandboxCase,
  prebuiltProductSlotsOf,
  specWithPrebuiltProduct,
  wakeCustomGroupKeep,
} from "./index.ts";
import type { CommandResult, Sandbox } from "./types.ts";

function stubSandbox(id = "sb-1"): Sandbox {
  return {
    workdir: "/home/sandbox/workspace",
    sandboxId: id,
    otlpHost: null,
    async runCommand() {
      return { stdout: "", stderr: "", exitCode: 0 };
    },
    async runShell() {
      return { stdout: "", stderr: "", exitCode: 0 };
    },
    async runCommandOrThrow() {
      return { stdout: "", stderr: "", exitCode: 0 };
    },
    async runShellOrThrow() {
      return { stdout: "", stderr: "", exitCode: 0 };
    },
    async readText() {
      return "";
    },
    async readBytes() {
      return new Uint8Array();
    },
    async writeText() {},
    async writeBytes() {},
    async pathExists() {
      return false;
    },
    async uploadDirectory() {},
    async downloadFile() {},
    async uploadFile() {},
    async downloadDirectory() {},
    async stop() {},
  };
}

afterEach(() => {
  clearCustomGroupKeepRegistry();
});

describe("预制单 Sandbox 产物槽位(旧路径严格子集)", () => {
  it("Docker image / E2B template / Vercel snapshot / Local dir 各自映射到 create 槽位", () => {
    const docker = planSandboxCase({
      evalId: "py",
      environment: "python-3.9",
      spec: dockerSandbox({
        image: "node:24-slim",
        environments: { "python-3.9": { image: "acme/py39" } },
      }),
    });
    expect(docker.status).toBe("ready");
    if (docker.status !== "ready") return;
    expect(prebuiltProductSlotsOf(docker.plan)).toEqual({ image: "acme/py39" });
    expect(specWithPrebuiltProduct(dockerSandbox({ image: "node:24-slim" }), docker.plan)).toMatchObject({
      provider: "docker",
      image: "acme/py39",
    });

    const e2b = planSandboxCase({
      evalId: "py",
      environment: "python-3.9",
      spec: e2bSandbox({
        template: "base",
        environments: { "python-3.9": { template: "acme/py39" } },
      }),
    });
    expect(e2b.status).toBe("ready");
    if (e2b.status !== "ready") return;
    expect(prebuiltProductSlotsOf(e2b.plan)).toEqual({ template: "acme/py39" });

    const vercel = planSandboxCase({
      evalId: "py",
      environment: "snap-a",
      spec: vercelSandbox({
        snapshotId: "snap_base",
        environments: { "snap-a": { snapshotId: "snap_a" } },
      }),
    });
    expect(vercel.status).toBe("ready");
    if (vercel.status !== "ready") return;
    expect(prebuiltProductSlotsOf(vercel.plan)).toEqual({ snapshotId: "snap_a" });

    const local = planSandboxCase({
      evalId: "local",
      spec: localSandbox({ dir: "/tmp/workdir" }),
    });
    expect(local.status).toBe("ready");
    if (local.status !== "ready") return;
    expect(prebuiltProductSlotsOf(local.plan)).toEqual({ dir: "/tmp/workdir" });
  });

  it("Compose / build 判别键不得浅覆盖进 create 路径", () => {
    const compose = planSandboxCase({
      evalId: "tb",
      environment: "tb-sheets",
      spec: dockerSandbox({
        environments: { "tb-sheets": { compose: { file: "c.yaml", mainService: "client" } } },
      }),
    });
    expect(compose.status).toBe("ready");
    if (compose.status !== "ready") return;
    expect(prebuiltProductSlotsOf(compose.plan)).toBeUndefined();
    expect(() => specWithPrebuiltProduct(dockerSandbox(), compose.plan)).toThrow(/refuse to shallow-merge/);

    const build = planSandboxCase({
      evalId: "tb",
      environment: "tb-debug",
      spec: dockerSandbox({
        environments: { "tb-debug": { build: { context: "." } } },
      }),
    });
    expect(build.status).toBe("ready");
    if (build.status !== "ready") return;
    expect(prebuiltProductSlotsOf(build.plan)).toBeUndefined();
  });
});

describe("createMaterializedCase 单实例与自定义", () => {
  it("Local 基础产物经 materializePlannedCase 产出 primary-only 资源组", async () => {
    const dir = await mkdtemp(join(tmpdir(), "niceeval-single-case-"));
    try {
      const materialized = await createMaterializedCase({
        evalId: "local/basic",
        sandbox: localSandbox({ dir }),
      });
      expect(materialized.caseKind).toBe("prebuilt");
      expect(materialized.sandbox.workdir).toBe(dir);
      expect(materialized.group.primary.sandboxId).toBe(materialized.sandbox.sandboxId);
      expect(materialized.group.resources).toMatchObject({ kind: "primary-only" });
      expect(materialized.services).toBeUndefined();
      await materialized.group.stop();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("自定义 case:services 能力兑现 + group-keep 进程内 detached destroy", async () => {
    const primary = stubSandbox("main-pod");
    let destroyed = false;
    const resources = { namespace: "eval-ns", rev: 1 };
    const custom = defineSandboxCase({
      identity: { kind: "kubernetes", cluster: "eval-prod", manifestDigest: "sha256:abc" },
      capabilities: ["services", "group-keep"],
      groupKeep: {
        resources,
        async wake() {
          return { sandbox: stubSandbox("woken"), stop: async () => {} };
        },
        async destroy() {
          destroyed = true;
        },
      },
      materialize: async () => ({
        sandbox: primary,
        services: {
          async exec(): Promise<CommandResult> {
            return { stdout: "ok", stderr: "", exitCode: 0 };
          },
          async collectLogs() {
            return Buffer.from("log");
          },
          async stop() {},
        },
        stop: async () => {},
        resources,
      }),
    });

    const materialized = await createMaterializedCase({
      evalId: "k8s/job",
      environment: "k8s-job",
      sandbox: defineSandbox({
        name: "k8s",
        create: async () => stubSandbox("unused-base"),
        environments: { "k8s-job": custom },
      }),
      keepRequested: true,
    });

    expect(materialized.caseKind).toBe("custom");
    expect(materialized.services).toBeDefined();
    expect(materialized.group.entry?.resources).toEqual(resources);
    expect(lookupCustomGroupKeep("k8s", resources)).toBeDefined();

    const woken = await wakeCustomGroupKeep("k8s", resources);
    expect(woken?.sandbox.sandboxId).toBe("woken");

    expect(await destroyCustomGroupKeep("k8s", resources)).toBe(true);
    expect(destroyed).toBe(true);
    expect(lookupCustomGroupKeep("k8s", resources)).toBeUndefined();

    await materialized.group.stop();
  });

  it("自定义 case 声明 services 却未返回 ServiceController 时硬失败", async () => {
    const custom = defineSandboxCase({
      identity: { kind: "bare" },
      capabilities: ["services"],
      materialize: async () => ({ sandbox: stubSandbox(), stop: async () => {} }),
    });
    await expect(
      createMaterializedCase({
        evalId: "bad/services",
        environment: "x",
        sandbox: defineSandbox({
          name: "acme",
          create: async () => stubSandbox(),
          environments: { x: custom },
        }),
      }),
    ).rejects.toThrow(/ServiceController/);
  });

  it("keepRequested + 自定义缺 group-keep → 创建前报错", () => {
    const planned = planSandboxCase({
      evalId: "k8s/job",
      environment: "k8s-job",
      spec: defineSandbox({
        name: "k8s",
        create: async () => stubSandbox(),
        environments: {
          "k8s-job": defineSandboxCase({
            identity: { kind: "k8s" },
            materialize: async () => ({ sandbox: stubSandbox(), stop: async () => {} }),
          }),
        },
      }),
    });
    expect(planned.status).toBe("ready");
    if (planned.status !== "ready") return;
    expect(() =>
      assertKeepAllowedForCase({ plan: planned.plan, provider: "k8s", keepRequested: true }),
    ).toThrow(/group-keep/);
  });

  it("keepRequested + local → 创建前报错", () => {
    const planned = planSandboxCase({ evalId: "local", spec: localSandbox({ dir: "/tmp/x" }) });
    expect(planned.status).toBe("ready");
    if (planned.status !== "ready") return;
    expect(() =>
      assertKeepAllowedForCase({ plan: planned.plan, provider: "local", keepRequested: true }),
    ).toThrow(/local/);
  });

  it("Compose case 经 createMaterializedCase 进入原生物化(缺文件时报错,不降级成单 Sandbox)", async () => {
    await expect(
      createMaterializedCase({
        evalId: "tb/sheets",
        environment: "tb-sheets",
        sandbox: dockerSandbox({
          environments: { "tb-sheets": { compose: { file: "c.yaml", mainService: "client" } } },
        }),
      }),
    ).rejects.toThrow();
  });

  it("按需构建无 locator 时拒绝;有 locator 时不得在缺 provider 支持时假装成功", async () => {
    await expect(
      createMaterializedCase({
        evalId: "tb/debug",
        environment: "tb-debug",
        sandbox: dockerSandbox({
          environments: { "tb-debug": { build: { context: "." } } },
        }),
      }),
    ).rejects.toThrow(/build coordinator/);
  });
});
