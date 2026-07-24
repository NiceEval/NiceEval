// turn 级重试执行体:包住 context 层对 `agent.send(...)` 的那一次调用(全仓库唯一 choke
// point,见 docs/feature/error-classification/architecture.md「重试执行体」)。这里只管
// 「要不要重试、睡多久、耗尽后怎么收尾」;失败分类的判据在 turn-errors.ts,这个模块只消费
// 分类结果。会话记账(turnCount 自增、userEvent 推入)在调用方早已完成,重试循环看不到、
// 也不重放它们——被吸收的失败尝试的 Turn 只在这个循环内部经过,从不外泄。

import type { Turn } from "../types.ts";
import { t } from "../i18n/index.ts";
import { attachFailureClass, type AttemptFailureClassifier, type FailureClass } from "../shared/failure-class.ts";
import { resolveTurnFailureClass, type TurnErrorClassifier, type TurnFailure } from "./turn-errors.ts";

/** 单次 send 调用封顶的尝试次数(首次 + 至多 3 次重试)。 */
export const SEND_MAX_ATTEMPTS = 4;
/** 整个 attempt 全部 send 加总的重试次数封顶。 */
export const ATTEMPT_MAX_RETRIES = 8;
/** 指数 + 全抖动的基数:第 n 次重试前睡 `uniform(0, BASE_DELAY_MS * 2^(n-1))`。 */
const BASE_DELAY_MS = 5000;

/**
 * attempt 级重试预算:跨该 attempt 全部 send 持续扣减,不随单次 send 重置。由
 * `SessionManager` 持有一份、贯穿整个 attempt 的生命周期(见 session.ts)。
 */
export interface AttemptRetryBudget {
  remaining: number;
}

export function createAttemptRetryBudget(): AttemptRetryBudget {
  return { remaining: ATTEMPT_MAX_RETRIES };
}

/**
 * 退避期间释放/收回并发槽位的接口——与 sandbox provisioning 重试
 * (`src/sandbox/retry.ts` 的 `ProvisionSlot`)同一形状,各自实现、不共享:被限流的一批
 * attempt 不该攥着全局并发名额陪睡。
 */
export interface ConcurrencySlot {
  release(): Promise<void>;
  reacquire(): Promise<void>;
}

/** 把「一次逻辑 send 的返回值」读写成 Turn 的取值器——非 otel 路径 T 就是 Turn 本身,
 *  otel 路径 T 是 `{ turn, traceId, attribution }`,重试只需要认得其中的 Turn。 */
export interface TurnLens<T> {
  get(result: T): Turn;
  set(result: T, turn: Turn): T;
}

export interface SendRetryDeps {
  /** adapter 声明的分类器(可选),undefined 回落保守兜底。 */
  classifier?: TurnErrorClassifier;
  /** 实验声明的分类器(`ExperimentDef.classifyFailure`,可选),排在 adapter 之前询问。 */
  experimentClassifier?: AttemptFailureClassifier;
  /**
   * 终局失败(不重试 / 重试耗尽)的分类回执:被重试吸收的失败不回调——只有真正浮出的失败
   * 携带分类,止损闸消费的空间轴由此抵达 attempt 封口。`turn-failed` 形态的失败没有错误对象
   * 可标记(错误在 `expectOk()` 才铸造),经这条回执转交调用方。
   */
  onFinalFailure?: (cls: FailureClass, failure: TurnFailure) => void;
  /** attempt 级预算,持续扣减(调用方在 attempt 生命周期内只创建一份并跨多次 send 复用)。 */
  budget: AttemptRetryBudget;
  /** 省略时不释放槽位(测试 / 无并发闸场景)。 */
  slot?: ConcurrencySlot;
  /** activity 行(不产生 diagnostic);省略时不上报。 */
  reportRetry?: (message: string) => void;
  /** 退避睡眠可被它干净打断;外层 attempt deadline 原样生效,这里不新增超时语义。 */
  signal: AbortSignal;
  /** 仅供确定性单测注入。 */
  random?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

/** 默认退避睡眠:signal 已 abort 时立即拒绝;abort 事件触发时清掉定时器并立即拒绝,
 *  不占满整段延迟——这是退避睡眠「可被干净打断」的落点。 */
function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error("aborted"));
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason ?? new Error("aborted"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** 失败 Turn 里最后一条 `error` 事件追加后缀;没有 error 事件时无处可加,返回 undefined。 */
function appendToLastErrorEvent(turn: Turn, suffix: string): Turn | undefined {
  const events = turn.events;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type === "error") {
      const next = events.slice();
      next[i] = { ...e, message: e.message + suffix };
      return { ...turn, events: next };
    }
  }
  return undefined;
}

