import { defineConfig } from "vitest/config";
import { configDefaults } from "vitest/config";

export default defineConfig({
  test: {
    // .claude/worktrees 里是 agent 的临时 worktree，含整份 src 副本；不排掉会被当成正式测试跑
    exclude: [...configDefaults.exclude, ".repos/**", ".claude/**"],
  },
});
