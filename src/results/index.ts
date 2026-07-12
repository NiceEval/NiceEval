// niceeval/results —— 实验结果数据的读写库(定稿见 docs/feature/results/library.md、docs/feature/results/architecture.md)。
//
// 读:openResults(实验 → 快照 → eval → attempt 分层、skipped、latest() Selection);
// 写:createResultsWriter(快照声明 + attempt 增量落盘 + finish 补 completedAt);
// 发布:copySnapshots(格式感知复制 + knownEvalIds 补记);
// 身份:dedupeAttempts(跨快照聚合前按 (experimentId, evalId, attempt, startedAt) 去重)、isNewerSnapshot。
// 布局知识(路径、清洗、拆分、版本)全宇宙只有这一份实现;
// src/runner/reporters/artifacts.ts 是写入面的薄壳,view 的读取经 openResults 消费。

export {
  openResults,
  experimentOfSnapshot,
  resolveLocator,
  LocatorNotFoundError,
  MalformedLocatorError,
} from "./open.ts";
export {
  ATTEMPT_LOCATOR_PREFIX,
  buildLocatorIndex,
  decodeAttemptLocator,
  encodeAttemptLocator,
  resolveAttemptLocator,
  LocatorCollisionError,
  type AttemptIdentity,
  type AttemptLocator,
  type LocatorAttempt,
  type LocatorDecodeResult,
  type LocatorResolution,
} from "./locator.ts";
export {
  buildAnnotatedEvalSource,
  type AnnotatedEvalSource,
  type AnnotatedEvalSourceSummary,
  type AnnotatedSourceLine,
} from "./annotated-source.ts";
export { loadAnnotatedEvalSource } from "./attempt-source.ts";
export {
  loadAttemptEvidence,
  type AttemptEvidence,
  type AttemptEvidenceCapabilities,
  type EvidencePaths,
} from "./attempt-evidence.ts";
export { hashEvalSource, normalizeEvalSource } from "./source-hash.ts";
export { groupIncompatibleVersionSkips, type SkippedVersionGroup } from "./skipped-notice.ts";
export { dedupeAttempts, isNewerSnapshot } from "./select.ts";
export { copySnapshots, type CopySnapshotsOptions, type CopySnapshotsResult } from "./copy.ts";
export {
  createResultsWriter,
  type AttemptArtifacts,
  type AttemptEntry,
  type ResultsWriter,
  type ResultsWriterOptions,
  type SnapshotDeclaration,
  type SnapshotWriter,
} from "./writer.ts";
export {
  RESULT_FILE,
  SNAPSHOT_FILE,
  attemptDirOf,
  artifactFileOf,
  classifySnapshot,
  experimentDirOf,
  type SnapshotClassification,
} from "./format.ts";
export {
  ARTIFACT_KINDS,
  type ArtifactKind,
  type AttemptHandle,
  type AttemptRef,
  type DedupeWarning,
  type Eval,
  type Experiment,
  type Results,
  type Selection,
  type SelectionWarning,
  type SkippedDir,
  type Snapshot,
  type SnapshotMeta,
} from "./types.ts";

// 结果数据类型的家还没搬(facade 迁移是下一波);先从这里 re-export,
// 让消费方从一个入口拿全「分层句柄 + 数据类型 + 格式常量」。
export { RESULTS_FORMAT, RESULTS_SCHEMA_VERSION } from "../types.ts";
export type { EvalResult, ExperimentRunInfo, RunSummary } from "../types.ts";
export type { O11ySummary, StreamEvent, TraceSpan, Usage } from "../types.ts";
export type { AgentSetupManifest, AgentSetupSkill, DiffData, SourceArtifact } from "../types.ts";
