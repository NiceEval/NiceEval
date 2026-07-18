// run 激活期间,底层模块(sandbox provider、budget 记账、reporter 兜底、中断处理……)不得
// 直接写 stdout/stderr(见 docs/feature/experiments/cli.md「输出流和落盘节奏」与本文件对应的
// PLAN 第 2 节「一个 run 内只有一个终端协调者」)。它们改调用这里的 reportXxx() 系列函数。
//
// - 有活跃 FeedbackCoordinator 时(coordinator.start() 之后、finish() 之前,见 cli.ts 的
//   run:start 接线),转发给它 —— coordinator 负责去重、clear→append→redraw 排序、按 profile
//   分派给 renderer。
// - 没有活跃 coordinator 时(run:start 之前的 bootstrap 错误、finish() 之后、或不经过
//   cli.ts 的直接库调用),透传回 `src/tty-line.ts` 的 bootstrap 出口。
//
// 活跃 coordinator 用一个栈而不是单个全局变量:允许嵌套/连续的 runEvals() 调用(如测试里
// 同进程跑多个 run,或未来某种「run 之内再跑一个子 run」的场景)各自持有自己的活跃身份,
// 不会互相覆盖对方的 sink。用显式栈(而不是旧 `tty-line.ts` 那套「广播给所有监听者」的
// 订阅模式)是因为 reportXxx() 需要一个*唯一*目的地来做去重决策,不能让多个监听者都收到
// 同一条消息。

import { writeStderrLine } from "../../tty-line.ts";
import { t } from "../../i18n/index.ts";
import type { AttemptLifecycleEvent, AttemptRef, ExperimentHookName, FailureDetail } from "../types.ts";
import type { Verdict } from "../../scoring/types.ts";
import type { JsonValue } from "../../shared/types.ts";
import type { AttemptLocator } from "../../results/locator.ts";

/** `sink.diagnostic()` 的输入 —— 与 `DurableFeedbackEvent` 的 "diagnostic" 变体字段一致,
 *  只是省略 `type`/`at`(由 coordinator 补上)。 */
export interface DiagnosticInput {
  /** 稳定去重 key —— 同一种 warning/error 用同一个 key(见 cli.md「同一 dedupeKey 并发出现时
   *  只留一条并显示次数」),不要把可变的实例细节(如具体 sandbox id)编进 key 本身,
   *  那些细节放 `data`。 */
  key: string;
  severity: "warning" | "error";
  /** 一句话人类可读摘要;renderer 的 appendDurable 直接展示,不需要再解析。 */
  message: string;
  identity?: AttemptRef;
  data?: Readonly<Record<string, JsonValue>>;
}

/** `sink.failure()` 的输入 —— 与 `DurableFeedbackEvent` 的 "failure" 变体字段一致,只省略
 *  `type`/`at`(由 coordinator 补上)。`locator` 只有在 attempt 挂靠 experiment 时才存在
 *  (见 `results/locator.ts` 的 `encodeAttemptLocator`);调用方(run.ts)只在拿到 locator 之后
 *  才应该调用这个函数——没有 locator 的裸 run 不产出这类永久失败通知。 */
export type FailureInput = FailureDetail;

/** `sink.budgetExhausted()` 的输入 —— 与 `DurableFeedbackEvent` 的 "budget-exhausted" 变体字段
 *  一致,只省略 `type`/`at`。调用方(run.ts)对每一个因预算到顶而不派发的 attempt 各调一次
 *  (与 `AttemptLifecycleEvent` 的 "attempt:early-exit" 同构);`unstarted` 是调用方自己维护的、
 *  发出这条时的累计未派发数,不是 reducer 能推导的值(见 reducer.ts 对应事件的注释)。 */
export interface BudgetExhaustedInput {
  experimentId: string;
  spent: number;
  unstarted: number;
}

/** `sink.experimentHook()` 的输入 —— 与 `DurableFeedbackEvent` 的 "experiment-hook" 变体字段
 *  一致,省略 `type`/`at`(由 coordinator 补上)。调用方(run.ts)在钩子真正开始/结束时各调
 *  一次;`durationMs` 只在 done/failed 上给。 */
export interface ExperimentHookInput {
  experimentId: string;
  hook: ExperimentHookName;
  status: "started" | "done" | "failed";
  durationMs?: number;
}

/** `sink.experimentProgress()` 的输入 —— 实验级 `ctx.progress` 压好的单行文本。 */
export interface ExperimentProgressInput {
  experimentId: string;
  detail: string;
}

