// results 域类型:openResults 的分层读取契约与 Selection(定稿见 docs/feature/record/library.md、docs/feature/record/architecture.md)。
//
// 结果数据类型(EvalResult / ExperimentRunInfo / StreamEvent / …)仍住在各自的域文件里,
// 这里只 import,不搬家 —— 「类型的家」迁移(facade 反向 re-export)是下一波,不在本次范围。
//
// 命名约定:Experiment / Snapshot / Eval 是纯数据,不带 Handle 后缀;
// 唯一叫 AttemptHandle 的是 attempt —— 它的方法真的会碰磁盘,后缀标记的就是这件事。

import type { DiagnosticRecord, EvalResult, ExperimentRunInfo, LocalizedText } from "../types.ts";
import type { FailedCommandEvidence, O11ySummary, StreamEvent, TraceSpan } from "../types.ts";
import type { AgentSetupManifest, DiffData, SourceArtifact } from "../types.ts";
import type { AttemptLocator } from "./locator.ts";

/** attempt 级 artifact 的种类;文件名见 format.ts 的 artifactFileOf,布局见 docs/feature/record/architecture.md。 */
export const ARTIFACT_KINDS = ["commands", "events", "trace", "o11y", "agentSetup", "diff", "sources"] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

/** 写这份结果的工具:niceeval 自己,或经 niceeval/results 写入面转换的第三方 harness。 */
export interface Producer {
  name: string;
  version?: string;
  commit?: string;
}

/**
 * `snapshot.json` 的持久化契约:快照元数据 —— 身份、快照级字段与版本元数据,
 * 不含任何逐 attempt 数据。快照开始时写入;收尾时补写 `completedAt`。
 * 字段规则与版本判定见 docs/feature/record/architecture.md「snapshot.json」「版本与升级设计」。
 */
export interface SnapshotMeta {
  /** 恒为 "niceeval.results";和 schemaVersion、producer 一起构成持久化契约,永不移动或改名。 */
  format: "niceeval.results";
  /** 结果格式版本;与读取器不同即视为不兼容,提示用 producer.version 对应的 niceeval 查看。 */
  schemaVersion: number;
  producer: Producer;
  /** 权威的实验身份;实验目录名是它的清洗投影。 */
  experimentId: string;
  /** 实验运行配置(flags / runs / earlyExit / sandbox / timeoutMs / budget),快照内全部 attempt 共享。 */
  experiment?: ExperimentRunInfo;
  agent: string;
  model?: string;
  startedAt: string;
  /** 收尾时补写;缺失 = 快照未收尾(进程中断),已落盘的 attempt 照常可读。 */
  completedAt?: string;
  /**
   * 属于整个 Experiment 快照、无法诚实挂到单个 Attempt 的操作性诊断。与 completedAt 在同一次
   * 快照封口补写;例如 experiment-teardown-failed、budget-unenforceable。不与 attempt 级
   * diagnostics 混合,不得放入跨 Experiment 的 Invocation 汇总(见 docs/runner.md「实验域诊断持久化」)。
   */
  diagnostics?: DiagnosticRecord[];
  /**
   * experiment 作用域生命周期代码经 `ctx.fact()` 上报的运行事实;与 completedAt 同批在快照
   * 封口补写。字段契约见 result.json 的 facts 小节(docs/feature/record/architecture.md#facts运行事实)。
   */
  facts?: Record<string, string | number | boolean>;
  /** 写入时刻该实验已知的 eval 并集 —— 残缺检测的分母随数据走(copySnapshots 自动补记,writer 可声明)。 */
  knownEvalIds?: string[];
  /** 项目名(来自 config.name),透传给 `niceeval view` 顶部 hero 显示。 */
  name?: LocalizedText;
}

/**
 * 回到证据的引用:快照目录(根相对)+ 快照内 attempt 目录(快照相对)。
 * 字段名(snapshot / attempt)是 view 深链 `#/attempt/<snapshot>/<attempt>` 的持久化路由契约,
 * 不随句柄改名;`snapshot` 恒为两段(`<实验目录>/<快照目录>`),`attempt` 是 `<evalId 路径>/a<n>`,
 * 路由按「前两段 = 快照」解析。Reports 的 MetricCell.refs 用的是同一个身份。
 */
