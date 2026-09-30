import { defineExperiment } from "niceeval";
import { OpenAIProvider } from "niceeval/judge";
import { markerApplication } from "../evals/assertion-judge-fake.eval.ts";

export default defineExperiment({
  description: "挂起的 Judge HTTP 请求由 Attempt deadline 取消",
  adapter: markerApplication,
  judgeRuntime: OpenAIProvider({
    model: "judge-e2e",
    baseUrl: process.env.NICEEVAL_E2E_JUDGE_BASE_URL,
    apiKeyEnv: "NICEEVAL_E2E_JUDGE_KEY",
    supportsImages: true,
    maxOutputTokens: 128,
  }),
  timeoutMs: 4_000,
  evals: ["assertion-judge-cancelled"],
});
