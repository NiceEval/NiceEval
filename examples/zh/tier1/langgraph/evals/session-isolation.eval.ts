import { defineEval } from "niceeval";
import { includes, excludes } from "niceeval/expect";

// 这条 eval 专门验证会话续接的两半承诺:同一条会话线里第二轮记得住第一轮说的名字
// (LangGraph InMemorySaver 按 thread_id 续接成功);t.newSession() 造出的新会话线不共享历史。
export default defineEval({
  description: "测试跨轮记忆与 newSession() 隔离",

  async test(t) {
    await t.send("我叫小明,帮我记住这个名字。");
    const recall = await t.send("我刚才说我叫什么名字?");
    recall.messageIncludes("小明");
    t.check(t.reply, includes("小明"));

    const fresh = t.newSession();
    await fresh.send("我叫什么名字?");
    t.check(fresh.reply, excludes("小明"));
  },
});
