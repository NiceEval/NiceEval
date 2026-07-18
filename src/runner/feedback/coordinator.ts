// FeedbackCoordinator:一个 run 内唯一的终端协调者(见 docs/feature/experiments/cli.md
// 「输出流和落盘节奏」与 plan 第 2 节「一个 run 内只有一个终端协调者」)。
//
// 职责边界:
// - 维护 RunFeedbackState(纯 reducer,见 reducer.ts)——每次 emit() 后同步更新,
//   `coordinator.state` 永远读到最新值,不经过下面的异步队列。
// - 把每个事件按「lifecycle / tick / durable」分派给当前 profile 的 FeedbackRenderer
//   (renderer.ts),并对 durable 事件保证 clearDynamic → appendDurable → redrawDynamic
//   三步原子执行(内部单队列串行处理,不会被下一个事件插入打断)。
// - 驱动 tick 定时器(周期性推进 elapsedMs、给 renderer 重画/heartbeat 判断的机会),
//   在 stopDynamic() 时停止,停止后保证不再有 timer 驱动的重画。
// - 通过 sink.ts 的活跃栈,成为底层模块(sandbox provider、budget 记账、reporter 兜底……)
//   的统一诊断出口 —— start() 时激活自己,finish() 时退出。
//
// 不负责(留给后续阶段):
// - 具体怎么画(ANSI dashboard、agent envelope、CI 事件行……)—— 那是各 renderer 自己的事,
//   coordinator 只保证「什么时候、按什么顺序」调用 renderer。
// - 从 runner 实际生命周期(sandbox provision / agent setup / …)推导 AttemptPhase 并发出
//   attempt:start/phase/progress 事件 —— 那是 A2 阶段的 lifecycle 接线;coordinator 只是
//   这些事件的消费者,不关心它们从哪来。
// - 在 cli.ts 里决定何时构造 coordinator、传哪个 renderer —— 那是 CLI 接线阶段的事。

import { createInitialRunFeedbackState, reduceRunFeedback } from "./reducer.ts";
import {
  activateFeedbackSink,
  type BudgetExhaustedInput,
  type DiagnosticInput,
  type ExperimentHookInput,
  type ExperimentProgressInput,
  type FailureInput,
  type FeedbackSink,
  type KeptInput,
} from "./sink.ts";
import type { FeedbackIO, FeedbackTimerHandle } from "./io.ts";
import type { FeedbackRenderer } from "./renderer.ts";
import { writeStderrLine } from "../../tty-line.ts";
import { t } from "../../i18n/index.ts";
import type {
  AttemptLifecycleEvent,
  DurableFeedbackEvent,
  FeedbackTickEvent,
  OutputProfile,
  RunCompletion,
  RunFeedbackEvent,
  RunFeedbackPlan,
  RunFeedbackState,
  RunSummary,
} from "../types.ts";

/** 默认 tick 周期:250ms(每秒最多 4 次重画机会),对应 docs 里 human dashboard「最多每秒
 *  4 帧」的上限 —— coordinator 只保证「不超过这个频率的重画机会」,合并/节流到「真的要不要
 *  重画这一帧」由 renderer 自己判断(见 renderer.ts 的 onTick 注释)。 */
const DEFAULT_TICK_INTERVAL_MS = 250;

export interface FeedbackCoordinatorOptions {
  profile: OutputProfile;
  renderer: FeedbackRenderer;
  io: FeedbackIO;
  /** 覆盖默认 tick 周期;测试/未来某个 profile 需要更粗或更细的节奏时用。 */
  tickIntervalMs?: number;
}

