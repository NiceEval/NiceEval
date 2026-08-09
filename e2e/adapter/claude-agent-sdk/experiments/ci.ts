import { defineExperiment } from "niceeval";
import agent, { CLAUDE_AGENT_SDK_LIVE_MODEL } from "../agents/claude-agent-sdk.ts";

export default defineExperiment({
  description: "锁定 Claude Agent SDK 的 query() 原生帧进入公共 converter 的 live 闭环",
  agent,
  model: CLAUDE_AGENT_SDK_LIVE_MODEL,
  evals: ["bash-session"],
  attempts: 1,
});
