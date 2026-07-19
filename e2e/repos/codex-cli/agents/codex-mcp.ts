// MCP 实验专用:同一个 codex adapter,额外挂两种 MCP 传输形态——
// stdio(官方 @modelcontextprotocol/server-everything 的确定性 get-sum 工具)与
// 远程 Streamable HTTP(DeepWiki 的公开、免鉴权 MCP 端点,https://mcp.deepwiki.com/mcp,
// 工具 read_wiki_structure)。两者都已用真实 codex CLI(0.144.1)在本机验证过真实调用
// (工具原始名分别是 e2e.get-sum 与 deepwiki.read_wiki_structure,见
// src/o11y/parsers/codex.ts 的 mcp_tool_call 分支:`${server}.${tool}`)。
//
// 配置键必须是复数 mcp_servers——单数 mcp_server 会被 codex 静默忽略(见
// memory/mcp-tool-naming-claude-vs-codex.md 与 src/agents/codex.ts 的同名注释)。
import { codexAgent } from "niceeval/adapter";

export default codexAgent({
  apiKey: process.env.CODEX_API_KEY,
  baseUrl: process.env.CODEX_BASE_URL,
  mcpServers: [
    { name: "e2e", command: "npx", args: ["-y", "@modelcontextprotocol/server-everything"] },
    { name: "deepwiki", url: "https://mcp.deepwiki.com/mcp" },
  ],
});
