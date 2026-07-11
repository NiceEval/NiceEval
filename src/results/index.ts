// niceeval/results —— 实验结果数据的读写库(定稿见 docs/results-lib.md)。
//
// 读:openResults(实验 → 快照 → eval → attempt 分层、skipped、runDirs、latest() Selection);
// 写:createRunWriter(快照级声明 + attempt 增量落盘 + summary 收尾);
// 发布:copySnapshots(格式感知复制 + knownEvalIds 补记);
// 身份:dedupeAttempts(跨快照聚合前按 (experimentId, evalId, attempt, startedAt) 去重)。
// 布局知识(路径、清洗、拆分、版本)全宇宙只有这一份实现;
// src/runner/reporters/artifacts.ts 是写入面的薄壳,view 的读取收编是下一波。

export { openResults } from "./open.ts";
export { dedupeAttempts } from "./select.ts";
export { copySnapshots, type CopySnapshotsOptions, type CopySnapshotsResult } from "./copy.ts";
export {
  createRunWriter,
  type AttemptArtifacts,
  type AttemptEntry,
  type FinishOverrides,
  type RunWriter,
  type RunWriterOptions,
  type SnapshotDeclaration,
  type SnapshotWriter,
} from "./writer.ts";
export {
  ARTIFACT_KINDS,
  type ArtifactKind,
  type AttemptHandle,
  type AttemptRef,
  type DedupeWarning,
  type Eval,
  type Experiment,
  type Results,
  type RunDir,
  type Selection,
  type SelectionWarning,
  type SkippedRun,
  type Snapshot,
} from "./types.ts";

// 结果数据类型的家还没搬(facade 迁移是下一波);先从这里 re-export,
// 让消费方从一个入口拿全「分层句柄 + 数据类型 + 格式常量」。
export { RESULTS_FORMAT, RESULTS_SCHEMA_VERSION } from "../types.ts";
export type { EvalResult, ExperimentRunInfo, RunSummary } from "../types.ts";
export type { O11ySummary, StreamEvent, TraceSpan, Usage } from "../types.ts";
export type { DiffData, SourceArtifact } from "../types.ts";
