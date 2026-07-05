// 一个用 Claude Agent SDK(@anthropic-ai/claude-agent-sdk)搭的最小 agent 后端。
// 独立示例项目,不 import niceeval,不是 niceeval adapter —— 详见 README.md。
//
// 通信协议就是 Claude Agent SDK 自己的原生协议:`query()` 产出的 `SDKMessage`
// (system / assistant / user / result / stream_event)被原样序列化成 SSE 帧透传
// 给前端,服务端不做任何协议翻译——前端(src/frontend/App.tsx)直接按 SDKMessage
// 渲染,stream_event 里就是 Anthropic 的原始流事件(content_block_delta 等),
// 逐 token 渲染也在前端做。
//
// 这个后端是"每轮一次 query() + resume 找回历史"的会话形态:请求体只带
// {message, sessionId?},session_id 从消息流里自己拿(system/init 和 result
// 消息都带),下一轮随请求带回来——服务端零会话状态(SDK 落盘在 ~/.claude)。

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { runTurn } from "./agent.ts";
import { pendingApprovals } from "./pending-approvals.ts";

const PORT = Number(process.env.PORT ?? 32001);

const server = createServer(async (req, res) => {
  try {
    await route(req, res);
  } catch (error) {
    json(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  process.stdout.write(`claude-sdk 示例服务已启动: http://127.0.0.1:${PORT}\n`);
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

  if (req.method === "GET" && req.url === "/healthz") {
    json(res, 200, { ok: true });
    return;
  }

  // 流式聊天端点:SDKMessage 原样透传成 SSE。
  if (req.method === "POST" && req.url === "/api/chat") {
    const body = (await readJson(req)) as { message?: unknown; sessionId?: unknown };
    if (typeof body.message !== "string" || body.message.trim().length === 0) {
      throw new Error("body.message must be a non-empty string.");
    }
    const sessionId = typeof body.sessionId === "string" && body.sessionId ? body.sessionId : undefined;

    const turn = runTurn(body.message, sessionId);
    // 浏览器断开(关标签/点停止)就中断这一轮,别让 claude-code 子进程白跑。
    req.on("close", () => {
      void turn.interrupt().catch(() => {});
    });

    res.writeHead(200, {
      ...corsHeaders(),
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    const send = (frame: unknown) => res.write(`data: ${JSON.stringify(frame)}\n\n`);

    try {
      for await (const sdkMessage of turn) send(sdkMessage);
    } catch (error) {
      // query() 之外的失败(spawn 失败等),包一帧自定义错误(SDKMessage 的
      // type 联合里没有 server_error,前端据此区分)。
      send({ type: "server_error", message: error instanceof Error ? error.message : String(error) });
    }
    res.end();
    return;
  }

  // HITL 审批端点。SSE 连接在等审批期间全程不关(agent.ts 的 canUseTool 挂在
  // pendingApprovals 的 Promise 上),这里只是把浏览器点按钮的结果转成
  // resolve() 调用去唤醒它——不是另开一轮请求重放历史。
  if (req.method === "POST" && req.url === "/api/chat/approve") {
    const body = (await readJson(req)) as { toolUseId?: string; approved?: boolean };
    if (typeof body.toolUseId !== "string" || typeof body.approved !== "boolean") {
      json(res, 400, { error: "toolUseId (string) and approved (boolean) are required" });
      return;
    }
    const resolve = pendingApprovals.get(body.toolUseId);
    if (!resolve) {
      json(res, 404, { error: `no pending approval for toolUseId ${body.toolUseId}` });
      return;
    }
    pendingApprovals.delete(body.toolUseId);
    resolve(body.approved);
    json(res, 200, { ok: true });
    return;
  }

  json(res, 404, { error: `not found: ${req.method} ${req.url}` });
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
