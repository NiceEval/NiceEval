import { defineExperiment } from "niceeval";
import agent from "../agents/claude-code-plugin.ts";

// 独立实验:只连了本仓库自带 Marketplace fixture 的 agent 才装得上这个 Plugin。
export default defineExperiment({
  description: "plugin: claude-code agent with a marketplace-installed plugin bundling its own MCP server",
  agent,
  model: "deepseek-v4-flash",
  runs: 1,
  evals: (id) => id === "plugin-mcp",
});
