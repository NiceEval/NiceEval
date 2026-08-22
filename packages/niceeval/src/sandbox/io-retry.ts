// 已创建 Sandbox 的幂等文件 IO 重试。命令执行、appendLog、stop 不经过这里：
// 它们可能有不可重复的副作用，框架不能在调用者不知情时重跑。

import { Effect, Random } from "effect";

import {
  classifySandboxIoError,
  isRetryableSandboxIoError,
  type SandboxIoErrorKind,
} from "./errors.ts";

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 250;

export interface SandboxIoRetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  classify?: (error: unknown) => SandboxIoErrorKind;
  /** 内部可观察挂点；runner feedback 接入后由统一包装层注入。 */
  onRetry?: (event: { attempt: number; delayMs: number; kind: SandboxIoErrorKind; error: unknown }) => void;
}

/**
 * operation 是 Provider Promise 叶子被 `Effect.tryPromise` 适配过**一次**后的 Effect：
 * 失败通道里就是原始错误对象，重试耗尽时原样抛回，不包一层新的错误。
 * 等待用 `Effect.sleep`、抖动用 `Random.next`，确定性验证交给 TestClock / 固定 Random。
 */
export function withSandboxIoRetry<T>(
  operation: Effect.Effect<T, unknown>,
  options: SandboxIoRetryOptions = {},
): Effect.Effect<T, unknown> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS);
  const classify = options.classify ?? classifySandboxIoError;

  const retry = (attempt: number): Effect.Effect<T, unknown> =>
    Effect.gen(function* () {
      return yield* operation.pipe(
        Effect.catchAll((error) => Effect.gen(function* () {
          const kind = classify(error);
          if (!isRetryableSandboxIoError(kind) || attempt >= maxAttempts) return yield* Effect.fail(error);
          const jitter = yield* Random.next;
          const delayMs = baseDelayMs * 2 ** (attempt - 1) * (0.5 + jitter);
          yield* Effect.sync(() => options.onRetry?.({ attempt, delayMs, kind, error }));
          yield* Effect.sleep(delayMs);
          return yield* retry(attempt + 1);
        })),
      );
    });

  return retry(1);
}
