// uiMessageStreamAgent():AI SDK UI Message Stream Protocol 的无侵入 HTTP adapter 工厂。
//
// 协议:https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol —— `useChat` 后端的标准 SSE
// (`data: {UIMessageChunk}\n\n`,以 `data: [DONE]\n\n` 收尾)。这是「对着一个已部署的
// AI SDK 应用的 HTTP 接口无侵入接入」:adapter 只 fetch,不 import 被测应用的任何代码。
//
//   · 会话:协议是服务端零状态、「客户端带全量历史」——工厂用 typed slot 存整份
//     UIMessage[],每轮原样重放;ctx.session.id 未记录时开新 chat id 并 capture 回写。
//   · 事件流:从归约后的 assistant 消息 parts 直构(text → message,tool part 的
//     approval-requested → operation.started,output-available / output-error / 审批拒绝
//     → operation.finished),
//     不要求应用接 OTel;跨 resume 轮次按 callId / 已报文本长度去重。
//   · HITL:v7 tool approval(`needsApproval` 工具)——part 停在 `approval-requested` 时
//     整轮 `waiting` + `input.requested`;下一轮输入(approve / yes / 同意 / 批准 开头 =
//     批准,其余拒绝)翻译成 `approval-responded` 原地改写该 part、原样重发 messages 触发
//     服务端续跑 —— 和真实前端 `addToolApprovalResponse()` + `sendMessage()` 的协议行为
//     完全一致,没有单独的 approve 端点。拒绝的调用协议里不会有任何 tool-output 帧
//     (从没真正执行),由工厂合成 `status: "rejected"` 的 operation.finished。
//   · chunk 归约用 `ai` 包官方导出的框架无关 reducer `readUIMessageStream`(`useChat`
//     内部同款),保证重放回服务端的 UIMessage 形状协议正确 —— `ai` 是可选 peer 依赖,
//     只在用到本工厂时需要安装。
//
// tracing / spanMapper 原样透传:应用有 OTel 时接上拿瀑布图(span 只进瀑布图,不喂断言),
// 事件流始终从协议帧直构。

import { randomUUID } from "node:crypto";
import { Effect } from "effect";

import { defineAgent } from "../define.ts";
import { makeSendFailure } from "../context/send-failures.ts";
import { normalizeExternalCause } from "../shared/external-cause.ts";
import { completeEvidenceCoverage } from "../assertions/coverage.ts";
import type { Agent, AgentContext, AgentTracing, CommandProjection, EvidenceCoverage, InputResponse, JsonValue, SpanMapper, StreamEvent, TurnInput } from "../types.ts";
import { createSessionSlot } from "./session-slot.ts";
import { unclassifiedToolActionsCoverage } from "../o11y/command-projection.ts";

// UI Message Stream 帧里没有 usage(协议本身不带 token 计数,见 docs/engineering/testing/e2e/README.md
// 第 2 节);events/actions/messages/status 都直接来自完整归约的协议帧,和 turnFromAiSdk/aiSdkAgent
// 同等完整——官方 SDK 适配器应声明全通道 complete(docs/feature/adapters/architecture/evidence.md),
// 这里唯一的例外是协议本身没有的 usage 通道,如实标 unavailable 而不是留成 unknown。
const COVERAGE: EvidenceCoverage = Object.freeze({
  ...completeEvidenceCoverage,
  usage: { status: "unavailable" as const, reason: "UI Message Stream frames carry no token usage" },
});

// ───────────────────────── 协议的结构化类型(structural,不依赖 ai 包的类型) ─────────────────────────

/** UIMessage 的最小结构面:只声明工厂真正要读的字段,其余原样透传。 */
export interface UIMessageLike {
  id: string;
  role: string;
  parts: UIMessagePartLike[];
  [key: string]: JsonValue | UIMessagePartLike[] | undefined;
}

export interface UIMessagePartLike {
  type: string;
  state?: string;
  text?: string;
  toolCallId?: string;
  toolName?: string;
  input?: JsonValue;
  output?: JsonValue;
  errorText?: string;
  approval?: { id: string; approved?: boolean; reason?: string };
  [key: string]: JsonValue | undefined;
}

interface UIMessageChunkLike {
  type: string;
  errorText?: string;
  [key: string]: JsonValue | undefined;
}

interface UiMessageSessionState {
  chatId?: string;
  reported?: ReportedState;
}

const historySlot = createSessionSlot<UIMessageLike[]>("ui-message-stream/history");
const sessionStateSlot = createSessionSlot<UiMessageSessionState>("ui-message-stream/state");

