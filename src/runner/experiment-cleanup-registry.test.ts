// cases: docs/engineering/unit-tests/experiments-runner/cases.md
// bug: memory/force-exit-skips-experiment-teardown.md
import { describe, expect, it } from "vitest";
import {
  drainExperimentTeardowns,
  pendingExperimentTeardownCount,
  registerExperimentTeardown,
  unregisterExperimentTeardown,
} from "./experiment-cleanup-registry.ts";

/** 模拟 runner 登记的执行体形态(见 run.ts 的 runExperimentTeardown):memoized 一次性
 *  promise,settle 后自行注销——注册表契约的一半在登记方,测试按同一形态构造。 */
function registerMemoizedEntry(id: string, body: () => Promise<void>): () => Promise<void> {
  let p: Promise<void> | undefined;
  const run = () =>
    (p ??= body()
      .catch(() => {})
      .finally(() => unregisterExperimentTeardown(id)));
  registerExperimentTeardown(id, run);
  return run;
}

describe("experiment-cleanup-registry", () => {
  it("drain 启动所有登记条目各一次并等到 settle;条目自注销后再次 drain 无动作", async () => {
    const calls: string[] = [];
    registerMemoizedEntry("exp-a", async () => {
      calls.push("a");
    });
    registerMemoizedEntry("exp-b", async () => {
      calls.push("b");
    });
    expect(pendingExperimentTeardownCount()).toBe(2);

    expect(await drainExperimentTeardowns()).toBe(2);
    expect(calls.sort()).toEqual(["a", "b"]);
    expect(pendingExperimentTeardownCount()).toBe(0);

    expect(await drainExperimentTeardowns()).toBe(0);
    expect(calls).toHaveLength(2);
  });

  it("drain 与正常路径并发到达同一入口:执行恰好一次,双方都等到 settle", async () => {
    let ran = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const run = registerMemoizedEntry("exp-concurrent", async () => {
      ran += 1;
      await gate;
    });

    let normalSettled = false;
    let drainSettled = false;
    const normal = run().then(() => {
      normalSettled = true;
    });
    const drain = drainExperimentTeardowns().then(() => {
      drainSettled = true;
    });
    // 双方都在等同一个在飞 promise:gate 未放行前谁都不 settle。
    await Promise.resolve();
    expect(ran).toBe(1);
    expect(normalSettled).toBe(false);
    expect(drainSettled).toBe(false);

    release();
    await Promise.all([normal, drain]);
    expect(ran).toBe(1);
    expect(pendingExperimentTeardownCount()).toBe(0);
  });

  it("settle 已注销(正常路径收尾完成)后 drain 无动作;执行体抛错不让 drain 抛", async () => {
    let ran = 0;
    const run = registerMemoizedEntry("exp-consumed", async () => {
      ran += 1;
    });
    await run(); // 正常路径先收尾:settle 后自注销
    expect(pendingExperimentTeardownCount()).toBe(0);

    registerMemoizedEntry("exp-throws", async () => {
      throw new Error("boom");
    });

    expect(await drainExperimentTeardowns()).toBe(1);
    expect(ran).toBe(1);
    expect(pendingExperimentTeardownCount()).toBe(0);
  });
});
