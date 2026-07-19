// plugin 实验专用:同一个 claude-code adapter,只连一个 Marketplace 并装其中一个 Plugin。
// Marketplace 是本仓库自带的本地 fixture(fixtures/plugins/e2e-marketplace),不依赖
// 第三方公开仓库——`marketplace.name` 必须原样等于该 fixture 自己 manifest 里的
// "name"(见 memory/native-plugin-marketplace-name-not-caller-assignable.md 的结论,
// 这里因为是自己写的 fixture,两者天然一致)。这个 Plugin 自带一个 `.mcp.json`,装上后
// 会以 `mcp__plugin_e2e-plugin_tools__get-sum` 命名出现——与直接配置的 mcpServers
// 命名空间不同(`mcp__<server>__<tool>`),这个差异本身就是"native plugin 安装真的把
// 内容接线进了运行中的 agent"的证据。
//
// `marketplace.source` 用 "./.fixtures/e2e-marketplace"(带 `./` 前缀的沙箱内相对路径):
// evals/plugin-mcp.eval.ts 的 setup 钩子在 agent.setup 跑之前,把
// fixtures/plugins/e2e-marketplace 上传到沙箱 workdir 下的同名相对路径;
// `claude plugin marketplace add` 要求本地路径显式带 `./` 或绝对路径,裸相对路径会被
// 误判成 "GitHub owner/repo" 简写而报错(本机 `claude` 2.1.214 实测复现)。
import { claudeCodeAgent } from "niceeval/adapter";

export default claudeCodeAgent({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseUrl: process.env.ANTHROPIC_BASE_URL,
  plugins: [
    {
      marketplace: { name: "niceeval-e2e-marketplace", source: "./.fixtures/e2e-marketplace" },
      name: "e2e-plugin",
    },
  ],
  // 这个 Plugin 自带的 MCP server 同样是 npx 起的 stdio server,首次调用要下载解析包,
  // 可能与第一轮对话里的第一次工具调用竞速——见 agents/claude-code-mcp.ts 同一条注释,
  // 预热用同一条命令(直接跑 npx,不借道 claude mcp list)。
  postSetup: [
    async (sb) => {
      await sb.runShell("timeout 60 npx -y @modelcontextprotocol/server-everything < /dev/null > /dev/null 2>&1 || true");
    },
  ],
});
