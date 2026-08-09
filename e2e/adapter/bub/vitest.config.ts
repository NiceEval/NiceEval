import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // 单文件垂直 Journey：真实 bub + Docker sandbox + live provider，
    // 覆盖 ci 四条 Eval 与 legacy 版本线。
    testTimeout: 36 * 60_000,
    hookTimeout: 120_000,
  },
});
