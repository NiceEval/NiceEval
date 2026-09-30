import { OpenAIProvider } from "niceeval/judge";
import { defineConfig } from "niceeval";

const judgeBaseUrl = process.env.NICEEVAL_E2E_JUDGE_BASE_URL;

// The default remains unconfigured for the zero-network unavailable owner. The
// positive owner injects only its local fake provider endpoint through the runner.
export default defineConfig({
  timeoutMs: 60_000,
  maxConcurrency: 4,
  pricing: {
    "eval-deterministic": {
      basis: "catalog-reference",
      currency: "USD",
      source: { id: "niceeval-e2e-fixed-prices", asOf: 1_789_718_400_000 },
      inputPerMTok: 0,
      outputPerMTok: 0,
    },
    "openai/gpt-6-luna": {
      basis: "catalog-reference",
      currency: "USD",
      source: { id: "niceeval-e2e-fixed-prices", asOf: 1_789_718_400_000 },
      inputPerMTok: 0.2,
      outputPerMTok: 1.2,
      cacheReadPerMTok: 0.02,
      cacheWritePerMTok: 0.25,
    },
  },
  ...(judgeBaseUrl === undefined ? {} : {
    judgeRuntime: OpenAIProvider({
      model: "judge-e2e",
      baseUrl: judgeBaseUrl,
      apiKeyEnv: "NICEEVAL_E2E_JUDGE_KEY",
      timeoutMs: 10_000,
      maxOutputTokens: 128,
    }),
  }),
});
