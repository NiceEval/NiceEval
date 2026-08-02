// runner 域类型:结果 / 汇总 / reporter 契约,eval / experiment / config 定义,
// 以及调度器的编排类型(AgentRun / RunOptions / Attempt)。

import type { JsonValue, LocalizedText, ScopedFeedback, SourceArtifact, Verdict } from "../shared/types.ts";
import type { AttemptFailureClassifier } from "../shared/failure-class.ts";
import type { O11ySummary, StreamEvent, TraceSpan, Usage } from "../o11y/types.ts";
import type { Agent, AgentSetupManifest } from "../agents/types.ts";
import type { SandboxLayer } from "../sandbox/layer.ts";
import type { LinkedRunPlan } from "../sandbox/plan.ts";
import type { BuildKey } from "../sandbox/identity.ts";
import type {
  AssertionResult,
  DiffArtifact,
  JudgeConfig,
  PrimaryAssertionSummary,
  ScoreEntry,
} from "../assertions/types.ts";
import type { ScoreTestContext, TestContext } from "../context/types.ts";
import type { CapturedEvalSource } from "./eval-source.ts";
import type { AttemptLocator } from "../record/locator.ts";
import type { EvalManifest, RunManifests } from "../record/manifest.ts";
// report 公共子路径是独立预编译单元；两种 Definition 使用不可构造的结构品牌，因此这里可以
// 对源码类型编程，同时与下游从 "niceeval/report" 取得的 dist 声明兼容，也不会形成干净构建的
// source → host → dist 自举环。
import type { ReportDefinition } from "../report/definition/report.ts";
import type { ThemeDefinition } from "../report/theme.ts";
import type {
  ExperimentStateDefinition,
  ExperimentStateProjection,
  StateTransferActivity,
  StateWindowRecord,
} from "../state/types.ts";
import type { PlannedExperimentState } from "../state/plan.ts";

// ───────────────────────── 结果 / 报告 ─────────────────────────

/**
 * 解析后运行配置的**穷尽可序列化投影**——记录这次运行实际生效的值,不是原始 `ExperimentDef`
 * (函数与 hooks 无法忠实落盘,存「原样」只能存谎)。`model` 与 `agent` 只在快照顶层存在,
 * 这里不复制(见 docs/feature/record/architecture.md「run.json」)。
 */
export interface ExperimentRunInfo {
  description?: string;
  reasoningEffort?: string;
  flags?: globalThis.Record<string, JsonValue>;
  /** 报告归类标注(ExperimentDef.labels 原样投影);不透传运行时,不参与可比性配置。 */
  labels?: globalThis.Record<string, string | number>;
  attempts: number;
  earlyExit: boolean;
  timeoutMs?: number;
  budget?: number;
  maxConcurrency?: number;
  /** 本次运行解析后实际选中的 eval id 全集——evals 过滤器(含函数形式)的求值结果,不存过滤器本身。 */
  selectedEvalIds: string[];
  /** evals 过滤器的指纹(数组内容 / 函数体哈希),供「配置没变」判断;与 selectedEvalIds 一起取代原过滤器。 */
  evalFilterFingerprint?: string;
  /** Experiment SandboxLayer 的纯数据身份；Direct 也以 command-only 的完整身份记录。 */
  sandboxLayer: JsonValue;
  /** 每个已选择 Eval 的完整 pair-owned physical plan；Direct 也有显式投影。 */
  sandboxPlansByEval: globalThis.Record<string, JsonValue>;
  /** Sandbox 是否在同一次 Run 内复用。 */
  sandboxReuse?: boolean;
  /** State 的静态声明投影；callback 与动态 checkpoint 不落盘。 */
  state?: ExperimentStateProjection;
  /** strict 与 judge 是配置身份的一部分，供历史结果重算 configHash。 */
  strict?: boolean;
  /** 解析后的 Judge 执行身份；apiKeyEnv 是凭据选择器，不落盘。 */
  judge?: Pick<JudgeConfig, "model" | "baseUrl" | "timeoutMs">;
  /**
   * Agent Ensure 与精确配对 installer 的静态身份投影；按声明顺序完整落盘。
   * 实际 artifact digest/platform 属运行 provenance，不进入这里。
   */
  agentInstalls: JsonValue[];
}

export interface SandboxRunInfo {
  provider: string;
  params?: globalThis.Record<string, JsonValue>;
  fingerprint?: string;
}

/**
 * Runner 保留的 attempt 生命周期锚点——闭集,不是扩展点(见 docs/feature/record/architecture.md
 * 「两层时间模型」)。计时(`phases[].name`)、错误与诊断的 attempt 锚点(见 TimingOrigin)、
 * live 当前步骤都由 Runner 绑定这同一个闭集;author、Adapter 与 provider 不能新增成员。
 * 可扩展的工作计时走开放 activity key,不进本词表。
 */
export type LifecyclePhase =
  // 运行级(派发前至多一次,宿主机侧;仅错误归因)
  | "judge.precheck" // 判分预检;预检失败时是含 judge 断言的 eval 全部 attempt 的错误锚点
  // 实验级(整场一次,宿主机侧;仅错误/诊断归因)
  | "experiment.setup" // ExperimentDef.setup;setup 抛错时是本实验所有 attempt 的错误锚点
  | "experiment.teardown" // ExperimentDef.teardown;失败只产生运行级 diagnostic
  // 主链:从排队到 trace collect,覆盖到判定与主证据收集完成,按执行序
  | "sandbox.queue" // 等待并发信号量(调度等待,唯一不属于某个 owner 的成员)
  | "sandbox.create" // provider 物化沙箱实例(共享构建不在这里,它在 Run 级 activity)
  | "sandbox.prepare" // 两层作者 layer 的 prepare 链
  | "sandbox.prepare.eval" // 仅错误/诊断归因,不单列计时
  | "sandbox.prepare.experiment" // 仅错误/诊断归因,不单列计时
  | "agent.ensure" // Runner 的 probe → 缺失才 install → 同一 probe 复检
  | "state.load" // State checkpoint 载入；Stateless 与 reuse window 中间 Attempt 不产生
  | "workspace.baseline" // 变更分类账锚点(runner 私有 git ledger 首笔 commit)
  | "agent.setup" // Adapter runtime 配置 / 凭据 / state setup
  | "telemetry.configure" // tracing 出口配置
  | "eval.run" // 整段 test(t),含所有 send 与手工命令
  | "agent.run" // 嵌套在 eval.run 内:adapter send 期间打开;只用于错误/诊断归因,不单列计时条目
  | "workspace.diff" // 从分类账折叠 agent 归因增量
  | "assertions.evaluate" // 断言 finalize + 判定,含 judge 调用
  | "telemetry.collect" // OTLP receiver settle / collect
  // 收尾段:无论主链成败都执行,不计入 durationMs 口径,按执行序
  | "agent.teardown"
  | "state.save" // State checkpoint 回存；按 saveOn 决定执行或 skip
  | "sandbox.cleanup" // 两层作者 layer 已登记 cleanup 全局 LIFO
  | "sandbox.suspend" // 留存提交后 provider 把现场转入休眠(docker stop / e2b pause)
  | "sandbox.stop"; // provider 销毁沙箱;与 sandbox.suspend 同一 attempt 互斥

/**
 * 开放的工作计时节点,Run 与 attempt 共用同一形状(见 docs/feature/record/architecture.md
 * 「TimingActivity」)。`key` 是非空、以 `.` 分段的稳定机器 key;未知 key 原样保留并可通用展示。
 * offset 相对所在时钟域(RunMeta.timings 或单个 attempt)的单调时钟起点。
 */
export interface TimingActivity {
  /** 所在时钟域内唯一,供 origin、provenance 与展示层稳定引用;不作为跨 Run 身份。 */
  id: string;
  /** ActivityKey;官方词表见 architecture.md,第三方用自己的命名空间。 */
  key: string;
  /** 采集端写入的有界、脱敏人读标签;展示层不解析它重建语义。 */
  label: string;
  /** 相对所在时钟域单调时钟起点的偏移。 */
  startOffsetMs: number;
  durationMs: number;
  failed?: true;
  children?: TimingActivity[];

  /** key = "agent.turn" 时存在;把 runner 的 send 墙钟包络与 trace.json 中同一轮的 spans 显式关联。 */
  sessionIndex?: number;
  turnIndex?: number;
  turnId?: string;
  traceId?: string;
  traceAttribution?: "traceparent" | "window" | "none";
  /** key = "agent.turn" 时存在,该轮 `Turn.usage` 落盘原样(有记录才写)。 */
  usage?: Usage;

  /** key = "sandbox.command" 时的有界脱敏摘要;环境变量值与 stdout/stderr 不进入时间树。 */
  command?: {
    display: string;
    exitCode?: number;
    /** 这条命令这次生效的时限与它来自哪一层;四层解析链一个上限都没声明时缺席。 */
    limit?: CommandLimitAttribution;
  };
}

/**
 * 一条命令生效的时限归属(词表单源在 docs/feature/sandbox/architecture.md
 * 「时限归属:attempt deadline 是唯一默认」)。命令节点带着它,读者才不用靠「停在整 1m 0s」
 * 这种巧合反推是谁掐断了命令。
 */
export interface CommandLimitAttribution {
  /**
   * 生效上限的来源层:`attempt-deadline` 是 attempt 自己的线(未显式传 `timeout` 的命令拿它的
   * 剩余量),`command-timeout` 是用户给这条命令显式传的 `timeout`,`provider-limit` 是 provider
   * 固有的会话上限——它在派发前就按环境约束报出来,attempt 层不会撞上,列在词表里是给读面认。
   */
  source: "attempt-deadline" | "command-timeout" | "provider-limit";
  /** 该层对这条命令实际生效的上限,毫秒(attempt deadline 记的是命令开始时的剩余量)。 */
  limitMs: number;
  /** 这条命令正是撞上这条线才失败的(非零退出与传输失败都不是)。 */
  timedOut?: true;
}

/**
 * 错误与诊断的归属(见 docs/feature/record/architecture.md「TimingOrigin」)。
 * attempt 支绑定 Runner 打开的生命周期锚点;run 支指向 RunMeta.timings 里的 activity。
 */
export type TimingOrigin =
  | {
      scope: "attempt";
      /** runner 在错误 / 诊断发生时已打开的生命周期锚点;producer 不能自行指定。 */
      phase: LifecyclePhase;
      /** 可选细化:锚点下具体的 activity(如失败的那条 sandbox.command)。 */
      timingNodeId?: string;
    }
  | {
      scope: "run";
      /** 指向 RunMeta.timings 里的 activity(如失败的 sandbox.build)。 */
      timingNodeId: string;
    };

/**
 * 共享构建的 provenance,每个实际查询或构建过的 BuildKey 一条。
 * 时间只保存在 `RunMeta.timings`,本表经 `timingNodeId` 关联,不复制 duration。
 */
export interface SandboxBuildRecord {
  buildKey: string;
  provider: string;
  status: "hit" | "built" | "failed" | "cancelled";
  /** 关联 RunMeta.timings 里对应的 sandbox.build activity。 */
  timingNodeId: string;
  locator?: JsonValue;
  inputs: JsonValue;
  error?: {
    code: string;
    message: string;
    cause?: { name?: string; code?: string; message: string };
  };
}

