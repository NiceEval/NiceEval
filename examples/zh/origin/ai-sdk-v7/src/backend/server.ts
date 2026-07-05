import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { pipeUIMessageStreamToResponse, toUIMessageStream } from "ai";
import { buildTools, streamChat } from "./ai-sdk-runtime.ts";
import { MODELS } from "./models.ts";
import { setupOtel } from "./otel.ts";

setupOtel("ai-sdk-v7-example");

const port = Number(process.env.PORT ?? 34001);

const server = createServer(async (req, res) => {
  try {
    await route(req, res);
  } catch (error) {
    json(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`Assistant server listening on http://127.0.0.1:${port}\n`);
});

function shutdown() {
  server.close(() => process.exit(0));
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  if (req.method === "GET" && (req.url === "/healthz" || req.url === "/api/health")) {
    json(res, 200, { ok: true });
    return;
  }

  // 模型注册表 — 前端选择器用。
  if (req.method === "GET" && req.url === "/api/models") {
    json(res, 200, { models: MODELS });
    return;
  }

  // 流式聊天端点 — React useChat 用，AI SDK data stream 格式。
  // `result.pipeUIMessageStreamToResponse` 是 deprecated 方法（下个大版本会删），改用
  // standalone 的 toUIMessageStream + pipeUIMessageStreamToResponse，见 migration guide。
  if (req.method === "POST" && req.url === "/api/chat") {
    const body = await readJson(req) as { messages?: unknown[]; model?: string };
    const signal = abortSignalFor(req);
    const result = await streamChat(body.messages ?? [], body.model, signal);
    pipeUIMessageStreamToResponse({
      response: res,
      stream: toUIMessageStream({ stream: result.stream, tools: buildTools() }),
      headers: corsHeaders(),
    });
    return;
  }

  json(res, 404, { error: "not found" });
}

function abortSignalFor(req: IncomingMessage): AbortSignal {
  const controller = new AbortController();
  req.on("close", () => controller.abort());
  return controller.signal;
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { ...corsHeaders(), "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function corsHeaders(): Record<string, string> {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
  };
}
