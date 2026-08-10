// niceeval/record —— 实验结果数据的读写库(定稿见 docs/feature/record/library.md、docs/feature/record/architecture.md)。
//
// 读:openRecord(实验 → 快照 → eval → attempt 分层、unreadable、latest() / current() Sample);
// 写:createWriter(快照声明 + attempt 增量落盘 + finish 补 completedAt);
// 发布:publish(格式感知复制 + knownEvalIds 补记);
// 身份:dedupeAttempts(跨快照聚合前按 (experimentId, evalId, attempt, startedAt) 去重)、isNewerSnapshot。
// 布局知识(路径、清洗、拆分、版本)全宇宙只有这一份实现;
// src/runner/reporters/artifacts.ts 是写入面的薄壳,view 的读取经 openRecord 消费。

export {
  openRecord,
  loadLatestResultsForCase,
  withArtifactBase,
  experimentOfSnapshot,
  resolveLocator,
  assertFreshAttemptLocatorRegistrations,
  LocatorNotFoundError,
  MalformedLocatorError,
  AmbiguousLocatorError,
  type AmbiguousLocatorCandidate,
} from "./open.ts";
export {
  ATTEMPT_LOCATOR_PREFIX,
  assertLocatorRegistrationsAvailable,
  buildLocatorIndex,
  decodeAttemptLocator,
  encodeAttemptLocator,
  resolveAttemptLocator,
  LocatorCollisionError,
  type AttemptIdentity,
  type AttemptLocator,
  type AttemptLocatorRegistration,
  type LocatorAttempt,
  type LocatorIndex,
  type LocatorDecodeResult,
  type LocatorResolution,
} from "./locator.ts";
export {
  assembleSourceTree,
  projectSourceView,
  deriveSendAnnotations,
  type SendAnnotation,
  type AnnotatedSourceTree,
  type LineAnnotation,
  type ProjectedSourceCall,
  type ProjectedSourceLine,
  type SourceContent,
  type SourceContentNode,
  type SourceCallSummary,
  type SourceNode,
} from "./annotated-source.ts";
export { loadAttemptSourceTree } from "./attempt-source.ts";
export {
  FACT_USE_EVALUATION_ALGORITHM,
  assertFactRecord,
  factRecordOf,
  materializeFactRecord,
  attemptTerminalOf,
  verdictForTerminal,
  scoreOutcomeOf,
  type AttemptTerminal,
  type FactRecordEnvelope,
  type FactRecordResult,
  type FactUseResult,
  type ScoreAttemptStatus,
} from "./fact-record.ts";
export {
  isAttemptEvidence,
  loadAttemptEvidence,
  type AttemptEvidence,
  type AttemptEvidenceCapabilities,
  type EvidencePaths,
} from "./attempt-evidence.ts";
export { hashEvalSource, normalizeEvalSource } from "./source-hash.ts";
export { groupIncompatibleVersionSkips, type SkippedVersionGroup } from "./skipped-notice.ts";
export {
  comparabilityConfigOf,
  dedupeAttempts,
  deepEqualJson,
  isNewerSnapshot,
  type ComparabilityConfig,
} from "../sample/index.ts";
export { publish, type CopySnapshotsOptions, type CopySnapshotsResult } from "./copy.ts";
export {
  createWriter,
  type AttemptArtifacts,
  type AttemptEntry,
  type Writer,
  type WriterOptions,
  type RunDeclaration,
  type RunWriter,
} from "./writer.ts";
export {
  RESULT_FILE,
  RUN_FILE,
  attemptDirOf,
  artifactFileOf,
  classifyRun,
  experimentDirOf,
  type RunClassification,
} from "./format.ts";
export {
  ARTIFACT_KINDS,
  type ArtifactKind,
  type AttemptHandle,
  type AttemptRef,
  type DedupeWarning,
  type Eval,
  type Experiment,
  type Record,
  type Sample,
  type SampleCoverage,
  type SampleIssue,
  type UnreadableRun,
  type Run,
  type RunMeta,
  type SampleMissing,
  type ProjectCurrentTarget,
  type ProjectCurrentExperimentTarget,
  type ProjectCurrentEvalTarget,
} from "../record/types.ts";

// 结果数据类型的家还没搬(facade 迁移是下一波);先从这里 re-export,
// 让消费方从一个入口拿全「分层句柄 + 数据类型 + 格式常量」。
export { RECORD_FORMAT, RECORD_SCHEMA_VERSION } from "../types.ts";
export type {
  AcceptedDifference,
  AcceptedResult,
  DiagnosticRecord,
  EvalResult,
  ExperimentRunInfo,
  CommandExitEvidence,
  InvocationSummary,
} from "../types.ts";
export type { O11ySummary, StreamEvent, TraceSpan, Usage } from "../types.ts";
export type { AgentSetupManifest, AgentSetupSkill, DiffData, SourceArtifact } from "../types.ts";
export type { SandboxBuildRecord, TimingActivity, TimingOrigin } from "../types.ts";
