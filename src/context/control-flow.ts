// test(t) 里的非错误控制流信号。运行器据类型分流:跳过不是失败,断言失败不是异常。

/** t.skip(reason):该 eval 不构成有效测试,记 skipped(不计入,不算 agent 挂)。 */
export class EvalSkipped extends Error {
  constructor(public readonly reason: string) {
    super(`eval skipped: ${reason}`);
    this.name = "EvalSkipped";
  }
}

/** `t.require()` 未通过:正常 Fact use 失败；中止后续，但由已记录 Fact/use 决定判定。 */
export class EvalRequirementFailed extends Error {
  constructor(public readonly assertionName: string) {
    super(`requirement failed: ${assertionName}`);
    this.name = "EvalRequirementFailed";
  }
}
