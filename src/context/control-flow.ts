// test(t) 里的非错误控制流信号。运行器据类型分流:跳过不是失败,断言失败不是异常。

import { t } from "../i18n/index.ts";

/** t.skip(reason):该 eval 不构成有效测试,记 skipped(不计入,不算 agent 挂)。 */
export class EvalSkipped extends Error {
  constructor(public readonly reason: string) {
    super(`eval skipped: ${reason}`);
    this.name = "EvalSkipped";
  }
}

/** t.require / turn.expectOk 不过:正常的断言失败,中止后续,但已记录的断言决定判决。 */
export class EvalRequirementFailed extends Error {
  constructor(public readonly assertionName: string) {
    super(`requirement failed: ${assertionName}`);
    this.name = "EvalRequirementFailed";
  }
}

/** 本轮 send 返回 failed,作者调了 expectOk():视为执行错误(eval failed)。 */
export class TurnFailed extends Error {
  constructor(message = t("context.turnFailedDefault")) {
    super(message);
    this.name = "TurnFailed";
  }
}
