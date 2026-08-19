import { defineExperiment } from "niceeval";
import { deterministicAgent } from "../agents/deterministic.ts";

export default defineExperiment({
  description: "Judge 预检失败的 locatorless JSON 归因",
  agent: deterministicAgent("cli-judge-precheck-error"),
  attempts: 2,
  judge: {
    model: "judge-fixture",
    baseUrl: "http://127.0.0.1:1/v1",
    apiKeyEnv: "CLI_JUDGE_TEST_KEY",
  },
  evals: ["judge-precheck/unreachable"],
});
