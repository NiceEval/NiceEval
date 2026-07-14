// runner 域类型:结果 / 汇总 / reporter 契约,eval / experiment / config 定义,
// 以及调度器的编排类型(AgentRun / RunOptions / Attempt)。

import type { Cleanup, JsonValue, LocalizedText, SourceArtifact } from "../shared/types.ts";
import type { O11ySummary, StreamEvent, TraceSpan, Usage } from "../o11y/types.ts";
import type { Agent, AgentSetupManifest } from "../agents/types.ts";
import type { Sandbox, SandboxOption } from "../sandbox/types.ts";
import type { AssertionResult, DiffData, JudgeConfig, Verdict } from "../scoring/types.ts";
import type { TestContext } from "../context/types.ts";
import type { CapturedEvalSource } from "./eval-source.ts";
import type { AttemptLocator } from "../results/locator.ts";

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

/**
 * runner 在错误 / 诊断发生时已经打开的 lifecycle operation —— `AttemptError` 与
 * `DiagnosticRecord` 的 `operation` 都从这个封闭集合取,调用方不能自填(见
 * docs/feature/results/architecture.md「result.json」)。这套 operation 名是结果语义的稳定 scope,
 * 与用于 dashboard 展示的 `AttemptPhase` 是两套词汇:phase 是 UI 投影(`sandbox-provision`),
 * operation 是落盘归属(`sandbox.provision`)。
 */
export type LifecycleOperationName =
  | "sandbox.provision"
  | "sandbox.setup"
  | "sandbox.teardown"
  | "sandbox.stop"
  | "workspace.prepare"
  | "workspace.diff"
  | "eval.setup"
  | "eval.run"
  | "agent.setup"
  | "agent.run"
  | "agent.teardown"
  | "telemetry.configure"
  | "telemetry.collect"
  | "scoring.evaluate";

/**
 * 使 attempt 无法正常完成的唯一致命执行错误(见 docs/feature/results/architecture.md 的
 * `AttemptError`)。`message` 是人可读的一层原因(不拼整份 SDK response);完整 stack 单放
 * `stack`,`niceeval show @locator` 首页展开、终端即时反馈不整段打印。榜单只显示 `message`。
 */
export interface AttemptError {
  /** 稳定、可供 CI/Agent 分支处理的机器码;未知异常使用 `"unexpected-error"`。 */
  code: string;
  /** 人可读的一层原因,不拼接整份 SDK response。 */
  message: string;
  /** runner 在错误发生时已经打开的 lifecycle operation。 */
  operation: LifecycleOperationName;
  /** 原异常有 stack 时保留,供 show 展开;终端即时反馈不整段打印。 */
  stack?: string;
  /** 下层 SDK/OS 错误的有限摘要。 */
  cause?: { name?: string; code?: string; message: string };
}

/**
 * 不一定改变 verdict、但运行后仍需回顾的有界诊断(见 docs/feature/results/architecture.md 的
 * `DiagnosticRecord`)。`level` 表达消息严重度,不是 verdict 的别名 —— passed / failed / errored
 * 任一 verdict 都可以带 cleanup / teardown 诊断。与运行级的 `DiagnosticNotice` 不同,这条挂在单个
 * attempt 结果上、随 `result.json` 落盘。
 */
