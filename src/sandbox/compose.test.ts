// cases: docs/engineering/testing/unit/sandbox.md
// 覆盖类别:
// - Compose 主空间、服务 ready、证据、整组清理与泄题门
//   (黑名单 / 规划与 BuildKey / 泄题门 / overlay / 整组 finalizer;真机 Compose 归 [X] 验收)
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { attachLeakGateHints, assertNoHiddenInputLeaks, getLeakGateHints } from "../runner/leak-gate.ts";
import {
  assertComposeBlacklist,
  buildComposeOverlay,
  collectComposeBuilds,
  composeBuildWorksFromPlan,
  COMPOSE_MATERIALIZER_REVISION,
  detectDockerBuildPlatform,
  dockerComposeBuildProvider,
  findComposeBlacklistViolations,
  inspectComposeYaml,
  leakGateHintsFromComposeFile,
  materializeDockerComposeCase,
} from "./compose.ts";
import { composeSandbox, planSandboxCase } from "./case.ts";
import { dockerSandbox } from "../define.ts";
import type { Sandbox } from "./types.ts";

const tmpDirs: string[] = [];

afterEach(async () => {
  // 测试目录留给 OS tmp 回收;不强制 rm,避免并行干扰。
  tmpDirs.length = 0;
});

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "niceeval-compose-"));
  tmpDirs.push(root);
  return root;
}

function stubSandbox(id = "compose-main"): Sandbox {
  return {
    workdir: "/app",
    sandboxId: id,
    otlpHost: null,
    async runCommand() {
      return { stdout: "", stderr: "", exitCode: 0 };
    },
    async runShell() {
      return { stdout: "", stderr: "", exitCode: 0 };
    },
    async readFile() {
      return "";
    },
    async fileExists() {
      return false;
    },
    async writeFiles() {},
    async uploadFiles() {},
    async uploadDirectory() {},
    async downloadFile() {
      return Buffer.alloc(0);
    },
    async uploadFile() {},
    async downloadDirectory() {},
    async stop() {},
  };
}

describe("Compose 黑名单", () => {
  it("拒绝 Docker socket 挂载并点名 volumes 字段", () => {
    const inspection = inspectComposeYaml(`
services:
  client:
    image: alpine
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
`);
    const findings = findComposeBlacklistViolations(inspection, { mainService: "client" });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.field).toBe("volumes");
    expect(findings[0]!.reason).toMatch(/Docker socket/);
    expect(() => assertComposeBlacklist(inspection, { mainService: "client" })).toThrow(
      /services\.client\.volumes/,
    );
  });

  it("拒绝 main 的 network_mode host/none/container", () => {
    for (const mode of ["host", "none", "container:other"]) {
      const inspection = inspectComposeYaml(`
services:
  client:
    image: alpine
    network_mode: ${mode}
  db:
    image: postgres:15
`);
      const findings = findComposeBlacklistViolations(inspection, { mainService: "client" });
      expect(findings.some((f) => f.field === "network_mode")).toBe(true);
    }
  });

  it("sidecar 的 network_mode 与 dns/extra_hosts 不进黑名单", () => {
    const inspection = inspectComposeYaml(`
services:
  client:
    image: alpine
    dns:
      - 192.0.2.1
    extra_hosts:
      - "example.com:131.25.18.2"
  program:
    image: python:3.13
    network_mode: host
`);
    const findings = findComposeBlacklistViolations(inspection, { mainService: "client" });
    expect(findings).toEqual([]);
  });

  it("managedWorkdir 冲突时拒绝 main working_dir", () => {
    const inspection = inspectComposeYaml(`
services:
  client:
    image: alpine
    working_dir: /elsewhere
`);
    expect(
      findComposeBlacklistViolations(inspection, {
        mainService: "client",
        managedWorkdir: "/home/sandbox/workspace",
      }),
    ).toMatchObject([{ field: "working_dir" }]);
    expect(
      findComposeBlacklistViolations(inspection, {
        mainService: "client",
        managedWorkdir: "/elsewhere",
      }),
    ).toEqual([]);
  });
});

