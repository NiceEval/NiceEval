import { defineConfig } from "vitest/config";

/**
 * 这些样例直接驱动 NiceEval 自己拥有的确定性语义，因此由核心仓库安装的依赖运行，
 * 不属于可复制的下游 scenario repo。独立配置避免被根配置的常规 include 隐式排除。
 */
export default defineConfig({
  test: {
    include: ["docs/roadmap/testing/example/unit/**/*.test.ts"],
  },
});