type ReadUIMessageStream = (options: {
  message?: UIMessageLike;
  stream: ReadableStream<UIMessageChunkLike>;
}) => AsyncIterable<UIMessageLike>;

// ai 是可选 peer 依赖:动态 import,缺了就把「装什么」直接说清楚。
// 说明符经变量传入,避免 TS 对字面量模块名做安装检查(niceeval 自身不依赖 ai)。
let aiModule: Promise<{ readUIMessageStream: ReadUIMessageStream }> | undefined;

function missingAiModule(): Error {
  return new Error(
    "uiMessageStreamAgent 需要 `ai` 包(AI SDK v5+,协议 reducer readUIMessageStream 来自它)。在你的 eval 项目里安装:npm install -D ai",
  );
}

/** Dynamic import is an SDK Promise boundary; a rejected load is never cached. */
function loadAiEffect(): Effect.Effect<{ readUIMessageStream: ReadUIMessageStream }, Error> {
  const pending = aiModule;
  return Effect.tryPromise({
    try: () => {
      if (pending !== undefined) return pending;
      const specifier = "ai";
      const loading = import(specifier) as Promise<{ readUIMessageStream: ReadUIMessageStream }>;
      aiModule = loading;
      return loading;
    },
    catch: () => missingAiModule(),
  }).pipe(
    Effect.tapError(() => Effect.sync(() => {
      aiModule = undefined;
    })),
  );
}

// ───────────────────────── SSE 解析 ─────────────────────────

function drainSseEvents(
  buffer: string,
  controller: TransformStreamDefaultController<UIMessageChunkLike>,
  onChunk: (chunk: UIMessageChunkLike) => void,
  onDone: () => void,
): string {
  for (;;) {
    const sepIndex = buffer.indexOf("\n\n");
    if (sepIndex === -1) return buffer;
    const rawEvent = buffer.slice(0, sepIndex);
    buffer = buffer.slice(sepIndex + 2);
    const line = rawEvent.split("\n").find((candidate) => candidate.startsWith("data: "));
    if (!line) continue;
    const payload = line.slice("data: ".length);
    if (payload === "[DONE]") {
      onDone();
      // `[DONE]` is the protocol terminal, not an advisory event. Closing the
      // reducer input here prevents frames later in the same network chunk (or
      // later chunks) from manufacturing a successful Turn after termination.
      controller.terminate();
      return "";
    }
    const chunk = JSON.parse(payload) as UIMessageChunkLike;
    onChunk(chunk);
    controller.enqueue(chunk);
  }
}

/**
 * Build the AI SDK reducer input with native stream composition rather than a hand-owned reader.
 * Scope finalization below aborts/cancels this pipeline, so an interrupted reducer cannot retain a
 * body reader or live HTTP transport.
 */
function toChunkStream(
  body: ReadableStream<Uint8Array>,
  onChunk: (c: UIMessageChunkLike) => void,
  onDone: () => void,
): ReadableStream<UIMessageChunkLike> {
  const decoder = new TextDecoder();
  let buffer = "";
  return body.pipeThrough(new TransformStream<Uint8Array, UIMessageChunkLike>({
    transform(value, controller) {
      buffer += decoder.decode(value, { stream: true });
      buffer = drainSseEvents(buffer, controller, onChunk, onDone);
    },
    flush(controller) {
      // Keep the original protocol rule: only a completed `\n\n` record is observable.
      buffer = drainSseEvents(buffer, controller, onChunk, onDone);
    },
  }));
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
  startedCalls: Set<string>;
  finishedCalls: Set<string>;
  liveProgressCalls: Set<string>;
  textLen: number;
}

const COMPLETE_TOOL_INPUT_STATES = new Set([
  "input-available",
  "approval-requested",
  "approval-responded",
  "output-available",
  "output-error",
  "output-denied",
]);

/** Project only reducer-owned messages whose tool input is already complete. */
function reportLiveToolProgress(message: UIMessageLike, reported: ReportedState, ctx: AgentContext): void {
  for (const part of message.parts) {
    if (
      !isToolPart(part) ||
      !COMPLETE_TOOL_INPUT_STATES.has(part.state ?? "") ||
      typeof part.toolCallId !== "string" || part.toolCallId === "" ||
      !Object.prototype.hasOwnProperty.call(part, "input") ||
      reported.liveProgressCalls.has(part.toolCallId)
    ) continue;
    const name = toolNameOf(part);
    if (name === "") continue;
    let input: string | undefined;
    try {
      input = JSON.stringify(part.input);
    } catch {
      continue;
    }
    if (input === undefined) continue;
    reported.liveProgressCalls.add(part.toolCallId);
    ctx.progress({ message: `tool: ${name} ${input}` });
  }
}