export interface AttemptRef {
  /** 根相对快照目录:`<experiment-dir>/<快照目录>`。 */
  snapshot: string;
  /** 快照相对 attempt 目录:`<evalId 路径>/a<n>`。 */
  attempt: string;
}

/**
 * 单个 eval attempt:瘦身条目 + 重 artifact 的懒加载方法。
 * 懒加载即存在性判断: artifact 缺失返回 null,不抛错;同一 handle 内读过一次即记忆化。
 * artifact 定位按候选顺序回退:先本 attempt 目录,再 artifactBase 指向的原快照 attempt 目录
 * (--resume 合入条目的 artifact 留在原快照里);原快照被清理后如实返回 null。
 */
export interface AttemptHandle {
  /** 属于哪道题 —— 直达字段,不绕 result。 */
  evalId: string;
  /** 属于哪个实验。 */
  experimentId: string;
  /** EvalResult 瘦身条目:判定、断言、用量、成本(快照级字段已拼合)。 */
  result: EvalResult;
  /** 证据引用,指条目所在的落盘(合入后的新快照); artifact 经候选回退仍可达。 */
  ref: AttemptRef;
  /** 所属快照(反向引用);去重「保留最新快照里的那份」靠它比较新旧。 */
  snapshot: Snapshot;
  /**
   * 不透明的 Attempt 定位符(见 `locator.ts`);openResults() 产出的 handle 恒会填这个字段
   * (result.json 里有就直接用,没有则按当前身份兜底算,见 open.ts 的回填逻辑)。可选只是为了
   * 不强制手工构造的 AttemptHandle(测试里的内存 fake)也必须带上——真实读取路径永远有值。
   */
  locator?: AttemptLocator;
  /**
   * 携带条目投影:true = fingerprint 未变、上一轮终态结果合入本快照(`result.artifactBase`
   * 有值);false = 本快照那次运行真实执行。`startedAt` 为原执行时刻,不因携带而改写
   * (时效语义见 docs/feature/sample/library.md「时效:新执行与历史执行」)。
   */
  carried: boolean;
  /** 非零 Sandbox 命令的 stdout/stderr 证据(`commands.json`);没有失败命令时 null。 */
  commands(): Promise<FailedCommandEvidence[] | null>;
  events(): Promise<StreamEvent[] | null>;
  trace(): Promise<TraceSpan[] | null>;
  o11y(): Promise<O11ySummary | null>;
  /** 这次 attempt 的 agent setup 装了什么(Skill / native plugin / MCP / Python plugin);没装扩展的 agent 恒为 null。 */
  agentSetup(): Promise<AgentSetupManifest | null>;
  diff(): Promise<DiffData | null>;
  sources(): Promise<SourceArtifact[] | null>;
}

/** 一道题在一个快照里的结果:id + 该题的全部 attempt(重试历史)。 */
export interface Eval {
  id: string;
  attempts: AttemptHandle[];
}

