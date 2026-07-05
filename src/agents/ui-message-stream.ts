// uiMessageStreamAgent():AI SDK UI Message Stream Protocol 的无侵入 HTTP adapter 工厂。
//
// 协议:https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol —— `useChat` 后端的标准 SSE
// (`data: {UIMessageChunk}\n\n`,以 `data: [DONE]\n\n` 收尾)。这是「对着一个已部署的
// AI SDK 应用的 HTTP 接口无侵入接入」:adapter 只 fetch,不 import 被测应用的任何代码。
//
//   · 会话:协议是服务端零状态、「客户端带全量历史」——工厂用 ctx.session.history() 存整份
//     UIMessage[],每轮原样重放;ctx.session.id 未记录时开新 chat id 并 capture 回写。
//   · 事件流:从归约后的 assistant 消息 parts 直构(text → message,tool part 的
//     output-available / output-error / 审批拒绝 → action.called + action.result),
//     不要求应用接 OTel;跨 resume 轮次按 callId / 已报文本长度去重。
//   · HITL:v7 tool approval(`needsApproval` 工具)——part 停在 `approval-requested` 时
//     整轮 `waiting` + `input.requested`;下一轮输入(approve / yes / 同意 / 批准 开头 =
//     批准,其余拒绝)翻译成 `approval-responded` 原地改写该 part、原样重发 messages 触发
//     服务端续跑 —— 和真实前端 `addToolApprovalResponse()` + `sendMessage()` 的协议行为
//     完全一致,没有单独的 approve 端点。拒绝的调用协议里不会有任何 tool-output 帧
//     (从没真正执行),由工厂合成 `status: "rejected"` 的 action.result。
//   · chunk 归约用 `ai` 包官方导出的框架无关 reducer `readUIMessageStream`(`useChat`
//     内部同款),保证重放回服务端的 UIMessage 形状协议正确 —— `ai` 是可选 peer 依赖,
//     只在用到本工厂时需要安装。
//
// tracing / spanMapper 原样透传:应用有 OTel 时接上拿瀑布图(span 只进瀑布图,不喂断言),
// 事件流始终从协议帧直构。

import { randomUUID } from "node:crypto";

import { defineAgent } from "../define.ts";
import type { Agent, AgentContext, AgentTracing, InputResponse, JsonValue, SpanMapper, StreamEvent, TurnInput } from "../types.ts";

// ───────────────────────── 协议的结构化类型(structural,不依赖 ai 包的类型) ─────────────────────────

/** UIMessage 的最小结构面:只声明工厂真正要读的字段,其余原样透传。 */
export interface UIMessageLike {
  id: string;
  role: string;
  parts: UIMessagePartLike[];
  [key: string]: unknown;
}

export interface UIMessagePartLike {
  type: string;
  state?: string;
  text?: string;
  toolCallId?: string;
  toolName?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
  approval?: { id: string; approved?: boolean; reason?: string };
  [key: string]: unknown;
}

interface UIMessageChunkLike {
  type: string;
  errorText?: string;
  [key: string]: unknown;
}

type ReadUIMessageStream = (options: {
  message?: UIMessageLike;
  stream: ReadableStream<UIMessageChunkLike>;
}) => AsyncIterable<UIMessageLike>;

// ai 是可选 peer 依赖:动态 import,缺了就把「装什么」直接说清楚。
// 说明符经变量传入,避免 TS 对字面量模块名做安装检查(niceeval 自身不依赖 ai)。
let aiModule: Promise<{ readUIMessageStream: ReadUIMessageStream }> | undefined;
function loadAi(): Promise<{ readUIMessageStream: ReadUIMessageStream }> {
  if (!aiModule) {
    const specifier = "ai";
    aiModule = (import(specifier) as Promise<{ readUIMessageStream: ReadUIMessageStream }>).catch(() => {
      aiModule = undefined;
      throw new Error(
        "uiMessageStreamAgent 需要 `ai` 包(AI SDK v5+,协议 reducer readUIMessageStream 来自它)。在你的 eval 项目里安装:npm install -D ai",
      );
    });
  }
  return aiModule;
}

// ───────────────────────── SSE 解析 ─────────────────────────

