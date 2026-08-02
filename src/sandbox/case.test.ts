// cases: docs/engineering/testing/unit/sandbox.md
// 覆盖类别:
// - sandbox case 五类
// - profile / source 双入口与优先级
import { describe, expect, it } from "vitest";
import { dockerSandbox, e2bSandbox } from "../define.ts";
import {
  assertEnvironmentCaseShape,
  collectSandboxCasePlanningGaps,
  composeSandbox,
  dockerfileSandbox,
  materializePlannedCase,
  planSandboxCase,
  sandboxCasePlanningError,
  type MaterializedSandboxCase,
  type SandboxMaterializer,
} from "./case.ts";
import {
  assertPureDataIdentity,
  caseCarryEligible,
  computeBuildKey,
  computeCaseKey,
  credentialIdentityContribution,
  resolveFloatingImageTag,
} from "./identity.ts";
import type { DockerSandboxSpec, Sandbox, SandboxOption } from "./types.ts";

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

function dockerSpec(
  environments?: DockerSandboxSpec["environments"],
  materializers?: DockerSandboxSpec["materializers"],
): SandboxOption {
  return dockerSandbox({
    image: "node:24-slim",
    ...(environments !== undefined ? { environments } : {}),
    ...(materializers !== undefined ? { materializers } : {}),
  });
}

describe("profile / source 双入口与优先级", () => {
  it("environments 表命中时优先于同 profile 的 materializer", () => {
    const source = composeSandbox({ file: "compose.yaml", mainService: "client" });
    const materializer: SandboxMaterializer = {
      kind: "compose",
      revision: "mat-1",
      async materialize() {
        throw new Error("materializer should not run when environments wins");
      },
    };
    const result = planSandboxCase({
      evalId: "tb/sheets",
      environment: source,
      defaultProfileId: "tb-sheets",
      spec: dockerSpec(
        { "tb-sheets": { image: "acme/tb-sheets:prebuilt" } },
        { compose: materializer },
      ),
    });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.plan.via).toBe("environments");
    expect(result.plan.caseKind).toBe("prebuilt");
    expect(result.plan.identity).toMatchObject({ declaration: { image: "acme/tb-sheets:prebuilt" } });
  });

  it("folder-local source 在无表项时走 materializer", () => {
    const source = composeSandbox({ file: "compose.yaml", mainService: "client" });
    const materializer: SandboxMaterializer = {
      kind: "compose",
      revision: "mat-1",
      async materialize() {
        throw new Error("not used in plan");
      },
    };
    const result = planSandboxCase({
      evalId: "tb/debug",
      environment: source,
      defaultProfileId: "tb/debug",
      spec: dockerSpec(undefined, { compose: materializer }),
    });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.plan.via).toBe("materializer");
    expect(result.plan.caseKind).toBe("compose");
    expect(result.plan.sourceKind).toBe("compose");
  });

  it("profile 键查不到且无 folder-local source → locator-unavailable", () => {
    const result = planSandboxCase({
      evalId: "math/py39",
      environment: "python-3.9",
      spec: dockerSpec({ "python-3.10": { image: "acme/py310" } }),
    });
    expect(result).toMatchObject({
      status: "unavailable",
      gap: {
        code: "sandbox.locator-unavailable",
        evalId: "math/py39",
        profile: "python-3.9",
        provider: "docker",
      },
    });
  });

  it("声明合法但缺表项与 materializer → capability-unavailable", () => {
    const source = composeSandbox({ file: "compose.yaml", mainService: "client" });
    const result = planSandboxCase({
      evalId: "tb/sheets",
      environment: source,
      defaultProfileId: "tb-sheets",
      spec: dockerSpec({ other: { image: "acme/other" } }),
    });
    expect(result.status).toBe("unavailable");
    if (result.status !== "unavailable") return;
    expect(result.gap).toMatchObject({
      code: "sandbox.capability-unavailable",
      evalId: "tb/sheets",
      profile: "tb-sheets",
      provider: "docker",
      capability: { _tag: "SourceMaterializer", sourceKind: "compose" },
    });
    expect(result.gap.summary).toContain("compose");
  });

  it("任一 locator / capability gap 与 ready 混合也聚合为零资源规划失败", () => {
    const source = composeSandbox({ file: "compose.yaml", mainService: "client" });
    const results = [
      planSandboxCase({ evalId: "a", environment: source, defaultProfileId: "a", spec: dockerSpec() }),
      planSandboxCase({ evalId: "b", spec: dockerSpec() }),
      planSandboxCase({ evalId: "c", environment: "absent", spec: dockerSpec() }),
    ];
    const gaps = collectSandboxCasePlanningGaps(results);
    expect(gaps.map(({ code }) => code)).toEqual([
      "sandbox.capability-unavailable",
      "sandbox.locator-unavailable",
    ]);
    if (gaps.length === 0) throw new Error("expected planning gaps");
    const failure = sandboxCasePlanningError("docker", [gaps[0], ...gaps.slice(1)]);
    expect(failure).toMatchObject({
      code: "sandbox.case-planning-failed",
      provider: "docker",
      gaps,
    });
    expect(failure.message).toContain("No provider build or Sandbox creation was started");
  });

  it("非法判别键组合在规划期报错", () => {
    expect(() =>
      assertEnvironmentCaseShape("docker", { image: "x", compose: { file: "c.yaml", mainService: "main" } }, "bad"),
    ).toThrow(/exactly one of image \| build \| compose/);
  });

  it("动态 environments 表值必须在规划期解码为真实的纯 JSON 声明", () => {
    expect(() => assertEnvironmentCaseShape("docker", { image: 42 }, "bad-image")).toThrow(/image must be a string/);
    expect(() =>
      assertEnvironmentCaseShape(
        "docker",
        { compose: { file: "compose.yaml", mainService: "main", env: { TOKEN: () => "secret" } } },
        "bad-compose",
      ),
    ).toThrow(/pure JSON data/);
  });
});