/** Runner 阶段计时,按执行顺序;只记录实际发生的阶段(见 docs/feature/record/architecture.md)。 */
export interface PhaseTiming {
  name: LifecyclePhase;
  /** 阶段耗时;失败阶段计到抛错或超时中断时。 */
  durationMs: number;
  /** 该阶段抛错或被超时中断。主链至多一条,其后无主链条目;收尾阶段各自独立标记,不改判定。 */
  failed?: true;
  /** 锚点内的 activity 子树,offset 相对本 attempt 的单调时钟起点。 */
  children?: TimingActivity[];
}

/**
 * `commands.json` 的一条落盘记录(见 docs/feature/record/architecture.md「commandsjson」):
 * 公开 `Sandbox.runCommand()` / `runShell()` 的最外层调用返回非零 `exitCode` 时,Runner 在
 * `CommandResult` 交还调用方**之前**登记的完整证据——Eval 后续即使只把 `.slice(-N)` 拼进
 * 异常消息,这份证据仍然完整。只记非零退出;成功命令的输出不进第二份 artifact,provider 内部
 * 实现步骤与 Agent 自己调用的 shell 不经过这层包装,不伪装成这里的命令。
 */
export interface FailedCommandEvidence {
  /** 与 `PhaseTiming.children` 中 `key === "sandbox.command"` 的 `TimingActivity.id` 相同,唯一关联失败命令卡与 `--timing` 的 command 节点。 */
  timingNodeId: string;
  /** runner 在命令返回那一刻已经打开的生命周期阶段。 */
  phase: LifecyclePhase;
  /** 与该 `TimingActivity.command.display` 同一份有界脱敏命令摘要;不含 env value。 */
  display: string;
  exitCode: number;
  /** 原样全量落盘:失败输出的起因常在前段、runner 的 summary 惯例在尾部,不做逐值截断。 */
  stdout: string;
  /** 原样全量落盘,同 `stdout`。 */
  stderr: string;
}

/** `commands.json` 的落盘形状。 */
export type CommandsArtifact = FailedCommandEvidence[];

/**
 * 使 attempt 无法正常完成的唯一致命执行错误(见 docs/feature/record/architecture.md 的
 * `AttemptError`)。`message` 是人可读的一层原因(不拼整份 SDK response);完整 stack 单放
 * `stack`,`niceeval show @locator` 首页展开、终端即时反馈不整段打印。默认报告只显示 `message`。
 */
export interface AttemptError {
  /** 稳定、可供 CI/Agent 分支处理的机器码;未知异常使用 `"unexpected-error"`。 */
  code: string;
  /** 人可读的一层原因,不拼接整份 SDK response。 */
  message: string;
  /**
   * 错误归属。attempt 内错误由 runner 绑定当时打开的生命周期锚点(attempt 形态);
   * attempt 开始前的共享构建失败引用 Run timing node(run 形态),不伪造 attempt 锚点。
   */
  origin: TimingOrigin;
  /** 原异常有 stack 时保留,供 show 展开;终端即时反馈不整段打印。 */
  stack?: string;
  /** 下层 SDK/OS 错误的有限摘要。 */
  cause?: { name?: string; code?: string; message: string };
  /**
   * 超时打断产生的 `errored` 专用:这次撞的是哪层时限、上限值多少、值从哪一层解析而来。
   * 三样一起落盘,报错行与 `show --timing` 照实印这三样;归属规则单源在
   * docs/feature/sandbox/architecture.md「时限归属:attempt deadline 是唯一默认」。
   */
  timeout?: TimeoutAttribution;
}

/** 一次超时的归属事实,由 runner 在把 attempt 转成 `errored` 时写下。 */
export interface TimeoutAttribution {
  /**
   * 触发层:`attempt-deadline` 是 attempt 自己的上限(沙箱内一切时限都从它派生),
   * `command-timeout` 是用户给单条命令显式传的 `timeout`。provider 固有的会话上限在派发前
   * 就按环境约束报出来(见 `assertDeadlineFitsProvider`),attempt 层不会撞上它。
   */
  trigger: "attempt-deadline" | "command-timeout";
  /** 该层实际生效的上限,毫秒。 */
  limitMs: number;
  /**
   * 值来自哪一层:`attempt-deadline` 取 `timeoutMs` 解析链四层之一,`command-timeout` 只有
   * 命令显式声明一个来源。
   */
  source: "flag" | "experiment" | "eval" | "config" | "command";
}

/**
 * 不一定改变 verdict、但运行后仍需回顾的有界诊断(见 docs/feature/record/architecture.md 的
 * `DiagnosticRecord`)。`level` 表达写入方观察到的运行影响,不是 verdict 的别名 ——
 * passed / failed / errored 任一 verdict 都可以带 cleanup / teardown 诊断。
 * 与运行级的 `DiagnosticNotice` 不同,这条挂在单个 attempt 结果或 RunMeta 上落盘。
 */
export interface DiagnosticRecord {
  code: string;
  level: "warning" | "error";
  /**
   * 诊断归属。attempt 诊断由 runner 绑定当时打开的锚点;Run 诊断可引用 Run timing node,
   * 也可只带 `experiment.teardown` 这类归因锚点;没有 timing 记录的第三方 producer 可省略。
   */
  origin?: TimingOrigin;
  /** 写入时观察到的原始有界描述;不包含修复动作或呈现文案。 */
  detail: string;
  /** 支撑 code 的结构化原始上下文。 */
  context?: Readonly<globalThis.Record<string, JsonValue>>;
  /** 相同 dedupeKey 折叠后的出现次数;省略等于 1。 */
  count?: number;
}

/**
 * `--accept` 跨过的一条具名差异(`EvalResult.carriedAccepting` 的成员)。
 * `selector` 与 CLI 上写下的那个字面量同一个词表,`from` / `to` 是有界值摘要;
 * 某一侧没有这个键(新增 / 删除)时该侧省略。
 */
export interface CarriedAcceptance {
  selector: string;
  from?: string;
  to?: string;
}

/** 自动重试吸收的一次物理 send 失败；不进入逻辑会话事件流。 */
export interface RetryAttemptRecord {
  sessionIndex: number;
  turnIndex: number;
  /** 同一逻辑 send 内从 0 开始；0 是首次发送。 */
  sendAttempt: number;
  startedAt: string;
  durationMs: number;
  failure: {
    type: "agent-send-failed";
    acceptance: "rejected";
    message: string;
    process?: { exitCode?: number; signal?: string };
  };
  classification: {
    retryable: true;
    scope: "attempt" | "eval" | "experiment";
    reason?: string;
  };
  events: StreamEvent[];
  usage?: Usage;
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
  /** 产出该结果时的 Run 级配置身份。 */
  configHash?: string;
  attempt: number;
  /** 本 attempt 开始的墙钟时刻(ISO);view 按 eval 粒度展示「何时跑的」。 */
  startedAt?: string;
  /**
   * 不透明的 Attempt 定位符(`@` 前缀短确定性编码,见 `src/record/locator.ts` 的 AttemptLocator),
   * 由 {runId, evalId, attempt} 身份元组派生。非携带条目由 writer 在落盘时算出;
   * 携带条目(`--resume` 合入)原样复制上一轮的值,从不按承载它的新 Run 重算。
   */
  locator?: string;
  /**
   * `locator` 的来源 Run 身份。niceeval writer 对 fresh 条目恒写；carry 与 publish 原样保留，
   * 使同一 attempt 在多份落盘中仍共享一个 locator 身份。旧记录缺失时 reader 会沿
   * `artifactBase` 回溯来源，无法回溯才退回当前 Run。
   */
  locatorRunId?: string;
  durationMs: number;
  /** 自 sandbox.create 起、排除并发排队和收尾的执行耗时；旧记录缺失时携带保守回退 durationMs。 */
  executionMs?: number;
  assertions: AssertionResult[];
  /**
   * 题型:`defineEval` → `"pass"`,`defineScoreEval` → `"points"`,定义期事实,与
   * `EvalDescriptor.evaluationKind` 同源。省略等价于 `"pass"`——兼容此字段引入前写入的落盘与未声明它的
   * 第三方 harness(见 docs/feature/record/architecture.md「result.json」)。
   */
  evaluationKind?: EvaluationKind;
  /**
   * `t.score(label, n)` 的直接给分记录,只在 `evaluationKind: "points"` 时出现;省略等价于空数组。
   * 与 `assertions[].points` 共同构成分数面(见 docs/feature/experiments/score-points.md)。
   */
  scoreEntries?: ScoreEntry[];
  /** 自动重试吸收的物理 send 失败，按发生顺序完整保留。 */
  retryAttempts?: RetryAttemptRecord[];
  usage?: Usage;
  estimatedCostUSD?: number;
  /** 使 attempt 进入 `errored` 的唯一致命执行错误(结构化);默认报告显示 `error.message` 一层原因。 */
  error?: AttemptError;
  /** 本 attempt 的诊断(与 verdict 独立);teardown / cleanup 失败等挂在这里,不改判定。 */
  diagnostics?: readonly DiagnosticRecord[];
  /**
   * sandbox hook / agent setup·send·teardown 经 `ctx.fact()` 上报的运行事实(同 attempt 内
   * 后写覆盖先写)。中性环境观测,不参与 verdict / 评分 / 指纹。见
   * docs/feature/record/architecture.md#facts运行事实。
   */
  facts?: globalThis.Record<string, string | number | boolean>;
  /** fresh State 的 transfer 活动；reuse Attempt 只引用 RunMeta.stateWindows 中的 windowId。 */
  state?: {
    windowId: string;
    load?: StateTransferActivity;
    save?: StateTransferActivity;
  };
  /** Runner 阶段计时,按执行顺序;只记录实际发生的阶段(见 docs/feature/record/architecture.md)。 */
  phases?: PhaseTiming[];
  skipReason?: string;
  events?: StreamEvent[];
  /** test 引用到的 eval 源码(按 loc 收集),供 view 渲染 github-diff 式代码视图。 */
  sources?: SourceArtifact[];
  o11y?: O11ySummary;
  /** agent 经 OpenTelemetry 导出的运行追踪(有 tracing 能力且收到 span 时)。 */
  trace?: TraceSpan[];
  /** 本 attempt 的 agent setup 实际装了什么(Skill / native plugin / MCP / Python plugin);不参与评分。 */
  agentSetup?: AgentSetupManifest;
  /**
   * attempt 级聚合的证据覆盖(各 turn 的最差值,unavailable < partial < complete)；必填。
   */
  evidenceCoverage: import("../agents/types.ts").EvidenceCoverage;
  /**
   * 沙箱型 attempt 的执行环境标识:provider 名与实例 id,用于关联 provider 侧日志与留存现场;
   * remote 型 agent 无此字段。`kept` 表示运行收尾时按 --keep-sandbox 留存了沙箱;之后的存活
   * 状态归 `niceeval sandbox list` 回答,本记录一次写成、不回写。
   */
  sandbox?: {
    provider: string;
    sandboxId: string;
    kept?: true;
    /** 本次 Attempt 使用了同一 Invocation 中已创建的 Sandbox。 */
    reused?: true;
    /** 本次 Invocation 内该 Sandbox 的稳定编号（从 1 开始）。 */
    reuseSandbox?: number;
    /** 此 Sandbox 承接的 Attempt 序号（从 1 开始）。 */
    reuseOrdinal?: number;
  };
  /** agent 归因增量:逐 send 窗口的 delta 序列(落盘为 diff.json;文件级视图由读取面派生)。 */
  diff?: DiffArtifact;
  /** 非零 Sandbox 命令的 stdout/stderr 证据(落盘为 commands.json);只记非零退出,见 `FailedCommandEvidence`。 */
  commands?: FailedCommandEvidence[];
  rawTranscript?: string;
  /** 携带条目(--resume 合入)专用:artifact 目录(相对结果根目录),指向原快照里的落盘。 */
  artifactBase?: string;
  /**
   * 仅经 `--accept` 授权跨过指纹差异携入时留下的审计痕迹:跨过的每条差异各一项。
   * 它让「这条是在哪个口径下被采信的」跟着结果走,不随 Run 翻篇丢失——授权是把风险显式交给
   * 人,报告因此会在新配置身份下混入旧配置跑出的结果,这个字段是事后追认这笔账的唯一线索。
   */
  carriedAccepting?: CarriedAcceptance[];
  /**
   * writer 实际写出的按需 artifact 词干列表(词表与全部横切属性单源在
   * docs/feature/record/architecture.md「证据 registry」,如 ["commands", "events", "sources"])。
   * 省略等价于空列表;携带条目原样携带。读取面的懒加载语义(缺失返回 null)独立成立,
   * 本字段只服务「不 stat 磁盘就知道有什么」的消费方。
   */
  artifacts?: string[];
}