/** 快照 = 单次跑的实验,物理上就是一个快照目录,没有更低一层。 */
export interface Snapshot {
  /** 权威身份(snapshot.json 字段;实验目录名只是它的清洗投影)。 */
  experimentId: string;
  startedAt: string;
  /** 缺失 = 未收尾(进程中断);已落盘 attempt 照常在下面读到。 */
  completedAt?: string;
  /** 快照级诊断;不与 attempt diagnostics 混合(见 SnapshotMeta.diagnostics)。 */
  diagnostics?: DiagnosticRecord[];
  /** experiment 作用域上报的运行事实;不与 attempt 级 facts(attempt.result.facts)合并(见 SnapshotMeta.facts)。 */
  facts?: Record<string, string | number | boolean>;
  /** 本快照自己的 agent。 */
  agent: string;
  model?: string;
  /** 实验运行配置(flags / runs / budget …),快照内全部 attempt 共享。 */
  experiment?: ExperimentRunInfo;
  /** 谁写的这份结果(niceeval 或第三方 harness)。 */
  producer: Producer;
  /** 结果格式版本(能读进来的恒为当前版本;不兼容的在 skipped)。 */
  schemaVersion: number;
  /** 项目名(来自 config.name),透传给 `niceeval view` 顶部 hero 显示。 */
  name?: LocalizedText;
  /** 每道题一项:{ id, attempts };残缺检测 / 逐题遍历从这里走。 */
  evals: Eval[];
  /** 全部 attempt 平铺(= evals 逐题展开),不关心题目边界的聚合消费用。 */
  attempts: AttemptHandle[];
  /** 快照目录的绝对路径(物理落盘就是快照本身,没有更低一层)。 */
  dir: string;
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
export interface SkippedDir {
  /** 落盘目录的绝对路径。 */
  dir: string;
  /**
   * incompatible-version:schemaVersion 与读取器不同(不解析、不迁移、不降级);
   * malformed:snapshot.json(或历史版本的 summary.json)是坏数据;
   * incomplete:有 attempt 落盘、没有 snapshot.json —— 快照目录建好但元数据没写完的极小窗口,
   * 或人为删文件。snapshot.json 是收尾事实,reader 不读无 snapshot.json 的目录;
   * 已完成的 attempt 留在盘上供手工排查。
   */
  reason: "incompatible-version" | "malformed" | "incomplete";
  /** 那份结果声明的 schemaVersion(incomplete 没有 snapshot.json,自然缺失)。 */
  schemaVersion?: number;
  /** 完整的 producer(name + version):只有 name === "niceeval" 才能拼 npx 提示,第三方如实报名字。 */
  producer?: Producer;
  /** malformed:一句英文诊断。 */
  detail?: string;
}

/** openResults 的返回:experiments 分层;skipped 不静默丢。 */
export interface Results {
  /**
   * 结果根目录的绝对路径(`openResults()` 入参解析后的原样值,不论传入的是结果根、
   * 实验目录、快照目录还是某个 snapshot.json)。`unreadable-snapshot` 警告拼版本化
   * `command`(`npx niceeval@<version> show --results <root>`)时取它。
   */
  root: string;
  /** 每个实验一项,挂着自己的全部历史(id 字典序)。 */
  experiments: Experiment[];
  skipped: SkippedDir[];
  /**
   * 每个实验取最新一次快照,返回 Scope(快照与挑选警告绑在一起走)。
   * `experiments` 是 experiment id 前缀过滤(string | string[]),同 CLI 位置参数语义。
   * `fresh: true` 只保留新执行的 attempt(排除携带条目),被排除的题按覆盖事实进入
   * `coverage.missingEvalIds`(见 docs/feature/sample/library.md「时效:新执行与历史执行」)。
   */
  latest(opts?: { experiments?: string | string[]; fresh?: boolean }): Scope;
  /**
   * 官方现刻水位:每个 experiment × eval 取「包含该 eval 的最新快照」里的全部 attempt,
   * 跨历史拼出当前判定水位。可比性前提:每个 experiment 以最新快照的可比性配置
   * (agent / model / reasoningEffort / flags / budget / timeoutMs / sandbox)为基准,
   * 配置不一致的旧快照不贡献 attempt,缺口进 `coverage.missingEvalIds`
   * (见 docs/feature/record/library.md「官方现刻水位」)。`fresh: true` 同 `latest()`。
   */
  current(opts?: { experiments?: string | string[]; fresh?: boolean }): Scope;
}

/**
 * 一个实验的覆盖事实:已知 eval 并集(分母)与当前口径下没有任何 attempt 的题。
 * `missingEvalIds` 永远被算出来,不静默——渲染面把它转成榜单占位行
 * (见 docs/feature/sample/library.md「选择快照」「时效:新执行与历史执行」)。
 */
export interface ScopeCoverage {
  experimentId: string;
  /** 分母:本地历史 ∪ 各快照携带的 knownEvalIds,交命令行范围(与 `exp.evalIds` 同源)。 */
  knownEvalIds: string[];
  /** 当前口径下没有任何 attempt 的题(含 `fresh: true` 排除历史执行后新产生的缺口)。 */
  missingEvalIds: string[];
}

/**
 * Scope(范围):选出的快照 + 口径 + 已按口径物化的 attempt 全集 + 挑选警告。
 * 渲染与否在消费方,但缺口永远被算出来。下游(Reports 计算函数、copySnapshots)收
 * `Scope | readonly Snapshot[]`;手工挑的裸数组没有挑选过程,自然没有 warnings 可带,也如实。
 */
export interface Scope {
  /** 这份 Scope 的口径,字面写在数据上。 */
  mode: "latest-snapshots" | "current-evals";
  snapshots: Snapshot[];
  /**
   * 按口径物化的 attempt 全集:消费 attempts 就自动正确,不需要自己 flatten snapshots,
   * 也就不可能算错口径。官方计算函数同样只消费它。
   */
  attempts: AttemptHandle[];
  /** 逐实验的覆盖事实(见 `ScopeCoverage`);手工挑的 `Snapshot[]` 没有挑选过程,不带覆盖事实。 */
  coverage: ScopeCoverage[];
  warnings: ScopeWarning[];
  /**
   * 只删不换:返回新 Scope,快照删减,attempts、coverage 与 warnings 随之同步修剪 ——
   * experimentId 不在幸存快照中的条目丢弃,非实验作用域的警告保留。
   * 「换成上一个完整快照」这类替换式重挑不给方法,回 exp.snapshots 自己挑。
   */
  filter(predicate: (snapshot: Snapshot) => boolean): Scope;
}

/**
 * 挑选警告:每种带 kind、可判断的结构化字段和渲染好的英文 message;能用一条命令直接推进的
 * kind 同时带 `command`(已替换真实 id,复制即跑)。kind 是契约的一部分,全集与触发条件见
 * docs/feature/record/library.md「警告 kind 全集」——三种都是**定位不到任何一行**的完整性
 * 事实:覆盖缺口(行级事实,见 `ScopeCoverage`)与时效(`AttemptHandle.carried` 投影的行级
 * 属性)不在这个联合里。
 */
export type ScopeWarning =
  | {
      /** 选中快照缺 completedAt(进程中断,未收尾);已落盘 attempt 照常读出,警告提示集合可能不完整。 */
      kind: "unfinished-snapshot";
      experimentId: string;
      startedAt: string;
      /** 该快照目录的绝对路径。 */
      dir: string;
      message: string;
      /** 一条可复制即跑的推进命令:`niceeval exp <experimentId>`。 */
      command: string;
    }
  | {
      /**
       * 身份键(experimentId, evalId, attempt, startedAt)缺 startedAt,`dedupeAttempts` 宁可
       * 不去重也不误删。归属 `dedupeAttempts`,不进 `Scope.warnings`(selectLatest / current
       * 不产出这个 kind)——`dedupeAttempts()` 直调时警告随它自己的返回值走,`DedupeWarning`
       * 是这个成员的类型别名。
       */
      kind: "missing-startedAt";
      experimentId: string;
      evalId: string;
      message: string;
    }
  | {
      /**
       * 扫描结果根遇到的不可读快照:schema 不兼容、JSON 损坏 / 必需字段错误(malformed)、
       * attempt 已写入但缺 `snapshot.json`(incomplete)。该快照被跳过,不挡其余结果
       * (非 niceeval JSON 静默忽略,不产生这个 kind)。非实验作用域(没有 experimentId
       * 字段) —— `Scope.filter()` 修剪时恒保留。
       */
      kind: "unreadable-snapshot";
      /** 该快照目录的绝对路径。 */
      dir: string;
      /** 与 `SkippedDir.reason` 同一取值集,原样透传。 */
      reason: "incompatible-version" | "malformed" | "incomplete";
      message: string;
      /**
       * 只有 reason 为 `incompatible-version` 且能确定是 niceeval 自己产出(`producer.name
       * === "niceeval"` 且带 `producer.version`)时给出:`npx niceeval@<version> show --results
       * <root>`。第三方 producer、版本信息缺失,或 reason 为 malformed / incomplete 时省略——
       * 这些情况没有单条命令能解决,message 改给定位动作。
       */
      command?: string;
    };

/** `dedupeAttempts` 的警告:`ScopeWarning` 里 `missing-startedAt` 那个成员的类型别名。 */
export type DedupeWarning = Extract<ScopeWarning, { kind: "missing-startedAt" }>;
