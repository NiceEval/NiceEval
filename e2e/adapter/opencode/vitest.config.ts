import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // 单文件垂直 Journey：真实 OpenCode CLI + Docker sandbox + live provider，
    // 覆盖 compat 基线与 OpenCode Go 原生 provider 两条配置线。
    testTimeout: 52 * 60_000,
    hookTimeout: 120_000,
  },
});