/**
 * 从归约后的最终消息派生本轮事件。工具事件按 part 顺序;文本合并成一条 message 事件
 * (resume 轮只报新增的后缀)。停在 approval-requested 的调用先报 started,
 * 因此它在审批轮是 pending;裁决后的续跑轮只补 finished,落成 completed 或 rejected。
 */
function deriveTurnEvents(
  message: UIMessageLike,
  reported: ReportedState,
  projectToolCommand: UiMessageStreamAgentOptions["projectToolCommand"],
): StreamEvent[] {
  const events: StreamEvent[] = [];
  let fullText = "";
  for (const part of message.parts) {
    if (part.type === "text") {
      fullText += part.text ?? "";
      continue;
    }
    if (!isToolPart(part)) continue;
    const callId = part.toolCallId ?? "";
    if (!callId || reported.finishedCalls.has(callId)) continue;
    const name = toolNameOf(part);
    const input = (part.input ?? null) as JsonValue;
    const start = () => {
      if (reported.startedCalls.has(callId)) return;
      const command = projectToolCommand?.({ name, input });
      events.push({
        type: "operation.started",
        operationId: callId,
        operation: {
          kind: "tool",
          name,
          input,
          ...(command === undefined ? {} : { command }),
        },
      });
      reported.startedCalls.add(callId);
    };
    if (part.state === "output-available") {
      start();
      events.push({ type: "operation.finished", operationId: callId, kind: "tool", output: part.output as JsonValue, status: "completed" });
      reported.finishedCalls.add(callId);
    } else if (part.state === "output-error") {
      start();
      events.push({ type: "operation.finished", operationId: callId, kind: "tool", output: part.errorText, status: "failed" });
      reported.finishedCalls.add(callId);
    } else if (
      part.state === "output-denied" ||
      (part.state === "approval-responded" && part.approval?.approved === false)
    ) {
      // 拒绝的调用从没真正执行,协议里不会再有它的任何帧 —— 在裁决落地的这一轮合成。
      start();
      events.push({ type: "operation.finished", operationId: callId, kind: "tool", status: "rejected" });
      reported.finishedCalls.add(callId);
    } else if (part.state === "approval-requested") {
      start();
    }
    // input-* 中间态还没有可信的完整入参,等 approval-requested 或终态再报。
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
  headers?: globalThis.Record<string, string> | ((ctx: AgentContext) => globalThis.Record<string, string>);
  /** 除 `messages` 外并入请求体的字段,如 `(ctx) => ({ model: ctx.model })`(undefined 字段序列化时自动丢弃)。 */
  body?: (ctx: AgentContext) => globalThis.Record<string, JsonValue | undefined>;
  /**
   * 由 endpoint owner 逐笔把逻辑工具调用分类为 command 或 not-command。
   * 未知调用返回 undefined 并保持 actions coverage partial；NiceEval 不按名称或 input 猜测。
   */
  projectToolCommand?: (tool: Readonly<{ name: string; input: JsonValue }>) => CommandProjection | undefined;
  /**
   * 拒绝审批时随 `approval-responded` 带出的理由。应用/SDK 会把它作为模型看到的工具结果
   * 文本 —— 写清楚「不要重试」能明显降低模型原样重发同一调用的概率(实测)。
   */
  denyReason?: string;
  /** 流结束后再等这么久才返回(毫秒),给应用侧的观测导出(如 BatchSpanProcessor)留时间。 */
  settleMs?: number;
  /** 应用有 OTel 时的端点投递方式(拿瀑布图);事件流不依赖它。 */
  tracing?: AgentTracing;
  /** 应用有 OTel 时的 span 归一函数(拿瀑布图);事件流不依赖它。 */
  spanMapper?: SpanMapper;
}

const DEFAULT_DENY_REASON = "用户拒绝了这次调用,不要重试,直接告知用户操作未执行。";

interface PreparedUiMessageStreamSend {
  readonly bookkeeping: UiMessageSessionState;
  readonly messagesToSend: UIMessageLike[];
  readonly resumeFrom: UIMessageLike | undefined;
}

/** External SDK / transport Promise boundary. */
function promiseEffect<Value>(
  run: (signal: AbortSignal) => PromiseLike<Value>,
): Effect.Effect<Value, unknown> {
  return Effect.tryPromise({ try: run, catch: (cause) => cause });
}

function resolveUrlEffect(
  options: UiMessageStreamAgentOptions,
  ctx: AgentContext,
): Effect.Effect<string, unknown> {
  const url = options.url;
  return typeof url === "function"
    ? promiseEffect(() => Promise.resolve(url(ctx)))
    : Effect.succeed(url);
}

function resolveHeadersEffect(
  options: UiMessageStreamAgentOptions,
  ctx: AgentContext,
): Effect.Effect<globalThis.Record<string, string>, unknown> {
  return Effect.try({
    try: () => typeof options.headers === "function" ? options.headers(ctx) : (options.headers ?? {}),
    catch: (cause) => cause,
  });
}

function transportController() {
  return Effect.acquireRelease(
    Effect.sync(() => new AbortController()),
    (controller) => Effect.sync(() => controller.abort()),
  );
}

function cancelReadableStreamEffect<Value>(stream: ReadableStream<Value>): Effect.Effect<void> {
  return promiseEffect(() => stream.cancel()).pipe(
    Effect.catch(() => Effect.void),
    Effect.asVoid,
  );
}

function prepareMessages(
  options: UiMessageStreamAgentOptions,
  input: TurnInput,
  ctx: AgentContext,
): PreparedUiMessageStreamSend {
  // 会话续接是「客户端带全量历史」模式:历史与协议簿记各用一个 typed slot,
  // 新线自然两者都为空；相同名字不会让其它 Adapter 的 slot 与它们碰撞。
  const priorMessages = ctx.session.get(historySlot) ?? [];
  const bookkeeping = ctx.session.get(sessionStateSlot) ?? {};
  ctx.session.set(sessionStateSlot, bookkeeping);
  let id = bookkeeping.chatId;
  if (!id) {
    id = `uims-${randomUUID()}`;
    bookkeeping.chatId = id;
    ctx.session.capture(id); // 镜像:t.sessionId / 报告可见
  }

  const lastMessage = priorMessages.at(-1);
  const pendingPart =
    lastMessage?.role === "assistant" ? lastMessage.parts.find(isApprovalRequested) : undefined;

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
    const resumeFrom = { ...lastMessage, parts: mutatedParts };
    return {
      bookkeeping,
      resumeFrom,
      messagesToSend: [...priorMessages.slice(0, -1), resumeFrom],
    };
  }

  const parts: UIMessagePartLike[] = [{ type: "text", text: input.text }];
  for (const file of input.files ?? []) {
    parts.push({ type: "file", mediaType: file.mimeType, url: `data:${file.mimeType};base64,${file.dataBase64}` });
  }
  return {
    bookkeeping,
    resumeFrom: undefined,
    messagesToSend: [...priorMessages, { id: randomUUID(), role: "user", parts }],
  };
}

