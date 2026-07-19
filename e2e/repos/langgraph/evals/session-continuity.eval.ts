import { defineEval } from "niceeval";
import { excludes, includes } from "niceeval/expect";

// 会话与 usage 协议行为:thread_id 作为 ctx.session.id 续接(LangGraph InMemorySaver 按
// thread_id 持久化 checkpoint,见 src/backend/agent.py),第二轮能引用首轮事实;
// t.newSession() 造出的新会话线不共享历史;message finish 上的 usage_metadata 累加进
// Turn.usage——maxTokens 给一个宽松上限,只为证明这个数字是真的从协议里聚合出来的,
// 不是编造的(usage 缺失时 maxTokens 记 unavailable 而不是静默通过,见
// docs/feature/scoring/architecture/evidence.md)。
export default defineEval({
  description: "会话续接:同一 thread_id 记住上一轮事实,newSession() 隔离,usage 从 message finish 聚合",

  async test(t) {
    await t.send("我叫小明,帮我记住这个名字。");
    const recall = await t.send("我刚才说我叫什么名字?");
    recall.messageIncludes("小明");
    t.check(t.reply, includes("小明"));

    const fresh = t.newSession();
    await fresh.send("我叫什么名字?");
    t.check(fresh.reply, excludes("小明"));

    t.maxTokens(20_000);
  },
});
