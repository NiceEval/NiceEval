import { defineEval } from "niceeval";
import { toolMatch } from "niceeval/expect";

// deny 分支:人否决和工具故障是两回事——calledTool 的 status 应该是 "rejected",
// noFailedActions() 依然通过(拒绝是预期路径,不是执行错误)。
export default defineEval({
  description: "HITL:calculate 被拒绝后标记 rejected 而不是 failed",

  async test(t) {
    // 提示词不提"审批"——一提审批,deepseek-v4-flash 就倾向于用文字问"可以吗",而不是真的发起
    // 工具调用;审批门是服务端 beforeToolCall 自动挂的,跟用户怎么问无关,越自然越准确触发工具。
    await t.send("用计算器算一下 (23+19)*3 等于多少");
    t.requireInputRequest({ action: "calculate" });

    const denied = await t.respond("deny");
    denied.succeeded();
    t.calledTool(toolMatch("calculate", { status: "rejected" }));
    t.noFailedActions();
  },
});
