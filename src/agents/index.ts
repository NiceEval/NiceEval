// niceeval/adapter 公开导出:「连到哪个 AI」相关的类型 + 内置 adapter + 自定义 adapter 的入口。

export { defineAgent, defineSandboxAgent } from "../define.ts";
export { shared } from "./shared.ts";
export type { Shared } from "./shared.ts";

export { otelEvents, otel } from "./otel-events.ts";
export type { OtelDialect, DialectDerivation, OtelEventsOptions, OtelEventsSource } from "./otel-events.ts";

// codex 原生 span → canonical GenAI 归一(瀑布图用)。无侵入接 codex 后端的 adapter 声明
// `spanMapper: mapCodexSpans`,就能拿到和内置 codexAgent 一样的瀑布图归一。
export { mapCodexSpans } from "../o11y/otlp/mappers/codex.ts";

export { uiMessageStreamAgent } from "./ui-message-stream.ts";
export type { UiMessageStreamAgentOptions, UIMessageLike, UIMessagePartLike } from "./ui-message-stream.ts";

// SDK 原生事件流 → 标准事件的官方转换器(无侵入 adapter 只剩传输粘合)+ 通用 SSE 读帧器。
export { sseJsonFrames, fromClaudeSdkMessages, fromPiAgentEvents, fromCodexThreadEvents } from "./sdk-streams.ts";
export type {
  SseFrameCursor,
  ClaudeSdkMessageLike,
  ClaudeSdkStream,
  PiAgentEventLike,
  PiAgentStream,
  CodexThreadEventLike,
  CodexThreadStream,
} from "./sdk-streams.ts";

// 通用「拼装方式」件:逐帧驱动循环、HITL 挂起、两种会话续接策略、逐 token/参数增量累加器。
// 见 docs/adapters/authoring.md「三段式」一节——这些和任何具体协议无关,自己写 adapter
// 时优先拿这些拼,只有 transport(怎么发)与「帧类型 → 操作」这张映射表才是真正要手写的。
export { driveFrameStream, pausable, serverSession, clientHistory, deltaStream } from "./streaming.ts";
export type { FrameReducer, FrameHook, Pausable, ServerSession, ClientHistory, DeltaOp, DeltaStreamSpec } from "./streaming.ts";

export { fromAiSdk, aiSdkAgent } from "./ai-sdk.ts";
export type {
  AiSdkAgentOptions,
  AiSdkGenerateContext,
  AiSdkResultLike,
  AiSdkStepLike,
  AiSdkToolCallLike,
  AiSdkToolResultLike,
  AiSdkTurn,
  AiSdkUsageLike,
} from "./ai-sdk.ts";

export { BUILTIN_AGENTS } from "./builtin.ts";
export { claudeCodeAgent } from "./claude-code.ts";
export { codexAgent } from "./codex.ts";
export { bubAgent } from "./bub.ts";
export type { ClaudeCodeConfig } from "./claude-code.ts";
export type { CodexConfig } from "./codex.ts";
export type { BubConfig } from "./bub.ts";

export type {
  Agent,
  AgentContext,
  AgentCapabilities,
  AgentSession,
  AgentTracing,
  Telemetry,
  SandboxAgentDef,
  RemoteAgentDef,
  McpServer,
} from "../types.ts";
