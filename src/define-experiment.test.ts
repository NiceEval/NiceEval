// cases: docs/feature/compile-time-contracts/library.md「Definition 阶段分离」
// Experiment 与 Eval 同样分为作者输入、factory 定义和 discovery 结果。这里钉住作者
// 不能写路径 id、JS/断言绕过仍被 factory 守卫，以及 Definition 的私有来源品牌。

import { describe, expect, it } from "vitest";
import { defineExperiment } from "./define.ts";
import type { Agent, ExperimentDefinition } from "./types.ts";

const agent = { name: "test-agent" } as unknown as Agent;

describe("defineExperiment", () => {
  it("返回带 factory 私有品牌的 Definition", () => {
    const definition = defineExperiment({ agent, description: "baseline" });
    expect(definition.description).toBe("baseline");
    expect(definition.flags).toEqual({});
    expect(definition.labels).toEqual({});
    expect(definition.attempts).toBe(1);
    expect(definition.earlyExit).toBe(false);
    expect(definition.evals).toBe("*");
    expect(definition.sandboxReuse).toBe(false);
    expect(Object.isFrozen(definition)).toBe(true);
    expect(Object.isFrozen(definition.flags)).toBe(true);
    expect(Object.isFrozen(definition.labels)).toBe(true);
  });

  it("运行时拒绝类型断言绕过的路径 id", () => {
    expect(() => defineExperiment({ agent, id: "manual" } as never)).toThrow(/id/);
  });

  it("运行时要求 agent", () => {
    expect(() => defineExperiment({} as never)).toThrow(/agent/);
  });

  it("类型层禁止派生 id，Definition 不能由对象字面量伪造", () => {
    if (false) {
      // @ts-expect-error id 由 discovery 从 experiments/ 文件路径推导
      defineExperiment({ agent, id: "manual" });
      // @ts-expect-error Definition 有模块私有品牌，只能由 defineExperiment 产生
      const forged: ExperimentDefinition = { agent };
      void forged;
    }
    expect(true).toBe(true);
  });
});
