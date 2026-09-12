import { createReadStream } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createWorld, type XGame } from "./game.js";
import { createProviderFromEnv, type ContentProvider } from "./provider.js";

const publicDir = join(dirname(fileURLToPath(import.meta.url)), "../public");

export interface XServerOptions {
  provider?: ContentProvider;
}

export function createXServer(options: XServerOptions = {}) {
  const provider = options.provider ?? createProviderFromEnv();
  let game: XGame | undefined;

  return createServer(async (request, response) => {
    const controller = new AbortController();
    request.once("aborted", () => controller.abort());
    response.once("close", () => {
      if (!response.writableEnded) controller.abort();
    });
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/app.js" || url.pathname === "/styles.css")) {
        return serveStatic(url.pathname, response);
      }
      if (request.method === "GET" && url.pathname === "/api/state") {
        return json(response, 200, game ? game.snapshot() : null);
      }
      if (request.method === "POST" && url.pathname === "/api/world") {
        const body = await readJson(request, controller.signal);
        const nextGame = await createWorld({
          playerName: stringField(body, "playerName"),
          topic: stringField(body, "topic"),
        }, { provider }, controller.signal);
        game = nextGame;
        return json(response, 201, game.snapshot());
      }
      if (!game) return json(response, 409, { error: "请先创建世界" });

      const profileMatch = /^\/api\/profiles\/([^/]+)$/.exec(url.pathname);
      if (request.method === "GET" && profileMatch) {
        return json(response, 200, game.viewProfile(decodeURIComponent(profileMatch[1]!), controller.signal));
      }
      if (request.method === "POST" && url.pathname === "/api/posts") {
        const body = await readJson(request, controller.signal);
        const world = await game.publishPost({
          intent: stringField(body, "intent"),
          withImage: body.withImage === true,
        }, controller.signal);
        return json(response, 201, world);
      }
      const replyMatch = /^\/api\/posts\/([^/]+)\/replies$/.exec(url.pathname);
      if (request.method === "POST" && replyMatch) {
        const body = await readJson(request, controller.signal);
        const world = await game.reply({
          postId: decodeURIComponent(replyMatch[1]!),
          intent: stringField(body, "intent"),
        }, controller.signal);
        return json(response, 201, world);
      }
      const imageMatch = /^\/api\/posts\/([^/]+)\/image$/.exec(url.pathname);
      if (request.method === "POST" && imageMatch) {
        const body = await readJson(request, controller.signal);
        const world = await game.generateImage({
          postId: decodeURIComponent(imageMatch[1]!),
          prompt: stringField(body, "prompt"),
        }, controller.signal);
        return json(response, 201, world);
      }
      if (request.method === "POST" && url.pathname === "/api/feed/refresh") {
        await drain(request, controller.signal);
        return json(response, 200, await game.refreshFeed(controller.signal));
      }
      return json(response, 404, { error: "路由不存在" });
    } catch (error) {
      if (response.headersSent || response.writableEnded) return;
      const aborted = error instanceof Error && error.name === "AbortError";
      json(response, aborted ? 499 : 400, { error: error instanceof Error ? error.message : "未知错误" });
    }
  });
}

function serveStatic(pathname: string, response: ServerResponse): void {
  const file = pathname === "/" ? "index.html" : pathname.slice(1);
  const contentType = file.endsWith(".html") ? "text/html; charset=utf-8"
    : file.endsWith(".js") ? "text/javascript; charset=utf-8"
      : "text/css; charset=utf-8";
  response.writeHead(200, {
    "content-type": contentType,
    "content-security-policy": "default-src 'self'; img-src 'self' data: https:; style-src 'self'; script-src 'self'; connect-src 'self'",
    "x-content-type-options": "nosniff",
  });
  createReadStream(join(publicDir, file)).on("error", () => {
    if (!response.headersSent) response.writeHead(404);
    response.end();
  }).pipe(response);
}

async function readJson(request: IncomingMessage, signal: AbortSignal): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    signal.throwIfAborted();
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 32_768) throw new Error("请求内容过大");
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("请求 JSON 必须是对象");
  return value as Record<string, unknown>;
}

async function drain(request: IncomingMessage, signal: AbortSignal): Promise<void> {
  for await (const _chunk of request) signal.throwIfAborted();
}

function stringField(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string") throw new Error(`${key} 必须是字符串`);
  return value;
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(value));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number.parseInt(process.env.PORT ?? "4318", 10);
  const server = createXServer();
  server.listen(port, "127.0.0.1", () => {
    const mode = process.env.X_PROVIDER_MODE ?? "fixture";
    console.log(`LLM X 已启动：http://127.0.0.1:${port}（${mode} 模式）`);
  });
}