async function* parseSseChunks(body: ReadableStream<Uint8Array>): AsyncGenerator<UIMessageChunkLike> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const sepIndex = buffer.indexOf("\n\n");
    if (sepIndex !== -1) {
      const rawEvent = buffer.slice(0, sepIndex);
      buffer = buffer.slice(sepIndex + 2);
      const line = rawEvent.split("\n").find((l) => l.startsWith("data: "));
      if (line) {
        const payload = line.slice("data: ".length);
        if (payload !== "[DONE]") yield JSON.parse(payload) as UIMessageChunkLike;
      }
      continue;
    }
    const { value, done } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
  }
}

/** 把 SSE 包成 readUIMessageStream 要的 ReadableStream,顺带旁路探测(错误帧等)。 */
function toChunkStream(
  body: ReadableStream<Uint8Array>,
  onChunk: (c: UIMessageChunkLike) => void,
): ReadableStream<UIMessageChunkLike> {
  const gen = parseSseChunks(body);
  return new ReadableStream<UIMessageChunkLike>({
    async pull(controller) {
      const { value, done } = await gen.next();
      if (done) {
        controller.close();
        return;
      }
      onChunk(value);
      controller.enqueue(value);
    },
  });
}

// ───────────────────────── parts → 事件 ─────────────────────────

function isToolPart(part: UIMessagePartLike): boolean {
  return part.type === "dynamic-tool" || part.type.startsWith("tool-");
}

function toolNameOf(part: UIMessagePartLike): string {
  if (part.type === "dynamic-tool") return part.toolName ?? "dynamic-tool";
  return part.type.slice("tool-".length);
}

function isApprovalRequested(part: UIMessagePartLike): boolean {
  return isToolPart(part) && part.state === "approval-requested";
}

/** 和 aiSdkAgent 同一词法(t.respond 的自由文本回答):approve / yes / 同意 / 批准 开头 = 批准。 */
function isApproved(text: string): boolean {
  return /^(approve|yes|同意|批准)/i.test(text.trim());
}

/** 按 requestId 从 input.responses 对位取裁决;optionId 优先,自由文本走 isApproved,没答到直接报错。 */
function approvalDecision(responses: readonly InputResponse[] | undefined, requestId: string | undefined): boolean {
  const matched = responses?.find((r) => r.requestId === requestId);
  if (!matched) {
    throw new Error(`No response for pending approval "${requestId ?? "unknown"}". Answer approval requests with t.respond(...).`);
  }
  if (matched.optionId !== undefined) return matched.optionId === "approve";
  return isApproved(matched.text ?? "");
}

/** 已报告的进度:resume 续跑的是同一条 assistant 消息,跨轮去重靠它。 */
interface ReportedState {
  calls: Set<string>;
  textLen: number;
}

/**
 * 从归约后的最终消息派生本轮事件。工具事件按 part 顺序;文本合并成一条 message 事件
 * (resume 轮只报新增的后缀)。停在 approval-requested 的调用不报 called —— 它还没执行,
 * 裁决后那一轮才落成 completed(批准)或 rejected(拒绝)。
 */
function deriveTurnEvents(message: UIMessageLike, reported: ReportedState): StreamEvent[] {
  const events: StreamEvent[] = [];
  let fullText = "";
  for (const part of message.parts) {
    if (part.type === "text") {
      fullText += part.text ?? "";
      continue;
    }
    if (!isToolPart(part)) continue;
    const callId = part.toolCallId ?? "";
    if (!callId || reported.calls.has(callId)) continue;
    const name = toolNameOf(part);
    const input = (part.input ?? null) as JsonValue;
    if (part.state === "output-available") {
      events.push({ type: "action.called", callId, name, input });
      events.push({ type: "action.result", callId, output: part.output as JsonValue, status: "completed" });
      reported.calls.add(callId);
    } else if (part.state === "output-error") {
      events.push({ type: "action.called", callId, name, input });
      events.push({ type: "action.result", callId, output: part.errorText, status: "failed" });
      reported.calls.add(callId);
    } else if (part.state === "approval-responded" && part.approval?.approved === false) {
      // 拒绝的调用从没真正执行,协议里不会再有它的任何帧 —— 在裁决落地的这一轮合成。
      events.push({ type: "action.called", callId, name, input });
      events.push({ type: "action.result", callId, status: "rejected" });
      reported.calls.add(callId);
    }
    // approval-requested(还没裁决)/ input-* 中间态:先不报,等它到终态。
  }
  const newText = fullText.slice(reported.textLen);
  if (newText.trim()) events.push({ type: "message", role: "assistant", text: newText });
  reported.textLen = fullText.length;
  return events;
}

