// runner 域类型:结果 / 汇总 / reporter 契约,eval / experiment / config 定义,
// 以及调度器的编排类型(AgentRun / RunOptions / Attempt)。

import type { Cleanup, LocalizedText, SourceArtifact } from "../shared/types.ts";
import type { O11ySummary, StreamEvent, TraceSpan, Usage } from "../o11y/types.ts";
import type { Agent } from "../agents/types.ts";
import type { Sandbox, SandboxOption } from "../sandbox/types.ts";
import type { AssertionResult, DiffData, JudgeConfig, Verdict } from "../scoring/types.ts";
import type { TestContext } from "../context/types.ts";

// ───────────────────────── 结果 / 报告 ─────────────────────────

export interface ExperimentRunInfo {
  id?: string;
  flags?: Record<string, unknown>;
  runs?: number;
  earlyExit?: boolean;
  sandbox?: string;
  timeoutMs?: number;
  budget?: number;
}

export interface EvalResult {
  id: string;
  description?: string;
  experimentId?: string;
  experiment?: ExperimentRunInfo;
  agent: string;
  model?: string;
  verdict: Verdict;
  fingerprint?: string;
  attempt: number;
  /** 本 attempt 开始的墙钟时刻(ISO);view 按 eval 粒度展示「何时跑的」。 */
  startedAt?: string;
  durationMs: number;
  assertions: AssertionResult[];
  usage?: Usage;
  estimatedCostUSD?: number;
  error?: string;
  skipReason?: string;
  events?: StreamEvent[];
  /** test 引用到的 eval 源码(按 loc 收集),供 view 渲染 github-diff 式代码视图。 */
  sources?: SourceArtifact[];
  o11y?: O11ySummary;
  /** agent 经 OpenTelemetry 导出的运行追踪(有 tracing 能力且收到 span 时)。 */
  trace?: TraceSpan[];
  diff?: DiffData;
  rawTranscript?: string;
  // ── 拆分工件的引用(Artifacts 报告器写 summary.json 时填;view 按需懒加载)──
  /** 本 attempt 工件目录(相对 run 根),下有 events/trace/o11y/diff.json。 */
  artifactsDir?: string;
  /** 工件目录(相对结果根,供前端 fetch 与懒加载回退);view 的 loader 注入,--resume 携带条目落盘时保留。 */
  artifactBase?: string;
  /** 工件目录的绝对路径;历史字段,当前读取面不再注入。 */
  artifactAbsBase?: string;
  hasTrace?: boolean;
  hasEvents?: boolean;
  hasSources?: boolean;
}

/** `summary.json` 的格式标记;把 niceeval 报告和其它工具的同名文件区分开。 */
export const RESULTS_FORMAT = "niceeval.results";
/** 结果格式版本,只在破坏兼容读取时递增;读取器只认相同版本,缺失按 1。见 docs/results-format.md。 */
export const RESULTS_SCHEMA_VERSION = 3;

export interface RunSummary {
  /** 恒为 "niceeval.results";和 schemaVersion、producer 一起构成持久化契约,永不移动或改名。 */
  format?: typeof RESULTS_FORMAT;
  /** 结果格式版本;与读取器不同即视为不兼容,提示用 producer.version 对应的 niceeval 查看。 */
  schemaVersion?: number;
  /** 写这份报告的工具:niceeval 自己,或经 niceeval/results 写入面转换的第三方 harness。
   *  name === "niceeval" 时 version 用于拼 `npx niceeval@<version> view` 提示;其它 name 如实报出。 */
  producer?: { name: string; version?: string; commit?: string };
  /** 项目名(来自 config.name),透传给 `niceeval view` 顶部 hero 显示。 */
  name?: LocalizedText;
  agent: string;
  model?: string;
  startedAt: string;
  completedAt: string;
  passed: number;
  /** 断言不通过的数量;不包含 errored。 */
  failed: number;
  skipped: number;
  /** 环境、超时、adapter、agent runtime 等执行错误数量;与 failed 互斥。 */
  errored: number;
  durationMs: number;
  usage?: Usage;
  estimatedCostUSD?: number;
  results: EvalResult[];
  outputDir?: string;
  /** 快照级元数据,按 experiment 键(缺 experimentId 时为 "<agent>/<model>" 合成键)存放:
   *  startedAt 只在与顶层 startedAt 不同(一个 run 装多份不同时刻的快照)时需要;
   *  knownEvalIds 是写入时刻该实验已知的 eval 并集(copySnapshots 自动补记,writer.snapshot 可声明)。
   *  可选新增字段,不递增 schemaVersion(docs/results-format.md 版本规则)。 */
  snapshots?: Record<string, { startedAt?: string; knownEvalIds?: string[] }>;
}

