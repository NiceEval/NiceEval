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

const pending = new Map<string, () => Promise<void>>();

/** 登记一个实验的 teardown 入口(实验生命周期触发时点调用;setup 尚未完成也已可达)。 */
export function registerExperimentTeardown(experimentId: string, run: () => Promise<void>): void {
  pending.set(experimentId, run);
}

/** teardown settle 后注销;不存在时是 no-op。 */
export function unregisterExperimentTeardown(experimentId: string): void {
  pending.delete(experimentId);
}

export function pendingExperimentTeardownCount(): number {
  return pending.size;
}

/**
 * 强清兜底:启动所有还登记着的实验级 teardown 并等待它们 settle(各执行体自己有界、自己兜错,
 * 绝不抛;已在飞的返回同一个 memoized promise,等待而非重跑)。返回本次等待的条目数。
 * 与 stopAllSandboxes 同语义:重复调用安全,表空时是 no-op。
 */
export async function drainExperimentTeardowns(): Promise<number> {
  const entries = [...pending.values()];
  await Promise.allSettled(entries.map((run) => run()));
  return entries.length;
}
