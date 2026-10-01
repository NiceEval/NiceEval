import { defineExperiment } from "niceeval";
import { VercelProvider } from "niceeval/judge";
import { judgeUsageApplication } from "../adapters/judge-usage.ts";

export default defineExperiment({
  adapter: judgeUsageApplication, evals: ["judge-usage-qa"], attempts: 1,
  // The existing explicit profile is input=1/output=2 USD per million tokens.
  judgeRuntime: VercelProvider({ model: "inspection-fixture-v1", baseUrl: process.env.NICEEVAL_E2E_JUDGE_USAGE_URL ?? "http://127.0.0.1:1/v1", apiKey: "judge-usage-offline-key", timeoutMs: 10_000 }),
});
