import { defineEval } from "niceeval";
import { includes, excludes } from "niceeval/expect";

// 这条 eval 专门验证跨轮记忆的两半承诺:同一 session 里第二轮记得住第一轮说的名字
// (客户端重放完整历史续接成功——这个应用服务端零状态,续接完全靠 adapter 按 sessionId 存取
// 完整 UIMessage[] 并原样重发);t.newSession() 造出的新 session 不共享历史。
export default defineEval({
  description: "测试跨轮记忆与 newSession() 隔离",

  async test(t) {
    await t.send("我叫小明,帮我记住这个名字。");
    const recall = await t.send("我刚才说我叫什么名字?");
    t.check(recall.message, includes("小明"));
    t.check(t.reply, includes("小明"));

    const fresh = t.newSession();
    await fresh.send("我叫什么名字?");
    t.check(fresh.reply, excludes("小明"));
  },
});
