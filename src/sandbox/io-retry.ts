// 已创建 Sandbox 的幂等文件 IO 重试。命令执行、appendLog、stop 不经过这里：
// 它们可能有不可重复的副作用，框架不能在调用者不知情时重跑。

import { Cause, Effect, Exit, Option, Random } from "effect";
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

/** Effect-native idempotent IO retry state machine. */
export function withSandboxIoRetryEffect<T, E>(
  operation: () => Effect.Effect<T, E>,
  options: SandboxIoRetryOptions = {},
): Effect.Effect<T, E> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS);
  const classify = options.classify ?? classifySandboxIoError;

  const loop = (attempt: number): Effect.Effect<T, E> =>
    Effect.suspend(() =>
      operation().pipe(
        Effect.catchAll((error) => {
          const kind = classify(error);
          if (!isRetryableSandboxIoError(kind) || attempt >= maxAttempts) return Effect.fail(error);
          return Effect.gen(function*() {
            const random = yield* Random.next;
            const delayMs = baseDelayMs * 2 ** (attempt - 1) * (0.5 + random);
            options.onRetry?.({ attempt, delayMs, kind, error });
            yield* Effect.sleep(delayMs);
            return yield* loop(attempt + 1);
          });
        }),
      ),
    );

  return loop(1);
}

/** Existing Promise façade for Sandbox path operations. */
export function withSandboxIoRetry<T>(
  operation: () => Promise<T>,
  options: SandboxIoRetryOptions = {},
): Promise<T> {
  const effect = withSandboxIoRetryEffect(
    () => Effect.tryPromise({ try: operation, catch: (error) => error }),
    options,
  );
  return Effect.runPromiseExit(effect).then((exit) => {
    if (Exit.isSuccess(exit)) return exit.value;
    const failure = Cause.failureOption(exit.cause);
    if (Option.isSome(failure)) throw failure.value;
    throw Cause.squash(exit.cause);
  });
}
