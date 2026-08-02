// cases: docs/engineering/testing/unit/adapters.md
import { describe, expect, it } from "vitest";

import { assertMcpServers, isHttpMcp, mcpManifestEntries } from "./mcp.ts";
import type { McpServer } from "./types.ts";

function mcpServerTypeContract(): void {
  const stdio: McpServer = { name: "local", command: "node", args: ["server.js"] };
  const http: McpServer = { name: "remote", url: "https://mcp.example.test", headers: { Authorization: "secret" } };
  void [stdio, http];

  // @ts-expect-error stdio 与 HTTP transport 字段必须互斥。
  const ambiguous: McpServer = { name: "ambiguous", command: "node", url: "https://mcp.example.test" };
  // @ts-expect-error HTTP transport 不能携带 stdio 的 args。
  const httpWithArgs: McpServer = { name: "mixed", url: "https://mcp.example.test", args: ["server.js"] };
  void [ambiguous, httpWithArgs];
}
void mcpServerTypeContract;

describe("MCP transport contract", () => {
  it("keeps the two valid transports distinguishable and strips secrets from manifests", () => {
    const servers: McpServer[] = [
      { name: "local", command: "node", args: ["server.js"], env: { TOKEN: "secret" } },
      { name: "remote", url: "https://mcp.example.test", headers: { Authorization: "secret" } },
    ];

    assertMcpServers(servers);
    expect(isHttpMcp(servers[0]!)).toBe(false);
    expect(isHttpMcp(servers[1]!)).toBe(true);
    expect(mcpManifestEntries(servers)).toEqual([
      { name: "local", command: "node", args: ["server.js"] },
      { name: "remote", url: "https://mcp.example.test" },
    ]);
  });

  it("still rejects ambiguous JavaScript input at the runtime boundary", () => {
    expect(() => assertMcpServers([
      { name: "ambiguous", command: "node", url: "https://mcp.example.test" } as never,
    ])).toThrow(/ambiguous|同时|both|二选一/i);
  });
});
