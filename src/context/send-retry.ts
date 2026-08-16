// Agent send 的唯一重试执行体。正常返回的三种 Turn status 都原样交回；只有 reject 的
// SendFailure 进入分类和重试（docs/feature/error-classification/architecture.md）。

import { Clock, Effect, Random } from "effect";

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
}

/** Adapt the Attempt-owned AbortSignal into interruption, without turning it into a send failure. */
function interruptWhenAborted(signal: AbortSignal): Effect.Effect<never> {
  return Effect.async<never>((resume) => {
    if (signal.aborted) {
      resume(Effect.interrupt);
      return;
    }
    const onAbort = () => resume(Effect.interrupt);
    signal.addEventListener("abort", onAbort, { once: true });
    return Effect.sync(() => signal.removeEventListener("abort", onAbort));
  });
}

function retrySleep(signal: AbortSignal, delayMs: number): Effect.Effect<void> {
  return Effect.raceFirst(Effect.sleep(delayMs), interruptWhenAborted(signal));
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
  const retry = (sendAttempt: number): Effect.Effect<T, unknown> =>
    Effect.gen(function* () {
      const startedAtMs = yield* Clock.currentTimeMillis;
      const monotonicStartedAt = yield* Clock.currentTimeNanos;
      return yield* callOnce.pipe(
        Effect.mapError(normalizeSendFailure),
        Effect.catchAll((failure) => Effect.gen(function* () {
          const monotonicEndedAt = yield* Clock.currentTimeNanos;
          const durationMs = Math.max(
            0,
            Number(monotonicEndedAt - monotonicStartedAt) / 1_000_000,
          );
          const cls = resolveSendFailureClass(failure, {
            experiment: deps.experimentClassifier,
            adapter: deps.classifier,
          });
          if (!cls.retryable) return yield* Effect.fail(attachFailureClass(failure, cls));
          if (sendAttempt + 1 >= SEND_MAX_ATTEMPTS) {
            return yield* Effect.fail(finalizeExhausted(failure, cls, "send"));
          }
          if (deps.budget.remaining <= 0) {
            return yield* Effect.fail(finalizeExhausted(failure, cls, "attempt"));
          }

          const jitter = yield* Random.next;
          const delayMs = BASE_DELAY_MS * 2 ** sendAttempt * jitter;
          yield* Effect.sync(() => {
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
          });
          yield* sleepWithReleasedSlot(deps.slot, retrySleep(deps.signal, delayMs));
          return yield* retry(sendAttempt + 1);
        })),
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