// ───────────────────────── 工厂 ─────────────────────────

export interface UiMessageStreamAgentOptions {
  /** agent 名(报告 / 结果聚合的身份)。默认 "ui-message-stream"。 */
  name?: string;
  /** 被测应用的 chat 端点(完整 URL,应用在哪部署就指哪);函数形式每轮解析。 */
  url: string | ((ctx: AgentContext) => string | Promise<string>);
  /** 附加请求头(鉴权等);`ctx.telemetry.headers`(traceparent)总会自动并入。 */
  headers?: Record<string, string> | ((ctx: AgentContext) => Record<string, string>);
  /** 除 `messages` 外并入请求体的字段,如 `(ctx) => ({ model: ctx.model })`(undefined 字段序列化时自动丢弃)。 */
  body?: (ctx: AgentContext) => Record<string, JsonValue | undefined>;
  /**
   * 拒绝审批时随 `approval-responded` 带出的理由。应用/SDK 会把它作为模型看到的工具结果
   * 文本 —— 写清楚「不要重试」能明显降低模型原样重发同一调用的概率(实测)。
   */
  denyReason?: string;
  /** 流结束后再等这么久才返回(毫秒),给应用侧的观测导出(如 BatchSpanProcessor)留时间。 */
  settleMs?: number;
  /** 应用有 OTel 时的端点投递方式(拿瀑布图);事件流不依赖它。 */
  tracing?: AgentTracing;
  spanMapper?: SpanMapper;
}

const DEFAULT_DENY_REASON = "用户拒绝了这次调用,不要重试,直接告知用户操作未执行。";

/**
 * UI Message Stream Protocol(AI SDK `useChat` 后端的标准 SSE 协议)的内置无侵入 adapter。
 * 对着已部署应用的 HTTP 端点收发,不 import 应用代码:
 *
 * ```typescript
 * import { uiMessageStreamAgent } from "niceeval/adapter";
 *
 * export default uiMessageStreamAgent({
 *   name: "my-assistant",
 *   url: "https://my-app.example.com/api/chat",
 *   body: (ctx) => ({ model: ctx.model }),   // 应用支持请求级选模型时,模型对比零改动
 * });
 * ```
 */
