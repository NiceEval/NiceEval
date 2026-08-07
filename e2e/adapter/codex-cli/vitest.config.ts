import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // 单文件垂直 Journey：真实 Codex CLI + Docker sandbox + live provider，
    // 覆盖 6 个 experiment / 7 条 Eval（含 sandboxReuse 第二条 attempt）。
    testTimeout: 38 * 60_000,
    hookTimeout: 120_000,
  },
});
