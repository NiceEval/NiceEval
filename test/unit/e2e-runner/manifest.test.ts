// cases: docs/engineering/testing/unit/experiments-runner.md
// 「E2E repo manifest schema 与发现」类别:根 orchestrator 与 e2e repo 之间的
// e2e.json 稳定契约(schemaVersion 1 的严格校验)与目录发现布局(adapter
// collection + 顶层功能 Repo)。只断言 manifest 稳定契约与发现结果,不锁实现
// 函数拆分;文件系统用每例独立的真实临时目录,不 mock fs。

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { discoverAllRepos } from "../../../e2e/scripts/discovery.ts";
import { parseManifest } from "../../../e2e/scripts/manifest.ts";

// ---------------------------------------------------------------------------
// Harness: builder 补机械默认值,case 只填有语义的字段
// ---------------------------------------------------------------------------

function validManifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: "cli",
    areas: ["runner"],
    lanes: ["pr"],
    executor: { kind: "host" },
    command: ["pnpm", "e2e"],
    timeoutMinutes: 15,
    secrets: [],
    paths: [],
    artifacts: [],
    ...overrides,
  };
}

function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "e2e-manifest-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeRepo(e2eRoot: string, dir: string, manifest: Record<string, unknown>): void {
  const full = join(e2eRoot, dir);
  mkdirSync(full, { recursive: true });
  writeFileSync(join(full, "e2e.json"), JSON.stringify(manifest, null, 2));
}

function errorsOf(result: { ok: boolean; errors: string[] }): string[] {
  return result.ok ? [] : result.errors;
}

// ---------------------------------------------------------------------------
// 合法 manifest
// ---------------------------------------------------------------------------

describe("e2e.json 合法 manifest", () => {
  it("host executor 解析为完整契约,字段原样保留", () => {
    const result = parseManifest(validManifest(), "cli/e2e.json");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest).toEqual({
      schemaVersion: 1,
      id: "cli",
      areas: ["runner"],
      lanes: ["pr"],
      executor: { kind: "host" },
      command: ["pnpm", "e2e"],
      timeoutMinutes: 15,
      secrets: [],
      paths: [],
      artifacts: [],
    });
  });

  it("docker executor 保留 image", () => {
    const result = parseManifest(
      validManifest({ executor: { kind: "docker", image: "node:22@sha256:abc" } }),
      "adapter/a/e2e.json",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.executor).toEqual({ kind: "docker", image: "node:22@sha256:abc" });
  });

  it("requires 全部字段合法时解析通过", () => {
    const result = parseManifest(
      validManifest({
        requires: {
          docker: true,
          externalNetwork: false,
          platforms: ["linux", "darwin"],
          runtimes: ["node>=22"],
          browsers: ["chromium"],
        },
      }),
      "cli/e2e.json",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.requires).toEqual({
      docker: true,
      externalNetwork: false,
      platforms: ["linux", "darwin"],
      runtimes: ["node>=22"],
      browsers: ["chromium"],
    });
  });

  it("harness.testkit: true 声明消费意图并原样保留", () => {
    const result = parseManifest(validManifest({ harness: { testkit: true } }), "cli/e2e.json");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.harness).toEqual({ testkit: true });
  });

  it("harness 缺省或 harness.testkit: false 解析为不消费", () => {
    expect(parseManifest(validManifest(), "cli/e2e.json").ok).toBe(true);
    const result = parseManifest(validManifest({ harness: { testkit: false } }), "cli/e2e.json");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.harness).toEqual({ testkit: false });
  });
});

// ---------------------------------------------------------------------------
// 缺字段
// ---------------------------------------------------------------------------