export interface DiagnosticRecord {
  code: string;
  level: "warning" | "error";
  message: string;
  operation: LifecycleOperationName;
  data?: Readonly<Record<string, JsonValue>>;
  /** 相同 dedupeKey 折叠后的出现次数;省略等于 1。 */
  count?: number;
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
  /**
   * 不透明的 Attempt 定位符(`@` 前缀短确定性编码,见 `src/results/locator.ts` 的 AttemptLocator),
   * 由 {experimentId, 快照 startedAt, evalId, attempt} 身份元组派生。非携带条目由 writer 在落盘时
   * 算出;携带条目(`--resume` 合入)原样复制上一轮的值,从不重算——原快照的 startedAt 已经不在
   * 当前快照里,重算会算出不同的字符串,详见 writer.ts 对携带分支的说明。省略时读取面按当前
   * 已知身份兜底算出(第三方 harness 未实现 locator 时的降级,不保证跨 --resume 稳定)。
   */
  locator?: string;
  durationMs: number;
  assertions: AssertionResult[];
  usage?: Usage;
  estimatedCostUSD?: number;
  /** 使 attempt 进入 `errored` 的唯一致命执行错误(结构化);榜单显示 `error.message` 一层原因。 */
  error?: AttemptError;
  /** 本 attempt 的诊断(与 verdict 独立);teardown / cleanup 失败等挂在这里,不改判定。 */
  diagnostics?: readonly DiagnosticRecord[];
  skipReason?: string;
  events?: StreamEvent[];
  /** test 引用到的 eval 源码(按 loc 收集),供 view 渲染 github-diff 式代码视图。 */
  sources?: SourceArtifact[];
  o11y?: O11ySummary;
  /** agent 经 OpenTelemetry 导出的运行追踪(有 tracing 能力且收到 span 时)。 */
  trace?: TraceSpan[];
  /** 本 attempt 的 agent setup 实际装了什么(Skill / native plugin / MCP / Python plugin);不参与评分。 */
  agentSetup?: AgentSetupManifest;
  diff?: DiffData;
  rawTranscript?: string;
  /** 携带条目(--resume 合入)专用:artifact 目录(相对结果根目录),指向原快照里的落盘。 */
  artifactBase?: string;
  hasTrace?: boolean;
  hasEvents?: boolean;
  hasSources?: boolean;
}

/** `snapshot.json` 的格式标记;把 niceeval 报告和其它工具的同名文件区分开。 */
export const RESULTS_FORMAT = "niceeval.results";
/**
 * 结果格式版本,只在破坏兼容读取时递增;读取器只认相同版本。见 docs/feature/results/architecture.md。
 * `5`(见 memory 的 attempt-locator-and-source-dedup 条目)= result.json 新增 `locator` 字段;
 * `sources.json` 从逐 attempt 内联全量内容改为「attempt 级引用 + 快照级 `sources/<sha256>.json`
 * 去重仓库」,`AttemptHandle.sources()` 的公开返回形状不变(仍是 `SourceArtifact[] | null`)。
 * `6` = `error` 从自由字符串改为结构化 `AttemptError`(lifecycle operation / code / message + 可选
 * stack / cause),并新增有界 `diagnostics`(`DiagnosticRecord[]`)。旧版快照按格式规则整份判为
 * 不兼容并在扫描时列为占位条目,不迁移不降级。
 */
export const RESULTS_SCHEMA_VERSION = 6;

/** 一次运行的纯运行时内存聚合(reporter 契约用);落盘格式契约在 niceeval/results 的 SnapshotMeta / AttemptRecord,见 docs/feature/results/architecture.md。 */
export interface RunSummary {
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
  /**
   * 本次 invocation 的快照身份锚点(ISO 时间戳),在调度任何 attempt 前确定。fresh
   * `EvalResult.locator` 编码进去的 `snapshotStartedAt`(见 `results/locator.ts` 的
   * `AttemptIdentity`)与 Artifacts writer 写进 `snapshot.json` 的 `startedAt` 共用
   * 同一个值 —— 不同 experiment 在同一次 invocation 内共享它也不会碰撞(locator 身份
   * 还含 experimentId)。`runEvals()` 恒在 `onRunStart` 触发前把它填进这里,这是它
   * 从 run.ts 传给 Artifacts 等 reporter 的唯一途径;省略只出现在测试/第三方手写
   * `RunShape` 的直调场景。见 docs/feature/experiments/cli.md「Locator 必须在
   * result 发布前确定」。
   */
  snapshotStartedAt?: string;
}

export interface Reporter {
  onEvent?(event: ReporterEvent): void | Promise<void>;
  onRunStart?(evals: { id: string }[], agent: Agent, shape?: RunShape): void | Promise<void>;
  onEvalComplete?(result: EvalResult): void | Promise<void>;
  onRunComplete?(summary: RunSummary): void | Promise<void>;
}

