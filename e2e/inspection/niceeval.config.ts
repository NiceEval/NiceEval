import { defineConfig } from "niceeval";

export default defineConfig({
  name: { en: "Inspection E2E fixture", "zh-CN": "Inspection E2E fixture" },
  timeoutMs: 60_000,
  maxConcurrency: 1,
  pricing: {
    "inspection-fixture-v1": { inputPerMTok: 1, outputPerMTok: 2 },
  },
});
