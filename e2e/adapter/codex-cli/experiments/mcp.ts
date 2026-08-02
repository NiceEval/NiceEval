import { defineExperiment } from "niceeval";
import { codexAgent } from "niceeval/adapter";

const agent = codexAgent({
  apiKey: process.env.CODEX_API_KEY,
  baseUrl: process.env.CODEX_BASE_URL,
  mcpServers: [
    { name: "e2e", command: "npx", args: ["-y", "@modelcontextprotocol/server-everything"] },
    { name: "deepwiki", url: "https://mcp.deepwiki.com/mcp" },
  ],
});

export default defineExperiment({
  description: "codex-cli MCP 闭环:stdio 与远程 HTTP 两种传输形态,外加未挂载 server 的反例",
  agent,
  model: "gpt-5.4-mini",
  evals: ["mcp"],
  attempts: 2,
  earlyExit: true,
  budget: 3,
});