describe("sandbox case 五类", () => {
  it("预制单 Sandbox:只返回一个主 Sandbox,资源组仅 primary", async () => {
    const planned = planSandboxCase({
      evalId: "py",
      environment: "python-3.9",
      spec: dockerSpec({ "python-3.9": { image: "acme/py39" } }),
    });
    expect(planned.status).toBe("ready");
    if (planned.status !== "ready") return;
    expect(planned.plan.caseKind).toBe("prebuilt");

    const primary = stubSandbox("primary-only");
    const materialized = await materializePlannedCase(planned.plan, {
      ctx: { evalId: "py", profile: "python-3.9" },
      primarySandbox: primary,
    });
    assertSinglePrimary(materialized, primary);
  });

  it("按需构建单 Sandbox:无 build locator 时拒绝物化,不降级", async () => {
    const planned = planSandboxCase({
      evalId: "tb/debug",
      environment: "tb-debug",
      spec: dockerSpec({
        "tb-debug": { build: { context: "tasks/debug/environment", dockerfile: "Dockerfile" } },
      }),
    });
    expect(planned.status).toBe("ready");
    if (planned.status !== "ready") return;
    expect(planned.plan.caseKind).toBe("on-demand-build");

    await expect(
      materializePlannedCase(planned.plan, { ctx: { evalId: "tb/debug", profile: "tb-debug" } }),
    ).rejects.toThrow(/build coordinator/);
  });

  it("Docker Compose:environments 表项走原生物化,不得用 primarySandbox 降级", async () => {
    const planned = planSandboxCase({
      evalId: "tb/sheets",
      environment: "tb-sheets",
      spec: dockerSpec({
        "tb-sheets": { compose: { file: "docker-compose.yaml", mainService: "client" } },
      }),
    });
    expect(planned.status).toBe("ready");
    if (planned.status !== "ready") return;
    expect(planned.plan.caseKind).toBe("compose");

    const primary = stubSandbox("would-be-wrong");
    // 没有真实 compose 文件时物化失败——但绝不能静默返回传入的 primarySandbox。
    await expect(
      materializePlannedCase(planned.plan, {
        ctx: { evalId: "tb/sheets", profile: "tb-sheets" },
        primarySandbox: primary,
      }),
    ).rejects.toThrow();
  });

  it("自定义 case 缺稳定纯数据 identity 时禁止携带", () => {
    expect(() => assertPureDataIdentity({ kind: "bad", run: () => "nope" })).toThrow(/pure JSON data/);
    expect(() => assertPureDataIdentity({ revision: Number.NaN })).toThrow(/pure JSON data/);
    expect(() => assertPureDataIdentity({ revision: Number.POSITIVE_INFINITY })).toThrow(/pure JSON data/);
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(() => assertPureDataIdentity(cyclic)).toThrow(/pure JSON data/);

    expect(caseCarryEligible({
      identity: { _tag: "Unavailable", code: "sandbox.identity-missing", reason: "fixture" },
      floatingImages: { _tag: "Resolved" },
    })).toBe(false);
    expect(caseCarryEligible({
      identity: { _tag: "Stable", identity: { ok: true } },
      floatingImages: { _tag: "Resolved" },
    })).toBe(true);
    expect(caseCarryEligible({
      identity: { _tag: "Stable", identity: { image: "node:24-slim" } },
      floatingImages: { _tag: "Unresolved", refs: ["node:24-slim"] },
    })).toBe(false);
  });

  it("Compose materializer 物化时仍只暴露一个主 Sandbox", async () => {
    const primary = stubSandbox("compose-main");
    const materializer: SandboxMaterializer = {
      kind: "compose",
      revision: "test-compose-1",
      async materialize(source) {
        if (source.kind !== "compose") throw new Error("expected compose");
        return {
          sandbox: primary,
          caseKind: "compose",
          caseKey: "ck",
          buildKeys: [],
          identity: { mainService: source.mainService },
          carryEligible: true,
          facts: { project: "p1" },
          group: {
            primary: { sandboxId: primary.sandboxId },
            resources: { project: "p1", services: ["client", "api"] },
            async stop() {},
          },
        };
      },
    };
    const source = composeSandbox({ file: "compose.yaml", mainService: "client" });
    const planned = planSandboxCase({
      evalId: "tb/sheets",
      environment: source,
      defaultProfileId: "tb-sheets",
      spec: dockerSpec(undefined, { compose: materializer }),
    });
    expect(planned.status).toBe("ready");
    if (planned.status !== "ready") return;
    const materialized = await materializePlannedCase(planned.plan, {
      ctx: { evalId: "tb/sheets", profile: "tb-sheets" },
    });
    assertSinglePrimary(materialized, primary);
    expect(materialized.group.resources).toMatchObject({ services: ["client", "api"] });
  });
});

