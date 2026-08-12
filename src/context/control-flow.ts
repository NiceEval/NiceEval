// test(t) 里的非错误控制流信号。运行器据类型分流：跳过不是失败。

/** t.skip(reason):该 eval 不构成有效测试,记 skipped(不计入,不算 agent 挂)。 */
export class EvalSkipped extends Error {
  constructor(public readonly reason: string) {
    super(`eval skipped: ${reason}`);
    this.name = "EvalSkipped";
  }
}
