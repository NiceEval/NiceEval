// MCP server 的形态判别与 manifest 映射 —— Claude Code / Codex 两个 adapter 共用。
// 契约见 docs/feature/adapters/architecture/coding-agent-extensions.md「类型边界」:
// stdio(command)与 Streamable HTTP(url)按形状判别;双字段是配置错误,setup 点名报错。

import { t } from "../i18n/index.ts";
import type { AgentSetupManifest, McpHttpServer, McpServer } from "./types.ts";

/** 形态判别:有 url 的是 HTTP。调用前先过 {@link assertMcpServers}(双字段在那里报错)。 */
export function isHttpMcp(server: McpServer): server is McpHttpServer {
  return "url" in server && typeof server.url === "string";
}

/** 双字段(command + url)的配置错误在写任何沙箱配置前抛出,点名 server。 */
export function assertMcpServers(servers: readonly McpServer[]): void {
  for (const server of servers) {
    if ("command" in server && "url" in server) {
      throw new Error(t("mcp.ambiguousTransport", { name: server.name }));
    }
  }
}

/** manifest 条目:只记非 secret 字段(stdio 不含 env,HTTP 不含 headers)。 */
export function mcpManifestEntries(
  servers: readonly McpServer[],
): NonNullable<AgentSetupManifest["mcpServers"]> {
  return servers.map((s) =>
    isHttpMcp(s)
      ? { name: s.name, url: s.url }
      : { name: s.name, command: s.command, ...(s.args?.length ? { args: [...s.args] } : {}) },
  );
}
