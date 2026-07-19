// mcp 实验专用:同一个 claude-code adapter,挂两个 MCP server——一个 stdio 形态
// (npx 起官方 @modelcontextprotocol/server-everything,自带确定性的 get-sum 工具),
// 一个 Streamable HTTP 形态(本仓库自带的 src/mcp-http-server.ts,由 scripts/e2e.ts
// 启动在宿主机上)。Docker 沙箱经 `host.docker.internal` 回连宿主(docker.ts 对每个
// 容器都加了 ExtraHosts: host.docker.internal:host-gateway,这条回连路径不是这个
// 仓库专属发明,tracing 的 otlpHost 走的是同一条路)。
import { claudeCodeAgent } from "niceeval/adapter";

const MCP_HTTP_PORT = process.env.MCP_HTTP_PORT ?? "32131";

export default claudeCodeAgent({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseUrl: process.env.ANTHROPIC_BASE_URL,
  mcpServers: [
    { name: "e2e-stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-everything"] },
    { name: "e2e-http", url: `http://host.docker.internal:${MCP_HTTP_PORT}/mcp` },
  ],
  // npx 起的 stdio server 首次调用要下载解析包(实测本机冷启动 ~19s),可能与第一轮对话
  // 里的第一次工具调用竞速("still connecting, not yet available")。直接跑一次同样的
  // npx 命令预热 npm 包缓存——比指望 `claude mcp list` 的健康检查更直接:后者对单个 server
  // 的连接自带较短超时,给它拖慢/放弃的话,子进程可能连同下载一起被杀掉,预热不到东西。
  // 尽力而为,不是硬依赖:这条命令本身失败或超时不影响真实调用。
  postSetup: [
    async (sb) => {
      await sb.runShell("timeout 60 npx -y @modelcontextprotocol/server-everything < /dev/null > /dev/null 2>&1 || true");
    },
  ],
});
