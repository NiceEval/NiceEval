import { defineEval } from "niceeval";
import { equals, pattern, toolMatch } from "niceeval/expect";

// calculate 工具声明了 needsApproval:true(AI SDK 自己的 tool loop 停轮机制)。这条验证批准
// 分支:approve 之后工具正常执行,calledTool 的 status 是 "completed"。
//
// 提示词不提"审批"——不同模型看到提示词里的"审批"字样,有的会倾向于用文字反问用户
// "可以吗"而不是真的发起工具调用(在 pi-sdk / claude-sdk / langgraph 的接入里都复现过);
// 审批门是 SDK 自动挂的,跟用户怎么问无关。
export default defineEval({
  description: "HITL:calculate 经批准后正常执行",

  async test(t) {
    const draft = await t.send("用计算器算一下 (23+19)*3 等于多少");
    t.check(draft.status, equals("waiting"));

    t.requireInputRequest({ action: "calculate" });

    const approved = await t.respond("approve");
    approved.succeeded();
    t.calledTool(toolMatch("calculate", { status: "completed" }));
    t.check(approved.message, pattern(/126/));
  },
});