/** `run.json` 的格式标记;把 niceeval 报告和其它工具的同名文件区分开。 */
export const RECORD_FORMAT = "niceeval.results";
/**
 * 结果格式版本,只在破坏兼容读取时递增;读取器只认相同版本。见 docs/feature/record/architecture.md。
 * `5`(见 memory 的 attempt-locator-and-source-dedup 条目)= result.json 新增 `locator` 字段;
 * `sources.json` 从逐 attempt 内联全量内容改为「attempt 级引用 + 快照级 `sources/<sha256>.json`
 * 去重仓库」,`AttemptHandle.sources()` 的公开返回形状不变(仍是 `SourceArtifact[] | null`)。
 * `6` = `error` 从自由字符串改为结构化 `AttemptError`,并新增有界 `diagnostics`。
 * `8` = 断言记录改 outcome 判别联合(groupPath/optional/expected/received/unavailable+reason);
 * 生命周期词表统一为 LifecyclePhase,`error.operation`/`diagnostics[].operation` 更名 `phase`;
 * 新增 `phases`(阶段计时)、`coverage`(证据覆盖聚合)、`sandbox`(执行环境标识)字段;
 * `ExperimentRunInfo` 改为解析后运行配置的穷尽投影(sandbox 从字符串改结构化投影对象);
 * `diff.json` 落逐窗口 delta 序列(DiffWindow[]);events/trace 的字符串值统一 256 KiB 截断
 * (结构化 `truncated` 标记);run.json 新增发布拷贝的 `publish` 标记。
 * `9` = `hasEvents`/`hasTrace`/`hasSources` 三个布尔删除,统一为 `artifacts`(writer 实际写出的
 * 按需 artifact 词干列表,单源在证据 registry);`O11ySummary` 删除 `usage`/`estimatedCostUSD`/
 * `durationMs`,正名为纯行为计数缓存,权威唯一在 `result.json` 的 `Usage`/`estimatedCostUSD`/
 * `durationMs`(见 memory 的 results-evidence-registry-ruling 条目)。
 * `12` = `diff.json` 的 `WindowChange.binary` 并入 `elided`。
 * `13` = 两层时间模型:`TimingNode` 封闭 kind 改为开放 key 的 `TimingActivity`;
 * `AttemptError.phase` / `DiagnosticRecord.phase` 改为 `origin: TimingOrigin`;
 * `RunMeta` 新增 `timings` 与 `sandboxBuilds`(见 memory 的 results-schema-version-history)。
 * `14` = result.json 的证据聚合字段从 `coverage` 破坏性重命名为 `evidenceCoverage`；
 * 六通道全部必填，不兼容旧 schema，也不做 normalize。
 * 旧版快照按格式规则整份判为不兼容并在扫描时列为占位条目,不迁移不降级。
 */
export const RECORD_SCHEMA_VERSION = 14;

/** 一次 Invocation 的纯运行时内存聚合(reporter 契约用);落盘格式契约在 niceeval/record 的 RunMeta / AttemptRecord,见 docs/feature/record/architecture.md。不携带顶层 `agent`/`model`——一次 Invocation 可能横跨多个 `(agent, model, flags)` 配置,塞一个顶层单值只能代表其中一份配置;需要时从 `results` 里逐条 `EvalResult.agent`/`.model` 去重派生。 */
export interface InvocationSummary {
  /** 项目名(来自 config.name),透传给 `niceeval view` 顶部 hero 显示。 */
  name?: LocalizedText;
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

/** onInvocationStart 的运行规模:去重后 eval 数 × 配置(agent×model×flags)数 → 总 attempt 数。 */
export interface InvocationShape {
  /** 去重后实际要跑的 eval 数(= evals.length)。 */
  evals: number;
  /** (agent, model, flags) 配置组合数;compare 多 agent 时 > 1。 */
  configs: number;
  /** 总 attempt 数(evals × configs × attempts);逐行输出与汇总计数都按它。 */
  totalAttempts: number;
  /** 本次运行实际生效的全局并发数(flag/config/sandbox 默认值解析后的结果);
   *  实验级 maxConcurrency 只在该实验内部限流,不改这个全局值。 */
  maxConcurrency: number;
  /**
   * 本次 Invocation 的快照时间(ISO 时间戳),在调度任何 attempt 前确定。
   * Artifacts writer 把它写入 `run.json.startedAt`；Attempt locator 另由持久化 Run 的
   * `runId` 与 `evalId` / attempt 下标派生，不把时间戳当身份。`runEvals()` 恒在
   * `onInvocationStart` 触发前填入该值；省略只出现在测试/第三方手写
   * `InvocationShape` 的直调场景。
   */
  snapshotStartedAt?: string;
  /**
   * 调度前为每个 Experiment 分配的持久化 Run 身份。Artifacts writer 必须把同一值写进
   * run.json；其它 reporter 可用它关联 plan 期 attempt locator 与最终 Run。
   */
  runIds?: ReadonlyMap<string, string>;
  /**
   * 本次规划期算出的指纹输入清单,按 experimentId 分组(evalId → 清单)。落盘面据此在建 Run
   * 目录时与 `run.json` 同批写出 `manifests.json`(见 record/writer.ts 的 `WriterOptions`)。
   * 与 `snapshotStartedAt` 同一条路径:runner 显式递给 reporter,不由落盘面自己猜。
   * 省略只出现在没有携带规划的直调场景。
   */
  manifests?: ReadonlyMap<string, RunManifests>;
}

export interface Reporter {
  onEvent?(event: ReporterEvent): void | Promise<void>;
  onInvocationStart?(evals: { id: string }[], shape?: InvocationShape): void | Promise<void>;
  onEvalComplete?(result: EvalResult): void | Promise<void>;
  onInvocationComplete?(summary: InvocationSummary): void | Promise<void>;
}

/**
 * 内部 reporter 注册项:CLI/runner 给每个 `Reporter` 实例附上「叫什么名字」「失败是否致命」
 * 两条元数据,不改变用户实现 `Reporter` 的公共形状——`Reporter` 接口本身不变,用户只需要实现
 * 上面那四个回调,从不需要知道 `ReporterRegistration` 的存在。`name` 是
 * `reportReporterError()` / `DiagnosticNotice.key` 里 `reporter-error:<name>` 的稳定标识:
 * 同一个 reporter 反复失败折叠成一条诊断、`count` 递增,不同 reporter 各自一条,由这个字段的
 * 取值决定,不是「在哪个回调阶段失败」(onInvocationStart/onEvalComplete/…)决定——后者只作为
 * 诊断消息里的次要上下文,不参与去重身份。
 *
 * `required` 语义(见 docs/feature/experiments/cli.md「运行完成状态不只看 verdict 计数」):
 * - 默认 Artifacts reporter、CLI 显式 `--json` / `--junit`:`required: true`——它们的产物是
 *   agent/CI 读取权威结果的唯一入口,写失败必须让 `InvocationCompletion` 判红、CI 退出码非零。
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
  | { type: "invocation:start"; evals: { id: string }[]; shape: InvocationShape }
  | { type: "eval:start"; eval: { id: string }; agent: Agent; model?: string; attempt: number; experimentId?: string }
  | { type: "eval:complete"; result: EvalResult }
  | { type: "invocation:earlyExit"; evalId: string; experimentId?: string }
  | { type: "invocation:budgetExceeded"; budget: number; spent: number }
  | { type: "invocation:saved"; summary: InvocationSummary }
  | { type: "invocation:summary"; summary: InvocationSummary }
  | {
      /**
       * 该 Experiment 的 teardown(若声明)完成之后、invocation:summary 之前触发,标记它
       * 已经彻底跑完;供内建 Artifacts 精确地在这一刻封口对应的 Run,不必等到整个
       * Invocation 结束才一次性封全部快照(见 docs/runner.md「Experiment 收尾协议」)。
       */
      type: "experiment:complete";
      experimentId: string;
      /** 该 Experiment 封口时刻,即它的 Run completedAt。 */
      completedAt: string;
      /** 本次携带合入(fingerprint 命中、未真实执行)的历史终态结果,收尾时一并落盘。 */
      carriedResults: EvalResult[];
      /** 该 Experiment 域产生的全部诊断;空集合传空数组,不省略字段。 */
      diagnostics: readonly DiagnosticRecord[];
      /** 该 Experiment 域经 `ctx.fact()` 累计的运行事实(experiment.setup / .teardown,含收尾自愈路径);省略 = 没有上报过。 */
      facts?: Readonly<globalThis.Record<string, string | number | boolean>>;
      /** Run 级共享工作时间树;与 completedAt 同批封口。省略 = 本 Run 没有共享 activity。 */
      timings?: readonly TimingActivity[];
      /** 共享构建 provenance;与 timings 经 timingNodeId 关联。省略 = 本 Run 没有查询或构建过 BuildKey。 */
      sandboxBuilds?: readonly SandboxBuildRecord[];
      /** reuse State window 的 load/save provenance。 */
      stateWindows?: readonly StateWindowRecord[];
      /** 项目名(来自 config.name),整次 Invocation 内所有 Experiment 共享同一个值。 */
      name?: LocalizedText;
    };

// ───────────────────────── eval / experiment / config 定义 ─────────────────────────

/**
 * 计分粒度题型:`defineEval` 恒 `"pass"`(通过制,一题一分,读通过率),`defineScoreEval` 恒
 * `"points"`(计分制,题内叠加挣分,读总分)。定义期事实,发现期从 `EvalDefinition.evaluationKind` 直接读取,
 * 不靠执行 `test()` 推断(见 docs/feature/experiments/score-points.md)。
 */
export type EvaluationKind = "pass" | "points";

/**
 * 作者输入里的派生字段用模块私有诊断类型，而不是 `never`：错误会说明字段属于哪个阶段。
 * 这些 symbol 不从包入口导出，因此包外没有可写入的同类值。
 */
