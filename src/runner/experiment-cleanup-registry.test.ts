// cases: docs/engineering/unit-tests/experiments-runner/cases.md
// bug: memory/force-exit-skips-experiment-teardown.md
import { describe, expect, it } from "vitest";
import {
  drainExperimentTeardowns,
  pendingExperimentTeardownCount,
  registerExperimentTeardown,
  unregisterExperimentTeardown,
} from "./experiment-cleanup-registry.ts";

describe("experiment-cleanup-registry", () => {
  it("drain 执行所有还登记着的 teardown 各一次;排空后再次 drain 无动作", async () => {
    const calls: string[] = [];
    registerExperimentTeardown("exp-a", async () => {
      calls.push("a");
    });
    registerExperimentTeardown("exp-b", async () => {
      calls.push("b");
    });
    expect(pendingExperimentTeardownCount()).toBe(2);

    expect(await drainExperimentTeardowns()).toBe(2);
    expect(calls.sort()).toEqual(["a", "b"]);
    expect(pendingExperimentTeardownCount()).toBe(0);

    expect(await drainExperimentTeardowns()).toBe(0);
    expect(calls).toHaveLength(2);
  });

  it("unregister 后的条目不被 drain(正常路径消费与兜底互斥);闭包抛错不让 drain 抛", async () => {
    let ran = 0;
    registerExperimentTeardown("exp-consumed", async () => {
      ran += 1;
    });
    unregisterExperimentTeardown("exp-consumed");
    registerExperimentTeardown("exp-throws", async () => {
      throw new Error("boom");
    });

    expect(await drainExperimentTeardowns()).toBe(1);
    expect(ran).toBe(0);
  });
});
