import { defineEval } from "niceeval";
import { includes, excludes } from "niceeval/expect";

// 这条 eval 专门验证 ctx.session 续接的两半承诺:同一条会话线里第二轮记得住第一轮说的名字
// (server.ts 内存 Map<sessionId, AgentMessage[]> 续接成功);t.newSession() 开出的新会话线
// 拿到一份全新的 ctx.session,不共享历史(常见 bug:adapter 把 sessionId 存进模块级变量而不是
// 读 ctx.session.id,新会话线会被错误地续上旧历史,隔离会静默失真且不报错)。
export default defineEval({
  description: "测试跨轮记忆与 newSession() 隔离",

  async test(t) {
    await t.send("我叫小明,帮我记住这个名字。");
    const recall = await t.send("我刚才说我叫什么名字?");
    t.check(recall.message, includes("小明"));
    t.check(t.reply, includes("小明"));

    const fresh = t.newSession();
    await fresh.send("我叫什么名字?");
    // 新 session 没有历史,不应该知道"小明"这个事实——用 fresh.* 只看这条新 session 自己的事件,
    // 不是 t.*(t.* 是 run 级聚合,会同时看到主 session 的事件)。
    t.check(fresh.reply, excludes("小明"));
  },
});
