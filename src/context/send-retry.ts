// Agent send 的唯一重试执行体。正常返回的三种 Turn status 都原样交回；只有 reject 的
// SendFailure 进入分类和重试（docs/feature/error-classification/architecture.md）。

import { Effect } from "effect";

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
import { normalizeExternalCause } from "../shared/external-cause.ts";

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
  readonly release: Effect.Effect<void>;
  readonly reacquire: Effect.Effect<void>;
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
  /** 仅供既有确定性测试注入；生产退避始终使用 Effect.sleep。 */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

/** Adapt the Attempt-owned AbortSignal into interruption, without turning it into a send failure. */
function awaitAbort(signal: AbortSignal): Effect.Effect<void> {
  return Effect.async<void>((resume) => {
    if (signal.aborted) {
      resume(Effect.void);
      return;
    }
    const onAbort = () => resume(Effect.void);
    signal.addEventListener("abort", onAbort, { once: true });
    return Effect.sync(() => signal.removeEventListener("abort", onAbort));
  });
}

function retrySleep(deps: SendRetryDeps, delayMs: number): Effect.Effect<void, unknown> {
  const delay = deps.sleep
    ? Effect.tryPromise({
        try: (signal) => deps.sleep!(delayMs, signal),
        catch: (error) => error,
      })
    : Effect.sleep(delayMs);
  return Effect.raceFirst(
    delay.pipe(Effect.as("delay" as const)),
    awaitAbort(deps.signal).pipe(Effect.as("aborted" as const)),
  ).pipe(Effect.flatMap((winner) => winner === "aborted" ? Effect.interrupt : Effect.void));
}

/**
 * A retried Attempt gives its global slot back while waiting. acquireUseRelease
 * registers reacquire before entering the interruptible sleep, so interruption
 * cannot permanently shrink available capacity.
 */
function sleepWithReleasedSlot(
  slot: ConcurrencySlot | undefined,
  sleep: Effect.Effect<void, unknown>,
): Effect.Effect<void, unknown> {
  if (slot === undefined) return sleep;
  return Effect.acquireUseRelease(
    Effect.suspend(() => slot.release),
    () => sleep,
    () => Effect.suspend(() => slot.reacquire),
  );
}

/**
 * 对同一个物理输入至多调用四次。adapter 未使用 makeSendFailure 而直接抛出的值在这里
 * 保守归一为 acceptance=unknown，因此会得到稳定 agent-send-failed，而不会被误重发。
 */
export function sendWithTurnRetry<T>(
  callOnce: Effect.Effect<T, unknown>,
  deps: SendRetryDeps,
): Effect.Effect<T, unknown> {
  const random = deps.random ?? Math.random;
  const retry = (sendAttempt: number): Effect.Effect<T, unknown> =>
    Effect.suspend(() => {
      const startedAtMs = Date.now();
      const monotonicStartedAt = performance.now();
      return callOnce.pipe(
        Effect.mapError(normalizeSendFailure),
        Effect.catchAll((failure) => {
          const durationMs = Math.max(0, performance.now() - monotonicStartedAt);
          const cls = resolveSendFailureClass(failure, {
            experiment: deps.experimentClassifier,
            adapter: deps.classifier,
          });
          if (!cls.retryable) return Effect.fail(attachFailureClass(failure, cls));
          if (sendAttempt + 1 >= SEND_MAX_ATTEMPTS) {
            return Effect.fail(finalizeExhausted(failure, cls, "send"));
          }
          if (deps.budget.remaining <= 0) {
            return Effect.fail(finalizeExhausted(failure, cls, "attempt"));
          }

          const delayMs = BASE_DELAY_MS * 2 ** sendAttempt * random();
          return Effect.sync(() => {
            deps.onRetryAttempt?.({
              sendAttempt,
              startedAt: new Date(startedAtMs).toISOString(),
              durationMs,
              failure,
              classification: cls,
            });
            deps.budget.remaining -= 1;
            deps.reportRetry?.(
              t("session.turnRetry", {
                attempt: sendAttempt + 2,
                maxAttempts: SEND_MAX_ATTEMPTS,
                reason: cls.reason,
                seconds: Math.round(delayMs / 1000),
              }),
            );
          }).pipe(
            Effect.zipRight(sleepWithReleasedSlot(deps.slot, retrySleep(deps, delayMs))),
            Effect.zipRight(retry(sendAttempt + 1)),
          );
        }),
      );
    });

  return retry(0);
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
    cause: normalizeExternalCause(failure),
  });
  return attachFailureClass(wrapped, cls);
}
