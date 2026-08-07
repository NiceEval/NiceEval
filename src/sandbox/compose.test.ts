// cases: docs/engineering/testing/unit/sandbox.md
// 覆盖类别:
// - Compose 主空间、服务 ready、证据、整组清理与泄题门
//   (黑名单 / 规划与 BuildKey / 泄题门 / overlay / 整组 finalizer;真机 Compose 归 [X] 验收)
// - 受管资源的 project namespace escape(双哨兵有效模型;见
//   bug: memory/compose-project-namespace-escape-destabilizes-case-identity.md)
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument } from "yaml";
import { afterEach, describe, expect, it, vi } from "vitest";
import { attachLeakGateHints, assertNoHiddenInputLeaks, getLeakGateHints } from "../runner/leak-gate.ts";
import {
  assertComposeBlacklist,
  buildComposeOverlay,
  collectComposeBuilds,
  collectComposeBuildsForTest,
  composeCollectionIdentity,
  COMPOSE_MATERIALIZER_REVISION,
  detectDockerBuildPlatform,
  dockerComposeBuildProvider,
  findComposeBlacklistViolations,
  inspectComposeYaml,
  leakGateHintsFromComposeFile,
  materializeDockerComposeProviderCase,
  runDockerCompose,
} from "./compose.ts";
import type { ComposeCommandResult } from "./compose.ts";
import { computeCaseKey, digestOf } from "./identity.ts";
import type { Sandbox } from "./types.ts";

const tmpDirs: string[] = [];

afterEach(async () => {
  // 测试目录留给 OS tmp 回收;不强制 rm,避免并行干扰。
  tmpDirs.length = 0;
});

describe("runDockerCompose abort boundary", () => {
  it("命令忽略 TERM 时也会在 grace 后主动 reject", async () => {
    const root = await makeRoot();
    const fakeDocker = join(root, "docker");
    await writeFile(fakeDocker, "#!/bin/sh\ntrap '' TERM\nwhile :; do sleep 1; done\n", "utf-8");
    await chmod(fakeDocker, 0o755);
    const controller = new AbortController();
    const startedAt = Date.now();
    const running = runDockerCompose(["compose", "version"], {
      cwd: root,
      env: { PATH: `${root}:${process.env.PATH ?? ""}` },
      signal: controller.signal,
    });

    setTimeout(() => controller.abort(new Error("test timeout")), 25);
    await expect(running).rejects.toThrow(/test timeout|aborted/i);
    expect(Date.now() - startedAt).toBeLessThan(2_500);
  }, 5_000);
});

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "niceeval-compose-"));
  tmpDirs.push(root);
  return root;
}

async function composeProviderPlan(file: string, evalId: string, mainService = "client") {
  const collection = await safeCollect({ file, mainService });
  const identity = { provider: "docker", kind: "compose", file, mainService } as const;
  return {
    evalId,
    profile: evalId,
    mainService,
    env: {},
    collection,
    caseKey: computeCaseKey({
      caseKind: "compose",
      materializerRevision: COMPOSE_MATERIALIZER_REVISION,
      composeBytes: collection.composeBytes,
      buildKeys: collection.buildKeys,
      caseParams: identity,
    }),
    identity,
  };
}

interface SafeCollectOpts {
  readonly file: string | URL;
  readonly mainService: string;
  readonly baseDir?: string;
  readonly platform?: string;
  readonly platformProbe?: () => Promise<string | undefined>;
  readonly env?: Readonly<Record<string, string>>;
}

/**
 * 单测不调用真机 docker:用与 `docker compose config` 同构的合成有效模型注入
 * (服务透传 container_name,非 external 资源按 `<project>_<key>` 派生,显式 name 原样透传)。
 */
async function safeCollect(opts: SafeCollectOpts): Promise<Awaited<ReturnType<typeof collectComposeBuilds>>> {
  const raw = await readFile(typeof opts.file === "string" ? opts.file : fileURLToPath(opts.file), "utf-8");
  return collectComposeBuildsForTest(opts, fakeComposeConfig(raw));
}

