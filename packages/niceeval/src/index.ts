// niceeval 公开导出(import { … } from "niceeval")。
// Agent/Adapter 相关见 "niceeval/adapter";Sandbox 相关见 "niceeval/sandbox"。

export { defineEval, defineScoreEval, defineEvalGroup, defineConfig, defineExperiment } from "./define.ts";
export { defineAdapter, defineAdapterContract } from "./adapter.ts";
export { defineJudge } from "./assertions/judge.ts";
export type { JudgeAnchor, JudgeDefinition, JudgeOptions } from "./assertions/judge.ts";
export { defineScoreMatch } from "./assertions/match.ts";
export type { ManagedScoreMatchOptions, ScoreMatch, ScoreMatchAnchor, ScoreMatchContext, ScoreMatchLlmFailure, ScoreMatchResult } from "./assertions/match.ts";
export type { AssertionEntryId } from "./assertions/identity.ts";
export {
  readScoreMatchAudit,
  type ScoreMatchAudit,
  type ScoreMatchAuditEnvelope,
  type ScoreMatchAuditReadResult,
} from "./assertions/score-match-audit.ts";

export type {
  AgentSendWindowIdentity,
  AgentWorkspaceDiffEndpoint,
  AgentWorkspaceDiffHunks,
  AgentWorkspaceDiffPolicy,
  AgentWorkspaceDiff,
  AgentWorkspaceDiffWindow,
  AgentWorkspaceDiffWindowChange,
} from "./assertions/workspace-diff.ts";
export type {
  AssertionCheck,
  PolymorphicBooleanAssertionHandle,
  PolymorphicMeasurementAssertionHandle,
  PostRunBooleanAssertionHandle,
} from "./assertions/api.ts";

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
  SharedStateConfig,
  ExperimentInput,
  ExperimentDefinition,
  ExperimentHook,
  ExperimentHookContext,
  Config,
  LocalizedText,
  JudgeConfig,
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
export type {
  Adapter,
  AdapterAssertionsFactory,
  AdapterAssertionsFactoryContext,
  AdapterCleanupContext,
  AdapterContract,
  AdapterCreateContext,
  AdapterDefinition,
  AdapterEvalDefinition,
  AdapterEvalInput,
  AdapterIdentity,
  AdapterImplementation,
  AdapterImplementationInput,
  AdapterRuntimeDefinition,
  AdapterScoreEvalInput,
  EvalContext,
  ReservedAdapterContextKey,
} from "./adapter.ts";
export type { ParsedTranscript } from "./o11y/parsers/index.ts";

export { closeQA, factuality, faithfulness, instructionFollowing, pairwisePreference } from "./assertions/judge-presets.ts";
export type { CloseQAMaterial, JudgePresetOptions, FactualityMaterial, FaithfulnessMaterial, InstructionFollowingMaterial, PairwisePreferenceMaterial } from "./assertions/judge-presets.ts";
export type { AdapterUsageInput } from "./adapter-usage.ts";
export type { AdapterAttachmentInput, AdapterAttachmentReceipt } from "./adapter-attachments.ts";
