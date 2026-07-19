import { defineConfig } from "vitest/config";
import { configDefaults } from "vitest/config";

export default defineConfig({
  test: {
    // .claude/worktrees 里是 agent 的临时 worktree，含整份 src 副本；不排掉会被当成正式测试跑
    // e2e/repos/* 是独立测试仓库，各自有自己的测试运行方式（pnpm e2e），根 vitest 不应该
    // 递归进去——沙箱型仓库运行时会拉取真实插件/依赖内容（可能含 *.test.ts 文件），不排掉
    // 会被误当成本仓库的正式测试跑
    exclude: [...configDefaults.exclude, ".repos/**", ".claude/**", "e2e/repos/**"],
  },
});
