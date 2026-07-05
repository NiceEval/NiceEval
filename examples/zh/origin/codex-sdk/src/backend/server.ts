// 一个 node:http 服务器,演示怎么用 OpenAI 的 Codex TypeScript SDK
// (`@openai/codex-sdk`)搭一个 agent 后端。纯 demo,不依赖 niceeval。见 README.md。
//
// 通信协议就是 Codex SDK 自己的原生协议:`thread.runStreamed()` 产出的
// `ThreadEvent`(thread.started / turn.* / item.*)被原样序列化成 SSE 帧透传给
// 前端,服务端不做任何协议翻译——前端(src/frontend/App.tsx)直接按 ThreadEvent
// 渲染。真正的 Codex 调用在 agent.ts。
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { runTurnStreamed } from "./agent.ts";

// 端口分配见 examples/zh/origin/README.md;每个示例一段独立的高位端口,同时起多个不撞车。
const PORT = Number(process.env.PORT ?? 31001);

const server = createServer(async (req, res) => {
  try {
    await route(req, res);
  } catch (error) {
    json(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(PORT, () => {
  process.stdout.write(`codex-sdk example listening on http://localhost:${PORT}\n`);
});

function shutdown() {
  server.close(() => process.exit(0));
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = req.url ?? "/";

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  if (req.method === "GET" && url === "/healthz") {
    json(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && url === "/api/chat") {
    const { message, threadId } = parseChatRequest(await readJson(req));

    // 浏览器断开(关页面/点停止)就取消这一轮 turn,别让 Codex 子进程白跑。
    const abort = new AbortController();
    req.on("close", () => abort.abort());

    res.writeHead(200, {
      ...corsHeaders(),
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    const send = (event: unknown) => res.write(`data: ${JSON.stringify(event)}\n\n`);

    try {
      const events = await runTurnStreamed(message, threadId, abort.signal);
      for await (const event of events) send(event);
    } catch (error) {
      // 进程/spawn 级别的失败(SDK 事件流之外),包一帧和 ThreadErrorEvent 同形状的错误。
      send({ type: "error", message: error instanceof Error ? error.message : String(error) });
    }
    res.end();
    return;
  }

  json(res, 404, { error: `not found: ${req.method} ${url}` });
}

function parseChatRequest(value: unknown): { message: string; threadId?: string } {
  if (typeof value !== "object" || value === null) throw new Error("JSON body is required.");
  const record = value as Record<string, unknown>;
  if (typeof record.message !== "string" || record.message.trim().length === 0) {
    throw new Error("message must be a non-empty string.");
  }
  return {
    message: record.message,
    threadId: typeof record.threadId === "string" && record.threadId.length > 0 ? record.threadId : undefined,
  };
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
