import { defineEval } from "niceeval";
import { equals, toolMatch } from "niceeval/expect";

// calculate 工具经 canUseTool 挂了审批(见 agents/claude-sdk.ts、origin src/backend/agent.ts)。
// 这条验证批准分支:approve 之后工具正常执行,calledTool 的 status 是 "completed"。
//
// 提示词不提"审批"——不同模型在提示词里看到"审批"字样时,有的会倾向于用文字问"可以吗"
// 而不是真的发起工具调用;审批门是服务端 canUseTool 自动挂的,跟用户怎么问无关。
export default defineEval({
  description: "HITL:calculate 经批准后正常执行",

  async test(t) {
    const draft = await t.send("用计算器算一下 (23+19)*3 等于多少");
    t.check(draft.status, equals("waiting"));

    t.requireInputRequest({ action: "mcp__demo-tools__calculate" });

    const approved = await t.respond("approve");
    approved.succeeded();
    t.calledTool(toolMatch("mcp__demo-tools__calculate", { status: "completed" }));
    t.messageIncludes(/126/);
  },
});
