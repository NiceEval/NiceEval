import { defineConfig } from "vitest/config";
import { configDefaults } from "vitest/config";

// 三个 project 按「验证对象」切，各有一个入口命令，互不重叠：
//   unit      → 代码           `pnpm test`           src/ 单测 + test/unit/ 的代码级仓库守护
//   docs      → docs/ memory/  `pnpm test:docs`      索引覆盖、链接真实性、句长段长行宽与禁用写法、用例登记
//   docs-site → docs-site/     `pnpm test:docs-site` 生成区块漂移、随包索引；命令里还串了 mint 校验
// project 成员资格由目录决定，不由清单决定——新守护文件放进哪个目录就归哪个入口，
// 不存在「三个 include 谁都没收它、于是永远不跑」的静默失效。
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

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["src/**/*.test.ts", "src/**/*.test.tsx", "test/unit/**/*.test.ts"],
          exclude: EXCLUDE,
        },
      },
      {
        test: {
          name: "docs",
          include: ["test/docs/**/*.test.ts"],
          exclude: EXCLUDE,
        },
      },
      {
        test: {
          name: "docs-site",
          include: ["test/docs-site/**/*.test.ts"],
          exclude: EXCLUDE,
        },
      },
    ],
  },
});