/** `sink.kept()` 的输入 —— 与 `DurableFeedbackEvent` 的 "kept" 变体字段一致,省略 type/at。 */
export interface KeptInput {
  locator: AttemptLocator;
  identity: AttemptRef;
  who: string;
  verdict: Verdict;
  provider: string;
  sandboxId: string;
  enter?: string;
}

/** `sink.ts` façade 函数实际转发到的最小接口 —— `FeedbackCoordinator`(coordinator.ts)实现它。
 *  定义在这里(而不是从 coordinator.ts 导入)是为了让 sink.ts 不必在运行时依赖 coordinator.ts,
 *  避免两个模块互相 import 造成的循环依赖 —— coordinator.ts 反过来 `import type` 这个接口。 */
export interface FeedbackSink {
  activity(text: string): void;
  diagnostic(input: DiagnosticInput): void;
  interrupted(): void;
  reporterError(input: { reporter: string; required: boolean; message: string }): void;
  /** 一次失败/errored attempt 的永久通知(见 `FailureInput`)。 */
  failure(input: FailureInput): void;
  /** 一个因预算到顶而未被派发的 attempt(见 `BudgetExhaustedInput`)。 */
  budgetExhausted(input: BudgetExhaustedInput): void;
  /** 一次留存授予(--keep-sandbox);见 `KeptInput` 与 docs/feature/sandbox/cli.md。 */
  kept(input: KeptInput): void;
  /** 实验级钩子(`ExperimentDef.setup` / teardown)的起止(见 `ExperimentHookInput`)。 */
  experimentHook(input: ExperimentHookInput): void;
  /** 实验级 `ctx.progress` 的短命投影:只更新运行级行的 detail。与 `lifecycle` 同级别的
   *  「只服务正在画着的 dashboard」信号,没有活跃 coordinator 时静默丢弃是安全的。 */
  experimentProgress(input: ExperimentProgressInput): void;
  /** attempt 生命周期事件(queued/start/phase/progress/complete/early-exit),见
   *  `AttemptLifecycleEvent`。只驱动 human dashboard 的 active slot,不落 RunSummary/结果文件,
   *  所以没有活跃 coordinator 时(见 `reportAttemptLifecycle`)静默丢弃是安全的 —— 这类信息
   *  本身就只服务「正在画着的 dashboard」,不是必须留痕的诊断。 */
  lifecycle(event: AttemptLifecycleEvent): void;
}

const activeStack: FeedbackSink[] = [];

/**
 * coordinator 进入「活跃」阶段时调用一次(见 coordinator.ts 的 start()),把自己注册为当前
 * reportXxx() 调用的目的地。返回的函数用于退出活跃状态(见 coordinator.ts 的 finish())——
 * 调用一次即失效,重复调用是安全的 no-op。
 */
export function activateFeedbackSink(sink: FeedbackSink): () => void {
  activeStack.push(sink);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    const idx = activeStack.lastIndexOf(sink);
    if (idx !== -1) activeStack.splice(idx, 1);
  };
}

function current(): FeedbackSink | undefined {
  return activeStack[activeStack.length - 1];
}

/** 仅供测试:断言没有遗留未退出的活跃 coordinator(避免一个测试忘记 finish() 污染下一个)。 */
export function activeFeedbackSinkCount(): number {
  return activeStack.length;
}

/** 不需要去重、不进入 RunFeedbackState 的瞬时活动文本(docker 镜像拉取进度、vercel session
 *  rotate 成功通知……)。没有活跃 coordinator 时退回一行 stderr,与迁移前的裸写视觉效果一致。 */
export function reportActivity(text: string): void {
  const sink = current();
  if (sink) {
    sink.activity(text);
    return;
  }
  writeStderrLine(text.endsWith("\n") ? text : `${text}\n`);
}

/** 需要去重、要出现在三种 profile 永久事件流里的一条 warning/error。 */
export function reportDiagnostic(input: DiagnosticInput): void {
  const sink = current();
  if (sink) {
    sink.diagnostic(input);
    return;
  }
  writeStderrLine(input.message.endsWith("\n") ? input.message : `${input.message}\n`);
}

/** 一次失败/errored attempt 的永久通知(见 `FailureInput`)。与 `reportDiagnostic` 同级别的
 *  「必须留痕」信号 —— 没有活跃 coordinator 时退回一行 stderr,不像 `reportAttemptLifecycle`
 *  那样静默丢弃(定位一次真实失败不该因为没接 coordinator 就彻底没有出口)。 */
