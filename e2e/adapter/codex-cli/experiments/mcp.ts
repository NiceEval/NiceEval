import { defineExperiment } from "niceeval";
import { codexAgent } from "niceeval/adapter";
import { sandbox } from "../sandbox.ts";

const agent = codexAgent({
  apiKey: process.env.OPENAI_API_KEY,
  baseUrl: process.env.OPENAI_BASE_URL,
  mcpServers: [
    {
      name: "e2e",
      command: "node",
      args: ["node_modules/@modelcontextprotocol/server-everything/dist/index.js"],
    },
    { name: "deepwiki", url: "https://mcp.deepwiki.com/mcp" },
  ],
});

export default defineExperiment({
  description: "codex-cli MCP 闭环:stdio 与远程 HTTP 两种传输形态,外加未挂载 server 的反例",
  agent,
  model: "gpt-5.6-luna",
  sandbox,
  evals: ["mcp"],
  attempts: 1,
  budget: 3,
});
