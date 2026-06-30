import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { handleAiSdkTurn } from "./src/ai-sdk-runtime.ts";
import { startAppTrace } from "./src/app-observability.ts";
import { handleMockTurn } from "./src/assistant.ts";
import type { AgentRequest } from "./src/protocol.ts";

const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 5188);

const server = createServer(async (req, res) => {
  try {
    await route(req, res);
  } catch (error) {
    json(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`Assistant web agent listening on http://127.0.0.1:${port}\n`);
});

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
    const html = await readFile(join(here, "index.html"), "utf8");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }

  if (req.method === "GET" && (req.url === "/healthz" || req.url === "/api/health")) {
    json(res, 200, { ok: true, mode: runtimeMode() });
    return;
  }

  if (req.method === "POST" && req.url === "/api/turn") {
    const body = await readJson(req);
    const request = parseAgentRequest(body);
    const mode = runtimeMode(request);
    const trace = await startAppTrace({
      name: "assistant-turn",
      sessionId: request.sessionId,
      mode,
      model: request.model ?? process.env.AGENT_MODEL,
      input: request.message,
    });
    const response = mode === "ai" ? await handleAiSdkTurn(request, abortSignalFor(req)) : await handleMockTurn(request);
    trace.event("tools", {
      calls: response.events.filter((event) => event.type === "action.called").map((event) => event.name),
    });
    trace.end({
      sessionId: response.sessionId,
      output: response.reply,
      usage: response.usage,
      lastAction: response.data.lastAction,
    });
    json(res, 200, response);
    return;
  }

  json(res, 404, { error: "not found" });
}

function runtimeMode(request?: AgentRequest): "ai" | "mock" {
  if (request?.mode) return request.mode;
  if (process.env.AGENT_MODE === "ai") return "ai";
  return "mock";
}

function parseAgentRequest(value: unknown): AgentRequest {
  if (typeof value !== "object" || value === null) throw new Error("JSON body is required.");
  const record = value as Record<string, unknown>;
  if (typeof record.message !== "string") throw new Error("message must be a string.");
  const files = parseFiles(record.files);
  if (record.message.trim().length === 0 && files.length === 0) {
    throw new Error("message must be non-empty (or include files).");
  }
  return {
    message: record.message,
    sessionId: typeof record.sessionId === "string" ? record.sessionId : undefined,
    model: typeof record.model === "string" ? record.model : undefined,
    mode: record.mode === "ai" || record.mode === "mock" ? record.mode : undefined,
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
      out.push({
        mimeType: f.mimeType,
        dataBase64: f.dataBase64,
        filename: typeof f.filename === "string" ? f.filename : undefined,
      });
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
