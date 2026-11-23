import { createRequire } from "node:module";
import { defineConfig } from "vitest/config";
import { configDefaults } from "vitest/config";
import architectureReporter from "./test/architecture-reporter.ts";

// unit 收集代码测试与 test/unit 下的仓库守护；Mint 构建与断链检查走 pnpm lint:docs-site。
// include 按仓库根锚定，正式安装后 E2E 由独立 runner 执行，不属于默认 suite。
const EXCLUDE = [
  ...configDefaults.exclude,
  // include 已按仓库根锚定（src/、test/ 开头），下面这些沙箱型目录本就匹配不到；
  // 保留为第二道闸，防止将来放宽 include 时重新收进别家的 *.test.ts：
  // .claude/worktrees 是 agent 临时 worktree（含整份 src 副本），
  // e2e/adapter|cli|report|undo 是独立测试仓库与暂停 fixture（运行时会拉真实插件依赖）。
  ".repos/**",
  ".claude/**",
  "e2e/adapter/**",
  "e2e/cli/**",
  "e2e/cli-built/**",
  "e2e/cli-docker/**",
  "e2e/eval-built/**",
  "e2e/report/**",
  "e2e/undo/**",
];
const UNIT_EXCLUDE = [...EXCLUDE, "packages/niceeval/src/**/*.docker.test.ts"];

const LAYERS = "{integration,cli,process}";
const SOURCE_CONDITION = "niceeval-source";
const SOURCE_EXEC_ARGV = [
  `--conditions=${SOURCE_CONDITION}`,
  ...(process.features.typescript
    ? []
    : process.allowedNodeEnvironmentFlags.has("--experimental-transform-types")
      ? ["--experimental-transform-types"]
      : ["--require", createRequire(import.meta.url).resolve("tsx/cjs")]),
];
const CONDITIONS = ["docker", "linux", "live"] as const;
const conditionedTests = (condition: string) => `test/${LAYERS}/**/*.${condition}.test.ts`;

// Let Node load the product on the same module graph as the fixtures loaded by Jiti.
const sourceProject = {
  ssr: { resolve: { conditions: [SOURCE_CONDITION, "module", "node", "development|production"] } },
};
const sourceDeps = { deps: { external: [/\/packages\/niceeval\/src\//] } };
const testCostScale = Number(process.env.NICEEVAL_TEST_COST_SCALE ?? 1);
if (!Number.isFinite(testCostScale) || testCostScale <= 0) {
  throw new Error("NICEEVAL_TEST_COST_SCALE must be a positive finite number");
}

export default defineConfig({
  test: {
    project: ["default", "unit"],
    reporters: ["default", architectureReporter(testCostScale)],
    projects: [
      {
        ...sourceProject,
        test: {
          name: "default",
          // Record tests start their own storage workers inside Vitest's file workers.
          // Leave CPU capacity for them when measuring wall time on GitHub runners.
          maxWorkers: process.env.GITHUB_ACTIONS === "true" ? "50%" : undefined,
          execArgv: SOURCE_EXEC_ARGV,
          server: sourceDeps,
          include: [`test/${LAYERS}/**/*.test.ts`],
          exclude: [...EXCLUDE, ...CONDITIONS.map(conditionedTests)],
        },
      },
      ...CONDITIONS.map((name) => ({
        ...sourceProject,
        test: {
          name,
          // Docker inventory scans the entire daemon while other Docker files install
          // packages in live snapshots. Give each file exclusive use of the CI daemon.
          ...(name === "docker" && { fileParallelism: false }),
          execArgv: SOURCE_EXEC_ARGV,
          server: sourceDeps,
          include: [conditionedTests(name)],
          exclude: EXCLUDE,
        },
      })),
      {
        test: {
          name: "unit",
          include: ["packages/niceeval/src/**/*.test.ts", "packages/niceeval/src/**/*.test.tsx", "packages/repo-tools/src/**/*.test.ts", "test/unit/**/*.test.ts"],
          exclude: UNIT_EXCLUDE,
        },
      },
    ],
  },
});
