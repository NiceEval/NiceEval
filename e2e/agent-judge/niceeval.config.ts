import { defineConfig } from "niceeval";

import { OpenAIProvider, TypesafeProvider } from "niceeval/judge";
const judgeBaseUrl = process.env.NICEEVAL_E2E_AGENT_JUDGE_URL;
export default defineConfig({ timeoutMs: process.env.NICEEVAL_E2E_AGENT_JUDGE_MODE === "cancel-http" ? 30_000 : 120_000, maxConcurrency: 4,
  ...(judgeBaseUrl === undefined ? {} : { judgeProvider: (process.env.NICEEVAL_E2E_AGENT_JUDGE_MODE === "typesafe" ? TypesafeProvider : OpenAIProvider)({ model: process.env.NICEEVAL_E2E_AGENT_JUDGE_MODEL ?? "agent-review-fixture", baseUrl: judgeBaseUrl,
    apiKeyEnv: "NICEEVAL_E2E_AGENT_JUDGE_KEY", ...(process.env.NICEEVAL_E2E_AGENT_JUDGE_MODE?.startsWith("compact-") ? { maxResponseBytes: 262144 } : {}), timeoutMs: process.env.NICEEVAL_E2E_AGENT_JUDGE_MODE === "cancel-http" ? 60_000 : 2_000, ...(process.env.NICEEVAL_E2E_AGENT_JUDGE_MODE === "typesafe" ? {} : { maxOutputTokens: 4096 }) }) }),
});
