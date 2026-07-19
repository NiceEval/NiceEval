// 协议行为:会话——首轮 startThread() 的 thread ID 经 ctx.session.capture() 捕获,
// 后续轮 resumeThread() 续接并能引用首轮事实。
import { defineEval } from "niceeval";
import { isDefined } from "niceeval/expect";

export default defineEval({
  description: "会话续接:首轮 thread ID 被捕获,后续轮 resumeThread() 续接并引用首轮事实",
  async test(t) {
    const suffix = "这轮不用跑命令也不用建文件。";
    (await t.send(`我叫 niceeval-e2e-tester,帮我记住这个名字。${suffix}`)).expectOk();

    // 首轮结束后,ctx.session.capture() 应该已经把 thread.started 回传的 id 记下来了。
    t.check(t.sessionId, isDefined("thread.started 的 thread_id 应该已经被 ctx.session.capture() 记下"));

    const recall = await t.send(`我刚才说我叫什么名字?${suffix}`);
    recall.expectOk();
    recall.messageIncludes("niceeval-e2e-tester");
  },
});
