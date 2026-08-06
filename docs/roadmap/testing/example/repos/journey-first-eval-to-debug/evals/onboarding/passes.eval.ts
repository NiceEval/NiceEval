import { defineEval } from "niceeval";

export default defineEval({
  description: "新手上路：第一条通过的评测",
  async test(t) {
    await t.send("请返回 fixture 值");
    t.succeeded();
  },
});
