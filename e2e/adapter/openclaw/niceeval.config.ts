import { defineConfig } from "niceeval";

export default defineConfig({
  name: { "zh-CN": "openclaw E2E", en: "openclaw E2E" },
  timeoutMs: 900_000,
  maxConcurrency: 4,
});
