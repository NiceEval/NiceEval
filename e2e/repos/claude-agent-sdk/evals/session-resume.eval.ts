import { defineEval } from "niceeval";
import { includes, excludes } from "niceeval/expect";

// 会话:首轮 session_id 经 ctx.session.capture() 捕获(见 agents/claude-agent-sdk.ts),后续轮
// 以 resume 续接并能引用首轮事实——这是 SDK 的 resume 续接同一个 claude-code 会话历史成功。
// t.newSession() 造出的新会话线不共享历史:常见 bug 是 adapter 不管新旧会话线都无条件复用
// 同一个 ctx.session.id,隔离会静默失真且不报错,所以同一个 Eval 里两半都要断言。
export default defineEval({
  description: "resume 续接会话历史;newSession() 开启隔离的新会话线",

  async test(t) {
    const first = await t.send("我叫 Ada,请记住这个名字。");
    first.expectOk();
    first.maxTokens(50_000);

    const recall = await t.send("我叫什么名字?只回答名字。");
    recall.expectOk();
    t.check(recall.message, includes("Ada"));
    recall.maxTokens(50_000);

    const fresh = t.newSession();
    const isolated = await fresh.send("我叫什么名字?");
    t.check(isolated.message, excludes("Ada"));
  },
});
