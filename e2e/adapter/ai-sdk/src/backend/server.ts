// HTTP target for the `uiMessageStreamAgent` entry point: a `useChat`-shaped backend
// speaking the AI SDK UI Message Stream protocol (https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol).
// OTel is on by default (see ./otel.ts) — this is the repo's remote-agent telemetry proof.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { convertToModelMessages, pipeUIMessageStreamToResponse, stepCountIs, streamText, toUIMessageStream, type UIMessage } from "ai";
import { buildTools, SYSTEM_PROMPT } from "./tool-defs.ts";
import { DEFAULT_MODEL, resolveModel } from "./models.ts";
import { setupOtel } from "./otel.ts";
import { AI_SDK_BASE_URL, AI_SDK_PORT } from "../topology.ts";

const telemetry = setupOtel("ai-sdk-e2e");

const server = createServer(async (req, res) => {
  try {
    await route(req, res);
  } catch (error) {
    json(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(AI_SDK_PORT, "127.0.0.1", () => {
  process.stdout.write(`ai-sdk e2e server listening on ${AI_SDK_BASE_URL}\n`);
});

function shutdown(): void {
  server.close(() => {
    void telemetry.shutdown().finally(() => process.exit(0));
  });
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  if (req.method === "GET" && req.url === "/healthz") {
    json(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && req.url === "/api/chat") {
    const body = (await readJson(req)) as { messages?: unknown[]; model?: string };
    const signal = abortSignalFor(req);
    const messages = await convertToModelMessages((body.messages ?? []) as UIMessage[]);
    const result = streamText({
      model: resolveModel(body.model ?? DEFAULT_MODEL),
      system: SYSTEM_PROMPT,
      messages,
      tools: buildTools(),
      stopWhen: stepCountIs(5),
      abortSignal: signal,
    });
    const stream = toUIMessageStream({ stream: result.stream, tools: buildTools() }).pipeThrough(
      new TransformStream({
        transform(chunk, controller) {
          controller.enqueue(chunk);
        },
        // BatchSpanProcessor's default timer is deliberately longer than this
        // request. Hold the HTTP close until every span from this turn has been
        // acknowledged by the NiceEval OTLP receiver; the consumer never needs
        // a timing sleep to race the exporter.
        async flush() {
          await telemetry.forceFlush();
        },
      }),
    );
    pipeUIMessageStreamToResponse({
      response: res,
      stream,
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
