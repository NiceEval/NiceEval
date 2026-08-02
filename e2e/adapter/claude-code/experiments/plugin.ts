import { defineExperiment } from "niceeval";
import { claudeCodeAgent } from "niceeval/adapter";

const agent = claudeCodeAgent({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseUrl: process.env.ANTHROPIC_BASE_URL,
  plugins: [
    {
      marketplace: { name: "niceeval-e2e-marketplace", source: "./.fixtures/e2e-marketplace" },
      name: "e2e-plugin",
    },
  ],
  postSetup: [
    async (sb) => {
      await sb.runShell("timeout 60 npx -y @modelcontextprotocol/server-everything < /dev/null > /dev/null 2>&1 || true");
    },
  ],
});

// 独立实验:只连了本仓库自带 Marketplace fixture 的 agent 才装得上这个 Plugin。
export default defineExperiment({
  description: "plugin:装了 marketplace plugin(自带 MCP server)的 claude-code agent",
  agent,
  model: "deepseek-v4-flash",
  attempts: 1,
  evals: (e) => e.id === "plugin-mcp",
});