describe("Compose 泄题门与 BuildKey 规划", () => {
  it("抽取全部 build context 与相对 bind mount,并挂 attachLeakGateHints", async () => {
    const root = await makeRoot();
    await mkdir(join(root, "client"), { recursive: true });
    await writeFile(join(root, "client", "Dockerfile"), "FROM alpine\n", "utf-8");
    await writeFile(join(root, "debug_server.py"), "print(1)\n", "utf-8");
    await writeFile(
      join(root, "docker-compose.yaml"),
      `
services:
  client:
    build:
      context: client
      dockerfile: Dockerfile
    image: ne-client
  program:
    image: python:3.13-slim
    volumes:
      - ./debug_server.py:/app/debug_server.py
`,
      "utf-8",
    );

    const { hints, inspection } = await leakGateHintsFromComposeFile(join(root, "docker-compose.yaml"), {
      mainService: "client",
    });
    expect(inspection.services.map((s) => s.name).sort()).toEqual(["client", "program"]);
    expect(hints.buildContexts).toHaveLength(1);
    expect(hints.buildContexts[0]!.contextDir).toBe(join(root, "client"));
    expect(hints.bindMounts).toHaveLength(1);
    expect(hints.bindMounts![0]!.source).toBe(join(root, "debug_server.py"));
    expect(hints.bindMounts![0]!.agentReachable).toBe(false);

    const source = attachLeakGateHints(
      composeSandbox({ file: join(root, "docker-compose.yaml"), mainService: "client" }),
      hints,
    );
    expect(getLeakGateHints(source)?.buildContexts).toHaveLength(1);

    const secret = join(root, "client", "tests", "secret.py");
    await mkdir(join(root, "client", "tests"), { recursive: true });
    await writeFile(secret, "assert False\n", "utf-8");
    await expect(
      assertNoHiddenInputLeaks({
        hidden: [{ path: secret, kind: "verifier" }],
        buildContexts: hints.buildContexts,
        evalId: "debug-long",
      }),
    ).rejects.toThrow(/Hidden input leak gate failed/);
  });

  it("有 build 的服务各一个 BuildKey;仅 image 的服务只记 imageRefs", async () => {
    const root = await makeRoot();
    await mkdir(join(root, "client"), { recursive: true });
    await mkdir(join(root, "api"), { recursive: true });
    await writeFile(join(root, "client", "Dockerfile"), "FROM alpine\nCMD sleep infinity\n", "utf-8");
    await writeFile(join(root, "api", "Dockerfile"), "FROM python:3.12\n", "utf-8");
    await writeFile(
      join(root, "docker-compose.yaml"),
      `
services:
  client:
    build:
      context: client
  api:
    build: ./api
  db:
    image: postgres:15
`,
      "utf-8",
    );

    const collection = await collectComposeBuilds({
      file: join(root, "docker-compose.yaml"),
      mainService: "client",
    });
    expect(collection.buildKeys).toHaveLength(2);
    expect(collection.works).toHaveLength(2);
    expect(collection.works.map((w) => (w.inputs as { service: string }).service).sort()).toEqual([
      "api",
      "client",
    ]);
    expect(collection.imageRefs).toEqual({ db: "postgres:15" });
    expect(collection.works[0]!.provider).toBe("docker");
  });

  it("composeBuildWorksFromPlan 从 PlannedSandboxCase 抽出 works", async () => {
    const root = await makeRoot();
    await mkdir(join(root, "ctx"), { recursive: true });
    await writeFile(join(root, "ctx", "Dockerfile"), "FROM alpine\n", "utf-8");
    await writeFile(
      join(root, "compose.yaml"),
      `
services:
  client:
    build: ./ctx
`,
      "utf-8",
    );
    const planned = planSandboxCase({
      evalId: "tb/sheets",
      environment: "tb-sheets",
      spec: dockerSandbox({
        environments: {
          "tb-sheets": { compose: { file: join(root, "compose.yaml"), mainService: "client" } },
        },
      }),
    });
    expect(planned.status).toBe("ready");
    if (planned.status !== "ready") return;
    const collection = await composeBuildWorksFromPlan(planned.plan);
    expect(collection?.buildKeys).toHaveLength(1);
    expect(dockerComposeBuildProvider()).toMatchObject({ lookup: expect.any(Function), build: expect.any(Function) });
    expect(COMPOSE_MATERIALIZER_REVISION).toMatch(/^docker-compose-/);
  });

  it("目标平台从构建执行环境探测:arm64 宿主与 amd64 宿主的 BuildKey 不同", async () => {
    const root = await makeRoot();
    await mkdir(join(root, "ctx"), { recursive: true });
    await writeFile(join(root, "ctx", "Dockerfile"), "FROM alpine\n", "utf-8");
    await writeFile(
      join(root, "compose.yaml"),
      `
services:
  client:
    build: ./ctx
`,
      "utf-8",
    );
    const collect = (probed: string) =>
      collectComposeBuilds({
        file: join(root, "compose.yaml"),
        mainService: "client",
        platformProbe: async () => probed,
      });

    const arm = await collect("linux/aarch64");
    const amd = await collect("linux/x86_64");
    expect(arm.platform).toBe("linux/arm64");
    expect(amd.platform).toBe("linux/amd64");
    expect(arm.buildKeys[0]).not.toBe(amd.buildKeys[0]);
    expect((arm.works[0]!.inputs as { platform: string }).platform).toBe("linux/arm64");

    // 用户指定值压过探测值;探测不通时回落到宿主架构而不是一个写死的默认值。
    expect(await detectDockerBuildPlatform({ env: { DOCKER_DEFAULT_PLATFORM: "linux/amd64" }, probe: async () => "linux/arm64" })).toBe(
      "linux/amd64",
    );
    expect(await detectDockerBuildPlatform({ env: {}, probe: async () => undefined })).toBe(
      `linux/${process.arch === "x64" ? "amd64" : process.arch === "arm64" ? "arm64" : process.arch}`,
    );
  });

  it("构建执行拿到的平台与进 BuildKey 的值同源", async () => {
    const root = await makeRoot();
    await mkdir(join(root, "ctx"), { recursive: true });
    await writeFile(join(root, "ctx", "Dockerfile"), "FROM alpine\n", "utf-8");
    await writeFile(
      join(root, "compose.yaml"),
      `
services:
  client:
    build: ./ctx
`,
      "utf-8",
    );
    const collection = await collectComposeBuilds({
      file: join(root, "compose.yaml"),
      mainService: "client",
      platformProbe: async () => "linux/arm64",
    });
    const calls: Array<{ args: readonly string[]; env: Record<string, string> }> = [];
    const provider = dockerComposeBuildProvider({
      runCompose: async (args, opts) => {
        calls.push({ args, env: (opts.env ?? {}) as Record<string, string> });
        return { stdout: "", stderr: "", exitCode: 0 };
      },
    });
    await provider.build(collection.works[0]!, {
      signal: new AbortController().signal,
      timing: { offsetNow: () => 0, childOf: () => ({ id: "x", key: "k", label: "l", startOffsetMs: 0, durationMs: 0 }) } as never,
      parent: { id: "p", key: "sandbox.build", label: "build", startOffsetMs: 0, durationMs: 0 },
    });
    const build = calls.find((c) => c.args.includes("build"));
    expect(build?.env.DOCKER_DEFAULT_PLATFORM).toBe("linux/arm64");
    expect(build?.env.DOCKER_DEFAULT_PLATFORM).toBe(collection.platform);
  });
});