export interface FeedbackCoordinator extends FeedbackSink {
  readonly profile: OutputProfile;
  /** 当前 reducer 状态快照;每次 emit() 后同步更新(不经过内部异步队列,读到的永远是
   *  emit() 调用那一刻算出的最新值)。 */
  readonly state: RunFeedbackState;
  /**
   * run:start 等价物:emit 一次 "plan" 永久事件、把自己注册为 sink.ts 的活跃目的地(此后
   * `reportActivity`/`reportDiagnostic`/… 转发给它)、启动 tick 定时器。只能调用一次 ——
   * 重复调用是编程错误(意味着同一个 coordinator 实例被跨 run 复用),直接抛错。
   */
  start(plan: RunFeedbackPlan): void;
  /**
   * 任意 `RunFeedbackEvent` 的通用入口:lifecycle/tick/durable 都走这里。`diagnostic()`/
   * `activity()`/`interrupted()`/`reporterError()` 是构造 durable 事件的便捷封装,内部
   * 也调用这个方法,保证两条路径(未来的 typed lifecycle 接线 vs 今天的 sink.ts 迁移出口)
   * 共用同一套 reducer 更新与 renderer 分派逻辑。
   */
  emit(event: RunFeedbackEvent): void;
  /**
   * 关闭顺序第 1-2 步:停止 tick 定时器、清空 dynamic 区域(见 docs「明确 sink 关闭顺序」)。
   * 之后 `diagnostic()`/`activity()` 仍可调用(reporter 收尾阶段可能还有诊断要报),但不会
   * 再触发 clearDynamic/redrawDynamic —— 只是纯追加,不会有 timer 再驱动一次重画。幂等:
   * 重复调用只有第一次生效。
   */
  stopDynamic(): Promise<void>;
  /**
   * 关闭顺序最后一步:确保 stopDynamic() 已执行,追加 "summary"/"saved" 两个永久事件,
   * 排空内部队列,通知 `renderer.close()`,并把自己从 sink.ts 的活跃栈里摘下(之后
   * `reportActivity()` 等调用会落回 bootstrap 兜底)。resolve 后保证不会再有任何 timer 或
   * 排队任务写终端 —— 调用方(CLI 接线阶段)应在这一步之前完成全部 reporter 收尾
   * (`onRunComplete` 等),让 reporter 收尾期间产生的诊断仍能走 stopDynamic() 之后的
   * 纯追加路径,而不是彻底没有出口。
   */
  finish(input: {
    summary: RunSummary;
    completion: RunCompletion;
    paths: readonly string[];
    /** 实际写出的 `--json` 聚合报告路径;省略表示没有写出(未传 `--json` 或写入失败),
     *  转发进 "saved" 永久事件的同名字段,供 ci renderer 打印独立的 `json=` 行(见
     *  docs/feature/experiments/cli.md「CI 怎么用」)。human/agent renderer 不读这两个字段。 */
    json?: string;
    /** 实际写出的 `--junit` 聚合报告路径,语义同 `json`。 */
    junit?: string;
  }): Promise<void>;
}

type Phase = "idle" | "active" | "dynamicStopped" | "finished";