function fakeComposeConfig(raw: string): (projectName: string) => Promise<ComposeCommandResult> {
  return async (projectName) => {
    const json = (parseDocument(raw, { merge: true }).toJSON() ?? {}) as Record<string, Record<string, unknown>>;
    const services: Record<string, Record<string, unknown>> = {};
    for (const [name, svc] of Object.entries(json.services ?? {})) {
      if (svc === null || typeof svc !== "object" || Array.isArray(svc)) {
        services[name] = {};
        continue;
      }
      const containerName = (svc as Record<string, unknown>).container_name;
      services[name] = typeof containerName === "string" ? { container_name: containerName } : {};
    }
    const resources = (section: unknown): Record<string, unknown> => {
      const out: Record<string, unknown> = {};
      if (section === null || typeof section !== "object" || Array.isArray(section)) return out;
      for (const [key, value] of Object.entries(section as Record<string, unknown>)) {
        const v = (value ?? {}) as Record<string, unknown>;
        const external = v.external === true;
        const declaredName = typeof v.name === "string" ? v.name : undefined;
        out[key] = external
          ? { name: declaredName ?? key, external: true }
          : { name: declaredName ?? `${projectName}_${key}` };
      }
      return out;
    };
    return {
      stdout: JSON.stringify({
        services,
        networks: resources(json.networks),
        volumes: resources(json.volumes),
        configs: resources(json.configs),
        secrets: resources(json.secrets),
      }),
      stderr: "",
      exitCode: 0,
    };
  };
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
      { kind: "compose", file: join(root, "docker-compose.yaml"), mainService: "client" },
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

    const collection = await safeCollect({ file: join(root, "docker-compose.yaml"), mainService: "client" });
    expect(collection.buildKeys).toHaveLength(2);
    expect(collection.works).toHaveLength(2);
    expect(collection.works.map((w) => (w.inputs as { service: string }).service).sort()).toEqual([
      "api",
      "client",
    ]);
    expect(collection.imageRefs).toEqual({ db: "postgres:15" });
    expect(collection.works[0]!.provider).toBe("docker");
  });

  it("未钉 digest 的 image ref 只收声明值,重复规划两次身份不漂移", async () => {
    const root = await makeRoot();
    await writeFile(
      join(root, "docker-compose.yaml"),
      `
services:
  client:
    image: python:3.11
`,
      "utf-8",
    );

    // 模拟 accept 重锚后立即 --dry:两次各自独立的 physical planning 调用,
    // 中间不共享任何进程内缓存(见 memory/compose-case-identity-digest-flap.md)。
    const first = await safeCollect({ file: join(root, "docker-compose.yaml"), mainService: "client" });
    const second = await safeCollect({ file: join(root, "docker-compose.yaml"), mainService: "client" });

    expect(first.imageRefs).toEqual({ client: "python:3.11" });
    expect(second.imageRefs).toEqual({ client: "python:3.11" });
    // 声明值本身,不是本地 daemon 解析出的 sha256 digest。
    expect(first.imageRefs.client).not.toMatch(/^sha256:|@sha256:/);
    expect(digestOf(composeCollectionIdentity(first))).toBe(digestOf(composeCollectionIdentity(second)));
  });

  it("typed provider planning 直接从 Compose 声明抽出 works", async () => {
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
    const collection = await safeCollect({ file: join(root, "compose.yaml"), mainService: "client" });
    expect(collection.buildKeys).toHaveLength(1);
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
      safeCollect({
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

  it("多阶段 target 是 BuildKey 的一部分", async () => {
    const root = await makeRoot();
    await mkdir(join(root, "ctx"), { recursive: true });
    await writeFile(
      join(root, "ctx", "Dockerfile"),
      `FROM alpine@sha256:${"a".repeat(64)} AS base\nFROM base AS final\n`,
      "utf-8",
    );
    const compose = async (target: string): Promise<string> => {
      await writeFile(
        join(root, "compose.yaml"),
        `services:\n  client:\n    build:\n      context: ./ctx\n      target: ${target}\n`,
        "utf-8",
      );
      return (await safeCollect({
        file: join(root, "compose.yaml"),
        mainService: "client",
        platform: "linux/amd64",
      })).buildKeys[0]!;
    };
    expect(await compose("base")).not.toBe(await compose("final"));
  });

  it("Compose 显式声明的平台压过探测值,逐服务进各自 BuildKey;多平台声明拒绝", async () => {
    const root = await makeRoot();
    await mkdir(join(root, "ctx"), { recursive: true });
    await writeFile(join(root, "ctx", "Dockerfile"), "FROM alpine\n", "utf-8");
    await writeFile(
      join(root, "compose.yaml"),
      `
services:
  client:
    platform: linux/amd64
    build: ./ctx
  sidecar:
    build:
      context: ./ctx
      platforms:
        - linux/arm64
  plain:
    build: ./ctx
`,
      "utf-8",
    );
    // arm64 宿主上:client 按声明构 amd64,sidecar 按 build.platforms 构 arm64,plain 跟探测值。
    const collection = await safeCollect({
      file: join(root, "compose.yaml"),
      mainService: "client",
      platformProbe: async () => "linux/aarch64",
    });
    const byService = Object.fromEntries(
      collection.works.map((w) => [(w.inputs as { service: string }).service, w]),
    );
    expect((byService.client!.inputs as { platform: string }).platform).toBe("linux/amd64");
    expect((byService.sidecar!.inputs as { platform: string }).platform).toBe("linux/arm64");
    expect((byService.plain!.inputs as { platform: string }).platform).toBe("linux/arm64");
    // P1 区分力:换一台宿主(探测值变)重收集,声明了平台的服务身份不动,未声明的跟宿主走。
    // 声明被忽略时 client 的 BuildKey 会随宿主漂移,两台机器互认不可比的产物。
    const onAmdHost = await safeCollect({
      file: join(root, "compose.yaml"),
      mainService: "client",
      platformProbe: async () => "linux/x86_64",
    });
    const byServiceAmd = Object.fromEntries(
      onAmdHost.works.map((w) => [(w.inputs as { service: string }).service, w]),
    );
    expect(byServiceAmd.client!.buildKey).toBe(byService.client!.buildKey);
    expect(byServiceAmd.sidecar!.buildKey).toBe(byService.sidecar!.buildKey);
    expect(byServiceAmd.plain!.buildKey).not.toBe(byService.plain!.buildKey);

    await writeFile(
      join(root, "compose.yaml"),
      `
services:
  client:
    build:
      context: ./ctx
      platforms:
        - linux/amd64
        - linux/arm64
`,
      "utf-8",
    );
    await expect(
      safeCollect({
        file: join(root, "compose.yaml"),
        mainService: "client",
        platformProbe: async () => "linux/aarch64",
      }),
    ).rejects.toThrow(/build\.platforms with 2 entries/);
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
    const collection = await safeCollect({
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

    const plan = await composeProviderPlan(join(root, "docker-compose.yaml"), "tb/sheets");

    const composeCalls: string[][] = [];
    let downCount = 0;
    const primary = stubSandbox("main-from-compose");

    const materialized = await materializeDockerComposeProviderCase(plan, {
      ctx: {
        evalId: "tb/sheets",
        profile: "tb-sheets",
        signal: new AbortController().signal,
        buildLocators: new Map(),
      },
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

  it("attempt 已 abort 后仍用独立 signal 整组 down，并发 stop 共享一次执行", async () => {
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
    const plan = await composeProviderPlan(join(root, "docker-compose.yaml"), "tb/abort-cleanup");
    const attempt = new AbortController();
    const downCalls: Array<{ args: readonly string[]; signal?: AbortSignal }> = [];
    const materialized = await materializeDockerComposeProviderCase(plan, {
      ctx: {
        evalId: "tb/abort-cleanup",
        profile: "tb-abort-cleanup",
        signal: attempt.signal,
        buildLocators: new Map(),
      },
      _testHooks: {
        async runCompose(args, opts) {
          if (args.includes("down")) {
            downCalls.push({ args: [...args], signal: opts.signal });
            await Promise.resolve();
          }
          return { stdout: "", stderr: "", exitCode: 0 };
        },
        async resolveMainContainerId() {
          return "abort-cleanup-container";
        },
        async attachMain() {
          return stubSandbox("abort-cleanup-container");
        },
      },
    });

    attempt.abort(new Error("attempt timeout"));
    await Promise.all([materialized.group.stop(), materialized.group.stop()]);

    expect(downCalls).toHaveLength(1);
    expect(downCalls[0]!.signal).not.toBe(attempt.signal);
    expect(downCalls[0]!.signal?.aborted).toBe(false);
    expect(downCalls[0]!.args).toEqual(expect.arrayContaining([
      "down",
      "--timeout",
      "5",
      "--volumes",
      "--remove-orphans",
    ]));
  });

  it("down 失败回到 Open，后续 stop 会真正重试", async () => {
    const root = await makeRoot();
    await writeFile(join(root, "docker-compose.yaml"), "services:\n  client:\n    image: alpine:3.20\n", "utf-8");
    const plan = await composeProviderPlan(join(root, "docker-compose.yaml"), "tb/cleanup-retry");
    let downCount = 0;
    const materialized = await materializeDockerComposeProviderCase(plan, {
      ctx: {
        evalId: "tb/cleanup-retry",
        profile: "tb-cleanup-retry",
        signal: new AbortController().signal,
        buildLocators: new Map(),
      },
      _testHooks: {
        async runCompose(args) {
          if (args.includes("down")) {
            downCount += 1;
            if (downCount === 1) throw new Error("transient cleanup failure");
          }
          return { stdout: "", stderr: "", exitCode: 0 };
        },
        async resolveMainContainerId() {
          return "cleanup-retry-container";
        },
        async attachMain() {
          return stubSandbox("cleanup-retry-container");
        },
      },
    });

    await expect(materialized.group.stop()).rejects.toThrow("transient cleanup failure");
    await expect(materialized.group.stop()).resolves.toBeUndefined();
    expect(downCount).toBe(2);
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
    const plan = await composeProviderPlan(join(root, "docker-compose.yaml"), "tb/fail");

    let downCount = 0;
    await expect(
      materializeDockerComposeProviderCase(plan, {
        ctx: {
          evalId: "tb/fail",
          profile: "tb-fail",
          signal: new AbortController().signal,
          buildLocators: new Map(),
        },
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

  it("物化原始错误不被 cleanup 错误遮蔽，后者只追加 stop diagnostic", async () => {
    const root = await makeRoot();
    await writeFile(join(root, "docker-compose.yaml"), "services:\n  client:\n    image: alpine:3.20\n", "utf-8");
    const plan = await composeProviderPlan(join(root, "docker-compose.yaml"), "tb/start-and-cleanup-fail");
    const diagnostics: Array<{ code: string; projectName?: unknown }> = [];

    await expect(materializeDockerComposeProviderCase(plan, {
      ctx: {
        evalId: "tb/start-and-cleanup-fail",
        profile: "tb-start-and-cleanup-fail",
        signal: new AbortController().signal,
        buildLocators: new Map(),
      },
      feedback: {
        progress() {},
        diagnostic(entry) {
          diagnostics.push({ code: entry.code, projectName: entry.data?.projectName });
        },
      },
      _testHooks: {
        async runCompose(args) {
          if (args.includes("up")) throw new Error("original startup failure");
          if (args.includes("down")) throw new Error("cleanup transport failure");
          return { stdout: "", stderr: "", exitCode: 0 };
        },
      },
    })).rejects.toThrow(/original startup failure/);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      code: "sandbox-stop-failed",
      projectName: expect.stringMatching(/^ne-/),
    });
  });

  it("up 遇到镜像拉取 EOF 时先对账同一 project 再重试", async () => {
    const root = await makeRoot();
    try {
      await writeFile(
        join(root, "docker-compose.yaml"),
        `
services:
  client:
    image: postgres:16
`,
        "utf-8",
      );
      const plan = await composeProviderPlan(join(root, "docker-compose.yaml"), "tb/transient-pull");

      vi.useFakeTimers();
      const order: string[] = [];
      let upCount = 0;
      const promise = materializeDockerComposeProviderCase(plan, {
        ctx: {
          evalId: "tb/transient-pull",
          profile: "tb/transient-pull",
          signal: new AbortController().signal,
          buildLocators: new Map(),
        },
        _testHooks: {
          async runCompose(args) {
            if (args.includes("up")) {
              upCount += 1;
              order.push(`up#${upCount}`);
              if (upCount === 1) throw new Error('Get "https://registry-1.docker.io/v2/": EOF');
            } else if (args.includes("down")) {
              order.push("down");
            }
            return { stdout: "", stderr: "", exitCode: 0 };
          },
          async resolveMainContainerId() {
            return "compose-after-retry";
          },
          async attachMain() {
            return stubSandbox("compose-after-retry");
          },
        },
      });

      await vi.waitFor(() => expect(upCount).toBe(1));
      await vi.runAllTimersAsync();
      const materialized = await promise;
      expect(order).toEqual(["up#1", "down", "up#2"]);
      await materialized.group.stop();
      expect(order).toEqual(["up#1", "down", "up#2", "down"]);
    } finally {
      vi.useRealTimers();
      await rm(root, { recursive: true, force: true });
    }
  });
});

// bug: memory/compose-project-namespace-escape-destabilizes-case-identity.md
// 回归判据:只扫描原始 service 节点、只检查 container_name、或只用一个固定规划 project 的实现必须在这些测试里失败。
describe("Compose 安全校验:受管资源 project namespace escape", () => {
  function securityModel(spec: {
    services?: Record<string, { container_name?: string }>;
    networks?: Record<string, { name: string; external?: boolean }>;
    volumes?: Record<string, { name: string; external?: boolean }>;
    configs?: Record<string, { name: string; external?: boolean }>;
    secrets?: Record<string, { name: string; external?: boolean }>;
  }): Record<string, unknown> {
    const resources = (entries?: Record<string, { name: string; external?: boolean }>) => {
      const out: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(entries ?? {})) {
        out[key] = value.external === true ? { name: value.name, external: true } : { name: value.name };
      }
      return out;
    };
    return {
      services: spec.services ?? {},
      networks: resources(spec.networks),
      volumes: resources(spec.volumes),
      configs: resources(spec.configs),
      secrets: resources(spec.secrets),
    };
  }

  function modelRunner(
    modelA: Record<string, unknown>,
    modelB: Record<string, unknown>,
  ): (projectName: string) => Promise<ComposeCommandResult> {
    return async (projectName) => ({
      stdout: JSON.stringify(projectName === "niceeval-plan-a" ? modelA : modelB),
      stderr: "",
      exitCode: 0,
    });
  }

  async function planWithSecurity(
    raw: string,
    runner: (projectName: string) => Promise<ComposeCommandResult>,
    extraFiles: Readonly<Record<string, string>> = {},
  ): Promise<Awaited<ReturnType<typeof collectComposeBuilds>>> {
    const root = await makeRoot();
    for (const [path, content] of Object.entries(extraFiles)) {
      await mkdir(join(root, dirname(path)), { recursive: true });
      await writeFile(join(root, path), content, "utf-8");
    }
    await writeFile(join(root, "compose.yaml"), raw, "utf-8");
    return collectComposeBuildsForTest({
      file: join(root, "compose.yaml"),
      mainService: "client",
      platform: "linux/amd64",
    }, runner);
  }

  async function rejectionOf(promise: Promise<unknown>): Promise<Error> {
    try {
      await promise;
    } catch (e) {
      return e instanceof Error ? e : new Error(String(e));
    }
    throw new Error("expected planning rejection");
  }

  it("任一 service 的 container_name 都拒绝,包括 sidecar", async () => {
    const raw = `
services:
  client:
    image: alpine
  worker:
    image: python:3.12
`;
    const runner = modelRunner(
      securityModel({
        services: { client: {}, worker: { container_name: "fixed-worker" } },
        networks: { default: { name: "niceeval-plan-a_default" } },
      }),
      securityModel({
        services: { client: {}, worker: { container_name: "fixed-worker" } },
        networks: { default: { name: "niceeval-plan-b_default" } },
      }),
    );
    const error = await rejectionOf(planWithSecurity(raw, runner));
    expect(error.message).toMatch(/services\.worker\.container_name/);
    expect(error.message).toMatch(/escape the managed Compose project namespace/);
  });

  it("anchor/merge 合成出的 container_name 同样拒绝", async () => {
    const raw = `
services:
  base: &base
    image: alpine
    container_name: ne-fixed-client
  client:
    <<: *base
`;
    const error = await rejectionOf(planWithSecurity(raw, fakeComposeConfig(raw)));
    expect(error.message).toMatch(/services\.client\.container_name/);
  });

  it("写死其中一个规划哨兵名会在另一哨兵模型失败", async () => {
    const raw = `
services:
  client:
    image: alpine
    volumes:
      - data:/data
volumes:
  data:
    name: niceeval-plan-a_data
`;
    const error = await rejectionOf(planWithSecurity(raw, fakeComposeConfig(raw)));
    expect(error.message).toMatch(/volumes\.data\.name/);
    expect(error.message).toMatch(/niceeval-plan-a_data \/ niceeval-plan-b_data/);
  });

  it("network/volume/config/secret 的固定全局名属于同一等价类,全部拒绝", async () => {
    const raw = `
services:
  client:
    image: alpine
    configs:
      - cfg1
    secrets:
      - sec1
networks:
  lan:
    name: fixed-lan
volumes:
  data:
    name: fixed-data
configs:
  cfg1:
    name: fixed-cfg
secrets:
  sec1:
    name: fixed-sec
`;
    const error = await rejectionOf(planWithSecurity(raw, fakeComposeConfig(raw)));
    expect(error.message).toMatch(/networks\.lan\.name/);
    expect(error.message).toMatch(/volumes\.data\.name/);
    expect(error.message).toMatch(/configs\.cfg1\.name/);
    expect(error.message).toMatch(/secrets\.sec1\.name/);
  });

  it("${COMPOSE_PROJECT_NAME} 派生名与 external: true 资源照常接受", async () => {
    const raw = `
services:
  client:
    image: alpine
    volumes:
      - data:/data
      - ext:/ext
volumes:
  data:
    name: \${COMPOSE_PROJECT_NAME}_data
  ext:
    external: true
    name: global-ext-vol
`;
    const runner = modelRunner(
      securityModel({
        services: { client: {} },
        networks: { default: { name: "niceeval-plan-a_default" } },
        volumes: {
          data: { name: "niceeval-plan-a_data" },
          ext: { name: "global-ext-vol", external: true },
        },
      }),
      securityModel({
        services: { client: {} },
        networks: { default: { name: "niceeval-plan-b_default" } },
        volumes: {
          data: { name: "niceeval-plan-b_data" },
          ext: { name: "global-ext-vol", external: true },
        },
      }),
    );
    await expect(planWithSecurity(raw, runner)).resolves.toBeDefined();
  });

  it("顶层 include 在 physical planning 拒绝", async () => {
    const raw = `
include:
  - ./other.yml
services:
  client:
    image: alpine
`;
    const runner = modelRunner(securityModel({}), securityModel({}));
    const error = await rejectionOf(planWithSecurity(raw, runner));
    expect(error.message).toMatch(/^Compose security validation rejected 1 declaration\(s\):\n  include:/);
  });

  it("任意 extends.file 拒绝;service-only extends 接受", async () => {
    const external = `
services:
  client:
    extends:
      file: ./shared.yml
      service: base
  base:
    image: alpine
`;
    const error = await rejectionOf(planWithSecurity(external, fakeComposeConfig(external)));
    expect(error.message).toMatch(/services\.client\.extends\.file/);

    const selfRef = `
services:
  client:
    extends:
      file: ./compose.yaml
      service: base
  base:
    image: alpine
`;
    const selfError = await rejectionOf(planWithSecurity(selfRef, fakeComposeConfig(selfRef)));
    expect(selfError.message).toMatch(/services\.client\.extends\.file/);

    const serviceOnly = `
services:
  client:
    extends:
      service: base
  base:
    image: alpine
`;
    await expect(planWithSecurity(serviceOnly, fakeComposeConfig(serviceOnly))).resolves.toBeDefined();
  });

  it("经 anchor/merge 出现的 extends.file 同样拒绝", async () => {
    const raw = `
x-svc: &x
  extends:
    file: ./other.yml
    service: db
services:
  client:
    <<: *x
`;
    const error = await rejectionOf(planWithSecurity(raw, fakeComposeConfig(raw)));
    expect(error.message).toMatch(/services\.client\.extends\.file/);
  });

  it("两个哨兵模型的资源 key 与 external 标记必须一致", async () => {
    const raw = "services:\n  client:\n    image: alpine\n";
    const base = (project: string) =>
      securityModel({
        services: { client: {} },
        networks: { default: { name: `${project}_default` } },
      });

    const keyMismatch = modelRunner(
      { ...base("niceeval-plan-a"), volumes: { data: { name: "niceeval-plan-a_data" } } },
      base("niceeval-plan-b"),
    );
    const keyError = await rejectionOf(planWithSecurity(raw, keyMismatch));
    expect(keyError.message).toMatch(/volumes\.data/);
    expect(keyError.message).toMatch(/key set differs/);

    const markerMismatch = modelRunner(
      { ...base("niceeval-plan-a"), volumes: { data: { name: "niceeval-plan-a_data" } } },
      { ...base("niceeval-plan-b"), volumes: { data: { name: "global", external: true } } },
    );
    const markerError = await rejectionOf(planWithSecurity(raw, markerMismatch));
    expect(markerError.message).toMatch(/volumes\.data/);
    expect(markerError.message).toMatch(/external marker differs/);
  });

  it("config 失败只报安全阶段与 exit code,绝不泄漏 stdout/stderr/模型原文", async () => {
    const raw = `
services:
  client:
    image: alpine
    environment:
      - API_KEY=\${SECRET_TOKEN}
`;
    const secret = "SUPER-SECRET-CREDENTIAL-7f3a";
    const runner = async () => ({
      stdout: `services:\n  client:\n    environment:\n      API_KEY: ${secret}\n`,
      stderr: `invalid interpolation\nAPI_KEY=${secret}\n`,
      exitCode: 1,
    });
    const error = await rejectionOf(planWithSecurity(raw, runner));
    expect(error.message).toMatch(/effective-model resolution for project niceeval-plan-a/);
    expect(error.message).toMatch(/docker compose config exited 1/);
    expect(error.message).not.toContain(secret);
    expect(error.message).not.toContain("API_KEY");
  });

  it("有效模型 JSON 解码失败同样是规划失败,不带正文", async () => {
    const secret = "SUPER-SECRET-CREDENTIAL-7f3a";
    const raw = "services:\n  client:\n    image: alpine\n";
    const runner = async () => ({ stdout: `not-json ${secret}`, stderr: "", exitCode: 0 });
    const error = await rejectionOf(planWithSecurity(raw, runner));
    expect(error.message).toMatch(/effective-model decoding for project niceeval-plan-a/);
    expect(error.message).not.toContain(secret);
  });
});
