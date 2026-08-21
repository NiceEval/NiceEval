import { codexAgent } from "niceeval/adapter";
import { defineExperiment } from "niceeval";
import { sandbox } from "../sandbox.ts";

export default defineExperiment({
  description: "Codex app-server 的协议内 failed Turn 保留为断言失败",
  agent: codexAgent({ apiKey: "fixture-key" }),
  sandbox,
  evals: ["failed-turn"],
  attempts: 1,
});