export function createFeedbackCoordinator(options: FeedbackCoordinatorOptions): FeedbackCoordinator {
  const { profile, renderer, io } = options;
  const tickIntervalMs = options.tickIntervalMs ?? DEFAULT_TICK_INTERVAL_MS;

  let phase: Phase = "idle";
  let state: RunFeedbackState = createInitialRunFeedbackState();
  let startedAtMs = 0;
  let tickHandle: FeedbackTimerHandle | undefined;
  let deactivate: (() => void) | undefined;
  const queue = new SerialQueue();

  function guardWritable(): boolean {
    if (phase === "idle") {
      throw new Error("FeedbackCoordinator: cannot report before start() has been called.");
    }
    return phase !== "finished";
  }

  function emit(event: RunFeedbackEvent): void {
    if (!guardWritable()) return;
    // dynamic 区域是否该围着这次投递做 clear/redraw,由「emit() 被调用那一刻」的 phase 决定,
    // 不是「排队任务真正执行那一刻」—— 队列是异步的,stopDynamic() 可能在这次投递已经入队、
    // 但还没轮到执行之前就同步翻转 phase。若在任务体内才读 phase,会让「stopDynamic() 调用
    // 前就已经合法入队」的 clear/redraw 被事后取消,产生「明明还在 active 阶段发生的事件,
    // 却因为收尾快了一步而丢了动态区域重建」的错误行为。这里同步捕获、随事件一起传下去,
    // 让「这次投递该不该有动态区域包裹」在入队瞬间就已经确定,不受后续 phase 变化影响。
    const bracket = phase === "active";
    state = reduceRunFeedback(state, event);
    const snapshot = state;
    switch (event.type) {
      case "attempt:queued":
      case "attempt:start":
      case "attempt:phase":
      case "attempt:progress":
      case "attempt:complete":
      case "attempt:early-exit":
        queue.push(() => renderer.onLifecycle?.(event, snapshot));
        return;
      case "experiment:progress":
        // 短命状态,只进 reducer(上面已更新 state.experimentHooks 的 detail);下一次 tick 的
        // 重画会读到新值,不为每条 progress 单独排一次渲染任务。
        return;
      case "tick":
        queue.push(() => renderer.onTick?.(event, snapshot));
        return;
      default: {
        // 穷尽性检查:剩下的只能是 DurableFeedbackEvent 的某个变体。新增 lifecycle/tick 事件
        // 类型时,这里会在编译期报错提醒补上对应 case —— 不会被无声地误分类成 durable
        // 并因此错误地触发 clearDynamic/redrawDynamic。反过来,新增 DurableFeedbackEvent
        // 的变体不需要动这个 switch(default 分支天然覆盖)。
        const durable: DurableFeedbackEvent = event;
        queue.push(() => deliverDurable(durable, snapshot, bracket));
        return;
      }
    }
  }

  async function deliverDurable(
    event: DurableFeedbackEvent,
    snapshot: RunFeedbackState,
    bracket: boolean,
  ): Promise<void> {
    try {
      if (bracket) await renderer.clearDynamic?.();
      await renderer.appendDurable(event, snapshot);
      if (bracket) await renderer.redrawDynamic?.(snapshot);
    } catch (e) {
      onRendererError(e, event.type, fallbackTextFor(event));
    }
  }

  function activity(text: string): void {
    if (!guardWritable()) return;
    const bracket = phase === "active"; // 同上,入队瞬间捕获。
    const snapshot = state;
    queue.push(async () => {
      try {
        if (bracket) await renderer.clearDynamic?.();
        await renderer.activity?.(text, snapshot);
        if (bracket) await renderer.redrawDynamic?.(snapshot);
      } catch (e) {
        onRendererError(e, "activity", text);
      }
    });
  }

  function diagnostic(input: DiagnosticInput): void {
    emit({
      type: "diagnostic",
      at: io.clock.now(),
      key: input.key,
      severity: input.severity,
      message: input.message,
      identity: input.identity,
      data: input.data,
    });
  }

  function interrupted(): void {
    emit({ type: "interrupted", at: io.clock.now() });
  }

  function failure(input: FailureInput): void {
    emit({
      type: "failure",
      at: io.clock.now(),
      locator: input.locator,
      identity: input.identity,
      who: input.who,
      verdict: input.verdict,
      reason: input.reason,
      ...(input.assertion !== undefined ? { assertion: input.assertion } : {}),
      ...(input.phase !== undefined ? { phase: input.phase } : {}),
    });
  }

  function kept(input: KeptInput): void {
    emit({
      type: "kept",
      at: io.clock.now(),
      locator: input.locator,
      identity: input.identity,
      who: input.who,
      verdict: input.verdict,
      provider: input.provider,
      sandboxId: input.sandboxId,
      ...(input.enter !== undefined ? { enter: input.enter } : {}),
    });
  }

  function budgetExhausted(input: BudgetExhaustedInput): void {
    emit({
      type: "budget-exhausted",
      at: io.clock.now(),
      experimentId: input.experimentId,
      spent: input.spent,
      unstarted: input.unstarted,
    });
  }

  function experimentHook(input: ExperimentHookInput): void {
    emit({
      type: "experiment-hook",
      at: io.clock.now(),
      experimentId: input.experimentId,
      hook: input.hook,
      status: input.status,
      ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
    });
  }

  function experimentProgress(input: ExperimentProgressInput): void {
    emit({ type: "experiment:progress", at: io.clock.now(), experimentId: input.experimentId, detail: input.detail });
  }

  function reporterError(input: { reporter: string; required: boolean; message: string }): void {
    emit({
      type: "reporter-error",
      at: io.clock.now(),
      reporter: input.reporter,
      required: input.required,
      message: input.message,
    });
  }

  /** `FeedbackSink.lifecycle` 实现:`emit` 已经穷尽处理 `AttemptLifecycleEvent`(见上面的
   *  switch),这里只是把 sink.ts 的窄接口对上同一个入口 —— 不是第二套分派逻辑。 */
  function lifecycle(event: AttemptLifecycleEvent): void {
    emit(event);
  }

  function onRendererError(e: unknown, context: string, fallbackMessage: string | undefined): void {
    const detail = e instanceof Error ? e.message : String(e);
    // renderer 自己崩了:这是「feedback sink 自己」的兜底出口,允许保留裸写(见 docs 的
    // 「删除与搜索验收」允许清单)—— 没有更下层的 coordinator 可以再兜一次。
    writeStderrLine(t("feedback.rendererError", { context, message: detail }));
    if (fallbackMessage) writeStderrLine(`  · ${fallbackMessage}\n`);
  }

  function start(plan: RunFeedbackPlan): void {
    if (phase !== "idle") {
      throw new Error("FeedbackCoordinator: start() called more than once.");
    }
    phase = "active";
    startedAtMs = io.clock.now();
    deactivate = activateFeedbackSink({
      activity,
      diagnostic,
      interrupted,
      reporterError,
      failure,
      budgetExhausted,
      kept,
      experimentHook,
      experimentProgress,
      lifecycle,
    });
    emit({ type: "plan", at: startedAtMs, plan });
    tickHandle = io.clock.setInterval(() => {
      if (phase !== "active") return;
      const now = io.clock.now();
      emit({ type: "tick", at: now, elapsedMs: now - startedAtMs });
    }, tickIntervalMs);
  }

  async function stopDynamic(): Promise<void> {
    if (phase === "idle") {
      throw new Error("FeedbackCoordinator: stopDynamic() called before start().");
    }
    if (phase !== "active") return; // 已经 stopDynamic 过(dynamicStopped)或已 finish,幂等
    phase = "dynamicStopped";
    if (tickHandle !== undefined) {
      io.clock.clearInterval(tickHandle);
      tickHandle = undefined;
    }
    // 无条件再清一次:即便前面某个仍在队列里的任务已经清过,重复调用 clearDynamic 必须安全
    // (renderer.ts 对它的幂等性有明确要求)。这一步保证「不管前面发生了什么交错,收尾时
    // dynamic 区域一定是空的」。
    queue.push(() => renderer.clearDynamic?.());
    await queue.drain();
  }

  async function finish(input: {
    summary: RunSummary;
    completion: RunCompletion;
    paths: readonly string[];
    json?: string;
    junit?: string;
  }): Promise<void> {
    if (phase === "finished") return; // 幂等
    await stopDynamic();
    emit({ type: "summary", at: io.clock.now(), summary: input.summary, completion: input.completion });
    emit({ type: "saved", at: io.clock.now(), paths: input.paths, json: input.json, junit: input.junit });
    await queue.drain();
    try {
      await renderer.close?.();
    } catch (e) {
      onRendererError(e, "close", undefined);
    }
    phase = "finished";
    deactivate?.();
    deactivate = undefined;
  }

  return {
    profile,
    get state() {
      return state;
    },
    start,
    emit,
    activity,
    diagnostic,
    interrupted,
    reporterError,
    failure,
    budgetExhausted,
    kept,
    experimentHook,
    experimentProgress,
    lifecycle,
    stopDynamic,
    finish,
  };
}

