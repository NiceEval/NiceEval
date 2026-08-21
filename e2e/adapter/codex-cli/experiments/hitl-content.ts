import { defineExperiment } from "niceeval";
import { codexAgent } from "niceeval/adapter";
import { sandbox } from "../sandbox.ts";

export default defineExperiment({
  description: "hitl-content:Codex 只输出普通内容时，HITL Eval 必须判为 failed",
  agent: codexAgent({ configFile: "configs/shell-enabled.toml" }),
  model: "gpt-5.6-luna",
  sandbox,
  flags: { requestHitl: false },
  evals: ["hitl-options"],
  attempts: 1,
  budget: 1,
});
