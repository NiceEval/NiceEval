import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // 单文件 Journey：串行覆盖 transport / 断流 / 超时 / HTTP 错误 / cleanup。
    testTimeout: 8 * 60_000,
    hookTimeout: 60_000,
  },
});
