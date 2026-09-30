import { defineConfig } from "niceeval";

export default defineConfig({
  name: { en: "Inspection E2E fixture", "zh-CN": "Inspection E2E fixture" },
  timeoutMs: 60_000,
  maxConcurrency: 1,
  pricing: {
    "openai/gpt-6-luna": {
      basis: "catalog-reference",
      currency: "USD",
      source: { id: "niceeval-insight-fixed-prices", asOf: 1_789_718_400_000 },
      inputPerMTok: 0.2,
      outputPerMTok: 1.2,
      cacheReadPerMTok: 0.02,
      cacheWritePerMTok: 0.25,
    },
  },
});
