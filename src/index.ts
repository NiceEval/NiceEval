// fastevals 公开导出(import { … } from "fastevals")。

export {
  defineEval,
  defineConfig,
  defineExperiment,
  defineAgent,
  defineSandboxAgent,
} from "./define.ts";

export { shared } from "./agents/shared.ts";
export type { Shared } from "./agents/shared.ts";

export { requireEnv, getEnv } from "./util.ts";

// 类型(沙箱 adapter / eval 作者会用到)
export type {
  StreamEvent,
  ToolName,
  JsonValue,
  Usage,
  Turn,
  TurnInput,
  TurnHandle,
  Agent,
  AgentContext,
  AgentCapabilities,
  AgentSession,
  SandboxAgentDef,
  RemoteAgentDef,
  Sandbox,
  SandboxFile,
  SandboxBackend,
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
  DerivedFacts,
  LifecycleHooks,
  RunContext,
} from "./types.ts";

export type { ParsedTranscript } from "./o11y/parsers/index.ts";
