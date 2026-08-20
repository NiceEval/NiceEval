// provider 无关的 provisioning 退避重试:runtime adapter 对每个内置 provider 的
// create/provision 步骤套这一层。只有各 provider 自己的 classifyProvisionError 判为
// 可重试的错误才会退避重试;其它错误第一次就抛出。防泄漏的两道防线
// (见 docs/feature/sandbox/architecture.md「Provisioning 失败与重试」)中,这里承担
// 「重试前对账」;kill-on-failure 在各 provider 的 create() 内部。

import { Cause, Effect, Exit, Option, Random } from "effect";
import { isRejectedProvisionError, isRetryableProvisionError, type SandboxProvisionErrorKind } from "./errors.ts";
import { t } from "../i18n/index.ts";
import { reportActivity, reportDiagnostic } from "../runner/feedback/sink.ts";
import type { ScopedFeedback } from "../types.ts";

const MAX_ATTEMPTS = 4;
const BASE_DELAY_MS = 1000;

/** Promise 只留在现有 provider façade；重试状态机使用 EffectProvisionSlot。 */
export interface ProvisionSlot {
  release(): Promise<void>;
  reacquire(): Promise<void>;
}

export interface EffectProvisionSlot {
  readonly release: Effect.Effect<void, unknown>;
  readonly reacquire: Effect.Effect<void, unknown>;
}

export interface ProvisionRetryEffectOptions {
  readonly slot?: EffectProvisionSlot;
  readonly feedback?: ScopedFeedback;
  readonly reconcile?: Effect.Effect<void, unknown>;
}

/** Effect-native provisioning retry state machine. */
export function withProvisionRetryEffect<T, E>(
  create: () => Effect.Effect<T, E>,
  classify: (error: E) => SandboxProvisionErrorKind,
  options: ProvisionRetryEffectOptions = {},
): Effect.Effect<T, E | unknown> {
  const loop = (attempt: number): Effect.Effect<T, E | unknown> =>
    Effect.suspend(() =>
      create().pipe(
        Effect.catchAll((error) => {
          const kind = classify(error);
          if (!isRetryableProvisionError(kind) || attempt >= MAX_ATTEMPTS - 1) return Effect.fail(error);
          if (!isRejectedProvisionError(kind) && options.reconcile === undefined) return Effect.fail(error);

          return Effect.gen(function*() {
            const random = yield* Random.next;
            const delayMs = BASE_DELAY_MS * 2 ** attempt * (0.5 + random);
            const message = t("sandbox.provisionRetry", {
              delayMs: Math.round(delayMs),
              attempt: attempt + 1,
              maxAttempts: MAX_ATTEMPTS,
            }).trimEnd();
            if (options.feedback) options.feedback.progress({ message });
            else reportActivity(message);

            const backoff = Effect.sleep(delayMs);
            if (options.slot === undefined) {
              yield* backoff;
            } else {
              yield* Effect.acquireUseRelease(
                options.slot.release,
                () => backoff,
                () => options.slot!.reacquire.pipe(
                  Effect.orDieWith((error) => error instanceof Error ? error : new Error(String(error))),
                ),
              );
            }

            if (options.reconcile !== undefined) {
              const reconciled = yield* options.reconcile.pipe(
                Effect.as(true),
                Effect.catchAll((reconcileError) =>
                  Effect.sync(() => {
                    const diagnostic = {
                      code: "sandbox-provision-reconcile-failed",
                      level: "warning" as const,
                      message: t("sandbox.provisionReconcileFailed", { error: String(reconcileError) }).trimEnd(),
                    };
                    if (options.feedback) options.feedback.diagnostic(diagnostic);
                    else reportDiagnostic({ key: diagnostic.code, severity: diagnostic.level, message: diagnostic.message });
                    return false;
                  }),
                ),
              );
              if (!reconciled) return yield* Effect.fail(error);
            }

            return yield* loop(attempt + 1);
          });
        }),
      ),
    );

  return loop(0);
}

function promiseEffect<A>(thunk: () => Promise<A>): Effect.Effect<A, unknown> {
  return Effect.tryPromise({ try: thunk, catch: (error) => error });
}

async function runPromiseFacade<A>(effect: Effect.Effect<A, unknown>): Promise<A> {
  const exit = await Effect.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) return exit.value;
  const failure = Cause.failureOption(exit.cause);
  if (Option.isSome(failure)) throw failure.value;
  throw Cause.squash(exit.cause);
}

/** Existing Promise façade for provider SDK callers. */
export function withProvisionRetry<T>(
  create: () => Promise<T>,
  classify: (e: unknown) => SandboxProvisionErrorKind,
  slot?: ProvisionSlot,
  feedback?: ScopedFeedback,
  /**
   * 对账钩子按 provision token 检索并销毁可能已创建的实例。每次重试前都执行；失败时
   * 放弃重试并保留原始 create 错误。没有对账通道的歧义失败不盲重试。
   */
  reconcile?: () => Promise<void>,
): Promise<T> {
  return runPromiseFacade(withProvisionRetryEffect(
    () => promiseEffect(create),
    classify,
    {
      ...(slot === undefined
        ? {}
        : { slot: { release: promiseEffect(() => slot.release()), reacquire: promiseEffect(() => slot.reacquire()) } }),
      ...(feedback === undefined ? {} : { feedback }),
      ...(reconcile === undefined ? {} : { reconcile: promiseEffect(reconcile) }),
    },
  ));
}
