// niceeval/adapter 公开导出:「连到哪个 AI」相关的类型 + 内置 adapter + 自定义 adapter 的入口。

export { defineAgent, defineSandboxAgent } from "../define.ts";
export { shared } from "./shared.ts";
export type { Shared } from "./shared.ts";

// 证据覆盖声明:官方 SDK 适配器声明全通道 complete 用 completeCoverage;
// 手写映射按实际情况声明(见 docs/feature/adapters/architecture/evidence.md)。
export { completeCoverage } from "../scoring/coverage.ts";
export type { CoverageStatus, CoverageDeclaration, EvidenceCoverage } from "../types.ts";

// 执行失败分类:`Agent.classifyTurnError` 认的输入/输出形状 + 摘要取值器(与 turn-failed
// 报错文案同源)。两轴词表(FailureClass / FailureScope)与包根导出的是同一个形状——adapter
// 作者与 eval 作者各自的入口拿到同一份类型。判据、分类链与重试执行体见
// docs/feature/error-classification/architecture.md。
export { turnErrorText } from "../context/turn-errors.ts";
export type { TurnErrorClassifier, TurnFailure } from "../context/turn-errors.ts";
export type { FailureClass, FailureScope } from "../shared/failure-class.ts";

// span → canonical GenAI 归一(只服务瀑布图,不喂断言)。私有埋点写自己的 spanMapper 时用:
// tagSpan 把判定写回 span(原属性只增不改),heuristicTag 是通用兜底判定;mapCodexSpans 是
// 现成的参考实现(无侵入接 codex 后端时直接声明 `spanMapper: mapCodexSpans`)。
// 映射目标(什么属性亮起瀑布图的什么)见 docs-site/zh/tutorials/connect-otel.mdx「瀑布图画得准不准」。
export { tagSpan, heuristicTag } from "../o11y/otlp/canonical.ts";
export type { SpanTag } from "../o11y/otlp/canonical.ts";
export { mapCodexSpans } from "../o11y/otlp/mappers/codex.ts";

export { uiMessageStreamAgent } from "./ui-message-stream.ts";
export type { UiMessageStreamAgentOptions, UIMessageLike, UIMessagePartLike } from "./ui-message-stream.ts";

// 两种 OpenAI 响应形状(不限于 OpenAI 官方,任何声明兼容这两种协议形状的服务都能用)的
// 官方转换器:整段响应 → Turn,零映射。
export { fromChatCompletion, fromResponses } from "./openai-compat.ts";
export type {
  ChatCompletionLike,
  ChatCompletionMessageLike,
  ChatCompletionToolCallLike,
  ChatCompletionUsageLike,
  ResponseFunctionCallItemLike,
  ResponseLike,
  ResponseMessageItemLike,
  ResponseOutputItemLike,
  ResponseOutputTextLike,
  ResponseUsageLike,
} from "./openai-compat.ts";

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

// LangGraph 官方事件流转换器(不绑定 transport,不提供 langGraphAgent 工厂)。
export { fromLangGraphEvents } from "./langgraph.ts";
export type { LangGraphEventLike, LangGraphContentBlockLike, LangGraphStream } from "./langgraph.ts";

// 通用「拼装方式」件:逐帧驱动循环、逐 token/参数增量累加器。见 docs-site/zh/tutorials/write-send.mdx——
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
export { openClawAgent } from "./openclaw.ts";
export type { ClaudeCodeConfig, ClaudeCodePluginSpec } from "./claude-code.ts";
export type { CodexConfig, CodexPluginSpec } from "./codex.ts";
export type { BubConfig, PythonPluginSpec } from "./bub.ts";
export type { OpenClawConfig } from "./openclaw.ts";

// 安装 manifest 的落点:adapter 写(shared.writeAgentSetup),运行器读并抬成 attempt artifact。
export { AGENT_SETUP_MANIFEST_PATH } from "./manifest.ts";

export type {
  Agent,
  AgentContext,
  AgentSession,
  AgentSetup,
  AgentSetupManifest,
  AgentSetupSkill,
  AgentTeardown,
  AgentTracing,
  SpanMapper,
  Telemetry,
  SandboxAgentDef,
  RemoteAgentDef,
  McpServer,
  SkillSpec,
} from "../types.ts";
