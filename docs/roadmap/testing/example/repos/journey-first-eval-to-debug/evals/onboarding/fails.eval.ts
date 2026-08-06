import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "新手上路：故意失败的评测，用来演示 show 定位",
  async test(t) {
    await t.send("请返回 fixture 值");
    t.check(t.reply, includes("never-arrives-sentinel"));
  },
});
