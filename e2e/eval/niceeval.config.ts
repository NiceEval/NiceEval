import { defineConfig } from "niceeval";

const judgeBaseUrl = process.env.NICEEVAL_E2E_JUDGE_BASE_URL;

// The default remains unconfigured for the zero-network unavailable owner. The
// positive owner injects only its local fake provider endpoint through the runner.
export default defineConfig({
  timeoutMs: 60_000,
  maxConcurrency: 4,
  pricing: {
    "eval-deterministic": { inputPerMTok: 0, outputPerMTok: 0 },
  },
  ...(judgeBaseUrl === undefined ? {} : {
    judgeRuntime: {
      model: "judge-e2e",
      baseUrl: judgeBaseUrl,
      apiKeyEnv: "NICEEVAL_E2E_JUDGE_KEY",
      timeoutMs: 10_000,
      maxOutputTokens: 128,
    },
  }),
});
