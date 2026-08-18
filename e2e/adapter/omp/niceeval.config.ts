import { defineConfig } from "niceeval";

export default defineConfig({
  name: { "zh-CN": "OMP E2E", en: "OMP E2E" },
  timeoutMs: 300_000,
  maxConcurrency: 1,
});