const EVAL_CONTRACT_DIAGNOSTIC: unique symbol = Symbol("niceeval.evalContractDiagnostic");
const EVAL_DEFINITION: unique symbol = Symbol("niceeval.evalDefinition");
const EXPERIMENT_CONTRACT_DIAGNOSTIC: unique symbol = Symbol("niceeval.experimentContractDiagnostic");
const EXPERIMENT_DEFINITION: unique symbol = Symbol("niceeval.experimentDefinition");

type IdComesFromFilePath = {
  readonly [EVAL_CONTRACT_DIAGNOSTIC]: "id comes from the file path";
};

type EvaluationKindComesFromFactory = {
  readonly [EVAL_CONTRACT_DIAGNOSTIC]: "evaluationKind comes from defineEval / defineScoreEval";
};

type ConfigHashComesFromPlanning = {
  readonly [EVAL_CONTRACT_DIAGNOSTIC]: "configHash comes from run planning";
};

type ExperimentIdComesFromFilePath = {
  readonly [EXPERIMENT_CONTRACT_DIAGNOSTIC]: "id comes from the file path";
};

/** Eval 作者自行选择的字段；不包含路径、factory 和规划期事实。 */
export interface EvalAuthorFields {
  /** 一句话描述,展示在 `niceeval list` 和 view 里;纯说明,不影响调度或打分。 */
  description?: string;
  /** 标签,供 CLI `--tag` 过滤和 view 分类;与 id 前缀过滤是两套独立的筛选维度。 */
  tags?: string[];
  /**
   * 这道题贡献的 Sandbox 声明层。省略等价于空 command-only layer，不提供隐式 template。
   * 每个实际 Eval x Experiment 配对必须恰好一方提供 template-bearing layer。
   */
  sandbox?: SandboxLayer;
  /** 覆盖项目级 Config.judge,只对这一条评估用例生效(如换个更贵的评审模型)。 */
  judge?: JudgeConfig;
  /** 覆盖 / 追加项目级 Config.reporters,只对这一条评估用例生效。 */
  reporters?: Reporter[];
  /** 覆盖项目级 / CLI 的单次 attempt 超时(毫秒),只对这一条评估用例生效。 */
  timeoutMs?: number;
  /** 任意附加元数据,原样透传进 EvalResult,不参与调度或打分;供自定义 reporter 消费。 */
  metadata?: globalThis.Record<string, JsonValue>;
  /**
   * 调整 agent diff 的归因排除清单(仅 Sandbox 型;见 docs/feature/eval/README.md):两个数组都是
   * gitignore 风格 glob(workdir 相对)。默认排除 .git/node_modules/构建产物/包管理器缓存;
   * `ignore` 在默认清单上追加排除;`include` 优先级最高,把匹配路径显式加回。
   * 合成规则固定为「默认 ∪ ignore,再被 include 打洞」,清单在分类账锚点时冻结。
   */
  diff?: { include?: string[]; ignore?: string[] };
}

/** 作者输入：id、evaluationKind、configHash 都由后续阶段拥有。 */
export type EvalInput = EvalAuthorFields & {
  id?: IdComesFromFilePath;
  evaluationKind?: EvaluationKindComesFromFactory;
  configHash?: ConfigHashComesFromPlanning;
  test(t: TestContext): Promise<void> | void;
};

/** 计分制作者输入，只有 test 的上下文不同。 */
export type ScoreEvalInput = EvalAuthorFields & {
  id?: IdComesFromFilePath;
  evaluationKind?: EvaluationKindComesFromFactory;
  configHash?: ConfigHashComesFromPlanning;
  test(t: ScoreTestContext): Promise<void> | void;
};

/** Factory 完成默认归一后的 Eval 字段；Definition 不再复用作者输入的 optional 半状态。 */
export interface EvalDefinitionFields {
  readonly description?: string;
  readonly tags: readonly string[];
  /**
   * 保留“作者省略”和“作者显式声明空 layer”的来源差异：Direct Agent 只允许前者，
   * Sandbox link 则把省略侧视为 command-only。不能在 factory 阶段补成 sandboxLayer()。
   */
  readonly sandbox?: SandboxLayer;
  readonly judge?: JudgeConfig;
  readonly reporters: readonly Reporter[];
  readonly timeoutMs?: number;
  readonly metadata: Readonly<globalThis.Record<string, JsonValue>>;
  readonly diff: {
    readonly include: readonly string[];
    readonly ignore: readonly string[];
  };
}

/** Factory 产物保留精确 evaluationKind / context，并带模块私有品牌，不能由对象字面量伪造。 */
export interface EvalDefinition<Kind extends EvaluationKind, Context> extends EvalDefinitionFields {
  readonly evaluationKind: Kind;
  test(t: Context): Promise<void> | void;
  readonly [EVAL_DEFINITION]: true;
}

export type AnyEvalDefinition =
  | EvalDefinition<"pass", TestContext>
  | EvalDefinition<"points", ScoreTestContext>;

/** @internal 唯一写入 Definition 私有品牌的构造辅助；不从公共入口导出。 */
export function brandEvalDefinition<Kind extends EvaluationKind, Context>(
  value: EvalDefinitionFields & { evaluationKind: Kind; test(t: Context): Promise<void> | void },
): EvalDefinition<Kind, Context> {
  Object.defineProperty(value, EVAL_DEFINITION, { value: true });
  return Object.freeze(value) as EvalDefinition<Kind, Context>;
}

/** Definition 之后由 discovery 一次性补齐的不可变事实。 */
export interface DiscoveredEvalFacts {
  readonly id: string;
  /** 定义文件所在目录(解析相对 workspace 用)。 */
  readonly baseDir: string;
  /** 定义文件绝对路径,用于内容指纹缓存。 */
  readonly sourcePath: string;
  /** 发现期经 loadJson/loadYaml/loadText 读入的项目内数据文件(内容已在内存,指纹哈希内容)。 */
  readonly loaderDataPaths: readonly string[];
  /**
   * 发现期经 `loadCriteria` 登记的判据树文件(只登记不读入)。指纹按「项目根相对路径 ×
   * 内容流式哈希」进,与 `loaderDataPaths` 分两格是因为这一格的内容从不进内存。
   */
  readonly criteriaPaths: readonly string[];
  /**
   * 发现期经 `loadPrivate` 登记的永不上传路径(只登记不读入)。指纹口径与 `criteriaPaths`
   * 相同,分键存放——private 与 verifier 同属判据面,但不与 criteria 混成一张表。
   */
  readonly privatePaths: readonly string[];
  /**
   * discovery 时捕获的规范化源码(归一化文本 + 项目相对路径 + SHA-256),见 `eval-source.ts`。
   * 同一文件里多个 eval(数组默认导出)共享同一份引用——哈希与内容天然相同,不重复读盘。
   */
  readonly source: CapturedEvalSource;
}

/** discovery 保留 factory 的 evaluationKind 判别、私有品牌与对应 test context。 */
export type DiscoveredEval =
  | (EvalDefinition<"pass", TestContext> & DiscoveredEvalFacts)
  | (EvalDefinition<"points", ScoreTestContext> & DiscoveredEvalFacts);

/** @internal discovery 动态边界的品牌守卫；普通对象即使字段同形也不通过。 */
export function isEvalDefinition(value: unknown): value is AnyEvalDefinition {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { readonly [EVAL_DEFINITION]?: unknown })[EVAL_DEFINITION] === true
  );
}

/** @internal discovery 构造唯一的不可变阶段三值，不回写 Definition。 */
export function discoverEval(definition: AnyEvalDefinition, facts: DiscoveredEvalFacts): DiscoveredEval {
  const value = { ...definition, ...facts };
  Object.defineProperty(value, EVAL_DEFINITION, { value: true });
  return Object.freeze(value) as DiscoveredEval;
}

/**
 * `ExperimentDefinition.setup` / `teardown` 拿到的窄上下文。`progress` 更新本实验运行级
 * active 行的次要文本(短命状态,agent/ci profile 不逐条输出),`diagnostic` 进运行级永久
 * 事件流(实验级钩子不属于任何单个 attempt,诊断不落 attempt 的 `result.json`;setup 抛错
 * 以每条 attempt 的结构化 `error` 落盘,失败仍可回顾)。钩子的起止本身由 runner 直接发布为
 * 运行级反馈,不依赖这里的 `progress`(见 docs/feature/experiments/cli.md「实验级 Hook 的显示」)。
 */
export interface ExperimentHookContext extends ScopedFeedback {
  readonly experimentId: string;
  /** 本实验解析后实际选中的 eval id 全集(evals 过滤器的求值结果)。 */
  readonly selectedEvalIds: readonly string[];
  /** 用户中断(Ctrl+C / kill)时 abort;长启动的 setup 应观察它提前退出。 */
  readonly signal: AbortSignal;
  /**
   * 第三条反馈通道:上报整场实验的环境观测,与 `completedAt` 同批在快照封口补写进
   * `RunMeta.facts`。key 匹配 `[a-z0-9._-]{1,64}`,value 是标量;同 key 后写覆盖先写,
   * 非法 key 或非标量 value 抛错。不影响判定,不参与 verdict / 评分 / 指纹。形状与归属语义见
   * docs/feature/record/architecture.md#facts运行事实。`niceeval exp --teardown` 的独立收尾
   * 路径不派发 attempt、不落任何 Run,没有 `RunMeta.facts` 可写——该路径下这个方法仍然
   * 校验入参(非法 key / 非标量 value 照样抛错),校验通过后丢弃写入(no-op:诚实优于
   * 静默——非法调用照样报错、不被这条路径悄悄吞掉,但也不假装有地方落盘),见 cli.ts 的
   * `--teardown` 构造点。
   */
  fact(key: string, value: string | number | boolean): void;
}

