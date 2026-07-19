import { defineExperiment } from "niceeval";
import agent from "../agents/claude-code-mcp.ts";

// 独立实验:只挂了 stdio + 远程 HTTP MCP server 的 agent 才可能过。
export default defineExperiment({
  description: "mcp: claude-code agent with stdio + remote HTTP MCP servers mounted",
  agent,
  model: "deepseek-v4-flash",
  runs: 1,
  evals: (id) => id === "mcp-tools",
});