describe("BuildKey / CaseKey 与身份规则", () => {
  it("BuildKey 对 Dockerfile / context / FROM digest 敏感,对无关字段不敏感", () => {
    const base = {
      builderKind: "docker",
      builderRevision: "1",
      platform: "linux/amd64",
      dockerfile: "FROM node:24\nRUN echo hi\n",
      contextDigest: "ctx-aaa",
      fromDigest: "sha256:from1",
    };
    const a = computeBuildKey(base);
    const b = computeBuildKey({ ...base, dockerfile: "FROM node:24\nRUN echo bye\n" });
    const c = computeBuildKey({ ...base, contextFilterRules: "exclude:verifier/**" });
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(computeBuildKey(base)).toBe(a);
  });

  it("CaseKey 含全部 BuildKey 与 bind mount,不含逐 attempt 随机名", () => {
    const bk = computeBuildKey({
      builderKind: "docker",
      builderRevision: "1",
      platform: "linux/amd64",
      dockerfile: "FROM scratch\n",
      contextDigest: "c",
      fromDigest: "sha256:x",
    });
    const a = computeCaseKey({
      caseKind: "compose",
      materializerRevision: "1",
      composeBytes: "services:\n  client:\n    build: .\n",
      buildKeys: [bk],
      bindMountDigests: { "./debug_server.py": "d1" },
      caseParams: { mainService: "client" },
    });
    const b = computeCaseKey({
      caseKind: "compose",
      materializerRevision: "1",
      composeBytes: "services:\n  client:\n    build: .\n",
      buildKeys: [bk],
      bindMountDigests: { "./debug_server.py": "d2" },
      caseParams: { mainService: "client" },
    });
    expect(a).not.toBe(b);
  });

  it("浮动 tag 解不出 digest 时禁止携带,钉 digest 的 ref 直接通过", async () => {
    const unresolved = await resolveFloatingImageTag("node:24-slim", async () => undefined);
    expect(unresolved).toEqual({ status: "unresolved", ref: "node:24-slim", carryEligible: false });

    const pinned = await resolveFloatingImageTag(
      "node@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      async () => {
        throw new Error("should not call registry");
      },
    );
    expect(pinned.status).toBe("resolved");

    const resolved = await resolveFloatingImageTag("node:24-slim", async () => "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    expect(resolved).toMatchObject({ status: "resolved", digest: expect.stringContaining("sha256:") });
  });

  it("凭据只贡献 name/revision,从不接收 secret 值字段", () => {
    expect(credentialIdentityContribution({ name: "REGISTRY_TOKEN" })).toEqual({ name: "REGISTRY_TOKEN" });
    expect(credentialIdentityContribution({ name: "REGISTRY_TOKEN", revision: "tenant-b" })).toEqual({
      name: "REGISTRY_TOKEN",
      revision: "tenant-b",
    });
    expect(assertPureDataIdentity({ cluster: "prod", rev: 3 })).toEqual({ cluster: "prod", rev: 3 });
  });

  it("dockerfileSandbox 在 Docker/E2B 走内置按需构建，不要求空壳 materializer", () => {
    const source = dockerfileSandbox({ context: ".", dockerfile: "Dockerfile" });
    expect(source.kind).toBe("dockerfile");
    for (const spec of [dockerSpec(), e2bSandbox()]) {
      const result = planSandboxCase({ evalId: "img", environment: source, spec });
      expect(result.status).toBe("ready");
      if (result.status !== "ready") continue;
      expect(result.plan).toMatchObject({ caseKind: "on-demand-build", sourceKind: "dockerfile", via: "builtin" });
    }
  });
});

function assertSinglePrimary(materialized: MaterializedSandboxCase, primary: Sandbox): void {
  expect(materialized.sandbox).toBe(primary);
  expect(materialized.group.primary.sandboxId).toBe(primary.sandboxId);
  // 不变量:对外只有一个主 Sandbox 引用,不能再挂第二份执行空间。
  expect(Object.keys(materialized).includes("sidecars")).toBe(false);
}
