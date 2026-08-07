import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "携带场景的确定性通过 eval（beta）",
  async test(t) {
    await t.send("请返回 fixture 值");
    t.check(t.reply, includes("固定回复"));
  },
});