/** Experiment 作者自行选择的字段；不包含路径 id 与 factory 品牌。 */
export interface ExperimentAuthorFields {
  /** 一句话描述,展示在 view / CLI 里;纯说明,不影响调度或打分。 */
  description?: string;
  /**
   * 必填:这个实验跑哪个 agent(defineSandboxAgent / defineDirectAgent 的产物)。运行配置的
   * agent 归属完全由这里决定——EvalDefinition 不声明 agent。
   */
  agent: Agent;
  /** 单个模型(agent 留空时实验决定);省略=用 agent 原生默认。跨模型对比写多个实验文件,别用数组。 */
  model?: string;
  /** 模型推理努力程度(如 "low"/"medium"/"high",取值由具体模型/adapter 决定);省略=用 agent 原生默认。经 ctx.reasoningEffort 透给 adapter 与 eval。 */
  reasoningEffort?: string;
  /**
   * 本实验的 Judge 执行配置。只覆盖 model / endpoint / credential selector / 调用预算，
   * rubric、材料、severity 与 threshold 仍由 Eval assertion 拥有。各字段按
   * Experiment → Eval → Config 解析。
   */
  judge?: JudgeConfig;
  /** 实验条件(A/B 里的 feature flag),由实验文件声明;必须是可 JSON 序列化的值
   *  (defineExperiment 解析时校验,非 JSON 直接报错),经 ctx.flags 透传给 adapter、
   *  t.flags 暴露给 eval,并原样进入结果快照的 ExperimentRunInfo.flags。 */
  flags?: globalThis.Record<string, JsonValue>;
  /**
   * 报告归类标注:实验在各对比轴上的坐标(如 `{ line: "codex", memory: "mempal" }`)。
   * 值域 string | number(解析时校验)。与 `flags` 的分界是「会不会改变 attempt 里发生的事」:
   * labels 不透传 ctx / t(agent 和 eval 看不见)、不参与可比性配置(改它不作废已有结果),
   * 只原样投影进快照的 `ExperimentRunInfo.labels` 供报告维度(`label()` / `numericLabel()`)
   * 分组。`line` 键被默认报告识别:组内任一实验声明了它,散点按线归类并连线。
   * 见 docs/feature/experiments/library.md「labels」。
   */
  labels?: globalThis.Record<string, string | number>;
  /** 同一 eval 重复跑几次(结果各计一条 attempt);省略/CLI `--attempts` 覆盖时默认 1。 */
  attempts?: number;
  /** 一次重复(attempts > 1)里某次 attempt 通过后是否跳过剩余重复;省略默认 false(`attempts` 跑满、测完整通过率),
   *  显式打开用于「只想知道能不能过」的省钱场景。 */
  earlyExit?: boolean;
  /**
   * 这个实验覆盖哪些 eval:`"*"` 全部、字符串数组按 id 前缀、或自定义谓词(逐条收到发现并扇出后的
   * 只读 `EvalDescriptor`,不暴露路径 / 执行字段);省略等价于 `"*"`。谓词对本次 invocation 的
   * 候选 eval 各求值一次,解析结果作为 `selectedEvalIds` 落进快照——不是运行时反复调用的过滤器
   * (见 docs/feature/eval/library.md「EvalDescriptor」、docs/feature/experiments/library.md
   * 「evals:遍历发现结果,自定义选择」)。
   */
  evals?: "*" | readonly string[] | ((e: EvalDescriptor) => boolean);
  /** 覆盖项目级 / CLI 的单次 attempt 超时(毫秒),只对这个实验生效。 */
  timeoutMs?: number;
  /**
   * 本实验贡献的 Sandbox 声明层。它与每条选中 Eval 的同名字段逐配对链接；
   * 每个配对恰好一方提供 template-bearing layer。
   */
  sandbox?: SandboxLayer;
  /** defineExperimentState() 的品牌化产物；State 只属于 Experiment。 */
  state?: ExperimentStateDefinition;
  /** 同一 Run 内复用沙箱；这种运行与历史携带双向隔离。 */
  sandboxReuse?: boolean;
  /**
   * 本实验的花费上限(USD)。调度器按「已完成 attempt 的实测花费」累计,到顶后跳过这个实验
   * 剩下未起飞的 attempt 并上报一次 `run:budgetExceeded`(已在飞的 attempt 仍会跑完)。
   */
  budget?: number;
  /**
   * 本实验自己的并发上限:调度器只对这个实验的 attempt 限流,同批其它实验不受影响,
   * 仍按全局并发(CLI / env / config / 沙箱默认)跑。用于串行化有共享状态的实验
   * (如跨 eval 累积记忆:`maxConcurrency: 1` 保证 attempt 按 eval 顺序一个个跑),
   * 或给撞 provider 限额的实验单独降速。名额与 attempt 同生命周期:从沙箱创建前一直握到
   * teardown 与沙箱销毁完成才归还,中途任何等待(含 turn 重试退避)都不松手——
   * `maxConcurrency: 1` 因此是严格的临界区,不会被同实验的下一个 attempt 提前闯入。
   */
  maxConcurrency?: number;
  /**
   * 本实验的失败分类器:识别以第三方错误形态浮出的自家共享基建死因(对自家隧道 host 的拒连
   * 一类),返回 `undefined` 表示「不认识,交给后续链路」。本实验任意 per-attempt 阶段的失败
   * 都会问到它;send 失败链上它排在 adapter 的 `classifySendFailure` 之前——按自家坐标过滤的
   * 特异性高于协议通用形状,两者同时认领时空间轴才赢得下来。分类器要快、纯、不抛错(抛错按
   * `undefined` 回落并被吞掉);只声明决策轴与 `reason` 词,重试与落闸策略归执行体。
   * 见 docs/feature/error-classification/library.md「实验 / eval 作者:声明死因的波及范围」。
   */
  classifyFailure?: AttemptFailureClassifier;
  /**
   * 实验级生命周期钩子对的 setup 侧:整场至多一次、宿主机侧,管「每实验一份、所有 attempt
   * 共享」的宿主机资源(隧道、mock server、license 租约)。本实验第一个通过派发许可的
   * attempt 触发(memoized,并发 attempt 等同一个结果;全部结果被 carry 携入时不执行)。
   * setup 不返回值;产物写模块级变量,`teardown` 与同文件 agent / sandbox 钩子从闭包读,
   * runner 不做值的中介。setup 抛错 → 本实验所有 attempt 记 `errored`
   * (code `"experiment-setup-failed"`、phase `"experiment.setup"`),同批其它实验不受影响。
   * 函数体不进 fingerprint,改了钩子逻辑用 `--force` 强制重跑。
   * 见 docs/feature/experiments/architecture.md「实验级生命周期」。
   */
  setup?: (ctx: ExperimentHookContext) => void | Promise<void>;
  /**
   * 实验级生命周期钩子对的 teardown 侧:本实验全部 attempt 收尾后执行(运行被中断也执行),
   * 当且仅当 setup 时点走到过——setup 抛错不豁免(半初始化现场同样要扫尾,teardown 对可能
   * 未赋值的闭包变量做防御),未声明 setup 不影响触发;一个 attempt 都不派发则跳过。
   * 抛错或超 30s 清理上限只记运行级 diagnostic(`experiment-teardown-failed`),不改判定。
   */
  teardown?: (ctx: ExperimentHookContext) => void | Promise<void>;
}

/** 作者输入：id 只能由发现阶段从文件路径推导。 */
export type ExperimentInput = ExperimentAuthorFields & {
  id?: ExperimentIdComesFromFilePath;
};

/** Factory 完成默认归一后的 Experiment 字段；无默认语义的 Hook/State 仍保持作者声明。 */
export interface ExperimentDefinition {
  readonly description?: string;
  readonly agent: Agent;
  readonly model?: string;
  readonly reasoningEffort?: string;
  readonly judge?: JudgeConfig;
  readonly flags: Readonly<globalThis.Record<string, JsonValue>>;
  readonly labels: Readonly<globalThis.Record<string, string | number>>;
  readonly attempts: number;
  readonly earlyExit: boolean;
  readonly evals: "*" | readonly string[] | ((e: EvalDescriptor) => boolean);
  readonly timeoutMs?: number;
  /** 省略本身是 link 阶段需要的来源事实，不能在 Definition 中归一成显式空 layer。 */
  readonly sandbox?: SandboxLayer;
  readonly state?: ExperimentStateDefinition;
  readonly sandboxReuse: boolean;
  readonly budget?: number;
  readonly maxConcurrency?: number;
  readonly classifyFailure?: AttemptFailureClassifier;
  readonly setup?: (ctx: ExperimentHookContext) => void | Promise<void>;
  readonly teardown?: (ctx: ExperimentHookContext) => void | Promise<void>;
  readonly [EXPERIMENT_DEFINITION]: true;
}

/** @internal 仅 defineExperiment 写入私有品牌。 */
export function brandExperimentDefinition(
  value: Omit<ExperimentDefinition, typeof EXPERIMENT_DEFINITION>,
): ExperimentDefinition {
  Object.defineProperty(value, EXPERIMENT_DEFINITION, { value: true });
  return Object.freeze(value) as ExperimentDefinition;
}

/** @internal discovery 只接受 defineExperiment 的原始产物，不做结构性兼容。 */
export function isExperimentDefinition(value: unknown): value is ExperimentDefinition {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { readonly [EXPERIMENT_DEFINITION]?: unknown })[EXPERIMENT_DEFINITION] === true
  );
}

/** @internal discovery 构造阶段三的不可变投影；不向 Definition 回写路径事实。 */
export function discoverExperiment(
  definition: ExperimentDefinition,
  source: { readonly id: string; readonly baseDir: string; readonly sourcePath: string },
): DiscoveredExperiment {
  const value = { ...definition, ...source };
  Object.defineProperty(value, EXPERIMENT_DEFINITION, { value: true });
  return Object.freeze(value) as DiscoveredExperiment;
}

/** 发现期运行形状：Definition 加入路径与来源；规划期 configHash 不在这里。 */
export interface DiscoveredExperiment extends ExperimentDefinition {
  readonly id: string;
  /** 定义文件所在目录；解析 Experiment layer 中的相对本地路径。 */
  readonly baseDir: string;
  /** 定义文件绝对路径；link 诊断标注声明来源。 */
  readonly sourcePath: string;
}

/**
 * 用户谓词(`ExperimentDefinition.evals`)能看到的唯一形状——发现并扇出后的显式白名单投影,不透传
 * `DiscoveredEval` 原对象(不暴露 `sourcePath` / `baseDir` / `test` / hooks 等内部路径与执行字段)。
 * `tags` 缺省为冻结空数组;`metadata` 原样引用作者声明的对象(至少浅冻结),供 `tags.includes(...)` /
 * `metadata.<key>` 判断(见 docs/feature/eval/library.md「EvalDescriptor」)。
 */
export interface EvalDescriptor {
  readonly id: string;
  readonly description?: string;
  readonly tags: readonly string[];
  /**
   * 计分粒度题型,`defineEval` → `"pass"`,`defineScoreEval` → `"points"`。定义期事实,
   * 每条发现出的 eval 上都有确定值。供 `ExperimentDefinition.evals` 谓词按题型过滤(见
   * docs/feature/experiments/score-points.md「横截面聚合:同型实验,各读各的」)。
   */
  readonly evaluationKind: EvaluationKind;
  readonly metadata?: Readonly<globalThis.Record<string, JsonValue>>;
}

