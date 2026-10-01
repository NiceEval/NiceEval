// Plugin 安装收敛 × Sandbox 复用(docs/engineering/testing/e2e/adapter/claude-code.md 的
// Plugins 行)。四个沙箱并发承接八条 attempt；第二波复用第一波的沙箱，workdir 回到
// 题间重置点，$HOME 保留上一波安装。八条 attempt 都必须调用 Plugin MCP 工具成功。
import { defineExperiment } from "niceeval";
import { claudeCodeAgent } from "niceeval/adapter";
import { claudeCodeProviderEnv } from "../provider.ts";
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

export default defineExperiment({
  description: "plugin 复用:四路并发的两波 attempt 都能调用签入的 MCP Plugin 的 MCP 工具",
  agent,
  model: "gpt-6-luna",
  sandbox: pluginSandbox,
  evals: (e) => e.id === "plugin-mcp",
  attempts: 8,
  sandboxReuse: true,
  // 并发宽度与 CI runner 的 4 vCPU 对齐；八条 attempt 保证每个并发槽都有复用波次。
  maxConcurrency: 4,
});
