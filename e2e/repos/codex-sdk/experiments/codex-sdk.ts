// 本仓库唯一的 Experiment:覆盖 evals/ 下全部 Eval(省略 `evals` 字段 = 全选)。
// deliberate-fail / deliberate-error 这类退出码折叠验证属于 cli-contract 仓库,不在这里重复。
import { defineExperiment } from "niceeval";
import agent from "../agents/codex-sdk.ts";

export default defineExperiment({
  description: "codex-sdk 协议闭环:coding tool / MCP 工具 / 会话续接 / usage / HITL 反证",
  agent,
  model: process.env.AGENT_MODEL,
  runs: 2,
  earlyExit: true,
  budget: 3,
});
