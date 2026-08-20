import { defineEval } from "niceeval";
import { equals, toolMatch } from "niceeval/expect";

// deny 分支:人否决和工具故障是两回事——calledTool 的 status 应该是 "rejected",
// noFailedActions() 依然通过。有的模型被拒绝一次后会不死心、原样再试一次同一个工具调用
// (在 claude-sdk / langgraph 的接入里都复现过),不是 adapter 的映射 bug,是模型行为。
// deny 到它放弃为止,给个上限避免死循环。
export default defineEval({
  description: "HITL:calculate 被拒绝后标记 rejected 而不是 failed",

  async test(t) {
    await t.send("用计算器算一下 (23+19)*3 等于多少");
    t.requireInputRequest({ action: "calculate" });

    let denied = await t.respond("deny");
    for (let attempt = 0; attempt < 3 && denied.status === "waiting"; attempt++) {
      denied = await t.respond("deny");
    }
    t.check(denied.status, equals("completed"));
    t.calledTool(toolMatch("calculate", { status: "rejected" }));
    t.noFailedActions();
  },
});
