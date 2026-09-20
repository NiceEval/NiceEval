import { defineExperiment } from "niceeval";
import { deterministicAgent } from "../agents/deterministic.ts";

export default defineExperiment({
  description: "Judge 调用失败的 Attempt JSON 归因",
  agent: deterministicAgent("cli-judge-precheck-error"),
  attempts: 2,
  judgeRuntime: {
    model: "judge-fixture",
    baseUrl: "http://127.0.0.1:1/v1",
    apiKeyEnv: "CLI_JUDGE_TEST_KEY",
    maxOutputTokens: 128,
  },
  evals: ["judge-precheck/unreachable"],
});
