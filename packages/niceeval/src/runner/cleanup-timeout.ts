// 收尾可调用体的有界执行:eval/agent/sandbox 各段的 cleanup、钩子与实验级 cleanup 共用。
// 有界性是「强清 = 加速收尾」设计的前提(docs/cli.md「中断:三级响应」):任何一个挂起的收尾
// 都不能无限拖住退出,到点按该段自己的失败语义收束(teardown-failed / experiment-teardown-failed
// 诊断),超时后遗留的 promise 悬空,随进程退出消亡。

import { Data, Effect } from "effect";
import { t } from "../i18n/index.ts";

/** 单个收尾可调用体的清理超时(docs 声明值,provider stop 另有自己的 8s 超时)。 */
export const CLEANUP_TIMEOUT_MS = 30_000;

export class CleanupTimeoutError extends Data.TaggedError("CleanupTimeoutError")<{
  readonly timeoutMs: number;
  readonly message: string;
}> {}

/**
 * Bounded cleanup stays inside the owning Scope. `tryPromise` supplies the
 * callback's only signal, and timeout interrupts that fiber. A legacy callback
 * which ignores the signal remains a process-level Promise, while the owning
 * Scope proceeds after the virtual timeout without disconnecting its cleanup.
 */
export function withCleanupTimeout<T, Error, Requirements>(
  effect: Effect.Effect<T, Error, Requirements>,
  timeoutMs = CLEANUP_TIMEOUT_MS,
): Effect.Effect<T, Error | CleanupTimeoutError, Requirements> {
  return effect.pipe(Effect.timeoutOrElse({
    duration: timeoutMs,
    orElse: () => Effect.fail(new CleanupTimeoutError({
      timeoutMs,
      message: t("runner.cleanupTimeout", { timeoutMs }),
    })),
  }));
}

/** Author / provider callback adapter; internal callers compose this Effect directly. */
export function cleanupCallback<T>(
  fn: (signal: AbortSignal) => PromiseLike<T> | T,
  timeoutMs = CLEANUP_TIMEOUT_MS,
): Effect.Effect<T, unknown | CleanupTimeoutError> {
  return withCleanupTimeout(
    Effect.tryPromise({
      // Keep this wrapper arity at one: Effect only creates and aborts the
      // signal for a `tryPromise` callback that declares it.
      try: (signal) => Promise.resolve(fn(signal)),
      // Preserve the callback's original error identity for legacy diagnostics.
      catch: (cause) => cause,
    }).pipe(
      // Scope finalizers run uninterruptibly. The cleanup child itself must be
      // interruptible so `timeoutFail` can abort its tryPromise signal and let
      // Scope.close finish at the virtual deadline.
      Effect.interruptible,
    ),
    timeoutMs,
  );
}
