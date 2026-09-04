import { defineExperiment } from "niceeval";
import { codexAgent } from "niceeval/adapter";
import { sandbox } from "../sandbox.ts";

const MCP_FIXTURE_ROOT = "/tmp/niceeval-e2e-mcp-fixture";
const MCP_FIXTURE_ENTRY = `${MCP_FIXTURE_ROOT}/node_modules/@modelcontextprotocol/server-everything/dist/index.js`;

const agent = codexAgent({
  apiKey: process.env.OPENAI_API_KEY,
  baseUrl: process.env.OPENAI_BASE_URL,
  mcpServers: [
    { name: "e2e", command: "node", args: [MCP_FIXTURE_ENTRY] },
    { name: "deepwiki", url: "https://mcp.deepwiki.com/mcp" },
  ],
  postSetup: [
    async (sb) => {
      // Install before Codex starts the MCP process. A cold npx here used Codex's
      // shorter MCP startup window for registry resolution and obscured install
      // failures as tool-call mismatches.
      await sb.runShellOrThrow(
        `npm install --prefix ${MCP_FIXTURE_ROOT} --no-save --no-package-lock @modelcontextprotocol/server-everything@2026.7.4`,
      );
    },
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
