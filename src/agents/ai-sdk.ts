// AI SDK(Vercel `ai` 包)结果 → 标准事件流的共享转换器(采集通道 0:进程内直构)。
//
// 结构化 typing,不依赖 `ai` 包:niceeval 只认识 generateText / streamText 完整结果的
// 【形状子集】。字段名跨 AI SDK 大版本漂移(v4 args/result/promptTokens、v5+ input/output/
// inputTokens、v7 inputTokenDetails)在这里统一兜住,adapter 作者不必各自写防御代码,也不必
// 像手工 recorder 那样包住每个工具的 execute —— AI SDK 的 steps 里本来就有带 toolCallId 的
// 完整调用记录。
//
// v7 的 tool approval(工具带 `needsApproval`)也在这里兜:
//   · `tool-approval-request` part → `input.requested` 事件 + 整轮 `status: "waiting"`,
//     直接满足 HITL 契约的「waiting + input.requested」两条义务(resume 仍归 adapter 管);
//   · 批准 / 拒绝后的 resume 结果里,执行结果只出现在 `responseMessages` 的 tool 消息中
//     (不在 steps 里),这里挖出来补成 `action.result` —— 拒绝(execution-denied)映射成
//     `status: "rejected"`,喂 `calledTool(..., { status: "rejected" })` 与 `noFailedActions()`。

import { randomUUID } from "node:crypto";

import { defineAgent } from "../define.ts";
import { normalizeToolName as normalizeShared } from "../o11y/tool-names.ts";
import type { Agent, InputRequest, InputResponse, JsonValue, StreamEvent, ToolName, Usage } from "../types.ts";

// ───────────────────────── AI SDK 结果的形状子集 ─────────────────────────

/** 一次工具调用(v5+ 用 `input`,v4 用 `args`;两者都认)。 */
export interface AiSdkToolCallLike {
  toolCallId: string;
  toolName: string;
  input?: unknown;
  args?: unknown;
}

/** 一次工具结果(v5+ 用 `output`,v4 用 `result`)。 */
export interface AiSdkToolResultLike {
  toolCallId: string;
  toolName?: string;
  output?: unknown;
  result?: unknown;
}

/**
 * step.content 的一个 part(v5+)。带类型序:同一 step 里 reasoning / text / tool-call /
 * tool-result / tool-error / tool-approval-request 按真实发生顺序排 —— 有它就优先用它,时序保真。
 */
export interface AiSdkContentPartLike {
  type: string;
  text?: unknown;
  toolCallId?: unknown;
  toolName?: unknown;
  input?: unknown;
  args?: unknown;
  output?: unknown;
  result?: unknown;
  error?: unknown;
  /** v7 tool approval:`tool-approval-request` part 的请求 id 与被拦下的调用。 */
  approvalId?: unknown;
  isAutomatic?: unknown;
  toolCall?: {
    toolCallId?: unknown;
    toolName?: unknown;
    input?: unknown;
    args?: unknown;
  };
}

/** 一个 step = 一次模型调用(工具循环里的一圈)。 */
export interface AiSdkStepLike {
  content?: readonly AiSdkContentPartLike[];
  text?: string;
  reasoningText?: string;
  toolCalls?: readonly AiSdkToolCallLike[];
  toolResults?: readonly AiSdkToolResultLike[];
}

