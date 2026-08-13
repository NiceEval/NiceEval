import { createE2EContext, type ArtifactStageEntry } from "@niceeval/testkit";
import { join, resolve } from "node:path";

/**
 * 每个 owner 自己在这个副本内写入 `.niceeval`；这里仅声明副本生命周期和
 * 已安装 candidate 的 node_modules 链接，不封装任何产品 argv 或 expected。
 */
export const reportProjectCopy = {
  from: process.cwd(),
  prefix: "niceeval-e2e-report-",
  omitTopLevel: [".e2e-artifacts", ".niceeval", "evidence", "node_modules", "site-export", "test", "test-results"],
  links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
} as const;

/**
 * Report Repo 共享的 E2E context：所有 case 共用一个 context 实例，
 * 各自通过 reportE2E.case 声明 artifact entry 与完整 argv/readiness/expected。
 */
export const reportE2E = createE2EContext({
  repoId: "report",
  project: reportProjectCopy,
  commands: {
    niceeval: [join(process.cwd(), "node_modules", ".bin", "niceeval")],
  },
});

/**
 * report 特有 artifact entry：固定收集 `.niceeval`，附加目录由各 case owner
 * 显式声明（例如静态导出或 JUnit 输出）。target 相对 case namespace，由
 * createE2EContext 统一铺到 `.e2e-artifacts/<invocation>/<case>/` 下。
 */
export function reportCaseArtifacts(extraDirectories: readonly string[] = []): readonly ArtifactStageEntry[] {
  return [
    { source: ".niceeval", target: ".niceeval", optional: true },
    ...extraDirectories.map((directory) => ({
      source: directory,
      target: directory,
      optional: true,
    })),
  ];
}
