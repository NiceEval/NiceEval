import { defineExperiment } from "niceeval";
import { OpenAIProvider } from "niceeval/judge";
import { judgeUsageApplication } from "../adapters/judge-usage.ts";

export default defineExperiment({
  adapter: judgeUsageApplication,
  evals: ["judge-retry-policy"],
  judge: OpenAIProvider({
    model: "retry-fixture",
    baseUrl: process.env.NICEEVAL_E2E_RETRY_URL ?? "http://127.0.0.1:1/v1",
    apiKey: "retry-fixture-key",
    timeoutMs: process.env.NICEEVAL_E2E_RETRY_DEADLINE === "short" ? 1500 : 15000,
  }),
});
