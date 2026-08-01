// Agent send 的唯一重试执行体。正常返回的三种 Turn status 都原样交回；只有 reject 的
// SendFailure 进入分类和重试（docs/feature/error-classification/architecture.md）。

import { t } from "../i18n/index.ts";
import { attachFailureClass, type AttemptFailureClassifier, type FailureClass } from "../shared/failure-class.ts";
import {
  makeSendFailure,
  normalizeSendFailure,
  resolveSendFailureClass,
  sendFailureText,
  type SendFailure,
  type SendFailureClassifier,
} from "./send-failures.ts";

export const SEND_MAX_ATTEMPTS = 4;
export const ATTEMPT_MAX_RETRIES = 8;
const BASE_DELAY_MS = 5000;

export interface AttemptRetryBudget {
  remaining: number;
}

export function createAttemptRetryBudget(): AttemptRetryBudget {
  return { remaining: ATTEMPT_MAX_RETRIES };
}

export interface ConcurrencySlot {
  release(): Promise<void>;
  reacquire(): Promise<void>;
}

export interface RetriedSendFailure {
  /** 同一逻辑 send 内从 0 开始的物理尝试序号。 */
  sendAttempt: number;
  startedAt: string;
  durationMs: number;
  failure: SendFailure;
  classification: Extract<FailureClass, { retryable: true }>;
}

export interface SendRetryDeps {
  classifier?: SendFailureClassifier;
  experimentClassifier?: AttemptFailureClassifier;
  /** 只回报被自动重试吸收的物理失败；终局失败由抛出值承载。 */
  onRetryAttempt?: (attempt: RetriedSendFailure) => void;
  budget: AttemptRetryBudget;
  slot?: ConcurrencySlot;
  reportRetry?: (message: string) => void;
  signal: AbortSignal;
  random?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

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

/**
 * 对同一个物理输入至多调用四次。adapter 未使用 makeSendFailure 而直接抛出的值在这里
 * 保守归一为 acceptance=unknown，因此会得到稳定 agent-send-failed，而不会被误重发。
 */
export async function sendWithTurnRetry<T>(callOnce: () => Promise<T>, deps: SendRetryDeps): Promise<T> {
  const random = deps.random ?? Math.random;
  const sleep = deps.sleep ?? defaultSleep;

  for (let sendAttempt = 0; ; sendAttempt++) {
    const startedAtMs = Date.now();
    let failure: SendFailure;
    try {
      return await callOnce();
    } catch (error) {
      failure = normalizeSendFailure(error);
    }

    const durationMs = Date.now() - startedAtMs;
    const cls = resolveSendFailureClass(failure, {
      experiment: deps.experimentClassifier,
      adapter: deps.classifier,
    });
    if (!cls.retryable) throw attachFailureClass(failure, cls);

    if (sendAttempt + 1 >= SEND_MAX_ATTEMPTS) {
      throw finalizeExhausted(failure, cls, "send");
    }
    if (deps.budget.remaining <= 0) {
      throw finalizeExhausted(failure, cls, "attempt");
    }

    deps.onRetryAttempt?.({
      sendAttempt,
      startedAt: new Date(startedAtMs).toISOString(),
      durationMs,
      failure,
      classification: cls,
    });
    deps.budget.remaining -= 1;
    const delayMs = BASE_DELAY_MS * 2 ** sendAttempt * random();
    deps.reportRetry?.(
      t("session.turnRetry", {
        attempt: sendAttempt + 2,
        maxAttempts: SEND_MAX_ATTEMPTS,
        reason: cls.reason,
        seconds: Math.round(delayMs / 1000),
      }),
    );

    if (deps.slot) await deps.slot.release();
    try {
      await sleep(delayMs, deps.signal);
    } finally {
      // 睡眠被中断也必须先取回 permit，避免永久缩小全局并发容量。
      if (deps.slot) await deps.slot.reacquire();
    }
  }
}

function finalizeExhausted(
  failure: SendFailure,
  cls: Extract<FailureClass, { retryable: true }>,
  layer: "send" | "attempt",
): SendFailure {
  const suffix =
    layer === "send"
      ? t("session.turnRetrySendExhausted", { maxAttempts: SEND_MAX_ATTEMPTS, reason: cls.reason })
      : t("session.turnRetryBudgetExhausted", { maxRetries: ATTEMPT_MAX_RETRIES, reason: cls.reason });
  const wrapped = makeSendFailure({
    ...failure,
    message: sendFailureText(failure) + suffix,
    cause: failure,
  });
  return attachFailureClass(wrapped, cls);
}
