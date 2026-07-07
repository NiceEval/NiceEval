// niceeval/results —— 实验结果数据的读写库(设计见 docs/results-lib.md)。
//
// 本实验先落读取面:openResults / latestPerExperiment / dedupeAttempts / copyRun。
// TODO(results-lib): 写入面 createRunWriter 落地后,src/runner/reporters/artifacts.ts
// 变薄壳、src/view/loader.ts 改吃这里的 reader —— 布局知识全宇宙只剩这一份实现。

export { openResults } from "./open.ts";
export { dedupeAttempts, latestPerExperiment } from "./select.ts";
export { copyRun, type CopiedRun, type CopyRunOptions } from "./copy.ts";
export {
  ARTIFACT_KINDS,
  type ArtifactKind,
  type AttemptHandle,
  type AttemptRef,
  type ResultsCollection,
  type RunHandle,
  type SkippedResultsRun,
  type SnapshotHandle,
} from "./types.ts";

// 结果数据类型的家还没搬(类型迁移是设计里单独的一步);先从这里 re-export,
// 让消费方从一个入口拿全「句柄 + 数据类型 + 格式常量」。
export { RESULTS_FORMAT, RESULTS_SCHEMA_VERSION } from "../runner/types.ts";
export type { EvalResult, ExperimentRunInfo, RunSummary } from "../runner/types.ts";
export type { O11ySummary, StreamEvent, TraceSpan, Usage } from "../o11y/types.ts";
export type { DiffData } from "../scoring/types.ts";
export type { SourceArtifact } from "../shared/types.ts";
