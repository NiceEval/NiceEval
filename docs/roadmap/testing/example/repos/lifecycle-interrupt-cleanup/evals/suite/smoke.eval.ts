import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "中断后的下一消费者：确定性通过的快速 eval",
  async test(t) {
    await t.send("请返回 fixture 值");
    t.check(t.reply, includes("fixture"));
  },
});