/**
 * turn 级重试执行体:反复调 `callOnce()`(每次都是原样重发同一个 `TurnInput`),对失败结果
 * 走三道分类链(见 turn-errors.ts 的 `resolveTurnErrorClass`),可重试则退避后重试,否则把
 * 失败原样(或带耗尽摘要)浮出。
 */
export async function sendWithTurnRetry<T>(
  callOnce: () => Promise<T>,
  lens: TurnLens<T>,
  deps: SendRetryDeps,
): Promise<T> {
  const random = deps.random ?? Math.random;
  const sleep = deps.sleep ?? defaultSleep;

  for (let sendAttempt = 1; ; sendAttempt++) {
    let failure: TurnFailure;
    let result: T | undefined;
    try {
      result = await callOnce();
      const turn = lens.get(result);
      if (turn.status !== "failed") return result;
      failure = { type: "turn-failed", turn };
    } catch (e) {
      failure = { type: "thrown", error: e };
    }

    const cls = resolveTurnFailureClass(failure, {
      experiment: deps.experimentClassifier,
      adapter: deps.classifier,
    });
    // 终局失败才携带分类浮出:被吸收的失败尝试不留痕(见 architecture.md「重试执行体」),
    // 它的 scope 永远到不了止损闸。
    if (!cls.retryable) return finalize(failure, result, lens, deps, cls);
    if (sendAttempt >= SEND_MAX_ATTEMPTS) return finalize(failure, result, lens, deps, cls, { layer: "send", cls });
    if (deps.budget.remaining <= 0) return finalize(failure, result, lens, deps, cls, { layer: "attempt", cls });

    deps.budget.remaining -= 1;
    const delayMs = BASE_DELAY_MS * 2 ** (sendAttempt - 1) * random();
    deps.reportRetry?.(
      t("session.turnRetry", {
        attempt: sendAttempt + 1,
        maxAttempts: SEND_MAX_ATTEMPTS,
        reason: cls.reason,
        seconds: Math.round(delayMs / 1000),
      }),
    );

    if (deps.slot) await deps.slot.release();
    try {
      await sleep(delayMs, deps.signal);
    } finally {
      // 即便退避睡眠被中断打断,也要先收回槽位再让中断继续传播——否则外层信号量的
      // permit 记账会被打乱(release 过一次、从未 reacquire,永久少一个可用名额)。
      if (deps.slot) await deps.slot.reacquire();
    }
  }
}

/**
 * 循环收口:未耗尽的非重试失败原样浮出;耗尽时按耗尽层追加摘要文本。两条路径都先把终局分类
 * 挂到浮出的失败上(`thrown` 形态标在错误对象上,沿 cause 链可读;两种形态都经 `onFinalFailure`
 * 回执),抛出点自己声明过分类的错误不被覆盖。
 */
function finalize<T>(
  failure: TurnFailure,
  result: T | undefined,
  lens: TurnLens<T>,
  deps: SendRetryDeps,
  cls: FailureClass,
  exhausted?: { layer: "send" | "attempt"; cls: Extract<FailureClass, { retryable: true }> },
): T {
  if (!exhausted) {
    deps.onFinalFailure?.(cls, failure);
    if (failure.type === "thrown") throw attachFailureClass(failure.error, cls);
    return result as T;
  }
  const suffix =
    exhausted.layer === "send"
      ? t("session.turnRetrySendExhausted", { maxAttempts: SEND_MAX_ATTEMPTS, reason: exhausted.cls.reason })
      : t("session.turnRetryBudgetExhausted", { maxRetries: ATTEMPT_MAX_RETRIES, reason: exhausted.cls.reason });

  if (failure.type === "thrown") {
    deps.onFinalFailure?.(cls, failure);
    const e = failure.error;
    // adapter 抛出的 Error 仍可能被上层保留、复用或记录；不要原地篡改它(分类标记挂在外层)。
    if (e instanceof Error) throw attachFailureClass(new Error(e.message + suffix, { cause: e }), cls);
    throw attachFailureClass(e, cls);
  }
  // 追加摘要产出的是一个新的 Turn 对象;回执必须报浮出的那个,分类才登记在调用方拿到的 Turn 上。
  const withSuffix = appendToLastErrorEvent(failure.turn, suffix);
  const finalTurn = withSuffix ?? failure.turn;
  deps.onFinalFailure?.(cls, { type: "turn-failed", turn: finalTurn });
  return withSuffix ? lens.set(result as T, withSuffix) : (result as T);
}
