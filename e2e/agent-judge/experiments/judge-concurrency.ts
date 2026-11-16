import { defineExperiment } from "niceeval";
import { OpenAIProvider } from "niceeval/judge";
import { lifecycleSandbox, quickAgent } from "../agents/deterministic.ts";
const selection = process.env.NICEEVAL_E2E_JUDGE_SELECTION;
export default defineExperiment({
  ...(selection === "model"
    ? { judge: "overridden-model" }
    : selection === "provider"
      ? {
          judge: OpenAIProvider({
            model: "replacement-model",
            baseUrl: process.env.NICEEVAL_E2E_AGENT_JUDGE_URL!,
            apiKeyEnv: "NICEEVAL_E2E_AGENT_JUDGE_KEY",
          }),
        }
      : {}),
  adapter: quickAgent,
  sandbox: lifecycleSandbox,
  evals: ["judge-concurrency"],
});
