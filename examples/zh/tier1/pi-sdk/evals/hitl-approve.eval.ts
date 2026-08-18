import { defineEval } from "niceeval";
import { equals, toolMatch } from "niceeval/expect";

// calculate 工具经服务端 beforeToolCall 挂了审批(见 agents/pi-sdk.ts、origin src/backend/server.ts)。
// 这条验证批准分支:approve 之后工具正常执行,calledTool 的 status 是 "completed"。
export default defineEval({
  description: "HITL:calculate 经批准后正常执行",

  async test(t) {
    // 提示词不提"审批"——一提审批,deepseek-v4-flash 就倾向于用文字问"可以吗",而不是真的发起
    // 工具调用;审批门是服务端 beforeToolCall 自动挂的,跟用户怎么问无关,越自然越准确触发工具。
    const draft = await t.send("用计算器算一下 (23+19)*3 等于多少");
    // t.parked() 之类的作用域断言是延迟求值的(评到 run 结束时的最终状态),这一轮结束后马上
    // continue 到 approve,run 早就不再"停着"了——判"当下有没有停在审批上"只能看这个
    // TurnHandle 自己的 status,不能用 t.parked()。
    t.check(draft.status, equals("waiting"));

    t.requireInputRequest({ action: "calculate" });

    const approved = await t.respond("approve");
    approved.succeeded();
    t.calledTool(toolMatch("calculate", { status: "completed" }));
    t.messageIncludes(/126/);
  },
});
