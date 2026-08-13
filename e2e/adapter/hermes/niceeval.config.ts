import { defineConfig } from "niceeval";

export default defineConfig({
  name: { "zh-CN": "hermes E2E", en: "hermes E2E" },
  timeoutMs: 600_000,
  maxConcurrency: 4,
});
