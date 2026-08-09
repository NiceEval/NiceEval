// Plugin 安装收敛 × Sandbox 复用(docs/engineering/testing/e2e/adapter/claude-code.md 的
// Plugins 行)。一个沙箱依次承接两条 attempt:workdir 回到题间重置点,$HOME 带着上一条
// attempt 的 marketplace 注册与插件安装进场,agent setup 每条 attempt 重跑一次；两条
// attempt 都必须调用同一个 Context7 MCP 工具成功。
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

export default defineExperiment({
  description: "plugin 复用:同一沙箱连续两条 attempt 都能调用官方 Context7 Plugin 的 MCP 工具",
  agent,
  model: "gpt-5.6-luna",
  sandbox,
  evals: (e) => e.id === "plugin-mcp",
  attempts: 2,
  sandboxReuse: true,
  // 两条 attempt 必须落在同一个沙箱上,残留才成立(复用契约:maxConcurrency > 1 时不保证谁与谁共用)。
  maxConcurrency: 1,
});
