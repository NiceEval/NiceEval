import { defineExperiment } from "niceeval";
import { claudeCodeAgent } from "niceeval/adapter";
import { sandbox } from "../sandbox.ts";

const agent = claudeCodeAgent({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseUrl: process.env.ANTHROPIC_BASE_URL,
  plugins: [
    {
      marketplace: {
        name: "claude-plugins-official",
        source: "anthropics/claude-plugins-official",
      },
      name: "context7",
    },
  ],
});

// 独立实验：从 Anthropic 官方 marketplace 安装知名的 Context7 Plugin，并调用其远程 MCP。
export default defineExperiment({
  description: "plugin:从 Anthropic 官方 marketplace 安装 Context7，并调用其远程 MCP server",
  agent,
  model: "gpt-5.6-luna",
  sandbox,
  attempts: 1,
  evals: (e) => e.id === "plugin-mcp",
});
