import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // 单文件垂直 Journey 内每一步按声明顺序串行执行,不依赖兄弟文件的执行顺序;
    // 它自己负责清理自己声明的 .niceeval / junit 路径。
    testTimeout: 240_000,
    hookTimeout: 120_000,
  },
});