/** onRunStart 的运行规模:去重后 eval 数 × 配置(agent×model×flags)数 → 总运行(attempt)数。 */
export interface RunShape {
  /** 去重后实际要跑的 eval 数(= evals.length)。 */
  evals: number;
  /** (agent, model, flags) 配置组合数;compare 多 agent 时 > 1。 */
  configs: number;
  /** 总 attempt 数(evals × configs × runs);逐行输出与汇总计数都按它。 */
  totalRuns: number;
  /** 本次运行实际生效的全局并发数(flag/env/config/sandbox 默认值解析后的结果);
   *  实验级 maxConcurrency 只在该实验内部限流,不改这个全局值。 */
  maxConcurrency: number;
}

export interface Reporter {
  onEvent?(event: ReporterEvent): void | Promise<void>;
  onRunStart?(evals: { id: string }[], agent: Agent, shape?: RunShape): void | Promise<void>;
  onEvalComplete?(result: EvalResult): void | Promise<void>;
  onRunComplete?(summary: RunSummary): void | Promise<void>;
}

export type ReporterEvent =
  | { type: "run:start"; evals: { id: string }[]; agent: Agent; shape: RunShape }
  | { type: "eval:start"; eval: { id: string }; agent: Agent; model?: string; attempt: number; experimentId?: string }
  | { type: "eval:complete"; result: EvalResult }
  | { type: "run:earlyExit"; evalId: string; experimentId?: string }
  | { type: "run:budgetExceeded"; budget: number; spent: number }
  | { type: "run:saved"; summary: RunSummary }
  | { type: "run:summary"; summary: RunSummary };

// ───────────────────────── eval / experiment / config 定义 ─────────────────────────

export interface EvalDef {
  /** 路径推导,定义里禁止手写。 */
  id?: string;
  /** 一句话描述,展示在 `niceeval list` 和 view 里;纯说明,不影响调度或打分。 */
  description?: string;
  /** 标签,供 CLI `--tag` 过滤和 view 分类;与 id 前缀过滤是两套独立的筛选维度。 */
  tags?: string[];
  /** 覆盖项目级 Config.judge,只对这一个 eval 生效(如换个更贵的评审模型)。 */
  judge?: JudgeConfig;
  /** 覆盖 / 追加项目级 Config.reporters,只对这一个 eval 生效。 */
  reporters?: Reporter[];
  /** 覆盖项目级 / CLI 的单次 attempt 超时(毫秒),只对这一个 eval 生效。 */
  timeoutMs?: number;
  /** 任意附加元数据,原样透传进 EvalResult,不参与调度或打分;供自定义 reporter 消费。 */
  metadata?: Record<string, unknown>;
  /**
   * eval 级预置:拿到沙箱(已上传 workspace + git 基线 + 装好依赖前)。
   * 默认命令以非 root 跑(agent 的自然环境);装系统依赖时给 `runCommand` 传 `{ root: true }`
   * (如 `runCommand("apt-get", ["install", …], { root: true })`),跨 provider 语义一致。
   */
  setup?: (sandbox: Sandbox) => Promise<void | Cleanup> | void | Cleanup;
  /** eval 主体:拿到 TestContext,驱动对话 / 沙箱操作并就地断言。 */
  test(t: TestContext): Promise<void> | void;
}

/** 内部:发现后带上 id 的 eval。 */
export interface DiscoveredEval extends EvalDef {
  id: string;
  /** 定义文件所在目录(解析相对 workspace 用)。 */
  baseDir: string;
  /** 定义文件绝对路径,用于内容指纹缓存。 */
  sourcePath: string;
}

