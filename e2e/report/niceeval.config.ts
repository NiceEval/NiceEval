import { defineConfig } from "niceeval";

// results only asserts mechanism (disk format, openResults() parity, --json
// parity, --junit folding) — no judge config needed (docs/engineering/testing/e2e/README.md §7).
//
// `pricing` pins a stable cost-per-token for the model this repo's agent calls, so the
// estimatedCostUSD assertions in scripts/verify-format.ts don't depend on niceeval's vendored
// price snapshot (src/o11y/prices.json) still carrying a "deepseek-chat" entry.
export default defineConfig({
  name: { en: "results E2E", "zh-CN": "results E2E" },
  timeoutMs: 60_000,
  pricing: {
    "deepseek-chat": { inputPerMTok: 0.14, outputPerMTok: 0.28, cacheReadPerMTok: 0.0028 },
  },
});
