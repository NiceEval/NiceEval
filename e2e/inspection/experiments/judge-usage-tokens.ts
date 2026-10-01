import { defineExperiment } from "niceeval";
import { VercelProvider } from "niceeval/judge";
import { judgeUsageApplication } from "../adapters/judge-usage.ts";

export default defineExperiment({
  adapter: judgeUsageApplication, evals: ["judge-usage-qa"], attempts: 1,
  judgeRuntime: VercelProvider({ model: "judge-usage-request", baseUrl: process.env.NICEEVAL_E2E_JUDGE_USAGE_URL ?? "http://127.0.0.1:1/v1", apiKey: "judge-usage-offline-key", timeoutMs: 10_000 }),
});