export interface Config {
  /** view/show 的项目默认报告。 */
  report?: ReportDefinition;
  /** view 的项目默认主题。 */
  theme?: ThemeDefinition;
  /**
   * 项目名,显示在 `niceeval view` 顶部 hero(`<h1>`),省略则回退到通用标题。
   * 可传字符串,或按 locale 提供多语言(如 `{ en: "...", "zh-CN": "..." }`),随 view 语言切换。
   */
  name?: LocalizedText;
  /**
   * CLI 与运行时文案的界面语言(BCP 47,如 `"en"` / `"zh-CN"`);CI 里想让日志恒定一种语言就写这个。
   * 省略则按系统 locale(`LC_ALL` / `LC_MESSAGES` / `LANG`)判定,都没有时用 `zh-CN`。
   */
  locale?: string;
  /** 上传进 Sandbox 的工作区根目录,省略则用项目根;评估用例的 sandbox 视图从这里起步。 */
  workspace?: string;
  /** 项目级默认 judge 配置(model / baseUrl / apiKeyEnv);EvalDef.judge 可按评估用例覆盖。 */
  judge?: JudgeConfig;
  /** 项目级默认 reporter 列表(如落盘 / 上传结果);EvalDef.reporters 会与它合并。 */
  reporters?: Reporter[];
  /** 项目级默认并发上限;CLI flag / experiment 的同名设置优先级更高(没有环境变量层)。 */
  maxConcurrency?: number;
  /** 项目级默认单次 attempt 超时(毫秒);CLI flag / experiment / EvalDef 的同名设置优先级更高。 */
  timeoutMs?: number;
  /**
   * OTLP 接收配置,niceeval 项目内唯一入口(不读 NICEEVAL_OTLP_* 环境变量)。
   * `port` 钉住接收端口(固定端口模式:长驻服务把 OTEL_EXPORTER_OTLP_ENDPOINT 一次性指到
   * http://localhost:<port>/v1/traces,跑多少次评估用例都不用改)。省略 = 每次运行动态分配
   * 临时端口(经 ctx.telemetry 交给 adapter)。代价:固定端口下同机同时只能跑一个 niceeval 进程,
   * 且该端口被别的进程占用时会报错——换一个空闲端口写回这里即可。
   * `host` 是报给 adapter 的接收端 hostname(而非监听地址,监听地址恒为 0.0.0.0):默认
   * "127.0.0.1";docker Sandbox 型 tracing 需要 "host.docker.internal" 之类的场景,或配了隧道
   * 的远程接入,在这里覆盖。
   */
  telemetry?: { host?: string; port?: number };
  /**
   * 内置价格表(`o11y/prices.json`)之上的用户覆盖 / 补充,按 model 查(见 Observability
   * · 用量与成本)。key 支持精确 model 名或 `provider/*` 通配(自托管/网关折扣按 provider 批量覆盖);
   * 精确 key 优先于通配。只在没有网关实测成本(`usage.costUSD`)时才会用到——实测优先于估算恒成立。
   */
  pricing?: globalThis.Record<string, PriceOverride>;
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
  readonly agent: Agent;
  readonly model?: string;
  readonly reasoningEffort?: string;
  readonly flags: Readonly<globalThis.Record<string, JsonValue>>;
  readonly attempts: number;
  readonly earlyExit: boolean;
  /** Experiment 的作者 layer；省略在 link 输入归一为 command-only。 */
  readonly sandbox?: SandboxLayer;
  readonly sandboxReuse?: boolean;
  /** 作者输入已完成组合校验后的穷尽 State 规划；运行器不再解释可选 callback。 */
  readonly state: PlannedExperimentState;
  /** Experiment 声明的 judge 覆盖；与 Eval/Config 的逐字段解析在 pair 规划期完成。 */
  readonly judge?: JudgeConfig;
  /**
   * 运行侧已求值的单 attempt 超时上限:只含 `--timeout` 与 experiment 字段两层
   * (`resolveRunTimeout`)。**不许把 config 的值提前物化进来**——eval 与 config 两层由
   * `resolveAttemptTimeout` 在派发时接上,提前物化会让 eval 自己声明的上限永久短路
   * (见 timeout.ts 与 memory/multi-source-field-resolution-order.md)。
   */
  readonly timeoutMs?: number;
  /** `timeoutMs` 那个值来自哪一层,供超时消息标注出处;省略按 `experiment` 读。 */
  readonly timeoutSource?: "flag" | "experiment";
  readonly budget?: number;
  readonly experimentId: string;
  /** Experiment 定义文件目录；只用于解析 template 中的相对宿主路径。 */
  readonly experimentBaseDir: string;
  /** Experiment 定义文件路径；link 诊断来源。 */
  readonly experimentSourcePath: string;
  /** 实验的一句话描述(ExperimentDef.description),进结果快照的 ExperimentRunInfo。 */
  readonly description?: string;
  /** 报告归类标注(ExperimentDef.labels),原样进 ExperimentRunInfo.labels;不透传 ctx / t。 */
  readonly labels?: Readonly<globalThis.Record<string, string | number>>;
  /** evals 过滤器的指纹(数组内容 / 函数体哈希),进 ExperimentRunInfo.evalFilterFingerprint。 */
  readonly evalFilterFingerprint?: string;
  /**
   * 本次 invocation 解析后实际选中的 eval id 全集——CLI 在构造 AgentRun 时对候选 eval 各求值
   * 一次算好(见 `eval-selection.ts` 的 `resolveExperimentEvals()`),下游(dry-run、sandbox 查表、
   * fingerprint/carry、attempt 展开、hook ctx、落盘)只消费这份已解析结果,不重新调用用户谓词。
   * 保持顺序 = discovery 稳定顺序,去重。
   */
  readonly selectedEvalIds: readonly string[];
  readonly strict?: boolean;
  /** 本配置自己的并发上限(来自 ExperimentDef.maxConcurrency):调度器为它单建信号量,
   *  attempt 先过这道闸再占全局并发位;省略则只受全局并发约束。 */
  readonly maxConcurrency?: number;
  /** 实验级生命周期钩子对(来自 ExperimentDef.setup / .teardown):setup 整场至多一次,
   *  调度器 memoize 执行;teardown 在全部 attempt 收尾后执行,当且仅当 setup 时点走到过
   *  (语义见 ExperimentDef 对应字段)。 */
  readonly setup?: (ctx: ExperimentHookContext) => void | Promise<void>;
  readonly teardown?: (ctx: ExperimentHookContext) => void | Promise<void>;
  /** 实验声明的失败分类器(来自 ExperimentDef.classifyFailure):turn 链上排在 adapter 之前,
   *  生命周期链上排在抛出点声明之后;产出的空间轴由止损闸在 attempt 封口消费。 */
  readonly classifyFailure?: AttemptFailureClassifier;
}

export interface RunOptions {
  config: Config;
  evals: readonly DiscoveredEval[];
  agentRuns: readonly AgentRun[];
  /**
   * `--keep-sandbox` 的留存档位:failed 留 failed/errored(含硬超时的 errored),all 全部留;
   * 省略 = 全部销毁(留存永远是显式选择)。留存决策在 verdict 定稿的收尾点按档位提交,
   * 见 docs/feature/sandbox/architecture.md「留存(keep)与注册表」。
   */
  keepSandbox?: "failed" | "all";
  /** --rerun 的本次调用携带口径。 */
  rerun?: "failed" | "all";
  /** `--accept` 本次授权跨过的差异 selector(`config:<字段路径>` 等)。 */
  accept?: readonly string[];
  /**
   * 历史侧的指纹输入清单(`${experimentId}|${evalId}` → 清单),差异解释与 `--accept` 的授权
   * 判据读它;缺席的 key 差异算不出,如实是 `opaque:no-manifest`。调用方已经算好 `carryPlan`
   * 时这个字段不参与——那份计划里的差异已经定了。
   */
  priorManifests?: ReadonlyMap<string, EvalManifest>;
  /** 结果根目录(.niceeval;留存注册表 `.niceeval/sandboxes/` 挂在它下面)。省略 = cwd/.niceeval。 */
  niceevalRoot?: string;
  /** @internal 测试/嵌入式编排可预分配 Run 身份；CLI 省略时 runner 为每个 Experiment 生成 UUID。 */
  runIds?: ReadonlyMap<string, string>;
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
  /**
   * Run 级共享构建准备。只含携带规划后仍需 fresh 执行的 BuildKey;
   * 省略时 runEvals 从 pair-owned ProviderPlan 自动收集
   * (Compose works 默认接 dockerComposeBuildProvider)。测试可显式注入假 provider。
   * 共享构建不占 attempt 并发位,不计入 executionMs。
   */
  buildPreparation?: {
    readonly works: readonly import("../sandbox/build-coordinator.ts").SandboxBuildWork[];
    readonly provider: import("../sandbox/build-coordinator.ts").SandboxBuildProvider;
    /** `${experimentId}|${evalId}` → 该 pair 的 fresh attempt 依赖的 BuildKey。 */
    readonly pairBuildKeys: Readonly<globalThis.Record<string, readonly BuildKey[]>>;
    readonly maxConcurrency?: number;
    readonly buildTimeoutMs?: number;
    readonly prepareBudgetMs?: number;
  };
  /**
   * Run 级 Agent artifact prepare 协调器。省略时 runEvals 为有 staged installer 的
   * sandbox agent 新建并接真 Run timing recorder;测试可注入。
   */
  artifactPrepare?: import("../agents/provisioner.ts").ArtifactPrepareCoordinator;
}

/** 调度器内部的一次尝试:eval × run × 第几轮。 */
export interface Attempt {
  readonly evalDef: DiscoveredEval;
  readonly run: AgentRun;
  readonly attempt: number;
  /** agent+model+evalId,用于首过即停。 */
  readonly key: string;
  readonly fingerprint: string;
  readonly configHash: string;
  /** 该 pair 的唯一、不可变规划产物；fingerprint / create / reuse 全部消费同一份值。 */
  readonly plan: LinkedRunPlan;
  /** 同一 Experiment 本次选中 Eval 的完整 plan 映射；run.json 不从当前 pair 猜全局默认值。 */
  readonly sandboxPlansByEval: Readonly<globalThis.Record<string, JsonValue>>;
  /**
   * 构造 fresh attempt plan 时即算好的 Attempt 定位符(不是完成后写回):由 invocation 的
   * 预分配 runId 与 attempt 身份派生,贯穿执行、留存登记与落盘——登记项、run 收尾反馈与
   * result.json 从第一次写入起就用同一个值。裸 run(无 experimentId)不产出。
   */
  readonly locator: AttemptLocator;
}

// ───────────────────────── 反馈 profile / 事件 / reducer 状态 ─────────────────────────
// `niceeval exp` 的 human / agent / ci 反馈模型(见 docs/feature/experiments/cli.md)。
// 本节只定义类型 + 纯 reducer 需要的输入输出契约;profile renderer、terminal coordinator、
// runner 侧的实际事件发射均由后续阶段实现 —— 这里先把事件形状和状态形状钉死,后续阶段
// 不需要重新设计事件联合类型。

/** 两种反馈形态(见 docs/feature/experiments/cli.md「每条命令一个人读 text 面,`--json` 是机器面」):
 *  `--json` 即机器面,否则人读文本(TTY live 面板 / 非 TTY 追加流,由渲染层内部按 `io.stderr.isTTY`
 *  再分派,不是第三个 profile)。 */
export type OutputProfile = "human" | "json";

// 反馈系统的 attempt 阶段与落盘 / envelope 用同一套 `LifecyclePhase` 闭集(见上),
// 不再有独立的 dashboard 词表;`waiting for a slot` 是 attempt 开始前的调度态,不属于闭集;
// `passed` / `failed` / `errored` / `reused` / `early-exit` / `budget-unstarted` 是 outcome,
// 发生在阶段结束后,也不塞进 phase 闭集。

/**
 * 反馈系统里一次 attempt 的稳定身份:reducer 用它做 active map 的 key、事件的关联字段。
 * 只含调度身份三元组 —— 不含 agent/model/展示 label(那是 `who`,来自 `runWho()`,
 * 见该函数注释:展示 label 不能当 identity key 用,folding 两个不同 config 到同一个 key
 * 曾经就是 live 表格两个真实 bug 的根因),也不含落盘 `AttemptLocator`
 * 所需的持久化 `runId`。完成/failure 事件在 locator 确定后直接携带
 * 派生好的 `AttemptLocator` 字符串,反馈层
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
  phase: LifecyclePhase;
  /**
   * 这条 attempt 被派发的墙钟时间(epoch ms,取 `attempt:start` 的 `at`)—— active 行时间列的
   * **唯一**基准,`attempt:phase` 不得改写它:live 面板不做 spinner 动画,存活性完全由这一列
   * 持续增长证明(见 docs/feature/experiments/cli.md「active 行的列序」),一列会归零的时间既
   * 证明不了存活,也让人误以为这条 eval 重跑了。阶段各自的耗时不进这里——它由结果的
   * `timing.phases` 完整落盘,live 面板要回答的是「这条还活着吗、跑了多久、正在干什么」。
   */
  startedAt: number;
  detail?: string;
}

