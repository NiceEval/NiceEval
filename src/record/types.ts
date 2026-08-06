// results 域类型:openRecord 的分层读取契约与 Selection(定稿见 docs/feature/record/library.md、docs/feature/record/architecture.md)。
//
// 结果数据类型(EvalResult / ExperimentRunInfo / StreamEvent / …)仍住在各自的域文件里,
// 这里只 import,不搬家 —— 「类型的家」迁移(facade 反向 re-export)是下一波,不在本次范围。
//
// 命名约定:Experiment / Run / Eval 是纯数据,不带 Handle 后缀;
// 唯一叫 AttemptHandle 的是 attempt —— 它的方法真的会碰磁盘,后缀标记的就是这件事。

import type { DiagnosticRecord, EvalResult, ExperimentRunInfo, LocalizedText, SandboxBuildRecord, TimingActivity, Verdict } from "../types.ts";
import type { CommandExitEvidence, O11ySummary, StreamEvent, TraceSpan } from "../types.ts";
import type { AgentSetupManifest, DiffData, SourceArtifact } from "../types.ts";
import type { AttemptIdentity, AttemptLocator } from "./locator.ts";

/** attempt 级 artifact 的种类;文件名见 format.ts 的 artifactFileOf,布局见 docs/feature/record/architecture.md。 */
export const ARTIFACT_KINDS = ["commands", "events", "trace", "o11y", "agentSetup", "diff", "sources"] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

/** 写这份结果的工具:niceeval 自己,或经 niceeval/record 写入面转换的第三方 harness。 */
export interface Producer {
  name: string;
  version?: string;
  commit?: string;
}

/**
 * `run.json` 的持久化契约:快照元数据 —— 身份、快照级字段与版本元数据,
 * 不含任何逐 attempt 数据。快照开始时写入;收尾时补写 `completedAt`。
 * 字段规则与版本判定见 docs/feature/record/architecture.md「run.json」「版本与升级设计」。
 */
export interface RunMeta {
  /** 恒为 "niceeval.results";和 schemaVersion、producer 一起构成持久化契约,永不移动或改名。 */
  format: "niceeval.results";
  /** 结果格式版本;与读取器不同即视为不兼容,提示用 producer.version 对应的 niceeval 查看。 */
  schemaVersion: number;
  producer: Producer;
  /** 创建 Run 时生成的 UUID v4，目录改名或发布不改变它。 */
  runId: string;
  /** 权威的实验身份;实验目录名是它的清洗投影。 */
  experimentId: string;
  /** 实验运行配置(flags / runs / earlyExit / sandbox / timeoutMs / budget),快照内全部 attempt 共享。 */
  experiment?: ExperimentRunInfo;
  agent: string;
  model?: string;
  startedAt: string;
  /** 此次运行的配置身份；缺失时只与本 Run 自身可比。 */
  configHash?: string;
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
  facts?: globalThis.Record<string, string | number | boolean>;
  /**
   * Run 级共享工作的时间树:共享构建、共享制品准备、实验级 Hook。
   * offset 相对本 Run 的单调时钟起点;与 completedAt 同批在 Run 封口补写。
   */
  timings?: TimingActivity[];
  /**
   * 共享构建的 provenance,每个实际查询或构建过的 BuildKey 一条。
   * 时间只保存在 `timings`,本表经 `timingNodeId` 关联,不复制 duration。
   */
  sandboxBuilds?: SandboxBuildRecord[];
  /** 写入时刻该实验已知的 eval 并集 —— 残缺检测的分母随数据走(publish 自动补记,writer 可声明)。 */
  knownEvalIds?: string[];
  /** 项目名(来自 config.name),透传给 `niceeval view` 顶部 hero 显示。 */
  name?: LocalizedText;
}

/**
 * 回到证据的引用:快照目录(根相对)+ 快照内 attempt 目录(快照相对)。
 * 字段名(run / attempt)是 view 深链 `#/attempt/<run>/<attempt>` 的持久化路由契约,
 * 不随句柄改名;`run` 恒为两段(`<实验目录>/<快照目录>`),`attempt` 是 `<evalId 路径>/a<n>`,
 * 路由按「前两段 = 快照」解析。Reports 的 MetricCell.refs 用的是同一个身份。
 */
