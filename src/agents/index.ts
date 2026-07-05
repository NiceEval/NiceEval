// niceeval/adapter 公开导出:「连到哪个 AI」相关的类型 + 内置 adapter + 自定义 adapter 的入口。

export { defineAgent, defineSandboxAgent } from "../define.ts";
export { shared } from "./shared.ts";
export type { Shared } from "./shared.ts";

// span → canonical GenAI 归一(只服务瀑布图,不喂断言)。私有埋点写自己的 spanMapper 时用:
// tagSpan 把判定写回 span(原属性只增不改),heuristicTag 是通用兜底判定;mapCodexSpans 是
// 现成的参考实现(无侵入接 codex 后端时直接声明 `spanMapper: mapCodexSpans`)。
// 映射目标(什么属性亮起瀑布图的什么)见 docs-site/zh/guides/connect-otel.mdx「瀑布图画得准不准」。
export { tagSpan, heuristicTag } from "../o11y/otlp/canonical.ts";
export type { SpanTag } from "../o11y/otlp/canonical.ts";
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

// 通用「拼装方式」件:逐帧驱动循环、逐 token/参数增量累加器。见 docs-site/zh/guides/write-send.mdx——
// 这些和任何具体协议无关,自己写 adapter 时优先拿这些拼,只有 transport(怎么发)与
// 「帧类型 → 操作」这张映射表才是真正要手写的。会话续接与 HITL 停轮现场不再是可选件,
// 而是 ctx.session(AgentSession)本身自带的存取器(history()/id+capture()、hold()/take())。
export { driveFrameStream, deltaStream } from "./streaming.ts";
export type { FrameReducer, FrameHook, DeltaOp, DeltaStreamSpec } from "./streaming.ts";

// tracing 管线的内置实现 aiSdkOtel() 在 `niceeval/adapter/otel`(独立子路径,不从这里
// re-export):OTel 三件套是可选 peer 依赖,只有 import 那个入口的项目才需要安装。
export { fromAiSdk, aiSdkAgent } from "./ai-sdk.ts";
export type {
  AiSdkAgentOptions,
  AiSdkGenerateContext,
  AiSdkResultLike,
  AiSdkStepLike,
  AiSdkTelemetrySettings,
  AiSdkToolCallLike,
  AiSdkToolResultLike,
  AiSdkTracing,
  AiSdkTurn,
  AiSdkTurnTelemetry,
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
  AgentSession,
  AgentTracing,
  SpanMapper,
  Telemetry,
  SandboxAgentDef,
  RemoteAgentDef,
  McpServer,
} from "../types.ts";
