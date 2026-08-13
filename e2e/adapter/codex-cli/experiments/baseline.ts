// 基线 agent 覆盖的三条 Eval:coding 任务工具轨 / 会话续接 / usage 与实际模型。
// deliberate-fail / deliberate-error 这类退出码折叠验证属于 cli 仓库,不在这里重复。
import { defineExperiment } from "niceeval";
import { codexAgent } from "niceeval/adapter";
import { sandbox } from "../sandbox.ts";

const agent = codexAgent({
  apiKey: process.env.CODEX_API_KEY,
  baseUrl: process.env.CODEX_BASE_URL,
  configFile: "configs/shell-enabled.toml",
});

export default defineExperiment({
  description: "codex-cli 基线闭环:coding 工具轨 / configFile / 会话续接 / usage 与实际模型",
  agent,
  model: "gpt-5.6-luna",
  sandbox,
  flags: { shellTool: true },
  evals: ["coding-task", "configfile", "session", "usage"],
  attempts: 1,
  budget: 3,
});
