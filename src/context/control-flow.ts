// test(t) 里的非错误控制流信号。运行器据类型分流:跳过不是失败,断言失败不是异常。

/** t.skip(reason):该 eval 不构成有效测试,记 unreadable(不计入,不算 agent 挂)。 */
export class EvalSkipped extends Error {
  constructor(public readonly reason: string) {
    super(`eval unreadable: ${reason}`);
    this.name = "EvalSkipped";
  }
}

/** t.require / .stopOnFailure() 不过:正常断言失败；中止后续，但由已记录断言决定判定。 */
export class EvalRequirementFailed extends Error {
  constructor(public readonly assertionName: string) {
    super(`requirement failed: ${assertionName}`);
    this.name = "EvalRequirementFailed";
  }
}