/**
 * 内部 reporter 注册项:CLI/runner 给每个 `Reporter` 实例附上「叫什么名字」「失败是否致命」
 * 两条元数据,不改变用户实现 `Reporter` 的公共形状——`Reporter` 接口本身不变,用户只需要实现
 * 上面那四个回调,从不需要知道 `ReporterRegistration` 的存在。`name` 是
 * `reportReporterError()` / `DiagnosticNotice.key` 里 `reporter-error:<name>` 的稳定标识:
 * 同一个 reporter 反复失败折叠成一条诊断、`count` 递增,不同 reporter 各自一条,由这个字段的
 * 取值决定,不是「在哪个回调阶段失败」(onRunStart/onEvalComplete/…)决定——后者只作为
 * 诊断消息里的次要上下文,不参与去重身份。
 *
 * `required` 语义(见 docs/feature/experiments/cli.md「运行完成状态不只看 verdict 计数」):
 * - 默认 Artifacts reporter、CLI 显式 `--json` / `--junit`:`required: true`——它们的产物是
 *   agent/CI 读取权威结果的唯一入口,写失败必须让 `RunCompletion` 判红、CI 退出码非零。
 * - 用户 `Config.reporters` / `EvalDef.reporters`:`required: false`——失败只折成一条
 *   diagnostic,不影响 completion,也不阻断其它 reporter 收尾或后续 attempt。
 *
 * `target` 是可选的落盘路径(如 `--json`/`--junit` 指定的文件),纯展示 / 排障用途,不参与判定。
 */
