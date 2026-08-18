import { defineConfig } from "niceeval";

export default defineConfig({
  name: { "zh-CN": "DeepSeek Harness E2E", en: "DeepSeek Harness E2E" },
  timeoutMs: 300_000,
  maxConcurrency: 1,
});
