import { defineExperiment } from "niceeval";
import { claudeCodeAgent } from "niceeval/adapter";

const MCP_HTTP_PORT = process.env.MCP_HTTP_PORT ?? "32131";
const agent = claudeCodeAgent({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseUrl: process.env.ANTHROPIC_BASE_URL,
  mcpServers: [
    { name: "e2e-stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-everything"] },
    { name: "e2e-http", url: `http://host.docker.internal:${MCP_HTTP_PORT}/mcp` },
  ],
  postSetup: [
    async (sb) => {
      await sb.runShell("timeout 60 npx -y @modelcontextprotocol/server-everything < /dev/null > /dev/null 2>&1 || true");
    },
  ],
});

// 独立实验:只挂了 stdio + 远程 HTTP MCP server 的 agent 才可能过。
export default defineExperiment({
  description: "mcp:挂载了 stdio + 远程 HTTP MCP server 的 claude-code agent",
  agent,
  model: "deepseek-v4-flash",
  attempts: 1,
  evals: (e) => e.id === "mcp-tools",
});