/** 实验级钩子只有 setup 与它返回的 teardown 两员,同一实验内两者永不并发
 *  (teardown 在全部 attempt 收尾后才触发),所以运行级行按 experimentId 建 key 就够。 */
export type ExperimentHookName = "setup" | "teardown";

/**
 * dashboard 当前可见的一个实验级钩子运行级行(见 docs/feature/experiments/cli.md
 * 「实验级 Hook 的显示」)。与 `ActiveAttempt` 分开建模:钩子不属于任何单个 attempt、不占并发位,
 * 也不参与 `RunFeedbackState` 的计数不变量——等待 setup 的
 * attempt 保持 `queued`,这行就是「为什么它们还在排队」的解释。`detail` 来自实验级
 * `ctx.progress`,后一条覆盖前一条。
 */
/**
 * dashboard 当前可见的 judge 预检运行级行(见 docs/feature/experiments/cli.md「judge 预检的显示」)。
 * 与 `ActiveExperimentHook` 分开建模:预检是 invocation 级、不挂任何 experimentId,只有一个在飞
 * 实例(整次运行至多一次预检)。`startedAt` 用于渲染运行级行持续增长的耗时,证明它还活着。
 */
export interface ActivePrecheck {
  /** 预检开始的墙钟时间(epoch ms),用于渲染运行级行的耗时。 */
  startedAt: number;
}

export interface ActiveExperimentHook {
  experimentId: string;
  hook: ExperimentHookName;
  /** 钩子开始的墙钟时间(epoch ms),用于渲染运行级行的耗时。 */
  startedAt: number;
  detail?: string;
  /** 强杀后启动自愈补执行的 teardown(见 `DurableFeedbackEvent` 的 "experiment-hook" 变体)。 */
  recovery?: boolean;
}

/**
 * dashboard 当前可见的一个「等待并行 run」运行级行(见 docs/feature/experiments/cli.md
 * 「等待并发 run 的显示」)。用例锁的等待粒度是单个 `(experimentId, evalId)`,但运行级行按
 * experimentId 聚合展示——一个实验可能同时有多个用例撞锁,只占一行,给出条数与代表持有方。
 */
export interface ActiveLockWait {
  experimentId: string;
  /** 当前仍在等待的 evalId → 该用例开始等待的时间与持有方身份。`size` 就是运行级行要展示的
   *  等待条数;为空表示这个实验当前没有在等的用例(条目仍保留在 map 里,供非 TTY 聚合文案
   *  读取下面两个累计字段,直到下一次 "started" 事件开启新窗口时清零)。 */
  waiting: ReadonlyMap<string, { startedAt: number; holderPid?: number; holderHost?: string }>;
  /** 本次「有等待用例」窗口内,累计已经 resolved 且携入 reused 的 attempt 数——供非 TTY 聚合
   *  收尾行(如 `lock wait resolved · compare/codex (2 carried · 1 to run, 1m 34s)`)读取。 */
  resolvedCarried: number;
  /** 同上,累计已经 resolved 且转为自跑(进入 queued)的 attempt 数。 */
  resolvedDispatched: number;
}

/**
 * dashboard 当前可见的一条 Run 级 activity 行(共享构建、制品准备等)。
 * 不占 attempt active 位,也不进五项恒等式计数;人读文本用 producer 的 `label`,不查
 * LifecyclePhase 锚点表(见 docs/feature/experiments/architecture.md「Run 级共享准备」)。
 */
export interface ActiveRunActivity {
  /** 与 TimingActivity.id 对齐,同一 Run 内唯一。 */
  id: string;
  /** ActivityKey;机器面分组用,不驱动人读标签切换。 */
  key: string;
  /** producer 写下的有界人读标签;展示层原样用。 */
  label: string;
  /** 开始的墙钟时间(epoch ms),用于渲染运行级行持续增长的耗时。 */
  startedAt: number;
}

/**
 * 一次失败/错误的永久通知:human 撤下 dashboard 后追加一行、agent/ci 立即追加一行,都读它。
 * 字段全部结构化(locator / identity / verdict / phase 都是具名字段),profile renderer 不需要
 * 解析 `reason` 之外的任何文本就能拼出机器可读的输出。
 */
export interface FailureDetail {
  locator: AttemptLocator;
  identity: AttemptRef;
  who: string;
  verdict: "failed" | "errored";
  /** 一层可行动摘要(gate 断言名、error 消息……),不是完整 stack/transcript;详情走 `niceeval show`。 */
  reason: string;
  /** failed / assertion-unavailable 时的结构化主断言摘要；机器 renderer 直接读字段。 */
  assertion?: PrimaryAssertionSummary;
  /** 仅 errored 使用：结构化执行错误发生时所在的阶段。failed 是断言 outcome，不带 phase。 */
  phase?: LifecyclePhase;
  /** 完整时间归属；attempt 形态同时投影上面的 phase，run 形态保留共享 timing node。 */
  origin?: TimingOrigin;
}

/** 带发生时间的失败通知；复用失败以 FailureDetail 静态进入 plan，不伪装成刚发生的事件。 */
export interface FailureNotice extends FailureDetail {
  at: number;
}

/**
 * 去重后的诊断通知(warning/error):相同 `key` 的诊断只保留一条,`count` 累加受影响次数
 *(见 docs/feature/experiments/cli.md「什么动态更新,什么逐条追加」的去重规则)。
 * `data` 携带结构化字段(如 budget 的 experimentId/spent/unstarted),agent/ci 直接读取,
 * 不解析 `message`(`message` 只是 human 展示用的一句话)。
 */
/**
 * 止损闸落闸诊断的稳定词法(`--json` 的 `warning.code`、`run.json` 的诊断 `code`,契约见
 * docs/feature/error-classification/architecture.md「止损执行体」)。emitter(run.ts)与两种
 * profile 的 renderer 共用这一个常量,谁都不在自己这边再写一遍字面量。
 */
export const HALT_DIAGNOSTIC_CODE = "dispatch-halted";

