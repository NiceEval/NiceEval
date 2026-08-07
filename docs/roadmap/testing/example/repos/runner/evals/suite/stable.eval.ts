import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "历史去重场景的稳定通过 eval",
  async test(t) {
    await t.send("请返回 fixture 值");
    t.check(t.reply, includes("fixture"));
  },
});
