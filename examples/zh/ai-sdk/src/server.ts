import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { handleAiSdkTurn, streamChat } from "./ai-sdk-runtime.ts";
import { startAppTrace } from "./app-observability.ts";
import { MODELS } from "./models.ts";
import type { AgentRequest } from "./protocol.ts";

const port = Number(process.env.PORT ?? 5188);

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
  if (req.method === "POST" && req.url === "/api/chat") {
    const body = await readJson(req) as { messages?: unknown[]; model?: string };
    const signal = abortSignalFor(req);
    const result = await streamChat(body.messages ?? [], body.model, signal);
    result.pipeUIMessageStreamToResponse(res, { headers: corsHeaders() });
    return;
  }

  // 非流式端点 — eval adapter 用，返回完整 JSON。
  if (req.method === "POST" && req.url === "/api/turn") {
    const body = await readJson(req);
    const request = parseAgentRequest(body);
    const trace = await startAppTrace({
      name: "assistant-turn",
      sessionId: request.sessionId,
      model: request.model ?? process.env.AGENT_MODEL,
      input: request.message,
    });
    const response = await handleAiSdkTurn(request, abortSignalFor(req));
    trace.event("tools", {
      calls: response.events.filter((e) => e.type === "action.called").map((e) => e.name),
    });
    trace.end({ sessionId: response.sessionId, output: response.reply, usage: response.usage, lastAction: response.data.lastAction });
    json(res, 200, response);
    return;
  }

  json(res, 404, { error: "not found" });
}

function parseAgentRequest(value: unknown): AgentRequest {
  if (typeof value !== "object" || value === null) throw new Error("JSON body is required.");
  const record = value as Record<string, unknown>;
  if (typeof record.message !== "string") throw new Error("message must be a string.");
  const files = parseFiles(record.files);
  if (record.message.trim().length === 0 && files.length === 0) throw new Error("message must be non-empty.");
  return {
    message: record.message,
    sessionId: typeof record.sessionId === "string" ? record.sessionId : undefined,
    model: typeof record.model === "string" ? record.model : undefined,
    files: files.length ? files : undefined,
    otelEndpoint: typeof record.otelEndpoint === "string" ? record.otelEndpoint : undefined,
  };
}

function parseFiles(value: unknown): NonNullable<AgentRequest["files"]> {
  if (!Array.isArray(value)) return [];
  const out: NonNullable<AgentRequest["files"]> = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const f = item as Record<string, unknown>;
    if (typeof f.mimeType === "string" && typeof f.dataBase64 === "string") {
      out.push({ mimeType: f.mimeType, dataBase64: f.dataBase64, filename: typeof f.filename === "string" ? f.filename : undefined });
    }
  }
  return out;
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
