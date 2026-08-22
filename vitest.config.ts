import { defineConfig } from "vitest/config";
import { configDefaults } from "vitest/config";

// 三个 project 按「验证对象」切，代码可直接运行 unit project，文档与文档站走统一 lint：
//   unit           → 代码           `pnpm exec vitest run --project unit`  src/ 单元测试
//   lint-docs      → docs/ memory/  `pnpm lint:docs`                      索引、链接、写作规则与用例登记
//   lint-docs-site → docs-site/     `pnpm lint:docs-site`                 生成区块、随包索引与 Mint 校验
// project 成员资格由目录决定，不由清单决定——新守护文件放进哪个目录就归哪个入口，
// 不存在「三个 include 谁都没收它、于是永远不跑」的静默失效。真机 Docker 验收由
// vitest.docker.config.ts 显式进入，不属于默认 suite。
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
const UNIT_EXCLUDE = [...EXCLUDE, "src/**/*.docker.test.ts"];

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["packages/niceeval/src/**/*.test.ts", "packages/niceeval/src/**/*.test.tsx", "test/unit/**/*.test.ts"],
          exclude: UNIT_EXCLUDE,
        },
      },
      {
        test: {
          name: "lint-docs",
          include: ["lint/docs/**/*.lint.ts"],
          exclude: EXCLUDE,
        },
      },
      {
        test: {
          name: "lint-docs-site",
          include: ["lint/docs-site/**/*.lint.ts"],
          exclude: EXCLUDE,
        },
      },
    ],
  },
});
