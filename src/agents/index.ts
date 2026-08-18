// niceeval/adapter 公开导出:「连到哪个 AI」相关的类型 + 内置 adapter + 自定义 adapter 的入口。

export { defineAgent, defineSandboxAgent } from "../define.ts";
export { createSessionSlot } from "./session-slot.ts";
export { shared } from "./shared.ts";
export type { Shared } from "./shared.ts";

export { createNpmCliInstaller, agentBin } from "./npm-staged.ts";
export type { NpmCliInstallerOptions } from "./npm-staged.ts";

// 证据覆盖声明:官方 SDK 适配器声明全通道 complete 用 completeEvidenceCoverage;
// 手写映射按实际情况声明(见 docs/feature/adapters/architecture/evidence.md)。
export { completeEvidenceCoverage } from "../assertions/coverage.ts";
export type {
  EvidenceCoverageStatus,
  EvidenceCoverageEntry,
  EvidenceCoverage,
  TurnEvidenceCoverage,
} from "../types.ts";

// tool operation 的 command 分类只能由 Adapter 根据原生协议事实产生。
// structured argv 走 commandProjection() 与同一 logical-command/v1 normalizer；
// 无法安全取得 argv 时显式 opaque，确认不是 command 时显式 not-command。
export {
  LOGICAL_COMMAND_NORMALIZER,
  commandProjection,
  normalizeLogicalCommand,
  notCommandProjection,
  opaqueCommandProjection,
} from "../o11y/command-projection.ts";
export type {
  CommandProjection,
  LogicalCommandInvocation,
  LogicalCommandNormalizer,
  OriginalCommandInvocation,
  OriginalCommandOpaqueReason,
} from "../o11y/types.ts";

// 执行失败分类:`Agent.classifySendFailure` 认的结构化 envelope 与同源摘要。两轴词表
// (FailureClass / FailureScope)与包根导出的是同一个形状——adapter
// 作者与 eval 作者各自的入口拿到同一份类型。判据、分类链与重试执行体见
// docs/feature/error-classification/architecture.md。
export { makeSendFailure, sendFailureText } from "../context/send-failures.ts";
export type { SendFailure, SendFailureClassifier } from "../context/send-failures.ts";
export type { FailureClass, FailureScope } from "../shared/failure-class.ts";
export { externalCauseMessageChain, externalCauseText, normalizeExternalCause } from "../shared/external-cause.ts";
export type { ExternalCause, ExternalCauseFact, ExternalCauseLink } from "../shared/external-cause.ts";

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
export {
  chatCompletionEvidenceCoverage,
  responsesEvidenceCoverage,
  turnFromChatCompletion,
  turnFromResponses,
} from "./openai-compat.ts";
export type {
  ChatCompletionLike,
  ChatCompletionCustomToolCallLike,
  ChatCompletionFunctionToolCallLike,
  ChatCompletionMessageLike,
  ChatCompletionToolCallLike,
  ChatCompletionUnknownToolCallLike,
  ChatCompletionUsageLike,
  ResponseFunctionCallItemLike,
  ResponseLike,
  ResponseMessageItemLike,
  ResponseOutputItemLike,
  ResponseOutputTextLike,
  ResponseUsageLike,
} from "./openai-compat.ts";

// SDK 原生事件流 → 标准事件的官方转换器(无侵入 adapter 只剩传输粘合)+ 通用 SSE 读帧器。
export { sseJsonFrames, createClaudeSdkEventStream, createPiAgentEventStream, createCodexThreadEventStream } from "./sdk-streams.ts";
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
export { createLangGraphEventStream } from "./langgraph.ts";
export type { LangGraphEventLike, LangGraphContentBlockLike, LangGraphStream } from "./langgraph.ts";

// 通用「拼装方式」件:逐帧驱动循环、逐 token/参数增量累加器。见 docs-site/zh/tutorials/write-send.mdx——
// 这些和任何具体协议无关,自己写 adapter 时优先拿这些拼,只有 transport(怎么发)与
// 「帧类型 → 操作」这张映射表才是真正要手写的。会话续接与 HITL 停轮现场不再是可选件,
// 而是 ctx.session(AgentSession)本身的 typed slot 与 id/capture 存取器。
export { driveFrameStream, deltaStream } from "./streaming.ts";
export type { FrameReducer, FrameHook, DeltaOp, DeltaStreamSpec } from "./streaming.ts";

// tracing 管线的内置实现 aiSdkOtel() 在 `niceeval/adapter/otel`(独立子路径,不从这里
// re-export):OTel 三件套是可选 peer 依赖,只有 import 那个入口的项目才需要安装。
export { turnFromAiSdk, aiSdkAgent } from "./ai-sdk.ts";
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
export { openCodeAgent } from "./opencode.ts";
export { hermesAgent } from "./hermes.ts";
export { openClawAgent } from "./openclaw.ts";
export { ompAgent } from "./omp.ts";
export { deepSeekHarnessAgent } from "./deepseek-harness.ts";
export type { ClaudeCodeConfig, ClaudeCodePluginSpec } from "./claude-code.ts";
export type { CodexConfig, CodexPluginSpec } from "./codex.ts";
export type { BubConfig, PythonPluginSpec } from "./bub.ts";
export type { OpenCodeConfig } from "./opencode.ts";
export type { HermesConfig } from "./hermes.ts";
export type { OpenClawConfig } from "./openclaw.ts";

export type {
  Agent,
  AgentContext,
  AgentIdentity,
  AgentInstallMode,
  AgentArtifactPlatform,
  AgentStagedArtifact,
  AgentEnsureOutcome,
  AgentEnsure,
  AgentInstaller,
  AgentArtifactContext,
  AgentInstallContext,
  StagedAgentInstallContext,
  DirectAgent,
  DirectAgentDef,
  DirectAgentSetup,
  DirectAgentTeardown,
  AgentSession,
  SessionSlot,
  AgentSetup,
  AgentSetupManifest,
  AgentSetupSkill,
  AgentTeardown,
  AgentTracing,
  SpanMapper,
  Telemetry,
  SandboxAgentDef,
  SandboxAgent,
  SandboxAgentContext,
  SandboxAgentSetupContext,
  McpServer,
  SkillSpec,
} from "../types.ts";