export interface ReporterRegistration {
  reporter: Reporter;
  name: string;
  required: boolean;
  target?: string;
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
  /**
   * discovery 时捕获的规范化源码(归一化文本 + 项目相对路径 + SHA-256),见 `eval-source.ts`。
   * 同一文件里多个 eval(数组默认导出)共享同一份引用——哈希与内容天然相同,不重复读盘。
   */
  source: CapturedEvalSource;
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
 * 无 experiment 时退回 agent/model。现有 live display 以它(拼 evalId)作行聚合 key,
 * 两处必须同源(改这里的格式要同步核对 live.ts 的 key 计算,见 memory 的
 * live-who-key-mismatch-freezes-rows —— 上一次格式改动漏改 live.ts 自己手写的两处曾冻结整表)。
 *
 * 这是展示 label,不是 identity —— 两个不同的 (evalId, attempt) 可能巧合算出同一个 who
 * (同 experiment 同 eval 的第 2 次重试与另一条 eval 的第 1 次重试,展示上都叫同一个 basename)。
 * 反馈系统新的事件/状态(见上面 `AttemptRef` / `AttemptKey` / `encodeAttemptKey`)一律用
 * `{experimentId, evalId, attempt}` 做 identity/Map key,`who` 只作为 `ActiveAttempt.who`
 * 之类的展示字段附着,不参与去重或查找 —— 把展示 label 错当成 identity key 曾经是 live 表格
 * 两个真实 bug 的根因(另见 memory 的 live-rows-fold-experiment-variants)。
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
  /**
   * 已注册的 reporter,携带 name/required 元数据(见 `ReporterRegistration`)。这是内部编排
   * 通道——调用方(今天只有 `cli.ts`)按来源(默认 artifacts / 显式 --json·--junit / 用户
   * `Config.reporters`)把裸 `Reporter` 各自包一层元数据后传进来;eval 级 `EvalDef.reporters`
   * 不经过这里,由 `runEvals()` 自己按 `scopeReporter()` 包装、统一记作 `required: false`
   *(见 run.ts 的 scopedSets 处理)。
   */
  reporters: ReporterRegistration[];
  maxConcurrency: number;
  signal?: AbortSignal;
  /** 上次运行的结果。verdict 为 passed/failed 的 (experimentId, evalId) 组合跳过重跑,结果直接合入本次汇总。 */
  priorResults?: EvalResult[];
  /**
   * 预算好的携入计划(见 fingerprint.ts 的 planCarry)。cli.ts 为了让 live 表格提前知道
   * 哪些行会被携入,必须在构建 liveRows 之前算一次;传进来后 runEvals 直接复用,不重算
   * 一遍(否则两处各自算一次,不仅重复 I/O,还留下"两边判断可能不一致"的隐患)。
   * 省略时 runEvals 自己算(测试直调等场景)。
   */
  carryPlan?: import("./fingerprint.ts").CarryPlan;
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

// ───────────────────────── 反馈 profile / 事件 / reducer 状态 ─────────────────────────
// `niceeval exp` 的 human / agent / ci 反馈模型(见 docs/feature/experiments/cli.md)。
// 本节只定义类型 + 纯 reducer 需要的输入输出契约;profile renderer、terminal coordinator、
// runner 侧的实际事件发射均由后续阶段实现 —— 这里先把事件形状和状态形状钉死,后续阶段
// 不需要重新设计事件联合类型。

/** 三种最终反馈 profile。`--output auto` 只是 CLI flag 的输入值,解析后必然落在这三者之一。 */
export type OutputProfile = "human" | "agent" | "ci";

/**
 * Attempt 的正式生命周期阶段,runner 把自己驱动的固定顺序投影成这个闭集合枚举
 *(见 docs/feature/experiments/cli.md「Attempt 阶段」)。没有对应 hook/配置的步骤直接跳过,
 * 不产生空阶段;不是 adapter / sandbox provider / 用户 hook 可以自行设置的公共字段
 *(那个更大的 per-owner operation scope API 不在本阶段范围内)。
 *
 * `waiting for a slot` 是 attempt 开始前的调度态,不属于这个枚举;
 * `passed` / `failed` / `errored` / `reused` / `early-exit` / `budget-unstarted` 是阶段结束后的
 * outcome,同样不塞进这里。
 */
export type AttemptPhase =
  | "sandbox-provision"
  | "sandbox-setup"
  | "workspace-setup"
  | "eval-setup"
  | "agent-setup"
  | "telemetry-setup"
  | "running"
  | "diff"
  | "scoring"
  | "trace"
  | "teardown";

/**
 * 反馈系统里一次 attempt 的稳定身份:reducer 用它做 active map 的 key、事件的关联字段。
 * 只含调度身份三元组 —— 不含 agent/model/展示 label(那是 `who`,来自 `runWho()`,
 * 见该函数注释:展示 label 不能当 identity key 用,folding 两个不同 config 到同一个 key
 * 曾经就是 live 表格两个真实 bug 的根因),也不含 `AttemptLocator` 需要的
 * `snapshotStartedAt`(那是落盘身份,由 `results/locator.ts` 的 `AttemptIdentity` 独立管理;
 * 完成/failure 事件在 locator 确定后直接携带派生好的 `AttemptLocator` 字符串,反馈层
 * 不重新推导身份 —— 两个同名概念的 identity 类型故意不同名,以免和落盘身份互相看错)。
 */
export interface AttemptRef {
  /** 未挂靠 experiment 时为 undefined(直接指定 agent/model 跑,不经过 experiment);不用空字符串占位。 */
  experimentId?: string;
  evalId: string;
  /** 0-indexed,与 `EvalResult.attempt` / `AttemptLocator` 的 attempt 同一口径。 */
  attempt: number;
}

/** `AttemptRef` 的确定性字符串编码,只作 `RunFeedbackState.active` 的 Map key 使用 ——
 *  不是展示文本(那是 `who`),也不是 `AttemptLocator`(那需要额外的 `snapshotStartedAt`)。 */
export type AttemptKey = string & { readonly __brand: "AttemptKey" };

/** 由 `AttemptRef` 派生 `AttemptKey`;同一身份永远编码出同一个 key。 */
export function encodeAttemptKey(ref: AttemptRef): AttemptKey {
  return `${ref.experimentId ?? ""}|${ref.evalId}|${ref.attempt}` as AttemptKey;
}

/**
 * dashboard 当前可见的一个 active slot。`phase` 是正式状态,`detail` 只是该 phase 下的次要文本
 *(如 `running` 阶段的 `tool: shell` / `turn 2`)—— 两者是两个字段,不把 adapter 的 raw progress
 * string 直接当状态用;phase 变化时 `detail` 清空(旧阶段的次要文本不该残留到新阶段)。
 */
export interface ActiveAttempt {
  identity: AttemptRef;
  /** 展示 label,等价 `runWho()` 的结果;渲染要用,但绝不作为 identity/key。 */
  who: string;
  phase: AttemptPhase;
  /** 进入当前 phase 的墙钟时间(epoch ms),用于渲染阶段耗时;每次 phase 变化都会更新。 */
  phaseStartedAt: number;
  detail?: string;
}

/**
 * 一次失败/错误的永久通知:human 撤下 dashboard 后追加一行、agent/ci 立即追加一行,都读它。
 * 字段全部结构化(locator / identity / verdict / phase 都是具名字段),profile renderer 不需要
 * 解析 `reason` 之外的任何文本就能拼出机器可读的输出。
 */
export interface FailureNotice {
  at: number;
  locator: AttemptLocator;
  identity: AttemptRef;
  who: string;
  verdict: "failed" | "errored";
  /** 一层可行动摘要(gate 断言名、error 消息……),不是完整 stack/transcript;详情走 `niceeval show`。 */
  reason: string;
  /** 失败发生时所在的阶段(如 `sandbox-provision`);框架层错误(如 timeout)可能没有明确阶段。 */
  phase?: AttemptPhase;
}

/**
 * 去重后的诊断通知(warning/error):相同 `key` 的诊断只保留一条,`count` 累加受影响次数
 *(见 docs/feature/experiments/cli.md「什么动态更新,什么逐条追加」的去重规则)。
 * `data` 携带结构化字段(如 budget 的 experimentId/spent/unstarted),agent/ci 直接读取,
 * 不解析 `message`(`message` 只是 human 展示用的一句话)。
 */
export interface DiagnosticNotice {
  at: number;
  key: string;
  severity: "warning" | "error";
  message: string;
  /** 相同 key 累计出现的次数,由 reducer 去重时递增。 */
  count: number;
  identity?: AttemptRef;
  data?: Readonly<Record<string, JsonValue>>;
}

/** 运行完整性结论,独立于 verdict 计数。CI 退出码不能只看 failed/errored ——
 *  budget 未覆盖全部计划、用户中断、required reporter 失败都必须让 completion 非「complete」。 */
export type CompletionStatus = "complete" | "incomplete" | "interrupted";

/** 一个 reporter 收尾失败的记录;`required` 区分它是否让 completion 判红(见 ReporterRegistration)。 */
export interface ReporterError {
  reporter: string;
  required: boolean;
  message: string;
}

export interface RunCompletion {
  status: CompletionStatus;
  /** budget 耗尽导致未派发的 attempt 数;不含首过即停省略的次数(见 `earlyExitUnstarted`)。 */
  unstarted: number;
  /** 首过即停在已知 verdict 下主动省略的计划次数 —— 这是「省下的重复验证」,不是「未完整覆盖」。 */
  earlyExitUnstarted: number;
  reporterErrors: readonly ReporterError[];
}

/**
 * 事件 → 状态的纯 reducer 产出(见 `src/runner/feedback/reducer.ts`)。所有计数、active map、
 * cost 累计、failure/diagnostic 去重都只在 reducer 里算一次;三种 profile 的 renderer 只读取
 * 这份状态,不各自维护第二份推导。
 *
 * `total = reused + running + queued + completed` 在处理完每一个事件之后都成立,是 reducer 的
 * 不变量(见 reducer.test.ts 的表驱动用例,每一步都断言,不只在流程末尾断言一次)。
 */
export interface RunFeedbackState {
  total: number;
  reused: number;
  running: number;
  queued: number;
  completed: number;
  elapsedMs: number;
  estimatedCostUSD?: number;
  active: ReadonlyMap<AttemptKey, ActiveAttempt>;
  failures: readonly FailureNotice[];
  diagnostics: readonly DiagnosticNotice[];
}

/** 一次 run 的初始计划,携带 carry/reuse 明细(按 experiment 分组的已复用 eval id 清单)。 */
export interface RunFeedbackPlan {
  shape: RunShape;
  /** 携入(carry)结果数,直接计入 `RunFeedbackState.reused`,不需要重新调度。 */
  reused: number;
  /** 按 experiment 分组的携入 eval 清单,供 human 摘要打印「哪些被复用」。 */
  reusedByExperiment: readonly { experimentId: string; evalIds: readonly string[] }[];
}

/**
 * 只影响 dashboard 当前帧、reducer 不为它保留历史的事件:新值使旧值失去意义,所以覆盖而不是
 * 追加(见 docs/feature/experiments/cli.md「什么动态更新,什么逐条追加」的判断标准)。
 * `attempt:early-exit` 同样折进这一组 —— 它不打印永久行,只把已知 verdict 的省略次数收进
 * `completed`(见 reducer 实现)。
 */
export type AttemptLifecycleEvent =
  | { type: "attempt:queued"; at: number; identity: AttemptRef; who: string }
  | { type: "attempt:start"; at: number; identity: AttemptRef; who: string; phase: AttemptPhase }
  | { type: "attempt:phase"; at: number; identity: AttemptRef; phase: AttemptPhase }
  | { type: "attempt:progress"; at: number; identity: AttemptRef; detail: string }
  | {
      type: "attempt:complete";
      at: number;
      identity: AttemptRef;
      who: string;
      verdict: Verdict;
      estimatedCostUSD?: number;
    }
  | { type: "attempt:early-exit"; at: number; identity: AttemptRef; who: string };

/**
 * 运行级时钟 tick:唯一允许更新 `RunFeedbackState.elapsedMs` 的事件,由 coordinator 的定时器产出
 *(见 plan 的可注入 `FeedbackIO` clock)。reducer 保持纯函数,不自己读 `Date.now()`,elapsedMs
 * 因此只能通过事件携带的值前进 —— 这也让 reducer 测试可以喂任意 elapsed 值,不必真的等待。
 */
export interface FeedbackTickEvent {
  type: "tick";
  at: number;
  elapsedMs: number;
}

/**
 * 永久事件:human 撤下 dashboard 后追加一行、agent 按 envelope 追加、ci 按 stdout 事件追加,
 * 一旦发生就不会被后续状态覆盖掉(与上面按当前帧覆盖的 `AttemptLifecycleEvent` 相对)。
 * 字段全部结构化,profile renderer 不解析 `message` 之外的任何文本、不解析 i18n 字符串。
 */
export type DurableFeedbackEvent =
  | { type: "plan"; at: number; plan: RunFeedbackPlan }
  | {
      type: "failure";
      at: number;
      locator: AttemptLocator;
      identity: AttemptRef;
      who: string;
      verdict: "failed" | "errored";
      reason: string;
      phase?: AttemptPhase;
    }
  | {
      type: "diagnostic";
      at: number;
      key: string;
      severity: "warning" | "error";
      message: string;
      identity?: AttemptRef;
      data?: Readonly<Record<string, JsonValue>>;
    }
  /**
   * emitter 对每一个因 budget 到顶而不派发的 attempt 各发一次(与 `attempt:early-exit` 同构,
   * 见 reducer 实现);`unstarted` 是 emitter 自己记的、发出这条时的累计未派发数,写进
   * `DiagnosticNotice.data` 供 agent/ci 直接读取,不是 reducer 用来计算「这次要挪多少」的输入
   *(reducer 只按事件触发次数折算,保持纯函数不需要额外记住上一次的值)。
   */
  | { type: "budget-exhausted"; at: number; experimentId: string; spent: number; unstarted: number }
  | { type: "interrupted"; at: number }
  | { type: "reporter-error"; at: number; reporter: string; required: boolean; message: string }
  | { type: "summary"; at: number; summary: RunSummary; completion: RunCompletion }
  | {
      type: "saved";
      at: number;
      /** 本次 invocation 实际落盘的快照结果路径。不含 `--json`/`--junit` 聚合文件——那两个由
       *  `json`/`junit` 两个独立字段单独携带,而不是塞进这个数组后靠猜文件后缀去反推「哪一个
       *  是聚合报告、哪些是快照目录」;CI 的 result 收尾需要把 `json=`/`junit=`/`snapshots=`
       *  打成三条独立的行(见 docs/feature/experiments/cli.md「CI 怎么用」的字面例子),
       *  结构化字段让它不需要解析路径字符串就能做到。 */
      paths: readonly string[];
      /** 实际写出的 `--json` 聚合报告路径。未传 `--json`,或写入失败(见 required reporter
       *  语义),都省略这个字段——省略表示「不打印这一行」,不是打印一个空路径。 */
      json?: string;
      /** 实际写出的 `--junit` 聚合报告路径,语义同 `json`。 */
      junit?: string;
    };

/**
 * runner → feedback coordinator 的内部事件通道,与公共 `Reporter` / `ReporterEvent` 分开:
 * profile renderer 只消费这里的具名字段,不解析 `ReporterEvent` 里的 i18n 文案或表格列宽
 *(见 docs/feature/experiments/cli.md「输出流和落盘节奏」)。
 */
export type RunFeedbackEvent = AttemptLifecycleEvent | FeedbackTickEvent | DurableFeedbackEvent;
