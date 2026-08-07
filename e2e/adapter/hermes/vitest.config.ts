import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // 单文件垂直 Journey：真实 Hermes CLI + Docker sandbox + live provider，
    // 覆盖 1 个 experiment（experiments/ci.ts）/ 3 条 Eval。
    testTimeout: 38 * 60_000,
    hookTimeout: 120_000,
  },
});
