// 签入的本地 UI Message Stream HTTP fixture。
//
// 只服务 adapter/local-protocol 的 transport / 故障注入与共享断言契约：
// 固定 SSE 帧、可控断流、挂起与 HTTP 错误；契约三节（conversation / scope-tool / coding）
// 按真实协议帧吐出工具 part。不模拟 live AI SDK 的 HITL / session 矩阵，也不需要真实
// provider 或密钥。协议形状参考 AI SDK UI Message Stream 文档
// （tool-input-available → tool-output-available 归约出 output-available 工具 part），
// 仅够 uiMessageStreamAgent 归约出真实事件流。coding 节只吐帧、不做文件操作：Direct
// Agent 没有 Sandbox（profile 声明 sandboxUnavailable: true），契约只要求真实的
// ToolMatch 帧，不要求落盘。

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { FIXTURE_BASE_URL, FIXTURE_HOST, FIXTURE_PORT } from "./address.ts";

type Mode = "ok" | "disconnect" | "hang" | "error" | "conversation" | "scope-tool" | "coding";

function modeFromPath(pathname: string): Mode | undefined {
  // /modes/<mode>/api/chat
  const match = pathname.match(
    /^\/modes\/(ok|disconnect|hang|error|conversation|scope-tool|coding)\/api\/chat\/?$/,
  );
  return match?.[1] as Mode | undefined;
}

// ───────────────────── 共享断言契约的 profile 常量 ─────────────────────
// 与 evals/assertion-profile.ts 的同一组字面量；fixture 是真实执行端，不是断言逻辑。
const CONTRACT_MARKERS = {
  conversation: "LOCAL_CONTRACT_CONVERSATION_926",
  scope: "LOCAL_CONTRACT_SCOPE_926",
  changedPath: "assertion-contract-edit.txt",
  createdPath: "assertion-contract-created.txt",
  deletedPath: "assertion-contract-delete.txt",
  changedBefore: "before-assertion-contract-926",
  changedAfter: "after-assertion-contract-926",
  createdMarker: "created-by-assertion-contract-926",
  shellMarker: "LOCAL_CONTRACT_OUTPUT_926",
} as const;

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

/** 最小完整 text 往返：start → text-start/delta/end → finish → [DONE]。 */
function writeOkStream(res: ServerResponse, text: string): void {
  const messageId = `msg_${randomUUID()}`;
  const textId = `text_${randomUUID()}`;
  writeSse(res, { type: "start", messageId });
  writeSse(res, { type: "text-start", id: textId });
  writeSse(res, { type: "text-delta", id: textId, delta: text });
  writeSse(res, { type: "text-end", id: textId });
  writeSse(res, { type: "finish" });
  res.write("data: [DONE]\n\n");
  res.end();
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

// ───────────────────── 共享断言契约的协议帧（真实工具 part，非伪造事件） ─────────────────────

/** 一条已完成工具调用的标准帧序列：input-available → output-available。 */
function writeToolCall(res: ServerResponse, callId: string, toolName: string, input: unknown, output: unknown): void {
  writeSse(res, { type: "tool-input-available", toolCallId: callId, toolName, input });
  writeSse(res, { type: "tool-output-available", toolCallId: callId, output });
}

/** 收尾文本 + finish + [DONE]；事件流里 operation 之后出现 message 事件。 */
function writeFinish(res: ServerResponse, text: string): void {
  const textId = `text_${randomUUID()}`;
  writeSse(res, { type: "text-start", id: textId });
  writeSse(res, { type: "text-delta", id: textId, delta: text });
  writeSse(res, { type: "text-end", id: textId });
  writeSse(res, { type: "finish" });
  res.write("data: [DONE]\n\n");
  res.end();
}

/** conversation 节：零工具的纯文本往返，回复固定 marker。 */
function writeConversationStream(res: ServerResponse): void {
  writeSse(res, { type: "start", messageId: `msg_${randomUUID()}` });
  writeFinish(res, CONTRACT_MARKERS.conversation);
}

/** scope-tool 节：恰好一次 shell 工具调用，input/output 都带 marker。 */
function writeScopeToolStream(res: ServerResponse): void {
  writeSse(res, { type: "start", messageId: `msg_${randomUUID()}` });
  writeToolCall(res, `call_${randomUUID()}`, "shell", { command: `echo ${CONTRACT_MARKERS.scope}` }, { stdout: CONTRACT_MARKERS.scope });
  writeFinish(res, "done");
}

/** coding 节：4 次真实工具 part 帧（file_write / file_edit / shell / shell）。 */
function writeCodingStream(res: ServerResponse): void {
  writeSse(res, { type: "start", messageId: `msg_${randomUUID()}` });

  writeToolCall(
    res,
    `call_${randomUUID()}`,
    "file_write",
    { path: CONTRACT_MARKERS.createdPath, content: CONTRACT_MARKERS.createdMarker },
    { ok: true },
  );

  writeToolCall(
    res,
    `call_${randomUUID()}`,
    "file_edit",
    {
      path: CONTRACT_MARKERS.changedPath,
      oldText: CONTRACT_MARKERS.changedBefore,
      newText: CONTRACT_MARKERS.changedAfter,
    },
    { ok: true, replaced: 1 },
  );

  writeToolCall(res, `call_${randomUUID()}`, "shell", { command: `rm ${CONTRACT_MARKERS.deletedPath}` }, { ok: true });

  writeToolCall(
    res,
    `call_${randomUUID()}`,
    "shell",
    { command: `echo ${CONTRACT_MARKERS.shellMarker}` },
    { stdout: CONTRACT_MARKERS.shellMarker },
  );

  writeFinish(res, "done");
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

        // 消费 body，避免客户端半关闭时挂起；内容本身不影响 canned 帧。
        await readBody(req);

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
        if (mode === "conversation") {
          writeConversationStream(res);
          return;
        }
        if (mode === "scope-tool") {
          writeScopeToolStream(res);
          return;
        }
        if (mode === "coding") {
          writeCodingStream(res);
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