describe("Compose overlay 与整组 finalizer", () => {
  it("overlay 只注入 labels,不改写 dns/extra_hosts", () => {
    const overlay = buildComposeOverlay({
      mainService: "client",
      evalId: "tb/net",
      profile: "tb-net",
      projectName: "ne-test",
      serviceNames: ["client", "program"],
    });
    expect(overlay.projectName).toBe("ne-test");
    expect(overlay.yaml).toContain("niceeval.main-service");
    expect(overlay.yaml).toContain("niceeval.eval-id");
    expect(overlay.yaml).not.toContain("dns:");
    expect(overlay.yaml).not.toContain("extra_hosts:");
    expect(overlay.yaml).not.toContain("network_mode:");
  });

  it("物化成功返回唯一主 Sandbox + services;stop 走整组 finalizer", async () => {
    const root = await makeRoot();
    await writeFile(
      join(root, "docker-compose.yaml"),
      `
services:
  client:
    image: alpine:3.20
  db:
    image: postgres:15
`,
      "utf-8",
    );

    const planned = planSandboxCase({
      evalId: "tb/sheets",
      environment: "tb-sheets",
      spec: dockerSandbox({
        environments: {
          "tb-sheets": { compose: { file: join(root, "docker-compose.yaml"), mainService: "client" } },
        },
      }),
    });
    expect(planned.status).toBe("ready");
    if (planned.status !== "ready") return;

    const composeCalls: string[][] = [];
    let downCount = 0;
    const primary = stubSandbox("main-from-compose");

    const materialized = await materializeDockerComposeCase(planned.plan, {
      ctx: { evalId: "tb/sheets", profile: "tb-sheets" },
      _testHooks: {
        async runCompose(args) {
          composeCalls.push([...args]);
          if (args.includes("down")) downCount += 1;
          return { stdout: "", stderr: "", exitCode: 0 };
        },
        async resolveMainContainerId() {
          return "abc123container";
        },
        async attachMain() {
          return primary;
        },
      },
    });

    expect(materialized.sandbox.sandboxId).toBe("main-from-compose");
    expect(materialized.services).toBeDefined();
    expect(materialized.caseKind).toBe("compose");
    expect(composeCalls.some((a) => a.includes("up"))).toBe(true);

    await materialized.group.stop();
    expect(downCount).toBeGreaterThanOrEqual(1);
    // 再次 stop 幂等
    await materialized.group.stop();
    expect(downCount).toBe(1);
  });

  it("部分启动失败也走整组 finalizer(down)", async () => {
    const root = await makeRoot();
    await writeFile(
      join(root, "docker-compose.yaml"),
      `
services:
  client:
    image: alpine:3.20
`,
      "utf-8",
    );
    const planned = planSandboxCase({
      evalId: "tb/fail",
      environment: "tb-fail",
      spec: dockerSandbox({
        environments: {
          "tb-fail": { compose: { file: join(root, "docker-compose.yaml"), mainService: "client" } },
        },
      }),
    });
    expect(planned.status).toBe("ready");
    if (planned.status !== "ready") return;

    let downCount = 0;
    await expect(
      materializeDockerComposeCase(planned.plan, {
        ctx: { evalId: "tb/fail", profile: "tb-fail" },
        _testHooks: {
          async runCompose(args) {
            if (args.includes("down")) {
              downCount += 1;
              return { stdout: "", stderr: "", exitCode: 0 };
            }
            if (args.includes("up")) {
              throw new Error("service db failed to start");
            }
            return { stdout: "", stderr: "", exitCode: 0 };
          },
        },
      }),
    ).rejects.toThrow(/Compose environment failed|service db failed/);
    expect(downCount).toBeGreaterThanOrEqual(1);
  });
});