export function uiMessageStreamAgent(options: UiMessageStreamAgentOptions): Agent {
  return defineAgent({
    name: options.name ?? "ui-message-stream",
    tracing: options.tracing,
    spanMapper: options.spanMapper,

    async send(input: TurnInput, ctx: AgentContext) {
      const { readUIMessageStream } = await loadAi();

      // 会话续接是「客户端带全量历史」模式:历史槽直接挂在 ctx.session 上,新线自然为空。
      // chat id(useChat 协议要求请求带,每条会话线固定一个)和 reported(HITL 续跑时跨轮
      // 去重要用)是本协议特有的簿记,存进 ctx.session.state(逃生舱,随会话线创建/丢弃)。
      const history = ctx.session.history<UIMessageLike>();
      const priorMessages = history.get();
      const bookkeeping = ctx.session.state as { chatId?: string; reported?: ReportedState };
      let id = bookkeeping.chatId;
      if (!id) {
        id = `uims-${randomUUID()}`;
        bookkeeping.chatId = id;
        ctx.session.capture(id); // 镜像:t.sessionId / 报告可见
      }

      const lastMessage = priorMessages.at(-1);
      const pendingPart =
        lastMessage?.role === "assistant" ? lastMessage.parts.find(isApprovalRequested) : undefined;

      let messagesToSend: UIMessageLike[];
      let resumeFrom: UIMessageLike | undefined;

      if (pendingPart && lastMessage) {
        // HITL 续跑:不追加新 user 消息 —— 把停在 approval-requested 的 part 原地改成
        // approval-responded,原样重发,服务端续跑同一条被打断的 assistant 消息。
        // 裁决按 requestId 从 input.responses 对位读取(t.respond 的结构化回答)。
        const requestId = pendingPart.approval?.id ?? pendingPart.toolCallId;
        const approved = approvalDecision(input.responses, requestId);
        const mutatedParts = lastMessage.parts.map((part) =>
          isApprovalRequested(part) && part.approval?.id === pendingPart.approval?.id
            ? {
                ...part,
                state: "approval-responded",
                approval: {
                  id: pendingPart.approval!.id,
                  approved,
                  ...(approved ? {} : { reason: options.denyReason ?? DEFAULT_DENY_REASON }),
                },
              }
            : part,
        );
        resumeFrom = { ...lastMessage, parts: mutatedParts };
        messagesToSend = [...priorMessages.slice(0, -1), resumeFrom];
      } else {
        const parts: UIMessagePartLike[] = [{ type: "text", text: input.text }];
        for (const f of input.files ?? []) {
          parts.push({ type: "file", mediaType: f.mimeType, url: `data:${f.mimeType};base64,${f.dataBase64}` });
        }
        messagesToSend = [...priorMessages, { id: randomUUID(), role: "user", parts }];
      }

      const url = typeof options.url === "function" ? await options.url(ctx) : options.url;
      const extraHeaders = typeof options.headers === "function" ? options.headers(ctx) : (options.headers ?? {});
      let res: Response;
      try {
        res = await fetch(url, {
          method: "POST",
          // traceparent 随请求带过去:应用埋点支持 context 传播时,span 归属精确到本轮。
          headers: { "content-type": "application/json", ...extraHeaders, ...ctx.telemetry?.headers },
          body: JSON.stringify({ ...options.body?.(ctx), messages: messagesToSend }),
          signal: ctx.signal,
        });
      } catch (err) {
        if (ctx.signal.aborted) throw err;
        const cause = err instanceof Error ? (err.cause instanceof Error ? err.cause.message : err.message) : String(err);
        throw new Error(
          `Could not connect to ${url} (${cause}). Is the app under test running? Start it yourself first, or point url at a deployed instance via config.`,
        );
      }
      if (!res.ok || !res.body) {
        throw new Error(
          `POST ${url} failed: ${res.status} ${await res.text().catch(() => "")}. Confirm the app is running and the endpoint speaks the UI Message Stream protocol (the backend useChat expects).`,
        );
      }

      let sawError: string | undefined;
      const chunkStream = toChunkStream(res.body, (c) => {
        if (c.type === "error") sawError = c.errorText;
      });

      let finalMessage: UIMessageLike | undefined;
      for await (const msg of readUIMessageStream({ message: resumeFrom, stream: chunkStream })) {
        finalMessage = msg;
      }
      if (!finalMessage) {
        throw new Error(`POST ${url} 的流结束了但一条 assistant 消息都没归约出来 —— 端点吐的不是 UI Message Stream 帧?`);
      }

      // 续跑轮:finalMessage 是同一条消息的完整版,替换末尾半成品;全新轮:追加。
      history.commit(
        resumeFrom ? [...messagesToSend.slice(0, -1), finalMessage] : [...messagesToSend, finalMessage],
      );

      const reported: ReportedState = resumeFrom && bookkeeping.reported ? bookkeeping.reported : { calls: new Set(), textLen: 0 };
      bookkeeping.reported = reported;
      const events = deriveTurnEvents(finalMessage, reported);

      const request = finalMessage.parts.find(isApprovalRequested);
      if (request) {
        return {
          status: "waiting" as const,
          events: [
            ...events,
            {
              type: "input.requested" as const,
              request: {
                id: request.approval?.id ?? request.toolCallId,
                action: toolNameOf(request),
                input: (request.input ?? null) as JsonValue,
                options: [{ id: "approve" }, { id: "deny" }],
              },
            },
          ],
        };
      }

      if (options.settleMs) await new Promise((resolve) => setTimeout(resolve, options.settleMs));
      return {
        status: sawError ? ("failed" as const) : ("completed" as const),
        events: [...events, ...(sawError ? [{ type: "error" as const, message: sawError }] : [])],
      };
    },
  });
}
