import { defineEval } from "niceeval";
import { includes, excludes } from "niceeval/expect";

// 这条 eval 专门验证会话续接的两半承诺:同一条会话线里第二轮记得住第一轮说的名字
// (SDK 的 resume 续接同一个 claude-code 会话历史成功);t.newSession() 造出的新会话线
// 不共享历史(常见 bug:adapter 不管新旧会话线都无条件复用同一个 ctx.session.id,隔离会静默失真且不报错)。
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