describe("e2e.json 缺字段", () => {
  const REQUIRED = [
    "schemaVersion",
    "id",
    "areas",
    "lanes",
    "executor",
    "command",
    "timeoutMinutes",
    "secrets",
    "paths",
    "artifacts",
  ] as const;

  it.each(REQUIRED)("缺少 %s 时整份拒绝,报错点名该字段", (field) => {
    const { [field]: _omitted, ...rest } = validManifest();
    const errors = errorsOf(parseManifest(rest, "cli/e2e.json"));
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes(`"${field}"`))).toBe(true);
  });

  it("docker executor 缺 image 时拒绝", () => {
    const errors = errorsOf(parseManifest(validManifest({ executor: { kind: "docker" } }), "a/e2e.json"));
    expect(errors.some((e) => e.includes('"executor.image"'))).toBe(true);
  });

  it("schemaVersion 不是 1 时拒绝", () => {
    const errors = errorsOf(parseManifest(validManifest({ schemaVersion: 2 }), "a/e2e.json"));
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes('"schemaVersion"'))).toBe(true);
  });

  it("顶层不是 JSON 对象时拒绝", () => {
    for (const raw of [null, [1, 2], "cli"]) {
      const errors = errorsOf(parseManifest(raw, "a/e2e.json"));
      expect(errors.some((e) => e.includes("must be a JSON object"))).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 未知字段
// ---------------------------------------------------------------------------

describe("e2e.json 未知字段", () => {
  it("顶层未知字段报错,旧 group 字段按未知字段拒绝", () => {
    const errors = errorsOf(parseManifest(validManifest({ group: "cli" }), "cli/e2e.json"));
    expect(errors.some((e) => e.includes("unknown field") && e.includes('"group"'))).toBe(true);
  });

  it("requires 内未知字段报错", () => {
    const errors = errorsOf(
      parseManifest(validManifest({ requires: { memoryGB: 8 } }), "a/e2e.json"),
    );
    expect(errors.some((e) => e.includes("unknown field") && e.includes('"memoryGB"'))).toBe(true);
  });

  it("executor 内未知字段报错", () => {
    const errors = errorsOf(
      parseManifest(validManifest({ executor: { kind: "host", cpus: 2 } }), "a/e2e.json"),
    );
    expect(errors.some((e) => e.includes("unknown field") && e.includes('"cpus"'))).toBe(true);
  });

  it("harness 内未知字段报错", () => {
    const errors = errorsOf(
      parseManifest(validManifest({ harness: { sandbox: true } }), "a/e2e.json"),
    );
    expect(errors.some((e) => e.includes("unknown field") && e.includes('"sandbox"'))).toBe(true);
  });

  it("harness 不是对象或 harness.testkit 不是布尔时拒绝", () => {
    const notObject = errorsOf(parseManifest(validManifest({ harness: true }), "a/e2e.json"));
    expect(notObject.some((e) => e.includes('"harness"'))).toBe(true);
    const notBoolean = errorsOf(parseManifest(validManifest({ harness: { testkit: "yes" } }), "a/e2e.json"));
    expect(notBoolean.some((e) => e.includes('"harness.testkit"'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 非法 enum
// ---------------------------------------------------------------------------

describe("e2e.json 非法 enum 与取值", () => {
  it("areas 含非法成员时拒绝", () => {
    const errors = errorsOf(parseManifest(validManifest({ areas: ["weekly"] }), "a/e2e.json"));
    expect(errors.some((e) => e.includes('"areas"'))).toBe(true);
  });

  it("record 是公开格式 owner 的合法 area", () => {
    const result = parseManifest(validManifest({ areas: ["record"] }), "record/e2e.json");
    expect(result.ok).toBe(true);
  });

  it("lanes 含非法成员时拒绝", () => {
    const errors = errorsOf(parseManifest(validManifest({ lanes: ["weekly"] }), "a/e2e.json"));
    expect(errors.some((e) => e.includes('"lanes"'))).toBe(true);
  });

  it("executor.kind 不是 host/docker 时拒绝", () => {
    const errors = errorsOf(
      parseManifest(validManifest({ executor: { kind: "kubernetes" } }), "a/e2e.json"),
    );
    expect(errors.some((e) => e.includes('"executor.kind"'))).toBe(true);
  });

  it("requires.platforms 含非法成员时拒绝", () => {
    const errors = errorsOf(
      parseManifest(validManifest({ requires: { platforms: ["windows"] } }), "a/e2e.json"),
    );
    expect(errors.some((e) => e.includes('"requires.platforms"'))).toBe(true);
  });

  it("requires.browsers 含非法成员时拒绝", () => {
    const errors = errorsOf(
      parseManifest(validManifest({ requires: { browsers: ["edge"] } }), "a/e2e.json"),
    );
    expect(errors.some((e) => e.includes('"requires.browsers"'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 目录发现
// ---------------------------------------------------------------------------

describe("目录发现布局", () => {
  it("adapter collection 与顶层功能 Repo 都被发现,目录结构与 id 无关", () => {
    withTempDir((e2eRoot) => {
      writeRepo(e2eRoot, "adapter/a", validManifest({ id: "adapter/a", areas: ["adapter"] }));
      writeRepo(e2eRoot, "adapter/b", validManifest({ id: "adapter/b", areas: ["adapter"] }));
      writeRepo(e2eRoot, "cli", validManifest({ id: "cli", command: ["pnpm", "test"] }));
      mkdirSync(join(e2eRoot, "scripts"), { recursive: true }); // 无 e2e.json 的目录不是 Repo
      writeRepo(e2eRoot, "undo/x", validManifest({ id: "x" })); // 嵌套 manifest 不发现

      const result = discoverAllRepos(e2eRoot);
      expect(result.errors).toEqual([]);
      expect(result.repos.map((r) => r.manifest.id)).toEqual(["adapter/a", "adapter/b", "cli"]);
      expect(result.repos.every((r) => join(e2eRoot, r.manifest.id) === r.dir)).toBe(true);
      const cli = result.repos.find((r) => r.manifest.id === "cli")!;
      expect(cli.manifest.command).toEqual(["pnpm", "test"]);
    });
  });

  it("adapter repo 的 id 必须是 adapter/<leaf>,不符即拒绝", () => {
    withTempDir((e2eRoot) => {
      writeRepo(e2eRoot, "adapter/a", validManifest({ id: "a" }));
      writeRepo(e2eRoot, "adapter/b", validManifest({ id: "adapter/a" }));

      const result = discoverAllRepos(e2eRoot);
      expect(result.repos).toEqual([]);
      expect(result.errors.some((e) => e.includes('"adapter/a"'))).toBe(true);
      expect(result.errors.some((e) => e.includes('"adapter/b"'))).toBe(true);
    });
  });

  it("目录缺失或空集合不是错误", () => {
    withTempDir((e2eRoot) => {
      mkdirSync(join(e2eRoot, "scripts"), { recursive: true });
      const result = discoverAllRepos(e2eRoot);
      expect(result.repos).toEqual([]);
      expect(result.errors).toEqual([]);
    });
    expect(discoverAllRepos("/nonexistent/e2e-root").errors).toEqual([]);
  });

  it("损坏 JSON 报错,不静默跳过", () => {
    withTempDir((e2eRoot) => {
      mkdirSync(join(e2eRoot, "adapter/broken"), { recursive: true });
      writeFileSync(join(e2eRoot, "adapter/broken/e2e.json"), "{ not json");

      const result = discoverAllRepos(e2eRoot);
      expect(result.repos).toEqual([]);
      expect(result.errors.some((e) => e.includes("invalid JSON"))).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// 重复 id 全局唯一
// ---------------------------------------------------------------------------

describe("发现 id 全局唯一", () => {
  it("adapter id 与顶层功能 Repo id 撞车时报告重复", () => {
    withTempDir((e2eRoot) => {
      writeRepo(e2eRoot, "adapter/a", validManifest({ id: "adapter/a" }));
      writeRepo(e2eRoot, "a", validManifest({ id: "adapter/a" }));

      const result = discoverAllRepos(e2eRoot);
      expect(result.errors.some((e) => e.includes("duplicate id") && e.includes('"adapter/a"'))).toBe(
        true,
      );
    });
  });

  it("两个顶层功能 Repo 声明同一 id 时报告重复", () => {
    withTempDir((e2eRoot) => {
      writeRepo(e2eRoot, "x", validManifest({ id: "runner" }));
      writeRepo(e2eRoot, "y", validManifest({ id: "runner" }));

      const result = discoverAllRepos(e2eRoot);
      expect(result.errors.some((e) => e.includes("duplicate id") && e.includes('"runner"'))).toBe(
        true,
      );
    });
  });

  it("同名叶子跨集合不误报:adapter/opencode 与顶层 opencode 各自成立", () => {
    withTempDir((e2eRoot) => {
      writeRepo(e2eRoot, "adapter/opencode", validManifest({ id: "adapter/opencode" }));
      writeRepo(e2eRoot, "opencode", validManifest({ id: "opencode" }));

      const result = discoverAllRepos(e2eRoot);
      expect(result.errors).toEqual([]);
      expect(result.repos.map((r) => r.manifest.id).sort()).toEqual(["adapter/opencode", "opencode"]);
    });
  });
});
