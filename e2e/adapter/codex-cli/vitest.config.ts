import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // 单文件垂直 Journey：真实 Codex CLI + Docker sandbox + live provider，
    // 覆盖 7 个 experiment / 11 条 Eval（含远程 Skill 与 sandboxReuse）。
    testTimeout: 46 * 60_000,
    hookTimeout: 120_000,
  },
});
