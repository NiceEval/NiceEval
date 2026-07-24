// niceeval 公开导出(import { … } from "niceeval")。
// Agent/Adapter 相关见 "niceeval/adapter";Sandbox 相关见 "niceeval/sandbox"。

export { defineEval, defineScoreEval, defineConfig, defineExperiment } from "./define.ts";

export { requireEnv, getEnv, stripComments } from "./util.ts";

// 执行失败分类:抛出点糖衣类(声明死因波及多远)+ 结构守卫。判据、分类链与止损语义见
// docs/feature/error-classification/README.md;`niceeval/adapter` 复导出同一份词表类型。
export { ExperimentFatalError, EvalFatalError, failureClassOf } from "./shared/failure-class.ts";

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
  BaseTestContext,
  TestContext,
  ScoreTestContext,
  ToolMatch,
  ValueAssertion,
  BaseAssertionHandle,
  AssertionHandle,
  ScoreAssertionHandle,
  ScorePointHandle,
  Severity,
  Verdict,
  EvalDef,
  ScoreEvalDef,
  EvalScoring,
  EvalDescriptor,
  ScoreEntry,
  ExperimentDef,
  ExperimentHookContext,
  Config,
  LocalizedText,
  JudgeConfig,
  Reporter,
  ReporterEvent,
  EvalResult,
  InvocationSummary,
  InvocationShape,
  AssertionResult,
  DiagnosticRecord,
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
  FailureClass,
  FailureScope,
  AttemptFailureInfo,
  AttemptFailureClassifier,
} from "./types.ts";

export type { ParsedTranscript } from "./o11y/parsers/index.ts";
