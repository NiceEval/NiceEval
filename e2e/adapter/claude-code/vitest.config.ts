import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // 单文件垂直 Journey：真实 Claude Code + Docker sandbox + live provider，
    // 覆盖 8 个 experiment / 12 条 Eval（含远程 Skill、远程 Plugin 与 sandboxReuse）。
    testTimeout: 52 * 60_000,
    hookTimeout: 120_000,
  },
});
