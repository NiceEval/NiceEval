import { defineExperiment } from "niceeval";
import agent from "../agents/codex-mcp.ts";

export default defineExperiment({
  description: "codex-cli MCP 闭环:stdio 与远程 HTTP 两种传输形态,外加未挂载 server 的反例",
  agent,
  model: "gpt-5.4-mini",
  evals: ["mcp"],
  runs: 2,
  earlyExit: true,
  budget: 3,
});