export interface AttemptRef {
  /** 根相对快照目录:`<experiment-dir>/<快照目录>`。 */
  run: string;
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
  run: Run;
  /**
   * 不透明的 Attempt 定位符(见 `locator.ts`);openRecord() 产出的 handle 恒会填这个字段
   * (result.json 里有就直接用,没有则按当前身份兜底算,见 open.ts 的回填逻辑)。可选只是为了
   * 不强制手工构造的 AttemptHandle(测试里的内存 fake)也必须带上——真实读取路径永远有值。
   */
  locator?: AttemptLocator;
  /**
   * locator 对应的来源身份。真实 openRecord() 句柄恒填；可选只为兼容手工构造的测试句柄。
   * carry 句柄会沿 artifactBase 指向原 attempt，而不是使用承载它的新 Run 身份。
   */
  locatorIdentity?: AttemptIdentity;
  /**
   * 携带条目投影:true = fingerprint 未变、上一轮终态结果合入本快照(`result.artifactBase`
   * 有值);false = 本快照那次运行真实执行。`startedAt` 为原执行时刻,不因携带而改写
   * (时效语义见 docs/feature/sample/library.md「时效:新执行与历史执行」)。
   */
  carried: boolean;
  /** artifact 是本地、借用历史 Run，还是其借用目标已丢失。 */
  evidenceState: "local" | "borrowed" | "dangling";
  /** 非零 Sandbox 命令的 stdout/stderr 证据(`commands.json`);没有非零命令时 null。 */
  commands(): Promise<CommandExitEvidence[] | null>;
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
export interface Run {
  runId: string;
  /** 权威身份(run.json 字段;实验目录名只是它的清洗投影)。 */
  experimentId: string;
  startedAt: string;
  configHash?: string;
  /** 缺失 = 未收尾(进程中断);已落盘 attempt 照常在下面读到。 */
  completedAt?: string;
  /** 快照级诊断;不与 attempt diagnostics 混合(见 RunMeta.diagnostics)。 */
  diagnostics?: DiagnosticRecord[];
  /** experiment 作用域上报的运行事实;不与 attempt 级 facts(attempt.result.facts)合并(见 RunMeta.facts)。 */
  facts?: globalThis.Record<string, string | number | boolean>;
  /** Run 级共享工作时间树(见 RunMeta.timings);缺失 = 本 Run 没有共享 activity 或第三方未写。 */
  timings?: TimingActivity[];
  /** 共享构建 provenance(见 RunMeta.sandboxBuilds)。 */
  sandboxBuilds?: SandboxBuildRecord[];
  /** 本快照自己的 agent。 */
  agent: string;
  model?: string;
  /** 实验运行配置(flags / runs / budget …),快照内全部 attempt 共享。 */
  experiment?: ExperimentRunInfo;
  /** 谁写的这份结果(niceeval 或第三方 harness)。 */
  producer: Producer;
  /** 结果格式版本(能读进来的恒为当前版本;不兼容的在 unreadable)。 */
  schemaVersion: number;
  /** 项目名(来自 config.name),透传给 `niceeval view` 顶部 hero 显示。 */
  name?: LocalizedText;
  /** 每道题一项:{ id, attempts };残缺检测 / 逐题遍历从这里走。 */
  evals: Eval[];
  /** 全部 attempt 平铺(= evals 逐题展开),不关心题目边界的聚合消费用。 */
  attempts: AttemptHandle[];
  /** 快照目录的绝对路径(物理落盘就是快照本身,没有更低一层)。 */
  dir: string;
  /** 写入时刻该实验已知的 eval 并集(可选);publish 自动补记,writer.run() 也可声明。 */
  knownEvalIds?: string[];
}

/** 一个实验的全部历史:同一 experiment id 的历次快照归在一起。 */
export interface Experiment {
  id: string;
  /** 历次快照,最新在前。 */
  runs: Run[];
  /** 最新一次(= runs[0])。 */
  latestRun: Run;
  /** 已知 eval 并集 = 本地历史 ∪ 各快照携带的 knownEvalIds —— 残缺检测的分母。 */
  knownEvalIds: string[];
}

/** 目录扫描里读不了、但必须让调用方知道的落盘;无关 JSON 不记(静默忽略)。 */
export interface UnreadableRun {
  /** 落盘目录的绝对路径。 */
  dir: string;
  /**
   * incompatible:schemaVersion 与读取器不同(不解析、不迁移、不降级);
   * malformed:run.json(或历史版本的 summary.json)是坏数据;
   * incomplete:有 attempt 落盘、没有 run.json —— 快照目录建好但元数据没写完的极小窗口,
   * 或人为删文件。run.json 是收尾事实,reader 不读无 run.json 的目录;
   * 已完成的 attempt 留在盘上供手工排查。
   */
  reason: "incompatible" | "malformed" | "incomplete";
  /** 那份结果声明的 schemaVersion(incomplete 没有 run.json,自然缺失)。 */
  schemaVersion?: number;
  /** 完整的 producer(name + version):只有 name === "niceeval" 才能拼 npx 提示,第三方如实报名字。 */
  producer?: Producer;
  /** malformed:一句英文诊断。 */
  detail?: string;
}

/** openRecord 的返回:experiments 分层;unreadable 不静默丢。 */
export interface Record {
  /**
   * 结果根目录的绝对路径(`openRecord()` 入参解析后的原样值,不论传入的是结果根、
   * 实验目录、快照目录还是某个 run.json)。`unreadable-run` 警告拼版本化
   * `command`(`npx niceeval@<version> show --record <root>`)时取它。
   */
  root: string;
  /** 每个实验一项,挂着自己的全部历史(id 字典序)。 */
  experiments: Experiment[];
  unreadable: UnreadableRun[];
}

/**
 * 一个实验的覆盖事实:已知 eval 并集(分母)与当前口径下没有任何 attempt 的题。
 * `missing` 永远被算出来,不静默——渲染面把它转成覆盖占位行
 * (见 docs/feature/sample/library.md「选择快照」「时效:新执行与历史执行」)。
 *
 * `run` 是该 Experiment 的锚点 Run:零 attempt 的 Eval 按 agent / model / flags 归组时
 * 读它。`latestRunSample` 锚 latest Run;`currentSample` 锚确定该 Experiment 可比性
 * 配置的 latest Run。锚点不必出现在 `Sample.runs`(全缺口 Experiment 仍有锚点)。
 */
export interface SampleCoverage {
  experimentId: string;
  /** 该 Experiment 的分组锚点 Run(agent / model / experiment 配置的事实来源)。 */
  run: Run;
  /** 分母:本地历史 ∪ 各快照携带的 knownEvalIds,交命令行范围(与 `exp.knownEvalIds` 同源)。 */
  knownEvalIds: string[];
  /** 当前配置下没有物理 Attempt 的题，以及帮助用户决定下一步的缺口原因。 */
  missing: SampleMissing[];
}

/** 当前结果缺口；原因只解释下一步，不构成另一种结果状态。 */
export interface SampleMissing {
  evalId: string;
  /** 从未有物理 Attempt，或有历史结果但没有一条能代表当前配置。 */
  reason: "never-run" | "previous-result";
  /** 最近一条旧结果的审计入口；它不参与当前统计，也不保证一定满足 accept 资格。 */
  previous?: {
    locator: AttemptLocator;
    verdict: Verdict;
    startedAt: string;
  };
}

/**
 * Sample(范围):选出的快照 + 口径 + 已按口径物化的 attempt 全集 + 挑选警告。
 * 渲染与否在消费方,但缺口永远被算出来。下游(Reports 计算函数、publish)收
 * `Sample | readonly Run[]`;手工挑的裸数组没有挑选过程,自然没有 issues 可带,也如实。
 */
export interface Sample {
  /** 这份 Sample 的口径,字面写在数据上。 */
  mode: "latest-run" | "current";
  runs: Run[];
  /**
   * 按口径物化的 attempt 全集:消费 attempts 就自动正确,不需要自己 flatten runs,
   * 也就不可能算错口径。官方计算函数同样只消费它。
   */
  attempts: AttemptHandle[];
  /** 同一总体内按 locator 去重的完整历史 attempt。 */
  historyAttempts: AttemptHandle[];
  /** 逐实验的覆盖事实(见 `SampleCoverage`);手工挑的 `Run[]` 没有挑选过程,不带覆盖事实。 */
  coverage: SampleCoverage[];
  issues: SampleIssue[];
  /**
   * 只删不换:返回新 Sample,快照删减,attempts、coverage 与 issues 随之同步修剪 ——
   * experimentId 不在幸存快照中的条目丢弃,非实验作用域的警告保留。
   * 「换成上一个完整快照」这类替换式重挑不给方法,回 exp.runs 自己挑。
   */
  scope(options: { experiments?: string | string[]; evals?: string | string[] }): Sample;
  filter(predicate: (attempt: AttemptHandle) => boolean): Sample;
}

/**
 * 挑选警告:每种带 kind、可判断的结构化字段和渲染好的英文 message;能用一条命令直接推进的
 * kind 同时带 `command`(已替换真实 id,复制即跑)。kind 是契约的一部分,全集与触发条件见
 * docs/feature/record/library.md「警告 kind 全集」——三种都是**定位不到任何一行**的完整性
 * 事实:覆盖缺口(行级事实,见 `SampleCoverage`)与时效(`AttemptHandle.carried` 投影的行级
 * 属性)不在这个联合里。
 */
export type SampleIssue =
  | {
      /** 选中快照缺 completedAt(进程中断,未收尾);已落盘 attempt 照常读出,警告提示集合可能不完整。 */
      code: "unfinished-run";
      experimentId: string;
      startedAt: string;
      /** 该快照目录的绝对路径。 */
      dir: string;
    }
  | {
      code: "dangling-evidence";
      experimentId: string;
      evalId: string;
      attempt: number;
      artifactBase: string;
      artifacts: readonly string[];
    }
  | {
      /**
       * 扫描结果根遇到的不可读快照:schema 不兼容、JSON 损坏 / 必需字段错误(malformed)、
       * attempt 已写入但缺 `run.json`(incomplete)。该快照被跳过,不挡其余结果
       * (非 niceeval JSON 静默忽略,不产生这个 kind)。非实验作用域(没有 experimentId
       * 字段) —— `Sample.filter()` 修剪时恒保留。
       */
      code: "unreadable-run";
      /** 该快照目录的绝对路径。 */
      dir: string;
      /** 与 `UnreadableRun.reason` 同一取值集,原样透传。 */
      reason: "incompatible" | "malformed" | "incomplete";
      producer?: Producer;
    };

/** `dedupeAttempts` 的警告不属于 SampleIssue，因为它只在手工去重时产生。 */
export interface DedupeWarning {
  kind: "missing-startedAt";
  experimentId: string;
  evalId: string;
  message: string;
}
