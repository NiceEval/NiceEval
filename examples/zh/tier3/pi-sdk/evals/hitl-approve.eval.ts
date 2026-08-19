import { defineEval } from "niceeval";
import { equals, pattern, toolMatch } from "niceeval/expect";

// calculate 工具经服务端 beforeToolCall 挂了审批(见 agents/pi-sdk.ts、origin src/backend/server.ts)。
// 这条验证批准分支:approve 之后工具正常执行,calledTool 的 status 是 "completed"。
export default defineEval({
  description: "HITL:calculate 经批准后正常执行",

  async test(t) {
    // 提示词不提"审批"——一提审批,deepseek-v4-flash 就倾向于用文字问"可以吗",而不是真的发起
    // 工具调用;审批门是服务端 beforeToolCall 自动挂的,跟用户怎么问无关,越自然越准确触发工具。
    const draft = await t.send("用计算器算一下 (23+19)*3 等于多少");
    // 作用域断言在 Run 封口时才读取最终状态；继续到 approve 后已经不再等待。
    // 要判断当前是否停在审批上，只能读取这个 TurnHandle 自己的 status。
    t.check(draft.status, equals("waiting"));

    t.requireInputRequest({ action: "calculate" });

    const approved = await t.respond("approve");
    approved.succeeded();
    t.calledTool(toolMatch("calculate", { status: "completed" }));
    t.check(approved.message, pattern(/126/));
  },
});