/** Consume the SDK's native async iterator only inside its named Effect Promise boundary. */
function reduceUiMessageStreamEffect(
  readUIMessageStream: ReadUIMessageStream,
  resumeFrom: UIMessageLike | undefined,
  stream: ReadableStream<UIMessageChunkLike>,
  transport: AbortController,
  onMessage: (message: UIMessageLike) => void,
): Effect.Effect<UIMessageLike | undefined, unknown> {
  return promiseEffect(async (signal) => {
    const onAbort = () => transport.abort(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
    try {
      let finalMessage: UIMessageLike | undefined;
      for await (const message of readUIMessageStream({ message: resumeFrom, stream })) {
        finalMessage = message;
        onMessage(message);
      }
      return finalMessage;
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  });
}

function uiMessageStreamSendEffect(
  options: UiMessageStreamAgentOptions,
  input: TurnInput,
  ctx: AgentContext,
): Effect.Effect<import("../types.ts").Turn, unknown> {
  return Effect.scoped(
    Effect.gen(function* () {
      const { readUIMessageStream } = yield* loadAiEffect();
      const prepared = yield* Effect.try({
        try: () => prepareMessages(options, input, ctx),
        catch: (cause) => cause,
      });
      const url = yield* resolveUrlEffect(options, ctx);
      const extraHeaders = yield* resolveHeadersEffect(options, ctx);
      const transport = yield* transportController();
      const res = yield* Effect.tryPromise({
        try: (signal) => fetch(url, {
          method: "POST",
          // traceparent 随请求带过去:应用埋点支持 context 传播时,span 归属精确到本轮。
          headers: { "content-type": "application/json", ...extraHeaders, ...ctx.telemetry?.headers },
          body: JSON.stringify({ ...options.body?.(ctx), messages: prepared.messagesToSend }),
          signal: AbortSignal.any([ctx.signal, signal, transport.signal]),
        }),
        catch: (err) => {
          if (ctx.signal.aborted) return err;
          const cause = err instanceof Error
            ? (err.cause instanceof Error ? err.cause.message : err.message)
            : String(err);
          return makeSendFailure({
            acceptance: "unknown",
            message: `Could not connect to ${url} (${cause}). Is the app under test running? Start it yourself first, or point url at a deployed instance via config.`,
            cause: normalizeExternalCause(err),
          });
        },
      });
      const responseBody = res.body;
      if (!res.ok || !responseBody) {
        const responseText = yield* promiseEffect(() => res.text()).pipe(
          Effect.catch(() => Effect.succeed("")),
        );
        return yield* Effect.fail(
          makeSendFailure({
            acceptance: "unknown",
            message: `POST ${url} failed: ${res.status} ${responseText}. Confirm the app is running and the endpoint speaks the UI Message Stream protocol (the backend useChat expects).`,
            cause: normalizeExternalCause({ status: res.status }),
          }),
        );
      }

      const streamState: { sawDone: boolean; sawError: string | undefined } = {
        sawDone: false,
        sawError: undefined,
      };
      const chunkStream = toChunkStream(responseBody, (chunk) => {
        if (chunk.type === "error") streamState.sawError = chunk.errorText;
      }, () => {
        streamState.sawDone = true;
      });
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => transport.abort()).pipe(
          Effect.andThen(cancelReadableStreamEffect(chunkStream)),
        ));
      const reported: ReportedState = prepared.resumeFrom && prepared.bookkeeping.reported
        ? prepared.bookkeeping.reported
        : { startedCalls: new Set(), finishedCalls: new Set(), liveProgressCalls: new Set(), textLen: 0 };
      prepared.bookkeeping.reported = reported;
      const finalMessage = yield* reduceUiMessageStreamEffect(
        readUIMessageStream,
        prepared.resumeFrom,
        chunkStream,
        transport,
        (message) => reportLiveToolProgress(message, reported, ctx),
      );
      if (!streamState.sawDone) {
        return yield* Effect.fail(
          makeSendFailure({
            acceptance: "unknown",
            message: `POST ${url} ended before the UI Message Stream [DONE] marker. The response was truncated or the endpoint does not speak the complete UI Message Stream protocol.`,
          }),
        );
      }
      if (!finalMessage) {
        return yield* Effect.fail(
          makeSendFailure({
            acceptance: "unknown",
            message: `POST ${url} 的流结束了但一条 assistant 消息都没归约出来 —— 端点吐的不是 UI Message Stream 帧?`,
          }),
        );
      }

      const derived = yield* Effect.try({
        try: () => {
          // 续跑轮:finalMessage 是同一条消息的完整版,替换末尾半成品;全新轮:追加。
          ctx.session.set(
            historySlot,
            prepared.resumeFrom
              ? [...prepared.messagesToSend.slice(0, -1), finalMessage]
              : [...prepared.messagesToSend, finalMessage],
          );
          return {
            events: deriveTurnEvents(finalMessage, reported, options.projectToolCommand),
            request: finalMessage.parts.find(isApprovalRequested),
          };
        },
        catch: (cause) => cause,
      });

      const request = derived.request;
      if (request) {
        return yield* Effect.try({
          try: () => {
            const waitingEvents = [
              ...derived.events,
              {
                type: "input.requested" as const,
                request: {
                  id: request.approval?.id ?? request.toolCallId,
                  action: toolNameOf(request),
                  input: (request.input ?? null) as JsonValue,
                  options: [{ id: "approve" }, { id: "deny" }],
                },
              },
            ];
            const evidenceCoverage = unclassifiedToolActionsCoverage(waitingEvents);
            return {
              status: "waiting" as const,
              events: waitingEvents,
              ...(evidenceCoverage === undefined ? {} : { evidenceCoverage }),
            };
          },
          catch: (cause) => cause,
        });
      }

      if (options.settleMs) yield* Effect.sleep(options.settleMs);
      return yield* Effect.try({
        try: () => {
          const finalEvents = [
            ...derived.events,
            ...(streamState.sawError ? [{ type: "error" as const, message: streamState.sawError }] : []),
          ];
          const evidenceCoverage = unclassifiedToolActionsCoverage(finalEvents);
          return {
            status: streamState.sawError ? ("failed" as const) : ("completed" as const),
            events: finalEvents,
            ...(evidenceCoverage === undefined ? {} : { evidenceCoverage }),
          };
        },
        catch: (cause) => cause,
      });
    }),
  );
}

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
    evidenceCoverage: COVERAGE,
    tracing: options.tracing,
    spanMapper: options.spanMapper,

    send: (input, ctx) => uiMessageStreamSendEffect(options, input, ctx),
  });
}