export function reportFailure(input: FailureInput): void {
  const sink = current();
  if (sink) {
    sink.failure(input);
    return;
  }
  writeStderrLine(`${input.who} ${input.verdict}: ${input.reason}\n`);
}

/** 一个因预算到顶而未被派发的 attempt(见 `BudgetExhaustedInput`)。没有活跃 coordinator 时的
 *  兜底文案与 coordinator.ts 的 `fallbackTextFor` 对 "budget-exhausted" 事件的格式化保持一致。 */
/** 一次留存授予的永久通知(--keep-sandbox);没有活跃 coordinator 时退回一行 stderr。 */
export function reportKept(input: KeptInput): void {
  const sink = current();
  if (sink) {
    sink.kept(input);
    return;
  }
  writeStderrLine(`kept sandbox ${input.sandboxId} (${input.provider}) — ${input.identity.evalId} #${input.identity.attempt} ${input.verdict}\n`);
}

/** 实验级钩子的起止(见 `ExperimentHookInput`)。没有活跃 coordinator 时退回一行 stderr ——
 *  长 setup 的可见性正是这条通道存在的理由,不能像 lifecycle 那样静默丢弃。 */
export function reportExperimentHook(input: ExperimentHookInput): void {
  const sink = current();
  if (sink) {
    sink.experimentHook(input);
    return;
  }
  const duration = input.durationMs !== undefined ? ` (${Math.round(input.durationMs / 1000)}s)` : "";
  writeStderrLine(`experiment ${input.hook} ${input.status} · ${input.experimentId}${duration}\n`);
}

/** 实验级 `ctx.progress` 的短命投影。与 `reportAttemptLifecycle` 同理:只服务正在画着的
 *  dashboard,没有活跃 coordinator 时静默 no-op。 */
export function reportExperimentProgress(input: ExperimentProgressInput): void {
  current()?.experimentProgress(input);
}

export function reportBudgetExhausted(input: BudgetExhaustedInput): void {
  const sink = current();
  if (sink) {
    sink.budgetExhausted(input);
    return;
  }
  writeStderrLine(`budget exhausted for ${input.experimentId} (spent ${input.spent}, unstarted ${input.unstarted})\n`);
}

/** 用户中断(Ctrl+C)。没有活跃 coordinator 时的兜底文案与迁移前的 `runner.interrupted` 完全
 *  相同 —— 调用方(run.ts)不再需要自己持有这段 i18n 文案。 */
export function reportInterrupted(): void {
  const sink = current();
  if (sink) {
    sink.interrupted();
    return;
  }
  writeStderrLine(t("runner.interrupted"));
}

/**
 * runner 自己驱动的 attempt 生命周期投影(见 docs/feature/experiments/cli.md「Attempt 阶段」)——
 * `src/runner/attempt.ts`(phase/progress)与 `src/runner/run.ts`(start/complete/early-exit)是
 * 目前仅有的两个调用方。没有活跃 coordinator 时(今天:CLI 还没接入 --output)静默 no-op ——
 * 与其它 reportXxx() 不同,这里不退回 `writeStderrLine` 兜底:这类事件只服务尚不存在的
 * dashboard,不是需要留痕的诊断,现有可观察行为(直到 CLI 接入真正的 coordinator 之前)因此
 * 完全不变。
 */
export function reportAttemptLifecycle(event: AttemptLifecycleEvent): void {
  current()?.lifecycle(event);
}

/** 一个 reporter 的某次回调抛错(见 `runner/report.ts` 的 `runReporter`)。`reporter`/`required`
 *  来自调用方注册这个 reporter 时的 `ReporterRegistration`(见其字段注释)——默认 artifacts、
 *  显式 `--json`/`--junit` 传 `required: true`,用户 `config.reporters`/`EvalDef.reporters`
 *  传 `required: false`。coordinator 把它折进 `RunFeedbackState.diagnostics`(reducer 按
 *  `reporter-error:<reporter>` 去重),调用方(`cli.ts` 的 `assembleRunCompletion`)据此把
 *  `required` 为真的失败折进 `RunCompletion.reporterErrors`,让 completion/CI 退出码判红。 */
export function reportReporterError(input: { reporter: string; required: boolean; message: string }): void {
  const sink = current();
  if (sink) {
    sink.reporterError(input);
    return;
  }
  writeStderrLine(t("runner.reporterDiagnostic", { stage: input.reporter, message: input.message }));
}