export interface ExperimentDef {
  /** 路径推导,定义里禁止手写(defineExperiment 会拒绝显式传入)。 */
  id?: string;
  /** 一句话描述,展示在 view / CLI 里;纯说明,不影响调度或打分。 */
  description?: string;
  /**
   * 必填:这个实验跑哪个 agent(defineSandboxAgent / defineAgent 的产物)。运行配置的
   * agent 归属完全由这里决定——EvalDef.agent 不参与(见其字段注释)。
   */
  agent: Agent;
  /** 单个模型(agent 留空时实验决定);省略=用 agent 原生默认。跨模型对比写多个实验文件,别用数组。 */
  model?: string;
  /** 模型推理努力程度(如 "low"/"medium"/"high",取值由具体模型/adapter 决定);省略=用 agent 原生默认。经 ctx.reasoningEffort 透给 adapter 与 eval。 */
  reasoningEffort?: string;
  /** 实验条件(A/B 里的 feature flag),由实验文件声明;经 ctx.flags 透传给 adapter、t.flags 暴露给 eval。 */
  flags?: Record<string, unknown>;
  /** 同一 eval 重复跑几次(结果各计一条 attempt);省略/CLI `--runs` 覆盖时默认 1。 */
  runs?: number;
  /** 一次重复(runs > 1)里某次 attempt 失败后是否跳过剩余重复;省略默认 true(提前退出省钱)。 */
  earlyExit?: boolean;
  /** 这个实验覆盖哪些 eval:"*" 全部、字符串数组按 id 前缀、或自定义谓词;省略等价于 "*"。 */
  evals?: "*" | string[] | ((id: string) => boolean);
  /** 覆盖项目级 / CLI 的单次 attempt 超时(毫秒),只对这个实验生效。 */
  timeoutMs?: number;
  /** 覆盖项目级 Config.sandbox,只对这个实验生效。 */
  sandbox?: SandboxOption;
  /**
   * 本实验的花费上限(USD)。调度器按「已花 + 在飞预估」的护栏口径逼近上限时限流,
   * 累计花费到顶后跳过这个实验剩下未起飞的 attempt 并上报一次 `run:budgetExceeded`
   * (已在飞的 attempt 仍会跑完)。
   */
  budget?: number;
  /**
   * 本实验自己的并发上限:调度器只对这个实验的 attempt 限流,同批其它实验不受影响,
   * 仍按全局并发(CLI / env / config / 沙箱默认)跑。用于串行化有共享状态的实验
   * (如跨 eval 累积记忆:`maxConcurrency: 1` 保证 attempt 按 eval 顺序一个个跑),
   * 或给撞 provider 限额的实验单独降速。
   */
  maxConcurrency?: number;
}

export interface DiscoveredExperiment extends ExperimentDef {
  id: string;
  group: string;
}

export interface Config {
  /**
   * 项目名,显示在 `niceeval view` 顶部 hero(`<h1>`),省略则回退到通用标题。
   * 可传字符串,或按 locale 提供多语言(如 `{ en: "...", "zh-CN": "..." }`),随 view 语言切换。
   */
  name?: LocalizedText;
  /** 项目级默认沙箱 provider(docker / vercel / e2b / custom);experiment 可覆盖。 */
  sandbox?: SandboxOption;
  /** 上传进沙箱的工作区根目录,省略则用项目根;eval 的 sandbox 视图从这里起步。 */
  workspace?: string;
  /** 项目级默认 judge 配置(model / baseUrl / apiKeyEnv);EvalDef.judge 可按 eval 覆盖。 */
  judge?: JudgeConfig;
  /** 项目级默认 reporter 列表(如落盘 / 上传结果);EvalDef.reporters 会与它合并。 */
  reporters?: Reporter[];
  /** 项目级默认并发上限;CLI flag / env / experiment 的同名设置优先级更高。 */
  maxConcurrency?: number;
  /** 项目级默认单次 attempt 超时(毫秒);CLI flag / experiment / EvalDef 的同名设置优先级更高。 */
  timeoutMs?: number;
  /**
   * OTLP 接收配置,niceeval 项目内唯一入口(不读 NICEEVAL_OTLP_* 环境变量)。
   * `port` 钉住接收端口(固定端口模式:长驻服务把 OTEL_EXPORTER_OTLP_ENDPOINT 一次性指到
   * http://localhost:<port>/v1/traces,跑多少次 eval 都不用改)。省略 = 每次运行动态分配
   * 临时端口(经 ctx.telemetry 交给 adapter)。代价:固定端口下同机同时只能跑一个 niceeval 进程,
   * 且该端口被别的进程占用时会报错——换一个空闲端口写回这里即可。
   * `host` 是报给 adapter 的接收端 hostname(而非监听地址,监听地址恒为 0.0.0.0):默认
   * "127.0.0.1";docker 沙箱型 tracing 需要 "host.docker.internal" 之类的场景,或配了隧道
   * 的远程接入,在这里覆盖。
   */
  telemetry?: { host?: string; port?: number };
  /**
   * 内置价格表(`o11y/prices.json`)之上的用户覆盖 / 补充,按 model 查(见 Observability
   * · 用量与成本)。key 支持精确 model 名或 `provider/*` 通配(自托管/网关折扣按 provider 批量覆盖);
   * 精确 key 优先于通配。只在没有网关实测成本(`usage.costUSD`)时才会用到——实测优先于估算恒成立。
   */
  pricing?: Record<string, PriceOverride>;
}