/** 渲染失败时的兜底文本 —— 保证一条真正的失败/诊断证据不会因为 renderer 自己抛错而彻底
 *  消失。"plan"/"summary"/"saved" 不需要兜底文本:它们描述的信息在 RunFeedbackState / 落盘
 *  结果里仍然完整,renderer 崩溃只是丢了这一次的终端展示,不是丢了数据本身。 */
function fallbackTextFor(event: DurableFeedbackEvent): string | undefined {
  switch (event.type) {
    case "failure":
      return `${event.who} ${event.verdict}: ${event.reason}`;
    case "diagnostic":
      return event.message;
    case "budget-exhausted":
      return `budget exhausted for ${event.experimentId} (spent ${event.spent}, unstarted ${event.unstarted})`;
    case "interrupted":
      return "run interrupted";
    case "reporter-error":
      return `reporter "${event.reporter}" failed: ${event.message}`;
    case "plan":
    case "summary":
    case "saved":
    case "experiment-hook":
      // 钩子起止不是失败证据:setup 失败的每条 attempt 另有 "failure" 事件兜底,
      // renderer 崩溃丢一行起止不丢数据。
      return undefined;
  }
}

/**
 * 一个先进先出的异步串行队列:保证一批 push() 进来的任务严格按顺序、一个跑完才跑下一个 ——
 * durable 事件的 clear→append→redraw 三步,以及跨多个事件的整体顺序,都靠它保证原子性,
 * 不需要每个调用方自己加锁。单个任务抛错不会让队列卡死(catch 后继续跑下一个)—— 各调用方
 * (deliverDurable/activity)已经各自兜错,这里的 catch 只是双保险,防止兜底逻辑本身的
 * bug poison 掉整条链。
 */
class SerialQueue {
  private tail: Promise<void> = Promise.resolve();

  push(task: () => void | Promise<void>): void {
    this.tail = this.tail.then(async () => {
      try {
        await task();
      } catch {
        // 见类内注释:双保险,不应该正常触发。
      }
    });
  }

  async drain(): Promise<void> {
    await this.tail;
  }
}
