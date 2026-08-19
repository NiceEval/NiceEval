import { defineExperiment } from "niceeval";
import { claudeCodeAgent } from "niceeval/adapter";
import { claudeCodeProviderEnv } from "../provider.ts";
import { sandbox } from "../sandbox.ts";

const MCP_HTTP_PORT = 32131;
const MCP_HTTP_LOG = "/tmp/niceeval-e2e-mcp-http.log";
const MCP_HTTP_PID = "/tmp/niceeval-e2e-mcp-http.pid";
const agent = claudeCodeAgent({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseUrl: process.env.ANTHROPIC_BASE_URL,
  env: claudeCodeProviderEnv,
  mcpServers: [
    { name: "e2e-stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-everything"] },
    { name: "e2e-http", url: `http://127.0.0.1:${MCP_HTTP_PORT}/mcp` },
  ],
  postSetup: [
    async (sb, context) => {
      // 先登记收尾，再启动进程：启动后的 readiness 若失败，agent teardown 仍会杀掉它；
      // attempt 的 Sandbox resource-group finalizer 是 interruption / 强制销毁的最后兜底。
      context.onCleanup(async (cleanupSandbox) => {
        await cleanupSandbox.runShellOrThrow(`
          set -eu
          if [ -s ${MCP_HTTP_PID} ]; then
            pid="$(cat ${MCP_HTTP_PID})"
            case "$pid" in
              *[!0-9]*|'') ;;
              *)
                kill "$pid" 2>/dev/null || true
                for attempt in $(seq 1 20); do
                  kill -0 "$pid" 2>/dev/null || break
                  sleep 0.1 2>/dev/null || sleep 1
                done
                kill -9 "$pid" 2>/dev/null || true
                ;;
            esac
          fi
          rm -f ${MCP_HTTP_PID} ${MCP_HTTP_LOG}
        `);
      });
      // 这个启动同时预热 e2e-stdio 所用的同一份 npx 包缓存。
      await sb.runShellOrThrow(`
        set -eu
        nohup env PORT=${MCP_HTTP_PORT} npx -y @modelcontextprotocol/server-everything streamableHttp >${MCP_HTTP_LOG} 2>&1 &
        echo "$!" >${MCP_HTTP_PID}
        for attempt in $(seq 1 60); do
          status="$(curl --silent --connect-timeout 1 --max-time 2 --output /dev/null --write-out '%{http_code}' http://127.0.0.1:${MCP_HTTP_PORT}/mcp || true)"
          case "$status" in
            [1-5][0-9][0-9]) exit 0 ;;
          esac
          sleep 1
        done
        cat ${MCP_HTTP_LOG} >&2 || true
        exit 1
      `);
    },
  ],
});

// 独立实验:只挂了 stdio + Streamable HTTP MCP server 的 agent 才可能过。
export default defineExperiment({
  description: "mcp:挂载了 stdio + Streamable HTTP MCP server 的 claude-code agent",
  agent,
  model: "gpt-5.6-luna",
  sandbox,
  attempts: 1,
  evals: (e) => e.id === "mcp-tools",
});
