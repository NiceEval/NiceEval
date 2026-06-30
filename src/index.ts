// fasteval 公开导出(import { … } from "fasteval")。

export {
  defineEval,
  defineConfig,
  defineExperiment,
  defineAgent,
  defineSandboxAgent,
  dockerSandbox,
  vercelSandbox,
  e2bSandbox,
} from "./define.ts";

export { shared } from "./agents/shared.ts";
export type { Shared } from "./agents/shared.ts";

export { BUILTIN_AGENTS } from "./agents/builtin.ts";
export { claudeCodeAgent } from "./agents/claude-code.ts";
export { codexAgent } from "./agents/codex.ts";
export { bubAgent } from "./agents/bub.ts";
export type { ClaudeCodeConfig } from "./agents/claude-code.ts";
export type { CodexConfig } from "./agents/codex.ts";
export type { BubConfig } from "./agents/bub.ts";
export type { McpServer } from "./types.ts";

export { requireEnv, getEnv, stripComments } from "./util.ts";
export { createCheckpoint, restoreCheckpoint } from "./sandbox/checkpoint.ts";

// 类型(沙箱 adapter / eval 作者会用到)
export type {
  StreamEvent,
  ToolName,
  JsonValue,
  Usage,
  Turn,
  TurnInput,
  InputFile,
  TurnHandle,
  Agent,
  AgentContext,
  AgentCapabilities,
  AgentSession,
  AgentTracing,
  Telemetry,
  SandboxAgentDef,
  RemoteAgentDef,
  Sandbox,
  SandboxFile,
  SourceFile,
  SourceFiles,
  ReadSourceFilesOptions,
  SandboxBackend,
  SandboxOption,
  SandboxSpec,
  SandboxRuntime,
  DockerSandboxSpec,
  VercelSandboxSpec,
  E2BSandboxSpec,
  CommandResult,
  CommandOptions,
  TestContext,
  ToolMatch,
  ValueAssertion,
  Severity,
  Verdict,
  EvalDef,
  ExperimentDef,
  Config,
  JudgeConfig,
  Reporter,
  EvalResult,
  RunSummary,
  O11ySummary,
  TraceSpan,
  SpanKind,
  DerivedFacts,
  LifecycleHooks,
  RunContext,
} from "./types.ts";

export type { ParsedTranscript } from "./o11y/parsers/index.ts";
