import { defineConfig } from "vitest/config";
import { configDefaults } from "vitest/config";

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
  "e2e/report/**",
  "e2e/undo/**",
];
const UNIT_EXCLUDE = [...EXCLUDE, "packages/niceeval/src/**/*.docker.test.ts"];

export default defineConfig({
  test: {
    projects: [
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
