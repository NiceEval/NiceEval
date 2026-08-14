import { defineConfig } from "niceeval";

export default defineConfig({
  name: { en: "Report E2E fixture", "zh-CN": "Report E2E fixture" },
  timeoutMs: 60_000,
  maxConcurrency: 4,
});
