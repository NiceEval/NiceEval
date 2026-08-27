// Scope-bound Sandbox 请求执行器:公开 Sandbox Promise 方法内部唯一的 Effect 运行入口。
//
// executor 在所属 Effect 内创建,捕获当时的 Context 与 owner Scope。每个请求 fork 成
// owner Scope 的子 fiber 并登记追踪;Scope 关闭时由 Effect 机制统一中断所有在飞请求,
// 关闭后的新调用稳定以 SandboxRequestExecutorClosedError 拒绝。不同 Scope 各自捕获自己的
// Runtime/Scope,互不串用。
//
// 这里不使用 Effect.runPromise*（关闭中的 Scope 下语义不受控）、
// 默认 Runtime、daemon fiber 或原生 timer;Promise 桥接沿用 FiberHandle.runtimePromise
// 的 observer 模式(Fiber 退出时 resolve/reject)。

import { Cause, Effect, Exit, Fiber, Scope } from "effect";

export class SandboxRequestExecutorClosedError extends Error {
  override readonly name = "SandboxRequestExecutorClosedError";

  constructor() {
    super("sandbox request executor is closed; new requests are rejected");
  }
}

export interface SandboxRequestExecutor {
  /** 把请求 Effect 作为 owner Scope 的子 fiber 启动,返回公开 Promise。 */
  run<A, E>(operation: Effect.Effect<A, E>): Promise<A>;
  /** 当前在飞请求数;用于诊断与验收,不承担调度。 */
  readonly inFlight: () => number;
}

/**
 * 只能在所属 Effect 内创建(需要当前 Context 与 owner Scope)。返回的 executor 供
 * Promise facade 边界同步调用;Effect 运行只经由捕获的 Context 与 Scope,不落默认 runtime。
 */
export function makeSandboxRequestExecutor(): Effect.Effect<SandboxRequestExecutor, never, Scope.Scope> {
  return Effect.gen(function* () {
    const context = yield* Effect.context<never>();
    const scope = yield* Effect.scope;
    const inFlight = new Set<Fiber.Fiber<unknown, unknown>>();
    let closed = false;

    yield* Scope.addFinalizer(scope, Effect.sync(() => {
      closed = true;
    }));

    const run = <A, E>(operation: Effect.Effect<A, E>): Promise<A> => {
      if (closed) return Promise.reject(new SandboxRequestExecutorClosedError());
      // 外层 fiber 只负责把请求 fork 进 owner Scope 后立即结束;真正的请求 fiber 是
      // Scope 子节点,Scope 关闭时被统一中断。
      const outer = Effect.runForkWith(context)(Effect.forkIn(operation, scope));
      return new Promise<A>((resolve, reject) => {
        outer.addObserver((outerExit) => {
          if (Exit.isFailure(outerExit)) {
            reject(Cause.squash(outerExit.cause));
            return;
          }
          const child = outerExit.value;
          inFlight.add(child);
          child.addObserver((exit) => {
            inFlight.delete(child);
            if (Exit.isSuccess(exit)) resolve(exit.value);
            else reject(Cause.squash(exit.cause));
          });
        });
      });
    };

    return { run, inFlight: () => inFlight.size };
  });
}
