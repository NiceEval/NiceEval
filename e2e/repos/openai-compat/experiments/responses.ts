import { defineExperiment } from "niceeval";
import agent from "../agents/responses.ts";

export default defineExperiment({
  description: "openai-compat: fromResponses 零映射(真实网关;404 时的取证路径见 agents/responses.ts)",
  agent,
  model: "deepseek-chat",
  evals: ["responses/"],
  runs: 1,
});