/** 每百万 token 的美元单价;省略的桶退回 `inputPerMTok`(cache token 本质也是 input)。 */
export interface PriceOverride {
  /** 普通输入 token 单价。 */
  inputPerMTok: number;
  /** 输出 token 单价。 */
  outputPerMTok: number;
  /** cache 命中(读)token 单价,省略则退回 inputPerMTok。 */
  cacheReadPerMTok?: number;
  /** cache 写入 token 单价,省略则退回 inputPerMTok。 */
  cacheWritePerMTok?: number;
}

// ───────────────────────── 调度编排 ─────────────────────────

/**
 * 进度行 / 日志里标识一个 run 配置的短名。有 experiment 时用其 basename(唯一,
 * 能区分同 agent 同 model 的实验变体,如 xxx 与 xxx--agents-md;与汇总表口径一致);
 * 无 experiment 时退回 agent/model。live display 以它作行聚合 key,两处必须同源。
 */
export function runWho(run: { agentName: string; model?: string; experimentId?: string }): string {
  if (run.experimentId) return run.experimentId.split("/").pop()!;
  return run.model ? `${run.agentName}/${run.model}` : run.agentName;
}

/** 一个 (agent, model, flags) 的运行配置 —— 由 CLI / 实验展开。 */
export interface AgentRun {
  agent: Agent;
  model?: string;
  reasoningEffort?: string;
  flags: Record<string, unknown>;
  runs: number;
  earlyExit: boolean;
  sandbox?: SandboxOption;
  timeoutMs?: number;
  budget?: number;
  evalFilter: (id: string) => boolean;
  experimentId?: string;
  strict?: boolean;
  /** 本配置自己的并发上限(来自 ExperimentDef.maxConcurrency):调度器为它单建信号量,
   *  attempt 先过这道闸再占全局并发位;省略则只受全局并发约束。 */
  maxConcurrency?: number;
}

export interface RunOptions {
  config: Config;
  evals: DiscoveredEval[];
  agentRuns: AgentRun[];
  reporters: Reporter[];
  maxConcurrency: number;
  signal?: AbortSignal;
  /** TTY live display 的进度回调;设置后 attempt 的 log 消息路由到它而不是 stderr。 */
  onProgress?: (evalId: string, who: string, msg: string) => void;
  /** 上次运行的结果。verdict === "passed" 的 (experimentId, evalId) 组合跳过重跑,结果直接合入本次汇总。 */
  priorResults?: EvalResult[];
  /**
   * 非沙箱 tracing agent 的 run 级共享 OTLP 接收池(runEvals 创建并回收;
   * 每个 agent 一个 receiver,attempt 之间共享 —— 被测应用是长驻进程,端点不能随 attempt 换)。
   */
  otelPool?: import("../o11y/otlp/turn-otel.ts").OtelReceiverPool;
}

/** 调度器内部的一次尝试:eval × run × 第几轮。 */
export interface Attempt {
  evalDef: DiscoveredEval;
  run: AgentRun;
  attempt: number;
  /** agent+model+evalId,用于首过即停。 */
  key: string;
  fingerprint: string;
}
