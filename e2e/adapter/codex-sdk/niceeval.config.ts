import { defineConfig } from "niceeval";

export default defineConfig({
  name: {
    "zh-CN": "e2e: Codex SDK converter live compatibility",
    en: "e2e: Codex SDK converter live compatibility",
  },
  timeoutMs: 12 * 60_000,
  maxConcurrency: 4,
});
