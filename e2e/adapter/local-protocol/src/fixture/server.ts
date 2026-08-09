// 签入的本地 UI Message Stream HTTP fixture。
//
// 只服务 adapter/local-protocol 的确定性协议与故障注入：由 AI SDK 公共
// UIMessageChunk 类型约束的 text / approval SSE、可控断流、挂起与 HTTP 错误。
// 它不模拟 provider 决策或完整 live AI SDK 矩阵，也不需要真实 provider 或密钥。

import type { UIMessageChunk } from "ai";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { FIXTURE_BASE_URL, FIXTURE_HOST, FIXTURE_PORT } from "./address.ts";

type Mode = "ok" | "approval" | "disconnect" | "hang" | "error";

const APPROVAL_MESSAGE_ID = "local-approval-message";
const APPROVAL_CALL_ID = "local-approval-call";
const APPROVAL_ID = "local-approval-request";
const APPROVAL_TOOL = "calculate";

function modeFromPath(pathname: string): Mode | undefined {
  // /modes/<mode>/api/chat
  const match = pathname.match(/^\/modes\/(ok|approval|disconnect|hang|error)\/api\/chat\/?$/);
  return match?.[1] as Mode | undefined;
}

function sseHeaders(): Record<string, string> {
  return {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    // AI SDK 自定义后端要求的协议版本头。
    "x-vercel-ai-ui-message-stream": "v1",
    "access-control-allow-origin": "*",
  };
}

function writeSse(res: ServerResponse, chunk: unknown): void {
  res.write(`data: ${JSON.stringify(chunk)}\n\n`);
}

function finishSse(res: ServerResponse): void {
  res.write("data: [DONE]\n\n");
  res.end();
}

/** 最小完整 text 往返：start → text-start/delta/end → finish → [DONE]。 */
function writeOkStream(res: ServerResponse, text: string): void {
  const messageId = `msg_${randomUUID()}`;
  const textId = `text_${randomUUID()}`;
  writeSse(res, { type: "start", messageId });
  writeSse(res, { type: "text-start", id: textId });
  writeSse(res, { type: "text-delta", id: textId, delta: text });
  writeSse(res, { type: "text-end", id: textId });
  writeSse(res, { type: "finish" });
  finishSse(res);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 从客户端重发的 assistant message 读取公开 approval-responded 状态。 */
function approvalDecision(bodyText: string): boolean | undefined {
  const body: unknown = JSON.parse(bodyText);
  if (!isRecord(body) || !Array.isArray(body.messages)) return undefined;
  const assistant = [...body.messages].reverse().find(
    (message) => isRecord(message) && message.role === "assistant" && Array.isArray(message.parts),
  );
  if (!isRecord(assistant) || !Array.isArray(assistant.parts)) return undefined;
  const part = assistant.parts.find(
    (candidate) => isRecord(candidate) && candidate.toolCallId === APPROVAL_CALL_ID,
  );
  if (!isRecord(part) || part.state !== "approval-responded" || !isRecord(part.approval)) {
    return undefined;
  }
  return part.approval.approved === true;
}

function writeApprovalStream(res: ServerResponse, bodyText: string): void {
  const decision = approvalDecision(bodyText);
  const chunks: UIMessageChunk[] = [{ type: "start", messageId: APPROVAL_MESSAGE_ID }];

  if (decision === undefined) {
    chunks.push(
      {
        type: "tool-input-available",
        toolCallId: APPROVAL_CALL_ID,
        toolName: APPROVAL_TOOL,
        input: { expression: "(23+19)*3" },
      },
      {
        type: "tool-approval-request",
        approvalId: APPROVAL_ID,
        toolCallId: APPROVAL_CALL_ID,
      },
      { type: "finish", finishReason: "tool-calls" },
    );
  } else {
    if (decision) {
      chunks.push({
        type: "tool-output-available",
        toolCallId: APPROVAL_CALL_ID,
        output: { value: 126, marker: "local-approval-output" },
      });
    }
    const textId = decision ? "local-approval-approved-text" : "local-approval-denied-text";
    chunks.push(
      { type: "text-start", id: textId },
      {
        type: "text-delta",
        id: textId,
        delta: decision ? "local-approval-approved" : "local-approval-denied",
      },
      { type: "text-end", id: textId },
      { type: "finish", finishReason: "stop" },
    );
  }

  for (const chunk of chunks) writeSse(res, chunk);
  finishSse(res);
}

/** 写半截 SSE 后硬关连接，模拟 transport 断流。 */
function writeDisconnectStream(res: ServerResponse): void {
  const messageId = `msg_${randomUUID()}`;
  const textId = `text_${randomUUID()}`;
  writeSse(res, { type: "start", messageId });
  writeSse(res, { type: "text-start", id: textId });
  writeSse(res, { type: "text-delta", id: textId, delta: "partial-" });
  // 先 flush 已写帧，再 destroy：客户端应已拿到 200 + 半截 body，失败落在流读取阶段。
  // 故意不 finish、不 [DONE]。
  res.write("", () => {
    res.destroy();
  });
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
  });
  res.end(JSON.stringify(body));
}

const server = createServer((req, res) => {
  void (async () => {
    try {
      const method = req.method ?? "GET";
      const url = new URL(req.url ?? "/", FIXTURE_BASE_URL);

      if (method === "OPTIONS") {
        res.writeHead(204, {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET,POST,OPTIONS",
          "access-control-allow-headers": "content-type",
        });
        res.end();
        return;
      }

      if (method === "GET" && (url.pathname === "/healthz" || url.pathname === "/api/health")) {
        json(res, 200, { ok: true });
        return;
      }

      if (method === "POST") {
        const mode = modeFromPath(url.pathname);
        if (!mode) {
          json(res, 404, { error: `unknown mode path: ${url.pathname}` });
          return;
        }

        // 消费 body，避免客户端半关闭时挂起；approval 模式还会读取公开的
        // assistant approval-responded 状态，决定返回 output 或拒绝确认。
        const body = await readBody(req);

        if (mode === "error") {
          json(res, 500, { error: "local-protocol fixture deliberate 500" });
          return;
        }

        if (mode === "hang") {
          // 写响应头后永不 body/end：给 attempt timeout 提供可观察的挂起。
          res.writeHead(200, sseHeaders());
          return;
        }

        res.writeHead(200, sseHeaders());
        if (mode === "disconnect") {
          writeDisconnectStream(res);
          return;
        }

        if (mode === "approval") {
          writeApprovalStream(res, body);
          return;
        }

        writeOkStream(res, "local-protocol-ok");
        return;
      }

      json(res, 404, { error: "not found" });
    } catch (error) {
      if (!res.headersSent) {
        json(res, 500, {
          error: error instanceof Error ? error.message : String(error),
        });
      } else {
        res.destroy(error instanceof Error ? error : undefined);
      }
    }
  })();
});

server.listen(FIXTURE_PORT, FIXTURE_HOST, () => {
  process.stdout.write(`local-protocol fixture listening on ${FIXTURE_BASE_URL}\n`);
});

function shutdown(): void {
  server.close(() => process.exit(0));
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
