import { defineExperiment } from "niceeval";
import { codexAgent } from "niceeval/adapter";
import { sandbox } from "../sandbox.ts";

export default defineExperiment({
  description: "hitl:Codex 原生选项请求、结构化选择与会话恢复",
  agent: codexAgent({ configFile: "configs/shell-enabled.toml" }),
  model: "gpt-5.6-luna",
  sandbox,
  flags: { requestHitl: true },
  evals: ["hitl-options"],
  attempts: 1,
  budget: 1,
});
