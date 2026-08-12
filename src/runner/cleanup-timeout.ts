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
 * Bounded cleanup stays inside the owning Scope. On timeout Effect interrupts
 * the cleanup fiber; a legacy callback that ignores cancellation remains an
 * intentional dangling process-level Promise, matching the prior Promise.race
 * behavior until process exit.
 */
export function withCleanupTimeout<T, Error, Requirements>(
  effect: Effect.Effect<T, Error, Requirements>,
  timeoutMs = CLEANUP_TIMEOUT_MS,
): Effect.Effect<T, Error | CleanupTimeoutError, Requirements> {
  return effect.pipe(Effect.timeoutFail({
    duration: timeoutMs,
    onTimeout: () => new CleanupTimeoutError({
      timeoutMs,
      message: t("runner.cleanupTimeout", { timeoutMs }),
    }),
  }));
}

/** Author / provider callback adapter; internal callers compose this Effect directly. */
export function cleanupCallback<T>(
  fn: () => Promise<T> | T,
  timeoutMs = CLEANUP_TIMEOUT_MS,
): Effect.Effect<T, unknown | CleanupTimeoutError> {
  return withCleanupTimeout(
    Effect.tryPromise({
      try: () => Promise.resolve().then(fn),
      // Preserve the callback's original error identity for legacy diagnostics.
      catch: (cause) => cause,
    }),
    timeoutMs,
  );
}
