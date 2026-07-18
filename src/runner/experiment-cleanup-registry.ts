// 实验级 cleanup 的宿主机侧登记表 + 强清兜底,与 sandbox/registry.ts 同一模式。
//
// 正常路径(per-attempt 计数归零 / run 收尾扫尾)在 runner 的 fiber 里消费 cleanup;强清退出
// (二次 Ctrl+C / 看门狗 / main() 崩溃路径)时 fiber 可能来不及走到那一步,cli 需要一个独立于
// Effect 的入口把「还没被消费的实验级 cleanup」排空,否则隧道/容器这类宿主机资源随 process.exit
// 变成孤儿(契约见 docs/cli.md「中断:三级响应」)。
//
// 双跑防护不在这里:登记的闭包由 runner 构造,内部用同步一次性交换消费 cleanup(见 run.ts 的
// runExperimentTeardown),drain 与正常路径重复调用同一闭包是幂等的。本表只负责「强清时还能
// 找到它们」。

const pending = new Map<string, () => Promise<void>>();

/** 登记一个实验的 teardown 闭包(setup 完成、拿到 cleanup 时调用)。 */
export function registerExperimentTeardown(experimentId: string, run: () => Promise<void>): void {
  pending.set(experimentId, run);
}

/** 正常路径消费 cleanup 后注销;不存在时是 no-op。 */
export function unregisterExperimentTeardown(experimentId: string): void {
  pending.delete(experimentId);
}

export function pendingExperimentTeardownCount(): number {
  return pending.size;
}

/**
 * 强清兜底:执行所有还登记着的实验级 teardown(各闭包自己有界、自己兜错,绝不抛)。
 * 返回尝试执行的数量。与 stopAllSandboxes 同语义:重复调用安全,表空时是 no-op。
 */
export async function drainExperimentTeardowns(): Promise<number> {
  const entries = [...pending.values()];
  pending.clear();
  await Promise.allSettled(entries.map((run) => run()));
  return entries.length;
}
