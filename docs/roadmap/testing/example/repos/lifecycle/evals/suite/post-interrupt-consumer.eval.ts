import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "确认中断后的下一消费者仍能确定性通过",
  async test(t) {
    await t.send("请返回 fixture 值");
    t.check(t.reply, includes("fixture"));
  },
});
