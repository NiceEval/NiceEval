import { defineConfig } from "niceeval";

export default defineConfig({
  name: { "zh-CN": "bub E2E", en: "bub E2E" },
  // 首次安装会拉 Python 3.12 工具链、Bub 和 OTel 插件。后续 Attempt 可复用安装 checkpoint。
  timeoutMs: 300_000,
  maxConcurrency: 4,
});
