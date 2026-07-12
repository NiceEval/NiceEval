// "故意红"的 fixture:验证断言真的会挂、退出码真的会变 1(docs/engineering/e2e-ci/README.md 第 3.3 节)。
// 设计成对模型输出不敏感——不管模型这次答得好不好,这两条必然一红一炸。
// 只进 verdicts 实验(不进 ci),由 verify.mjs 以"期望 exit 1"的方式正向消费。
import { defineEval } from "niceeval";

/** 必然 failed:断言一个真实压根不存在的工具名。 */
export function deliberateFail() {
  return defineEval({
    description: "verdicts fixture:断言必然不存在的工具调用,期望 failed",
    async test(t) {
      await t.send("请只回复两个字:好的。");
      t.calledTool("this_tool_does_not_exist_926");
    },
  });
}

/** 必然 errored:eval 代码自身抛运行时异常(区别于断言失败)。 */
export function deliberateError() {
  return defineEval({
    description: "verdicts fixture:eval 抛运行时异常,期望 errored",
    async test(t) {
      await t.send("请只回复两个字:好的。");
      throw new Error("deliberate runtime error: e2e verdicts fixture");
    },
  });
}
