// niceeval 公开导出(import { … } from "niceeval")。
// Agent/Adapter 相关见 "niceeval/adapter";Sandbox 相关见 "niceeval/sandbox"。

export { defineEval, defineScoreEval, defineEvalGroup, defineConfig, defineExperiment } from "./define.ts";
export type { AssertionEntryId } from "./assertions/identity.ts";

/** Neutral RecordAttachment projector for the Attempt-owned agent workspace diff. */
export { agentWorkspaceDiffProjector } from "./assertions/record/diff.ts";
export type {
  AgentSendWindowIdentity,
  AgentWorkspaceDiffEndpoint,
  AgentWorkspaceDiffHunks,
  AgentWorkspaceDiffPolicy,
  AgentWorkspaceDiff,
  AgentWorkspaceDiffWindow,
  AgentWorkspaceDiffWindowChange,
} from "./assertions/workspace-diff.ts";
export type { PostRunBooleanAssertionHandle } from "./assertions/api.ts";

export { requireEnv, getEnv, stripComments } from "./util.ts";

// 执行失败分类:抛出点糖衣类(声明死因波及多远)+ 结构守卫。判据、分类链与止损语义见
// docs/feature/error-classification/README.md;`niceeval/adapter` 复导出同一份词表类型。
export { ExperimentFatalError, EvalFatalError, failureClassOf } from "./shared/failure-class.ts";

// 类型(eval 作者会用到;跑哪个 agent / 用哪个 sandbox 见对应子路径)
export type {
  StreamEvent,
  ToolName,
  JsonValue,
  JsonMatch,
  Usage,
  Turn,
  EvidenceCoverageStatus,
  EvidenceCoverageEntry,
  EvidenceCoverage,
  TurnEvidenceCoverage,
  TurnInput,
  InputFile,
  AnswerValue,
  InputResponse,
  RespondAnswer,
  TurnHandle,
  SessionHandle,
  TestContext,
  ScoreTestContext,
  Verdict,
  EvalAuthorFields,
  EvalInput,
  ScoreEvalInput,
  EvalDefinition,
  AnyEvalDefinition,
  EvalGroupMember,
  EvalGroupInput,
  EvalGroupDefinition,
  EvaluationKind,
  EvalDescriptor,
  ExperimentAuthorFields,
  ExperimentInput,
  ExperimentDefinition,
  ExperimentHook,
  ExperimentHookContext,
  Config,
  LocalizedText,
  JudgeConfig,
  JudgeDeclaration,
  JudgeMaterial,
  Reporter,
  ReporterEvent,
  EvalResult,
  AcceptedDifference,
  AcceptedResult,
  RetryAttemptRecord,
  InvocationSummary,
  InvocationShape,
  DiagnosticRecord,
  ExperimentRunInfo,
  SandboxRunInfo,
  ScriptResult,
  CommandResult,
  CalledToolAtLeast,
  CalledToolCount,
  CalledToolOptions,
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
  ExternalCause,
  ExternalCauseFact,
  ExternalCauseLink,
  ExternalCauseScalar,
} from "./types.ts";
export type { ParsedTranscript } from "./o11y/parsers/index.ts";
