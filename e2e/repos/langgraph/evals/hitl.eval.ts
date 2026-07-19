import { defineEval } from "niceeval";
import { equals } from "niceeval/expect";

// HITL interrupt 协议行为:interrupt() 产生 input.requested(config.allow_accept/allow_ignore
// 映射成 options: [{id:"accept"},{id:"ignore"}],见 src/agents/langgraph.ts 的
// emitInputRequested),adapter 把 input.responses 翻译成 Command(resume=...)后恢复,
// 恢复轮出现对应结果。
//
// 提示词不提"审批"——审批门是服务端图结构自动挂的,跟用户怎么问无关(同
// examples/zh/tier1/langgraph 的先例)。
//
// approve/reject 是同一个"翻译 input.responses -> Command(resume=...)"机制的两个分支,
// 放一个 Eval 里而不是拆两条——reject 分支额外验证 adapter 的 markRejected() wiring:
// 被拒绝的调用要落 "rejected" 而不是 "failed"(见 agents/langgraph.ts send() 的 resume 分支)。
export default defineEval({
  description: "HITL:calculate 经 interrupt 门控,approve 后正常执行、reject 后标记 rejected",

  async test(t) {
    await t.group("approve 分支", async () => {
      const draft = await t.send("用计算器算一下 (23+19)*3 等于多少");
      t.check(draft.status, equals("waiting"));

      t.requireInputRequest({ action: "calculate", optionIds: ["accept", "ignore"] });

      const approved = await t.respond("accept");
      approved.succeeded();
      t.calledTool("calculate", { status: "completed" });
      t.messageIncludes(/126/);
    });

    await t.group("reject 分支(独立会话)", async () => {
      const session = t.newSession();
      const draft = await session.send("用计算器算一下 100/4 等于多少");
      t.check(draft.status, equals("waiting"));

      session.requireInputRequest({ action: "calculate" });

      // 有的模型被拒绝一次后会不死心、原样再试一次同一个工具调用——不是 adapter 映射
      // bug,是模型行为;给个上限避免死循环(同 tier1 hitl-deny.eval.ts 的先例)。
      let rejected = await session.respond("ignore");
      for (let attempt = 0; attempt < 3 && rejected.status === "waiting"; attempt++) {
        rejected = await session.respond("ignore");
      }
      t.check(rejected.status, equals("completed"));
      session.calledTool("calculate", { status: "rejected" });
      session.noFailedActions();
    });
  },
});