export interface DiagnosticNotice {
  at: number;
  key: string;
  /** 对外的稳定词法(`--json` 的 `warning.code`、human 诊断行标题);省略 = 与 `key` 相同。
   *  `key` 可以把折叠身份(experimentId / evalId)编进去,`code` 恒是干净字面量。 */
  code?: string;
  severity: "warning" | "error";
  message: string;
  /** 相同 key 累计出现的次数,由 reducer 去重时递增。 */
  count: number;
  identity?: AttemptRef;
  data?: Readonly<globalThis.Record<string, JsonValue>>;
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

export interface InvocationCompletion {
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
 * `total = reused + running + elsewhere + queued + passed + failed + errored + skipped`
 * (八项恒等式,见 docs/feature/experiments/cli.md「等待并发 run 的显示」)在处理完每一个事件
 * 之后都成立,是 reducer 的不变量:任何一次迁移都是「从一项减 x、往另一项加 x」,不存在两项
 * 同时计数或都不计数的中间态(见 reducer.test.ts 的表驱动用例,每一步都断言,不只在流程末尾
 * 断言一次)。
 */
export interface RunFeedbackState {
  total: number;
  reused: number;
  running: number;
  /** 正被并行 Invocation 持锁运行、本次在等待中的用例的 attempt 数(用例锁,见 `lock-wait`
   *  变体与 docs/feature/experiments/cli.md「等待并发 run 的显示」);与 `queued` 互斥——
   *  `queued` 是「等本进程并发位/setup」,`elsewhere` 是「等别的进程」。
   *  恒等式(见接口注释)在处理完每一个事件之后都成立。 */
  elsewhere: number;
  queued: number;
  /** 以下四项是本次派发并已了结的 attempt 按 verdict 的划分——reducer 不保留一个笼统的
   *  「完成数」:盯着运行的人问的是「到现在为止挂了几个」,一个合计数回答不了。携入结果的
   *  verdict 留在 `reused`,不摊进这四项(计数口径与成本口径一致地区分「本次派发」与
   *  「缓存携入」,见 docs/feature/experiments/cli.md「运行中的 live 面板」)。 */
  passed: number;
  failed: number;
  errored: number;
  /** 本次不产生 verdict 的了结:eval 自身 skip、首过即停省略的轮次、budget 未派发。
   *  它们不冒充 `passed`/`failed`;三者彼此的区别由结束结论与题目级 `eval` 事件给出。 */
  skipped: number;
  /** attempt:early-exit 事件的累计次数(首过即停省略 + fail-fast 未派发;后者由 fail-fast
   *  diagnostic 的 count 单独区分,见 cli.ts 的 assembleRunCompletion)。 */
  earlyExitSkipped: number;
  /**
   * `attempt:early-exit` 事件的原始次数,按 `${experimentId ?? ""}|${evalId}` 分组(见
   * `feedback/eval-conclusions.ts` 的 `evalConclusionKey`)。这份计数**未**剔除 fail-fast 的
   * 份额(fail-fast 未派发同样发出这个事件类型,见 run.ts)——`evalConclusionRows()` 消费时
   * 对照 `diagnostics` 里的 `fail-fast:` 记录减去那部分,得到真正的首过即停省略次数,据此判断
   * 是否给出 `reason=early_exit`。不得把这份原始计数直接当作首过即停次数使用。
   */
  earlyExitByEval: ReadonlyMap<string, number>;
  elapsedMs: number;
  /** 仅本次实际派发 attempt 的 token；carry 结果的历史 usage 不进入这里。 */
  newTokenCount?: number;
  estimatedCostUSD?: number;
  active: ReadonlyMap<AttemptKey, ActiveAttempt>;
  /** 在飞的 judge 预检运行级行(见 `DurableFeedbackEvent` 的 "precheck" 变体):`started` 置位、
   *  `done` 清空。预检发生在任何 attempt 派发之前、作用于整次 invocation,不属于任何 attempt,
   *  也不参与五项恒等式计数——预检期间 attempt 保持 `queued`,
   *  这行就是「为什么它们还在排队」的解释。undefined = 当前没有在飞的预检。 */
  activePrecheck?: ActivePrecheck;
  /** 在飞的实验级钩子(experimentId → 运行级行状态),由 "experiment-hook" 事件增删、
   *  "experiment:progress" 更新 detail(见 docs/feature/experiments/cli.md「实验级 Hook 的显示」)。 */
  experimentHooks: ReadonlyMap<string, ActiveExperimentHook>;
  /** 在飞的用例锁等待,按 experimentId 聚合(见 `ActiveLockWait`、docs/feature/experiments/cli.md
   *  「等待并发 run 的显示」)。由 "lock-wait" 事件增删/累计;没有等待用例的实验不出现在这个 map 里。 */
  lockWaits: ReadonlyMap<string, ActiveLockWait>;
  /** 在飞的 Run 级 activity(id → 运行级行状态),由 "run-activity" 事件增删。不占 attempt
   *  active 位,也不进计数恒等式(见 `ActiveRunActivity`)。 */
  runActivities: ReadonlyMap<string, ActiveRunActivity>;
  failures: readonly FailureNotice[];
  /** 本次实际派发后产生的去重失败数；复用失败不消耗 profile 的流式输出上限。 */
  freshFailureCount: number;
  diagnostics: readonly DiagnosticNotice[];
  /** 留存授予的沙箱(--keep-sandbox);run 摘要后各 profile 追加输出。 */
  kept: readonly KeptNotice[];
}

/** 一条留存授予的永久通知(见 docs/feature/sandbox/cli.md「run 收尾输出」)。 */
export interface KeptNotice {
  at: number;
  locator: AttemptLocator;
  identity: AttemptRef;
  who: string;
  verdict: Verdict;
  provider: string;
  sandboxId: string;
  enter?: string;
}

/** 一次 run 的初始计划。复用只暴露数量；失败明细仅用于静态初始化终局清单。 */
export interface RunFeedbackPlan {
  shape: InvocationShape;
  /**
   * 声明了 `maxConcurrency` 的实验 → 各自的上限。只收声明了的实验(未声明的实验的有效宽度就是
   * 全局值,列出来只是噪音);一个都没声明时整个字段省略——`--json` 的 `start` 事件因此不会
   * 出现空对象,human `PLAN` 行也不加附注(见 docs/feature/experiments/cli.md
   * 「运行中的 live 面板」的 `concurrency` 附注段)。
   */
  experimentConcurrency?: Readonly<globalThis.Record<string, number>>;
  /** 携入(carry)结果数,直接计入 `RunFeedbackState.reused`,不需要重新调度。 */
  reused: number;
  /** 复用结果中的失败；plan 时静态注入，不产生“刚发生”的失败事件。 */
  reusedFailures?: readonly FailureDetail[];
}

/**
 * 只影响 dashboard 当前帧、reducer 不为它保留历史的事件:新值使旧值失去意义,所以覆盖而不是
 * 追加(见 docs/feature/experiments/cli.md「什么动态更新,什么逐条追加」的判断标准)。
 * `attempt:early-exit` 同样折进这一组 —— 它不打印永久行,只把已知 verdict 的省略次数收进
 * `skipped`(见 reducer 实现)。
 */
export type AttemptLifecycleEvent =
  | { type: "attempt:queued"; at: number; identity: AttemptRef; who: string }
  | { type: "attempt:start"; at: number; identity: AttemptRef; who: string; phase: LifecyclePhase }
  | { type: "attempt:phase"; at: number; identity: AttemptRef; phase: LifecyclePhase }
  | { type: "attempt:progress"; at: number; identity: AttemptRef; detail: string }
  | {
      type: "attempt:complete";
      at: number;
      identity: AttemptRef;
      who: string;
      verdict: Verdict;
      /** 本次 attempt 的输入 + 输出 token；缺失表示 provider 未报告。 */
      tokenCount?: number;
      estimatedCostUSD?: number;
    }
  | { type: "attempt:early-exit"; at: number; identity: AttemptRef; who: string };

/**
 * 实验级 `ctx.progress` 的短命投影:只覆盖对应运行级行的 `detail`,不追加永久行——与
 * `attempt:progress` 同一判断标准(新值使旧值失去意义)。对应的运行级行不存在时静默忽略。
 */
export interface ExperimentProgressEvent {
  type: "experiment:progress";
  at: number;
  experimentId: string;
  detail: string;
}

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
      assertion?: PrimaryAssertionSummary;
      phase?: LifecyclePhase;
      origin?: TimingOrigin;
    }
  | {
      type: "diagnostic";
      at: number;
      key: string;
      /** 对外稳定词法(见 `DiagnosticNotice.code`);省略 = 与 `key` 相同。 */
      code?: string;
      severity: "warning" | "error";
      message: string;
      /** attempt 级诊断的归属身份。运行级诊断(实验闸 / eval 闸这类不属于任何单条 attempt 的
       *  事实)不许伪造 identity——它们的 experimentId / evalId 走 `data` 的同名字段,
       *  `--json` 的 `warning` 事件两处都读、identity 优先。 */
      identity?: AttemptRef;
      data?: Readonly<globalThis.Record<string, JsonValue>>;
    }
  /**
   * emitter 对每一个因 budget 到顶而不派发的 attempt 各发一次(与 `attempt:early-exit` 同构,
   * 见 reducer 实现);`unstarted` 是 emitter 自己记的、发出这条时的累计未派发数,写进
   * `DiagnosticNotice.data` 供 agent/ci 直接读取,不是 reducer 用来计算「这次要挪多少」的输入
   *(reducer 只按事件触发次数折算,保持纯函数不需要额外记住上一次的值)。
   */
  | { type: "budget-exhausted"; at: number; experimentId: string; spent: number; unstarted: number }
  /** 一次留存授予(--keep-sandbox):run 摘要后三种 profile 都追加输出(见 docs/feature/sandbox/cli.md)。 */
  | {
      type: "kept";
      at: number;
      locator: AttemptLocator;
      identity: AttemptRef;
      who: string;
      verdict: Verdict;
      provider: string;
      sandboxId: string;
      enter?: string;
    }
  /**
   * 实验级钩子(`ExperimentDef.setup` / 它返回的 teardown)的起止,由 runner 在钩子真正
   * 开始/结束时各发一次(见 docs/feature/experiments/cli.md「实验级 Hook 的显示」)。`failed`
   * 只标记钩子自身的结局——setup 失败的每条 attempt 仍以 "failure" 事件逐条给出。human TTY
   * 用它维护运行级 active 行(不写 scrollback),append-only profile 起止各追加一行。
   */
  | {
      type: "experiment-hook";
      at: number;
      experimentId: string;
      hook: ExperimentHookName;
      status: "started" | "done" | "failed";
      /** 只在 done / failed 上出现:钩子从开始到结束的耗时。 */
      durationMs?: number;
      /**
       * 只在 `hook: "teardown"` 的 `status: "started"` 上可能出现:标注这是强杀后的启动自愈
       * 补执行(见 docs/feature/experiments/architecture.md「强杀后的收尾兜底」),不是本次 run
       * 正常触发的收尾。省略 = 正常路径。
       */
      recovery?: boolean;
    }
  /**
   * judge 配置预检的起止,由 runner 在探测真正开始/结束时各发一次(见 docs/feature/experiments/
   * cli.md「judge 预检的显示」)。预检作用于整次 invocation、发生在任何 attempt 派发之前,不属于
   * 任何单个 attempt,也不触碰五项恒等式计数不变量。human
   * TTY 用它维护一条运行级 active 行(不写 scrollback),append-only profile 起止各追加一行。
   * `failed` 只标记预检本身的结局(与 `done` 一样清掉运行级行);受影响 eval 每条 attempt 的
   * `errored`(`judge-precheck-failed`)仍由 "failure" 事件逐条给出。
   */
  | { type: "precheck"; at: number; status: "started" | "done" | "failed"; durationMs?: number }
  /**
   * 用例锁等待的起止(见 docs/feature/experiments/cli.md「等待并发 run 的显示」)。粒度是单个
   * `(experimentId, evalId)`——同一 eval 的全部 attempt 作为一个整体一起等、一起解决,不按
   * attempt 拆分。emitter(run.ts)只在这批 attempt 需要重查携带时才发这对事件:全携带用例
   * 不取锁、无竞争的全新取锁(锁目录里从没出现过这个 key)都不发——静态携带规划的结论不可能
   * 过时,没有理由重新读盘。撞上新鲜锁(真正等待)与接管一把无人竞争的过期锁(从未真正等待,
   * `waitedMs` 因此可能接近 0)都算「需要重查」,统一走这对事件——即便是瞬时接管,这批
   * attempt 也必须先经 "started" 迁入 `elsewhere`,"resolved" 才能把它们正确迁回
   * `reused`/`queued`,否则它们会永远卡在 `queued`、打破五项恒等式。
   */
  | {
      type: "lock-wait";
      at: number;
      experimentId: string;
      evalId: string;
      status: "started" | "resolved";
      /** status 为 "started" 时给出:锁持有方身份,以及这次撞锁进入 elsewhere 等待的 attempt 数
       *  (该 eval 本轮需要真实派发、被这把锁挡住的 attempt 数;省略按 1 处理)。 */
      holderPid?: number;
      holderHost?: string;
      attempts?: number;
      /** status 为 "resolved" 时给出:锁释放后重查携带,分别有多少 attempt 从 elsewhere 迁入
       *  reused(carried)、多少迁入 queued 转为自跑(dispatched)——`attempts` 下可能两者都非零
       *  (部分携入部分补跑)。`--json` 的 `lock_wait` 事件把两者折成单一 `resolution` 字段:
       *  `dispatched > 0` 记 "dispatched"(这个用例仍需要真实派发,等待没有让它完全免于执行),
       *  否则记 "carried"(全部由携带满足,零新成本)。 */
      carried?: number;
      dispatched?: number;
      waitedMs?: number;
    }
  /**
   * Run 级开放 activity 的起止(共享构建、制品准备等)。`key` / `label` 原样来自 producer:
   * 人读面与 `--json` 对未登记 key 用 `label` 通用投影,不需要 switch 穷尽,也不进
   * LifecyclePhase 锚点标签表。human TTY 用它维护运行级 active 行(不占 attempt slot、
   * 成功不写 scrollback);非 TTY 与 `--json` 起止/失败各追加一行有界永久事件。
   */
  | {
      type: "run-activity";
      at: number;
      id: string;
      key: string;
      label: string;
      status: "started" | "done" | "failed";
      /** 只在 done / failed 上出现。 */
      durationMs?: number;
    }
  | { type: "interrupted"; at: number }
  | { type: "reporter-error"; at: number; reporter: string; required: boolean; message: string }
  | { type: "summary"; at: number; summary: InvocationSummary; completion: InvocationCompletion }
  | {
      type: "saved";
      at: number;
      /** 本次 invocation 实际落盘的快照结果路径。不含 `--junit` 聚合文件——那个由 `junit`
       *  独立字段单独携带,而不是塞进这个数组后靠猜文件后缀去反推「哪个是聚合报告、哪些是
       *  快照目录」。`exp` 没有 JSON 聚合文件出口(`--json` 是布尔:整条事件流本身就是机器面,
       *  见 docs/feature/experiments/cli.md「机器怎么读:--json」);需要 JSON 聚合文件时
       *  重定向事件流,或运行后 `niceeval show --json`。 */
      paths: readonly string[];
      /** 实际写出的 `--junit` 聚合报告路径;未传 `--junit`,或写入失败(见 required reporter
       *  语义),都省略这个字段——省略表示「不打印这一行」,不是打印一个空路径。 */
      junit?: string;
    };

/**
 * runner → feedback coordinator 的内部事件通道,与公共 `Reporter` / `ReporterEvent` 分开:
 * profile renderer 只消费这里的具名字段,不解析 `ReporterEvent` 里的 i18n 文案或表格列宽
 *(见 docs/feature/experiments/cli.md「输出流和落盘节奏」)。
 */
export type RunFeedbackEvent = AttemptLifecycleEvent | ExperimentProgressEvent | FeedbackTickEvent | DurableFeedbackEvent;
