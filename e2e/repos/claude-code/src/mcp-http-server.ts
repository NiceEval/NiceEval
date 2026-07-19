// 本仓库自带的远程 HTTP MCP server fixture——证明 claudeCodeAgent 的 mcpServers 支持
// Streamable HTTP 形态(不只是 stdio)。由 scripts/e2e.ts 在跑 Experiment 之前启动、
// 跑完关闭;agents/claude-code-mcp.ts 里的 claude-code Docker 沙箱经
// `host.docker.internal`(docker.ts 对每个容器都加了
// `ExtraHosts: ["host.docker.internal:host-gateway"]`)回连到这里,和 tracing 的
// otlpHost 走的是同一条回连路径,不是这个仓库专属发明。
//
// 绑定 0.0.0.0(不是 127.0.0.1)——容器经 host-gateway 打到的是宿主机的真实网卡,
// 只监听 loopback 会导致容器连不通。

import express from "express";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

function buildServer(): McpServer {
  const server = new McpServer({ name: "niceeval-e2e-remote-mcp", version: "1.0.0" });
  server.registerTool(
    "get-product",
    { description: "Multiply two integers and return the product.", inputSchema: { a: z.number(), b: z.number() } },
    async ({ a, b }: { a: number; b: number }) => ({ content: [{ type: "text" as const, text: String(a * b) }] }),
  );
  return server;
}

// session id → transport(多会话字典;标准 Streamable HTTP 多会话写法,见
// docs/engineering/e2e-ci/adapters/claude-code.md 的 prototyping 记录)。
const transports = new Map<string, StreamableHTTPServerTransport>();

const app = express();
app.use(express.json());

app.post("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  let transport = sessionId ? transports.get(sessionId) : undefined;

  if (!transport) {
    if (!isInitializeRequest(req.body)) {
      res.status(400).json({ jsonrpc: "2.0", error: { code: -32000, message: "No valid session" }, id: null });
      return;
    }
    const created: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        transports.set(id, created);
      },
    });
    created.onclose = () => {
      if (created.sessionId) transports.delete(created.sessionId);
    };
    await buildServer().connect(created);
    transport = created;
  }

  await transport.handleRequest(req, res, req.body);
});

app.get("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  const transport = sessionId ? transports.get(sessionId) : undefined;
  if (!transport) {
    res.status(400).send("Invalid or missing session ID");
    return;
  }
  await transport.handleRequest(req, res);
});

app.delete("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  const transport = sessionId ? transports.get(sessionId) : undefined;
  if (!transport) {
    res.status(400).send("Invalid or missing session ID");
    return;
  }
  await transport.handleRequest(req, res);
});

app.get("/healthz", (_req, res) => res.send("ok"));

const port = Number(process.env.MCP_HTTP_PORT ?? 32131);
app.listen(port, "0.0.0.0", () => console.log(`[mcp-http-server] remote mcp http server listening on 0.0.0.0:${port}`));
