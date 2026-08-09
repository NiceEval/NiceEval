import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "会话续接:第二轮能引用首轮事实",
  async test(t) {
    const first = await t.send(
      "我最喜欢的数字是 47。只需确认你会记住它——不要写任何文件。",
    );
    await t.require(first.succeeded());
    const recall = await t.send("我最喜欢的数字是多少?只回答数字。");
    await t.require(recall.succeeded());
    t.assert(t.check(recall.message, includes("47")));
  },
});
