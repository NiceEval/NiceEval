// niceeval 公开导出(import { … } from "niceeval")。
// Agent/Adapter 相关见 "niceeval/adapter";Sandbox 相关见 "niceeval/sandbox"。

export { defineEval, defineConfig, defineExperiment } from "./define.ts";

export { requireEnv, getEnv, stripComments } from "./util.ts";

// 类型(eval 作者会用到;跑哪个 agent / 用哪个 sandbox 见对应子路径)
export type {
  StreamEvent,
  ToolName,
  JsonValue,
  Usage,
  Turn,
  TurnInput,
  InputFile,
  InputResponse,
  RespondAnswer,
  TurnHandle,
  SessionHandle,
  TestContext,
  ToolMatch,
  ValueAssertion,
  Severity,
  Verdict,
  EvalDef,
  ExperimentDef,
  ExperimentHookContext,
  Config,
  LocalizedText,
  JudgeConfig,
  Reporter,
  ReporterEvent,
  EvalResult,
  RunSummary,
  RunShape,
  AssertionResult,
  ExperimentRunInfo,
  SandboxRunInfo,
  DiffData,
  DiffView,
  ScriptResult,
  SandboxHandle,
  CommandResult,
  InputRequest,
  InputRequestFilter,
  O11ySummary,
  TraceSpan,
  SpanKind,
  DerivedFacts,
} from "./types.ts";

export type { ParsedTranscript } from "./o11y/parsers/index.ts";
