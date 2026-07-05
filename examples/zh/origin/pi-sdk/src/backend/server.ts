// node:http 服务器:HTTP 层 + SSE 透传。真实的 pi Agent 搭建在 agent.ts,两个工具
// 的实现在 tools.ts。
//
// 通信协议就是 pi 自己的原生协议:`agent.subscribe()` 收到的 `AgentEvent`
// (turn_start / message_update / tool_execution_* / agent_end ...)被原样序列化成
// SSE 帧透传给前端,不翻译成任何中间协议——前端(src/frontend/App.tsx)直接按
// AgentEvent 渲染。pi 的事件里没有的信息走三种传输层帧:
//   {type:"session", sessionId}          会话 id(pi 没有落盘 resume,见下面 sessions)
//   {type:"approval_request", ...}       HITL 审批请求(beforeToolCall 是回调不是事件)
//   {type:"server_error", message}       agent 之外的服务器错误
//
// HITL:calculate 工具的审批走进程内的 pendingApprovals 这个 Map<toolCallId, resolve>。
// beforeToolCall 命中 calculate 时,先把 approval_request 帧写进当前这条(还开着的)
// SSE 流,再 await 一个 Promise 卡住 pi 的 tool 执行;POST /api/chat/approve 用
// toolUseId 查到对应的 resolve 函数并调用,原来那条 /api/chat 请求的流才会继续往下走。
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import type { AgentEvent, AgentMessage } from "@earendil-works/pi-agent-core";
import { createAgent } from "./agent.ts";

const port = Number(process.env.PORT ?? 33001);

const server = createServer(async (req, res) => {
  try {
    await route(req, res);
  } catch (error) {
    json(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`pi-sdk example listening on http://127.0.0.1:${port}\n`);
});

function shutdown(): void {
  server.close(() => process.exit(0));
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

// toolCallId -> resolve(approved)。POST /api/chat/approve 解析这个 Map。
const pendingApprovals = new Map<string, (approved: boolean) => void>();

// sessionId -> 上一轮结束时的完整对话记录(agent.state.messages)。pi 的 Agent
// 没有 Codex thread / Claude session 那种落盘 resume 机制,所以由服务端在内存里
// 保存历史;前端从 session 帧里拿 sessionId,下一轮随请求带回来。不存就是每轮
// 从零开始——上一轮问过的"哪个城市"这类上下文会全部丢失。
const sessions = new Map<string, AgentMessage[]>();

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = req.url ?? "/";

  if (req.method === "GET" && url === "/healthz") {
    json(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && url === "/api/chat") {
    const body = (await readJson(req)) as { message?: unknown; sessionId?: unknown };
    if (typeof body.message !== "string" || body.message.trim().length === 0) {
      throw new Error("body.message must be a non-empty string.");
    }
    const sessionId = typeof body.sessionId === "string" && body.sessionId ? body.sessionId : randomUUID();
    await streamChat(req, res, body.message, sessionId);
    return;
  }

  if (req.method === "POST" && url === "/api/chat/approve") {
    const body = (await readJson(req)) as { toolUseId?: unknown; approved?: unknown };
    if (typeof body.toolUseId !== "string" || typeof body.approved !== "boolean") {
      throw new Error("body must be { toolUseId: string, approved: boolean }.");
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

  json(res, 404, { error: "not found" });
}

async function streamChat(
  req: IncomingMessage,
  res: ServerResponse,
  message: string,
  sessionId: string,
): Promise<void> {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  const send = (frame: unknown) => res.write(`data: ${JSON.stringify(frame)}\n\n`);

  send({ type: "session", sessionId });

  const agent = createAgent({
    messages: sessions.get(sessionId),
    beforeToolCall: async ({ toolCall }) => {
      if (toolCall.name !== "calculate") return undefined;
      send({ type: "approval_request", toolCallId: toolCall.id, toolName: toolCall.name, args: toolCall.arguments });
      const approved = await new Promise<boolean>((resolve) => {
        pendingApprovals.set(toolCall.id, resolve);
      });
      // 被拒绝时 pi 自己会发 tool_execution_end(isError + reason),前端另外
      // 记着"这个 toolCallId 是我拒的",渲染成"已拒绝"而不是普通报错。
      return approved ? undefined : { block: true, reason: "用户拒绝了这次调用" };
    },
  });

  req.on("close", () => agent.abort());

  const unsubscribe = agent.subscribe((event: AgentEvent) => {
    send(event);
  });

  try {
    await agent.prompt(message);
    await agent.waitForIdle();
    if (agent.state.errorMessage) {
      send({ type: "server_error", message: agent.state.errorMessage });
    }
    // 这一轮跑完(含工具调用和最终回答)后把完整 transcript 存回去,下一轮续接。
    sessions.set(sessionId, agent.state.messages);
  } catch (error) {
    send({ type: "server_error", message: error instanceof Error ? error.message : String(error) });
  } finally {
    unsubscribe();
  }

  res.end();
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}
