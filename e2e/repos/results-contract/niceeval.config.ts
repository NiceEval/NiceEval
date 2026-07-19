import { defineConfig } from "niceeval";

// results-contract only asserts mechanism (disk format, openResults() parity, --json
// parity, --junit folding) — no judge config needed (docs/engineering/e2e-ci/README.md §7).
//
// `pricing` pins a stable cost-per-token for the model this repo's agent calls, so the
// estimatedCostUSD assertions in scripts/verify.ts don't depend on niceeval's vendored
// price snapshot (src/o11y/prices.json) still carrying a "deepseek-chat" entry.
export default defineConfig({
  name: { en: "results-contract E2E", "zh-CN": "results-contract E2E" },
  timeoutMs: 60_000,
  pricing: {
    "deepseek-chat": { inputPerMTok: 0.14, outputPerMTok: 0.28, cacheReadPerMTok: 0.0028 },
  },
});
