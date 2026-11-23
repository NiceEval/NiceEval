import { defineExperiment } from "niceeval";
import { claudeCodeAgent } from "niceeval/adapter";
import { claudeCodeLiveModel, claudeCodeProviderEnv } from "../provider.ts";
import { pluginMarketplacePath, pluginSandbox } from "../plugin-sandbox.ts";

const agent = claudeCodeAgent({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseUrl: process.env.ANTHROPIC_BASE_URL,
  env: claudeCodeProviderEnv,
  plugins: [
    {
      marketplace: {
        name: "niceeval-e2e",
        source: pluginMarketplacePath,
      },
      name: "e2e",
    },
  ],
});

// 独立实验：从本地 marketplace 安装签入的 Plugin，并调用其 stdio MCP。
export default defineExperiment({
  description: "plugin:从本地 marketplace 安装 Plugin，并调用其 stdio MCP server",
  adapter: agent,
  model: claudeCodeLiveModel,
  sandbox: pluginSandbox,
  attempts: 1,
  evals: (e) => e.id === "plugin-mcp",
});
