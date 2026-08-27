// 实验级 teardown 的宿主机侧登记表 + 强清兜底,与 sandbox/registry.ts 同一模式。
//
// 正常路径(per-attempt 计数归零 / run 收尾扫尾)在 runner 的 fiber 里执行 teardown;强清退出
// (二次 Ctrl+C / 看门狗 / main() 崩溃路径)时 fiber 可能来不及走到那一步,cli 需要一个独立于
// Effect 的入口把「还没 settle 的实验级 teardown」收口,否则隧道/容器这类宿主机资源随
// process.exit 变成孤儿(契约见 docs/cli.md「中断:三级响应」)。
//
// 登记的闭包由 runner 构造,执行体是 memoized 的一次性 promise(见 run.ts 的
// runExperimentTeardown):正常路径、drain、崩溃路径谁先到都启动同一个 promise,后到者等到
// 同一个结果——不双跑、也不空转。条目在 settle 后由闭包自己注销,所以 drain 的完整语义就是
// 「启动全部未启动 + 等待全部未 settle」;在飞中的 teardown 对 drain 同样可等待,这正是
// 强清「事件驱动收口」的数据基础。

import { Effect, Scope } from "effect";

export type ExperimentTeardown = () => Effect.Effect<void, unknown>;

const pending = new Map<string, ExperimentTeardown>();

function settleTeardown(run: ExperimentTeardown): Effect.Effect<void> {
  // Draining is best-effort by contract: failures are already recorded by the
  // lifecycle owner and must not keep sibling cleanup from starting.
  return Effect.suspend(run).pipe(Effect.catchCause(() => Effect.void));
}

/** Effect-native registration for an explicit lifecycle coordinator. */
export function registerExperimentTeardown(
  experimentId: string,
  run: ExperimentTeardown,
): Effect.Effect<void> {
  return Effect.sync(() => {
    pending.set(experimentId, run);
  });
}

/**
 * Scope-owned registration. If the coordinator exits before it explicitly
 * settles its lifecycle, the scope drains the still-current entry exactly once.
 * A later replacement or explicit unregister is never accidentally removed.
 */
export function registerExperimentTeardownScoped(
  experimentId: string,
  run: ExperimentTeardown,
): Effect.Effect<void, never, Scope.Scope> {
  return Effect.acquireRelease(
    Effect.sync(() => {
      pending.set(experimentId, run);
      return run;
    }),
    (registered) => Effect.suspend(() =>
      pending.get(experimentId) === registered
        ? settleTeardown(registered).pipe(
            Effect.ensuring(Effect.sync(() => {
              if (pending.get(experimentId) === registered) pending.delete(experimentId);
            })),
          )
        : Effect.void,
    ),
  ).pipe(Effect.asVoid);
}

/** teardown settle 后注销;不存在时是 no-op。 */
export function unregisterExperimentTeardown(experimentId: string): Effect.Effect<void> {
  return Effect.sync(() => {
    pending.delete(experimentId);
  });
}

export function pendingExperimentTeardownCount(): number {
  return pending.size;
}

/**
 * 强清兜底:启动所有还登记着的实验级 teardown 并等待它们 settle(各执行体自己有界、自己兜错,
 * 绝不抛;已在飞的返回同一个 memoized promise,等待而非重跑)。返回本次等待的条目数。
 * 与 stopAllSandboxes 同语义:重复调用安全,表空时是 no-op。
 */
export function drainExperimentTeardowns(): Effect.Effect<number> {
  return Effect.gen(function* () {
    const entries = yield* Effect.sync(() => [...pending.values()]);
    yield* Effect.forEach(entries, settleTeardown, { concurrency: "unbounded", discard: true });
    return entries.length;
  });
}