export interface AiSdkUsageLike {
  inputTokens?: number;
  outputTokens?: number;
  promptTokens?: number;
  completionTokens?: number;
  cachedInputTokens?: number;
  /** v7:cache 细分挪进了 inputTokenDetails。 */
  inputTokenDetails?: {
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
}

/** result.responseMessages 的一条(只认 tool 消息里的 tool-result part,其余略过)。 */
export interface AiSdkResponseMessageLike {
  role?: unknown;
  content?: unknown;
}

/** generateText / streamText 完整结果的形状子集。没有 steps 的老结果退回顶层字段。 */
export interface AiSdkResultLike {
  text?: string;
  steps?: readonly AiSdkStepLike[];
  /** v7:跨全部 step 聚合的 content parts(approval 请求也在里面)。 */
  content?: readonly AiSdkContentPartLike[];
  toolCalls?: readonly AiSdkToolCallLike[];
  toolResults?: readonly AiSdkToolResultLike[];
  /** v5/v6 聚合全部 step 的用量;优先于 usage(v6 的 usage 只是最后一个 step,v7 起也是聚合)。 */
  totalUsage?: AiSdkUsageLike;
  usage?: AiSdkUsageLike;
  /**
   * 本次调用新产生的消息(v7)。tool approval 批准 / 拒绝后,被拦工具的执行结果只出现在
   * 这里的 tool 消息里(不进 steps),fromAiSdk 从中补齐 `action.result`。
   */
  responseMessages?: readonly AiSdkResponseMessageLike[];
}

/** fromAiSdk 的返回:铺进 `Turn` 即可(data 仍归调用方 —— 结构化输出是应用自己的语义)。 */
export interface AiSdkTurn {
  events: StreamEvent[];
  usage?: Usage;
  /** 有待人批准的工具调用(非 automatic 的 tool-approval-request)→ "waiting",否则 "completed"。 */
  status: "completed" | "waiting";
}

// ───────────────────────── 转换 ─────────────────────────

/**
 * AI SDK 结果 → `{ events, usage, status }`,直接铺进 `Turn` 返回:
 *
 * ```typescript
 * const result = await generateText({ model, tools, prompt: input.text });
 * return { ...fromAiSdk(result), data: result.text };
 * ```
 *
 * `callId` 用 AI SDK 原生的 `toolCallId`(显式配对,不合成);工具名保留原名进 `name`,
 * canonical 名进 `tool`(认不出的域内工具落 "unknown",`calledTool("get_weather")`
 * 仍按原名匹配)。工具执行失败(v5+ 的 `tool-error` part)映射成 `status: "failed"` 的
 * `action.result`,喂 `noFailedActions()`。
 *
 * v7 tool approval:`needsApproval` 工具被拦下时返回 `status: "waiting"` + 每个待批准
 * 调用一条 `input.requested`(`id` = approvalId、`action` = 工具原名、`options` =
 * approve / deny)。resume(把 `tool-approval-response` 塞回 messages 再跑一次)后的结果
 * 再交给 fromAiSdk,会从 `responseMessages` 里补出执行 / 拒绝的 `action.result`。
 */
export function fromAiSdk(result: AiSdkResultLike): AiSdkTurn {
  const stepEvents: StreamEvent[] = [];
  const steps: readonly AiSdkStepLike[] =
    result.steps && result.steps.length > 0
      ? result.steps
      : [{ text: result.text, toolCalls: result.toolCalls, toolResults: result.toolResults }];

  const seen = { called: new Set<string>(), resolved: new Set<string>() };
  for (const step of steps) {
    if (Array.isArray(step.content) && step.content.length > 0) {
      pushContentParts(stepEvents, step.content, seen);
    } else {
      pushStepFields(stepEvents, step, seen);
    }
  }

  // approval resume 时被拦工具的执行结果只在 responseMessages 里;补出的 action.result
  // 排在本轮 step 事件之前 —— 时间上它确实先于模型看到结果后的新输出。
  const minedEvents = mineResponseMessages(result.responseMessages, seen.resolved);

  const events = [...minedEvents, ...stepEvents];
  const waiting = events.some((e) => e.type === "input.requested");
  return { events, usage: readUsage(result, steps.length), status: waiting ? "waiting" : "completed" };
}

interface SeenCallIds {
  called: Set<string>;
  resolved: Set<string>;
}

/** v5+ 路径:content parts 自带真实顺序,逐个翻译。 */
function pushContentParts(
  events: StreamEvent[],
  parts: readonly AiSdkContentPartLike[],
  seen: SeenCallIds,
): void {
  for (const part of parts) {
    switch (part.type) {
      case "text": {
        const text = str(part.text);
        if (text) events.push({ type: "message", role: "assistant", text });
        break;
      }
      case "reasoning": {
        const text = str(part.text);
        if (text) events.push({ type: "thinking", text });
        break;
      }
      case "tool-call": {
        pushCalled(events, seen, {
          toolCallId: str(part.toolCallId) ?? "unknown",
          toolName: str(part.toolName) ?? "unknown",
          input: part.input ?? part.args,
        });
        break;
      }
      case "tool-result": {
        const callId = str(part.toolCallId) ?? "unknown";
        seen.resolved.add(callId);
        events.push({
          type: "action.result",
          callId,
          output: asJson(part.output ?? part.result),
          status: "completed",
        });
        break;
      }
      case "tool-error": {
        const callId = str(part.toolCallId) ?? "unknown";
        seen.resolved.add(callId);
        events.push({
          type: "action.result",
          callId,
          output: { error: part.error instanceof Error ? part.error.message : String(part.error) },
          status: "failed",
        });
        break;
      }
      case "tool-approval-request": {
        // 同一 step 里通常已有配对的 tool-call part(去重);没有时从 toolCall 字段补。
        const call = part.toolCall;
        if (call) {
          pushCalled(events, seen, {
            toolCallId: str(call.toolCallId) ?? "unknown",
            toolName: str(call.toolName) ?? "unknown",
            input: call.input ?? call.args,
          });
        }
        if (part.isAutomatic === true) break; // SDK 自动裁决,不用等人
        const request: InputRequest = {
          id: str(part.approvalId),
          action: call ? str(call.toolName) : undefined,
          input: call ? asJson(call.input ?? call.args) : undefined,
          options: [{ id: "approve" }, { id: "deny" }],
        };
        events.push({ type: "input.requested", request });
        break;
      }
      default:
        break; // source / file 等其余 part 类型对断言无意义,丢弃
    }
  }
}

/** 退路(v4 / 无 content parts):toolCalls + toolResults + text,顺序按「调用 → 结果 → 文本」近似。 */
function pushStepFields(events: StreamEvent[], step: AiSdkStepLike, seen: SeenCallIds): void {
  if (step.reasoningText) events.push({ type: "thinking", text: step.reasoningText });
  for (const call of step.toolCalls ?? []) {
    pushCalled(events, seen, { toolCallId: call.toolCallId, toolName: call.toolName, input: call.input ?? call.args });
  }
  for (const res of step.toolResults ?? []) {
    seen.resolved.add(res.toolCallId);
    events.push({
      type: "action.result",
      callId: res.toolCallId,
      output: asJson(res.output ?? res.result),
      status: "completed",
    });
  }
  if (step.text?.trim()) events.push({ type: "message", role: "assistant", text: step.text });
}

/** 同一 callId 只发一条 action.called(tool-call part 与 approval-request 的 toolCall 会重)。 */
function pushCalled(
  events: StreamEvent[],
  seen: SeenCallIds,
  call: { toolCallId: string; toolName: string; input: unknown },
): void {
  if (seen.called.has(call.toolCallId)) return;
  seen.called.add(call.toolCallId);
  events.push({
    type: "action.called",
    callId: call.toolCallId,
    name: call.toolName,
    input: asJson(call.input),
    tool: normalizeToolName(call.toolName),
  });
}

/**
 * 从 responseMessages 的 tool 消息里挖 steps 没有的 tool-result(v7 approval resume 的
 * 执行结果只在这里)。output 是 ToolResultOutput 包装({ type: "json" | "text" |
 * "execution-denied" | "error-text" | … }),按类型解包;`execution-denied` → "rejected"。
 */
function mineResponseMessages(
  messages: readonly AiSdkResponseMessageLike[] | undefined,
  resolved: ReadonlySet<string>,
): StreamEvent[] {
  const events: StreamEvent[] = [];
  for (const msg of messages ?? []) {
    if (msg.role !== "tool" || !Array.isArray(msg.content)) continue;
    for (const part of msg.content as AiSdkContentPartLike[]) {
      if (part.type !== "tool-result") continue;
      const callId = str(part.toolCallId);
      if (!callId || resolved.has(callId)) continue;
      events.push({ type: "action.result", callId, ...unwrapToolOutput(part.output) });
    }
  }
  return events;
}

function unwrapToolOutput(output: unknown): { output?: JsonValue; status: "completed" | "failed" | "rejected" } {
  if (output && typeof output === "object" && !Array.isArray(output)) {
    const wrapped = output as { type?: unknown; value?: unknown; reason?: unknown };
    switch (wrapped.type) {
      case "json":
      case "text":
      case "content":
        return { output: asJson(wrapped.value), status: "completed" };
      case "execution-denied":
        return {
          output: str(wrapped.reason) ? { reason: str(wrapped.reason)! } : undefined,
          status: "rejected",
        };
      case "error-text":
      case "error-json":
        return { output: { error: asJson(wrapped.value) }, status: "failed" };
      default:
        break;
    }
  }
  return { output: asJson(output), status: "completed" };
}

/** totalUsage(v5/v6 的全 steps 聚合)优先;v7 的 usage 本身就是聚合;requests = step 数。 */
function readUsage(result: AiSdkResultLike, stepCount: number): Usage | undefined {
  const u = result.totalUsage ?? result.usage;
  if (!u) return undefined;
  const inputTokens = num(u.inputTokens) ?? num(u.promptTokens) ?? 0;
  const outputTokens = num(u.outputTokens) ?? num(u.completionTokens) ?? 0;
  if (inputTokens === 0 && outputTokens === 0) return undefined;
  const usage: Usage = { inputTokens, outputTokens, requests: Math.max(stepCount, 1) };
  const cacheRead = num(u.cachedInputTokens) ?? num(u.inputTokenDetails?.cacheReadTokens);
  if (cacheRead) usage.cacheReadTokens = cacheRead;
  const cacheWrite = num(u.inputTokenDetails?.cacheWriteTokens);
  if (cacheWrite) usage.cacheWriteTokens = cacheWrite;
  return usage;
}

/** AI SDK 应用的工具多为域内自定义名(get_weather…),canonical 落 "unknown" 即可;仅认通用别名基表。 */
function normalizeToolName(name: string): ToolName {
  return normalizeShared(name);
}

/** 工具入参 / 出参在 AI SDK 里经 schema 校验,本就是 JSON 值;这里只做形状断言。 */
function asJson(value: unknown): JsonValue {
  return (value ?? null) as JsonValue;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

// ───────────────────────── 内建 agent 工厂 ─────────────────────────

/**
 * `generate` 收到的上下文。`messages` 是本会话的完整 ModelMessage 历史(含本轮的用户消息 /
 * approval 裁决),直接透传给 generateText / streamText 即可;泛型 `M` 由调用方钉成自己
 * AI SDK 版本的 `ModelMessage`,niceeval 不引 `ai` 包。
 */
export interface AiSdkGenerateContext<M = unknown> {
  readonly messages: M[];
  /** 实验钉的 model(ctx.model);省略 → 用应用自己的默认。 */
  readonly model?: string;
  /** 实验钉的推理努力程度(ctx.reasoningEffort);省略 → 用应用自己的默认。应用自己决定怎么塞进 providerOptions(如 OpenAI 的 reasoningEffort)。 */
  readonly reasoningEffort?: string;
  readonly signal: AbortSignal;
  readonly flags: Readonly<Record<string, unknown>>;
  /**
   * 配了 `tracing`(如 `aiSdkOtel()`)才有:直接放进 generateText / streamText 的
   * `telemetry` 选项。OTel provider、per-attempt 端点绑定和轮末 flush 都由工厂做,
   * 应用侧原样透传即可。
   */
  readonly telemetry?: AiSdkTelemetrySettings;
}

/**
 * generateText / streamText 的 `telemetry` 选项的形状子集。integrations 的元素是
 * `@ai-sdk/otel` 的集成实例——类型属于用户的 ai 版本,niceeval 不引 `ai` 包,所以是 any。
 */
export interface AiSdkTelemetrySettings {
  readonly integrations: any[];
}

/** tracing 管线为某一轮建好的遥测件(`AiSdkTracing.telemetryForEndpoint` 的返回值)。 */
export interface AiSdkTurnTelemetry {
  /** 直接放进 generateText / streamText 的 `telemetry` 选项。 */
  settings: AiSdkTelemetrySettings;
  /** 每轮结束后由工厂调用:轮次归属靠时间窗口,span 必须立刻送到,不能等 batch。 */
  flush(): Promise<void>;
}

/**
 * `aiSdkAgent` 的 tracing 管线契约。内置实现是 `niceeval/adapter/otel` 的 `aiSdkOtel()`——
 * 独立子路径导出,OTel 三件套是可选 peer 依赖,只有 import 那个入口的项目才需要安装;
 * 这里只放形状,`niceeval/adapter` 本身零 OTel 依赖。
 */
export interface AiSdkTracing {
  /** 为本轮的 OTLP 接收端点建(或复用)一条导出管线。每个 attempt 端点不同,按端点缓存。 */
  telemetryForEndpoint(endpoint: string): AiSdkTurnTelemetry;
}

export interface AiSdkAgentOptions<M = unknown> {
  /** agent 名(报告 / 结果聚合的身份)。默认 "ai-sdk"。 */
  name?: string;
  /**
   * 开 OTel 管线(拿 `niceeval view` 的瀑布图):传 `niceeval/adapter/otel` 的
   * `aiSdkOtel()`。设了运行器就为这个 agent 开 per-attempt OTLP 接收器,工厂每轮用
   * 管线建好绑定接收端点的集成,经 `generate` 的 ctx.telemetry 交给应用,原样透传给
   * generateText / streamText 的 `telemetry` 选项即可。省略则整个 OTel 管线不开,
   * `generate` 拿到的 `telemetry` 恒为 undefined,应用侧零开销。
   *
   * ```typescript
   * import { aiSdkOtel } from "niceeval/adapter/otel";
   * aiSdkAgent({ tracing: aiSdkOtel(), generate });
   * ```
   */
  tracing?: AiSdkTracing;
  /**
   * 每轮一召:拿会话历史跑一次 generateText / streamText(await 完整结果)并原样返回。
   * model / tools / system prompt / stopWhen 都在这里配 —— 那是应用的事,工厂不掺和。
   */
  generate(ctx: AiSdkGenerateContext<M>): Promise<AiSdkResultLike>;
  /** 本轮的结构化输出(Turn.data,喂 outputEquals / outputMatches)。省略则 data 为 undefined。 */
  data?(result: AiSdkResultLike, turn: AiSdkTurn): unknown;
}

/**
 * 内建的 AI SDK 进程内 agent 工厂:把「一个 generateText 调用」变成完整的 niceeval agent。
 * 应用只写 `generate`(怎么召模型),协议侧的活全部由工厂承担:
 *
 *   · 多轮会话:ctx.session.id 未记录时开新会话线并 capture 回写,同一 id 续接同一份
 *     messages 历史;
 *   · 事件流:结果经 {@link fromAiSdk} 直构(toolCallId 配对、时序保真、usage);
 *   · HITL:`needsApproval` 工具停轮 → `waiting` + `input.requested`;下一轮输入按行翻译成
 *     tool-approval-response(以 approve / yes / 同意 / 批准 开头 = 批准,其余一律拒绝)塞回
 *     messages 再召 `generate`,SDK 才会执行(或跳过)被拦的工具;
 *   · 失败兜底:`generate` 抛错或结果完全为空 → `status: "failed"` + error 事件;
 *   · tracing:传 `tracing: aiSdkOtel()`(来自 `niceeval/adapter/otel`)后,工厂替应用
 *     做完 OTel 管线——为每轮建好绑定 niceeval 接收端点的 `@ai-sdk/otel` 集成(经
 *     ctx.telemetry 交给 generate,原样透传给 generateText 的 `telemetry` 即可)并在轮末
 *     flush;`aiSdkOtel({ backendUrl })` 可选双发到你自己的观测后端。应用侧零埋点代码。
 *
 * ```typescript
 * import { aiSdkAgent } from "niceeval/adapter";
 * import { generateText, isStepCount, type ModelMessage } from "ai";
 *
 * export const assistant = aiSdkAgent<ModelMessage>({
 *   name: "my-assistant",
 *   generate: ({ messages, model, signal }) =>
 *     generateText({ model: resolveModel(model), system: SYSTEM_PROMPT,
 *                    tools, stopWhen: isStepCount(5), messages, abortSignal: signal }),
 *   data: (result) => ({ reply: result.text }),
 * });
 * ```
 */
export function aiSdkAgent<M = unknown>(options: AiSdkAgentOptions<M>): Agent {
  interface SessionState {
    messages: M[];
    /** 上一轮停下的 tool approval:下一轮输入按行翻译成裁决。 */
    pendingApprovals: string[];
  }
  const sessions = new Map<string, SessionState>();

  return defineAgent({
    name: options.name ?? "ai-sdk",
    // tracing 开了才让运行器为这个 agent 起 OTLP 接收器(ctx.telemetry 才会出现);
    // AgentTracing 的其余字段(env/configure/scope)这里都用不上,空对象即可。
    tracing: options.tracing ? {} : undefined,

    async send(input, ctx) {
      // 会话续接:ctx.session.id 未记录时开新会话并 capture 回写;否则按 id 续接同一份历史。
      const id = ctx.session.id ?? `ai-sdk-${randomUUID()}`;
      ctx.session.capture(id);
      let state = sessions.get(id);
      if (!state) {
        state = { messages: [], pendingApprovals: [] };
        sessions.set(id, state);
      }

      if (state.pendingApprovals.length > 0) {
        // HITL:t.respond 的回答到 adapter 就是一次普通的带 responses 的 send,按
        // requestId(= approvalId)对位取裁决;没答到的请求直接报错,不从文本猜。
        const content = state.pendingApprovals.map((approvalId) => ({
          type: "tool-approval-response" as const,
          approvalId,
          approved: approvalDecision(input.responses, approvalId),
        }));
        state.pendingApprovals = [];
        state.messages.push({ role: "tool", content } as M);
      } else {
        state.messages.push(userMessage(input.text, input.files) as M);
      }

      // tracing 管线由调用方显式传入(niceeval/adapter/otel 的 aiSdkOtel()),工厂只管
      // 每轮把 per-attempt 端点交给它、轮末 flush。
      const otel = ctx.telemetry && options.tracing ? options.tracing.telemetryForEndpoint(ctx.telemetry.endpoint) : undefined;

      let result: AiSdkResultLike;
      try {
        result = await options.generate({
          messages: state.messages,
          model: ctx.model,
          reasoningEffort: ctx.reasoningEffort,
          signal: ctx.signal,
          flags: ctx.flags,
          telemetry: otel?.settings,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { status: "failed", events: [{ type: "error", message }] };
      } finally {
        // 轮次归属靠时间窗口:本轮 span 必须在 send 返回前送到接收器,不能等 batch。
        await otel?.flush();
      }

      // resume 的另一半义务:本次调用新产生的消息(含 approval 执行结果)进历史。
      state.messages.push(...((result.responseMessages ?? []) as M[]));
      state.pendingApprovals = collectPendingApprovals(result);

      const turn = fromAiSdk(result);
      // 上游偶尔退化返回完全空的结果;当正常回复会把故障伪装成通过,按失败处理。
      if (turn.events.length === 0) {
        return { status: "failed", events: [{ type: "error", message: "AI SDK returned an empty result (no text, no tool calls)" }] };
      }
      return { ...turn, data: options.data?.(result, turn) };
    },
  });
}

/** 裁决词法(t.respond 的自由文本回答):approve / yes / 同意 / 批准 开头 = 批准,其余一律拒绝。 */
function isApproved(line: string): boolean {
  return /^(approve|yes|同意|批准)/i.test(line);
}

/** 按 requestId(= approvalId)从 input.responses 对位取裁决;optionId 优先,自由文本走 isApproved。 */
function approvalDecision(responses: readonly InputResponse[] | undefined, requestId: string): boolean {
  const matched = responses?.find((r) => r.requestId === requestId);
  if (!matched) {
    throw new Error(`No response for pending approval "${requestId}". Answer approval requests with t.respond(...).`);
  }
  if (matched.optionId !== undefined) return matched.optionId === "approve";
  return isApproved(matched.text?.trim() ?? "");
}

/** 待人批准的 approval 请求 id(非 automatic)。steps 优先,退回 v7 顶层聚合 content。 */
function collectPendingApprovals(result: AiSdkResultLike): string[] {
  const parts: AiSdkContentPartLike[] = [];
  if (result.steps?.length) {
    for (const step of result.steps) if (Array.isArray(step.content)) parts.push(...step.content);
  } else if (Array.isArray(result.content)) {
    parts.push(...result.content);
  }
  const ids: string[] = [];
  for (const part of parts) {
    if (part.type !== "tool-approval-request" || part.isAutomatic === true) continue;
    const approvalId = str(part.approvalId);
    if (approvalId) ids.push(approvalId);
  }
  return ids;
}

/**
 * t.sendFile 带来的文件(base64)转成 AI SDK 的多模态用户消息;纯文本就是纯文本。
 * 用 `file` part(v7 推荐;`image` part 已废弃),mediaType 原样透传,图片之外的附件也能走。
 */
function userMessage(text: string, files: readonly { mimeType: string; dataBase64: string }[] | undefined): unknown {
  if (!files || files.length === 0) return { role: "user", content: text };
  return {
    role: "user",
    content: [
      { type: "text", text: text || "请描述这个附件。" },
      ...files.map((f) => ({ type: "file", mediaType: f.mimeType, data: f.dataBase64 })),
    ],
  };
}
