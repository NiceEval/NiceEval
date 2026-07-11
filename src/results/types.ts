// results 域类型:openResults 的分层读取契约与选集(定稿见 docs/results-lib.md)。
//
// 结果数据类型(EvalResult / RunSummary / StreamEvent / …)仍住在各自的域文件里,
// 这里只 import,不搬家 —— 「类型的家」迁移(facade 反向 re-export)是下一波,不在本次范围。
//
// 命名约定:Experiment / Snapshot / Eval / RunDir 是纯数据,不带 Handle 后缀;
// 唯一叫 AttemptHandle 的是 attempt —— 它的方法真的会碰磁盘,后缀标记的就是这件事。

import type { EvalResult, RunSummary } from "../types.ts";
import type { O11ySummary, StreamEvent, TraceSpan } from "../types.ts";
import type { DiffData, SourceArtifact } from "../types.ts";

/** attempt 级工件的种类;文件名恒为 `<kind>.json`,布局见 docs/results-format.md。 */
export const ARTIFACT_KINDS = ["events", "trace", "o11y", "diff", "sources"] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

/**
 * 回到证据的引用:run 目录名(相对结果根目录)+ summary.results[] 下标。
 * 字段名(run / result)是 view 深链 `#/attempt/<run>/<result>` 的持久化路由契约,不随句柄改名;
 * Reports 的 MetricCell.refs 用的是同一个身份。
 */
export interface AttemptRef {
  run: string;
  result: number;
}

/** 一个物理落盘 run 目录(低层忠实磁盘面);多数消费方走 experiments,不碰它。 */
export interface RunDir {
  /** run 目录的绝对路径(summary.json 所在目录)。 */
  dir: string;
  /** 与写入侧同一类型的 RunSummary(results[] 是瘦身条目)。 */
  summary: RunSummary;
  /** summary.results[] 逐条包一层懒加载句柄(按下标顺序)。 */
  attempts: AttemptHandle[];
}

/**
 * 单个 eval attempt:瘦身条目 + 重工件的懒加载方法。
 * 懒加载即存在性判断:工件缺失返回 null,不抛错;同一 handle 内读过一次即记忆化。
 * 工件定位按候选顺序回退:先本 run 的 artifactsDir,再 artifactBase 指向的原 run 目录
 * (--resume 合入条目的工件留在原 run 里);原 run 被清理后如实返回 null。
 */
export interface AttemptHandle {
  /** 属于哪道题 —— 直达字段,不绕 result。 */
  evalId: string;
  /** 属于哪个实验;落盘缺 experimentId 时是 "<agent>/<model>" 合成键(所属快照 synthetic: true)。 */
  experimentId: string;
  /** EvalResult 瘦身条目:判定、断言、用量、成本、experiment 元数据。 */
  result: EvalResult;
  /** 证据引用,指条目所在的落盘(合入后的新 run);工件经候选回退仍可达。 */
  ref: AttemptRef;
  /** 条目所在的物理落盘;去重「保留最新 run 目录里的那份」靠它比较新旧。 */
  runDir: RunDir;
  events(): Promise<StreamEvent[] | null>;
  trace(): Promise<TraceSpan[] | null>;
  o11y(): Promise<O11ySummary | null>;
  diff(): Promise<DiffData | null>;
  sources(): Promise<SourceArtifact[] | null>;
}

/** 一道题在一个快照里的结果:id + 该题的全部 attempt(重试历史)。 */
export interface Eval {
  id: string;
  attempts: AttemptHandle[];
}

/**
 * 快照 = 单次跑的实验(experiment × run 切片)。一个 run 目录可以装多个 experiment
 * (`niceeval exp compare`),所以「每个 experiment 最新一次」只能用快照粒度表达。
 */
export interface Snapshot {
  /** 结果里缺 experimentId 时以 "<agent>/<model>" 合成键,并经 latest() 记入 warnings。 */
  experimentId: string;
  startedAt: string;
  /** 本快照自己的 agent —— 不是落盘顶层那个「第一个配置」。 */
  agent: string;
  model?: string;
  /** 谁写的这份结果(niceeval 或第三方 harness;legacy 结果可能缺失)。 */
  producer?: RunSummary["producer"];
  /** 结果格式版本(能读进来的恒为当前版本;不兼容的在 skipped),缺失按 1。 */
  schemaVersion: number;
  /** 每道题一项:{ id, attempts };残缺检测 / 逐题遍历从这里走。 */
  evals: Eval[];
  /** 全部 attempt 平铺(= evals 逐题展开),不关心题目边界的聚合消费用。 */
  attempts: AttemptHandle[];
  /** 所属物理落盘(低层面)。 */
  runDir: RunDir;
  /** experimentId 是合成键(结果里没有 experimentId)时为 true。 */
  synthetic?: boolean;
  /** 写入时刻该实验已知的 eval 并集(可选);copySnapshots 自动补记,writer.snapshot() 也可声明。 */
  knownEvalIds?: string[];
}

