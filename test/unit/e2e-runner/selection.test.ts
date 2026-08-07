// cases: docs/engineering/testing/unit/experiments-runner.md
// 「E2E repo selection」类别：证明 lane、重复 --repo、capability、path
// 优化与 diff fail-open 的纯选择契约；计划投影不携带命令、secret 等执行字段。

import { describe, expect, it } from "vitest";

import { makePlan, parsePlanCli, selectRepos } from "../../../e2e/scripts/plan.ts";
import type { DiscoveredRepo } from "../../../e2e/scripts/discovery.ts";

function repo(
  id: string,
  overrides: Partial<DiscoveredRepo["manifest"]> = {},
): DiscoveredRepo {
  return {
    dir: `/checkout/e2e/${id}`,
    manifest: {
      schemaVersion: 1,
      id,
      areas: ["runner"],
      lanes: ["pr"],
      executor: { kind: "host" },
      command: ["pnpm", "e2e"],
      timeoutMinutes: 10,
      secrets: ["DO_NOT_PLAN"],
      paths: [],
      artifacts: [],
      ...overrides,
    },
  };
}

describe("E2E plan selection", () => {
  it("本地未声明 lane 时默认选择无密钥 PR 集合", () => {
    expect(parsePlanCli([]).lane).toBe("pr");
    expect(parsePlanCli(["--repo", "report"]).lane).toBe("pr");
  });

  const repos = [
    repo("cli", { areas: ["cli"], lanes: ["pr"], paths: ["e2e/cli/**"] }),
    repo("report", { areas: ["report"], lanes: ["pr", "main"], paths: ["e2e/report/**"] }),
    repo("live", { areas: ["adapter"], lanes: ["main"], paths: ["e2e/adapter/live/**"] }),
    repo("always", { areas: ["lifecycle"], lanes: ["pr"], paths: [] }),
  ];

  it("按 lane 选择，并将重复 --repo 合并为一次", () => {
    expect(selectRepos(repos, { lane: "pr", repoIds: ["report", "report", "cli"] }).map((r) => r.manifest.id)).toEqual([
      "cli",
      "report",
    ]);
    expect(selectRepos(repos, { lane: "pr" }).map((r) => r.manifest.id)).toEqual(["cli", "report", "always"]);
  });

  it("capability 匹配 manifest areas，path 匹配命中才收窄", () => {
    expect(selectRepos(repos, { lane: "pr", capability: "report" }).map((r) => r.manifest.id)).toEqual(["report"]);
    expect(selectRepos(repos, { lane: "pr", diffPaths: ["e2e/report/show.ts"] }).map((r) => r.manifest.id)).toEqual([
      "report",
      "always",
    ]);
  });

  it("无法求 diff 时 fail-open，不因 undefined 或空路径静默漏跑", () => {
    expect(selectRepos(repos, { lane: "pr", diffPaths: undefined }).map((r) => r.manifest.id)).toEqual([
      "cli",
      "report",
      "always",
    ]);
    expect(selectRepos(repos, { lane: "pr", diffPaths: [] }).map((r) => r.manifest.id)).toEqual([
      "cli",
      "report",
      "always",
    ]);
  });

  it("候选源码、共享 runner、Testkit、根 workspace/lock 或 workflow 变化时 fail-open 跑完整 lane", () => {
    for (const path of [
      "src/cli.ts",
      "e2e/scripts/run.ts",
      "packages/testkit/src/index.ts",
      "pnpm-workspace.yaml",
      "pnpm-lock.yaml",
      ".github/workflows/e2e.yml",
    ]) {
      expect(selectRepos(repos, { lane: "pr", diffPaths: [path] }).map((repo) => repo.manifest.id)).toEqual([
        "cli",
        "report",
        "always",
      ]);
    }
  });

  it("Testkit/workspace/注入契约变化时动态选中全部 harness.testkit 消费者", () => {
    const consumers = [
      repo("tk-consumer-a", { areas: ["runner"], lanes: ["pr"], paths: ["e2e/tk-a/**"], harness: { testkit: true } }),
      repo("tk-consumer-b", { areas: ["report"], lanes: ["pr"], paths: ["e2e/tk-b/**"], harness: { testkit: true } }),
    ];
    const set = [...repos, ...consumers];
    // 只有无关文件变化时,path 过滤仍然收窄,与声明无关的消费者不进场。
    expect(
      selectRepos(set, { lane: "pr", diffPaths: ["e2e/cli/cmd.ts"] }).map((r) => r.manifest.id),
    ).toEqual(["cli", "always"]);
    // 根 workspace、Testkit 源码或注入契约变化时,path 优化整体失效,全部消费者被选中。
    for (const path of ["pnpm-workspace.yaml", "packages/testkit/src/index.ts", "e2e/scripts/injection.ts"]) {
      const ids = selectRepos(set, { lane: "pr", diffPaths: [path] }).map((r) => r.manifest.id);
      expect(ids).toContain("tk-consumer-a");
      expect(ids).toContain("tk-consumer-b");
    }
  });

  it("plan 投影只含 matrix 所需信息，不触碰执行字段", () => {
    const [entry] = makePlan(repos, "/checkout/e2e", { lane: "pr", capability: "cli" });
    expect(entry).toMatchObject({
      id: "cli",
      dir: "cli",
      executor: { kind: "host" },
      capabilities: ["cli"],
      shard: "cli",
    });
    expect(entry).not.toHaveProperty("command");
    expect(entry).not.toHaveProperty("secrets");
  });

  it("显式 repo 不存在时给出可行动错误", () => {
    expect(() => selectRepos(repos, { lane: "pr", repoIds: ["missing"] })).toThrow(/unknown id/);
  });
});
