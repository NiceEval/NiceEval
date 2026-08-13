import { defineConfig } from "niceeval";

export default defineConfig({
  name: { "zh-CN": "opencode E2E", en: "opencode E2E" },
  timeoutMs: 600_000,
  maxConcurrency: 4,
});
