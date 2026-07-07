// results 域类型:openResults 返回的类型化句柄(读取面契约,见 docs/results-lib.md)。
//
// 结果数据类型(EvalResult / RunSummary / StreamEvent / …)仍住在各自的域文件里,
// 这里只 import,不搬家 —— 「类型的家」迁移是 results-lib 设计里单独的一步,不在本次范围。

import type { EvalResult, RunSummary } from "../runner/types.ts";
import type { O11ySummary, StreamEvent, TraceSpan } from "../o11y/types.ts";
import type { DiffData } from "../scoring/types.ts";
import type { SourceArtifact } from "../shared/types.ts";

/** attempt 级工件的种类;文件名恒为 `<kind>.json`,布局见 docs/results-format.md。 */
export const ARTIFACT_KINDS = ["events", "sources", "trace", "o11y", "diff"] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

/**
 * 回到证据的引用:run 目录名(相对结果根目录)+ summary.results[] 下标。
 * Reports 的 MetricCell.refs 与 view 深链 `#/attempt/<run>/<result>` 用的是同一个身份。
 */
export interface AttemptRef {
  run: string;
  result: number;
}

/** 一个落盘 run 目录;忠实反映磁盘,不合并、不去重。 */
export interface RunHandle {
  /** run 目录的绝对路径(summary.json 所在目录)。 */
  dir: string;
  /** 与写入侧同一类型的 RunSummary(results[] 是瘦身条目)。 */
  summary: RunSummary;
  /** summary.results[] 逐条包一层懒加载句柄。 */
  attempts: AttemptHandle[];
}

/**
 * 单个 eval attempt:瘦身条目 + 重工件的懒加载方法。
 * 懒加载即存在性判断:工件缺失返回 null,不抛错;同一 handle 内读过一次即缓存。
 */
export interface AttemptHandle {
  /** 所属物理 run;去重「保留最新 run 的那份」靠它比较新旧。 */
  run: RunHandle;
  /** 本 attempt 的证据引用(run 目录名 + summary.results 下标);消费方不必自己反查下标。 */
  ref: AttemptRef;
  /** EvalResult 瘦身条目:判决、断言、用量、成本、experiment 元数据。 */
  result: EvalResult;
  events(): Promise<StreamEvent[] | null>;
  trace(): Promise<TraceSpan[] | null>;
  o11y(): Promise<O11ySummary | null>;
  diff(): Promise<DiffData | null>;
  sources(): Promise<SourceArtifact[] | null>;
}

/**
 * 快照 = 一个 experiment 在一个 run 里的那部分 attempt(experiment × run 切片)。
 * 一个 run 目录可以装多个 experiment(`niceeval exp compare`),所以「每个 experiment
 * 最新一次」只能用快照粒度表达,不能用 run 粒度。
 */
export interface SnapshotHandle {
  /** experiment id;结果里缺 experimentId 时以 "<agent>/<model>" 合成,并记入集合级 warnings。 */
  experimentId: string;
  /** 所属物理 run。 */
  run: RunHandle;
  /** = run.summary.startedAt;快照新旧按它比较。 */
  startedAt: string;
  /** 本快照自己的 agent —— 不是 run 顶层那个「第一个配置」。 */
  agent: string;
  model?: string;
  attempts: AttemptHandle[];
  /** 覆盖的 eval 集合(去重,保持首次出现顺序),供选择器做残缺检测。 */
  evalIds: string[];
  /** experimentId 是合成键(结果里没有 experimentId)时为 true;选择器据此调整提示文案。 */
  synthetic?: boolean;
}

/** 目录扫描里读不了、但必须让调用方知道的 run;无关 JSON 不记(静默忽略)。 */
export interface SkippedResultsRun {
  /** run 目录的绝对路径。 */
  dir: string;
  /** summary.json 的绝对路径。 */
  path: string;
  reason: "incompatible-version" | "malformed";
  /** incompatible-version:那份报告声明的 schemaVersion。 */
  schemaVersion?: number;
  /** incompatible-version:写报告的 niceeval 版本,拼 `npx niceeval@<version> view` 提示用。 */
  producerVersion?: string;
  /** malformed:一句英文诊断。 */
  detail?: string;
}

/** openResults 的返回:runs 忠实磁盘;snapshots 只切片、不合并、不去重;skipped 不静默丢。 */
export interface ResultsCollection {
  /** 按 startedAt 降序(最新在前),同刻按目录名降序。 */
  runs: RunHandle[];
  /** 按 runs 顺序逐 run 切片;每个 experiment 在每个 run 里至多一个快照。 */
  snapshots: SnapshotHandle[];
  skipped: SkippedResultsRun[];
  /** 集合级警告(如 experimentId 缺失时的合成键);渲染与否在消费方,缺口永远被算出来。 */
  warnings: string[];
}
