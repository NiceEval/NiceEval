import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // 每个 owner 使用独立项目副本与动态端口，保留 Vitest 默认文件级并行。
    testTimeout: 2 * 60_000,
    hookTimeout: 60_000,
  },
});