/** 一个实验的全部历史:同一 experiment id 的历次快照归在一起。 */
export interface Experiment {
  id: string;
  /** 历次快照,最新在前。 */
  snapshots: Snapshot[];
  /** 最新一次(= snapshots[0])。 */
  latest: Snapshot;
  /** 已知 eval 并集 = 本地历史 ∪ 各快照携带的 knownEvalIds —— 残缺检测的分母。 */
  evalIds: string[];
}

/** 目录扫描里读不了、但必须让调用方知道的落盘;无关 JSON 不记(静默忽略)。 */
export interface SkippedRun {
  /** run 目录的绝对路径。 */
  dir: string;
  /**
   * incompatible-version:schemaVersion 与读取器不同(不解析、不迁移、不降级);
   * malformed:summary.json 是坏数据;
   * incomplete:有 attempt 工件、没有 summary.json —— run 中途 crash、writer 没走到 finish()。
   * summary 是收尾事实,reader 不读无 summary 的目录;已完成的工件留在盘上供手工排查。
   */
  reason: "incompatible-version" | "malformed" | "incomplete";
  /** 那份结果声明的 schemaVersion(incomplete 没有 summary,自然缺失)。 */
  schemaVersion?: number;
  /** 完整的 producer(name + version):只有 name === "niceeval" 才能拼 npx 提示,第三方如实报名字。 */
  producer?: RunSummary["producer"];
  /** malformed:一句英文诊断。 */
  detail?: string;
}

/** openResults 的返回:experiments 分层;skipped 不静默丢;runDirs 忠实磁盘(新→旧)。 */
export interface Results {
  /** 每个实验一项,挂着自己的全部历史(id 字典序)。 */
  experiments: Experiment[];
  skipped: SkippedRun[];
  /** 低层忠实磁盘面:物理落盘目录,新→旧;多数消费方不碰。 */
  runDirs: RunDir[];
  /**
   * 每个实验取最新一次快照,返回 Selection(快照与挑选警告绑在一起走)。
   * `experiments` 是 experiment id 前缀过滤(string | string[]),同 CLI 位置参数语义。
   */
  latest(opts?: { experiments?: string | string[] }): Selection;
}

/**
 * 选集:选出的快照 + 挑选过程算出的警告。渲染与否在消费方,但缺口永远被算出来。
 * 下游(Reports 计算函数、copySnapshots)收 `Selection | Snapshot[]`;
 * 手工挑的裸数组没有挑选过程,自然没有 warnings 可带,也如实。
 */
export interface Selection {
  snapshots: Snapshot[];
  warnings: SelectionWarning[];
  /**
   * 只删不换:返回新 Selection,快照删减,warnings 按规则修剪 ——
   * experimentId 不在幸存快照中的丢弃,非实验作用域的保留。
   * 「换成上一个完整快照」这类替换式重挑不给方法,回 exp.snapshots 自己挑。
   */
  filter(predicate: (snapshot: Snapshot) => boolean): Selection;
}

/**
 * 挑选警告:每种带 kind、可判断的结构化字段和渲染好的英文 message。
 * kind 是契约的一部分;全集与触发条件见 docs/results-lib.md「警告 kind 全集」。
 */
export type SelectionWarning =
  | {
      /** 选中快照的覆盖 < 该实验已知 eval 并集(本地历史 ∪ knownEvalIds)。 */
      kind: "partial-coverage";
      experimentId: string;
      covered: number;
      total: number;
      message: string;
    }
  | {
      /** 该实验选中的快照早于选集中最新的落盘;无阈值,如实触发,要阈值消费方按字段自比。 */
      kind: "stale-snapshot";
      experimentId: string;
      startedAt: string;
      latestStartedAt: string;
      message: string;
    }
  | {
      /** 落盘缺 experimentId,以 "<agent>/<model>" 合成键(快照的 synthetic: true 同源)。 */
      kind: "synthetic-experiment-id";
      experimentId: string;
      /** 该快照所在 run 目录的绝对路径。 */
      runDir: string;
      message: string;
    };

/** dedupeAttempts 的警告:身份键缺 startedAt,宁可不去重也不误删。 */
export interface DedupeWarning {
  kind: "missing-startedAt";
  experimentId: string;
  evalId: string;
  message: string;
}
