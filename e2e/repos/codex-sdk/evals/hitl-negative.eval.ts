// 协议行为:HITL 反证——Codex SDK 没有与 Claude Agent SDK `canUseTool` 等价的公开审批回调,
// adapter 因此不得猜测或伪造观察不到的 HITL:事件流从不出现 `input.requested`。
//
// 用一个真的会执行 shell 命令的提示词(而不是纯问答)来做反证——这正是其它 HITL 能观察
// 到的适配器(AI SDK / Claude Agent SDK)会在这一步产生 `input.requested` 的场景,证明的是
// "同样真实执行了工具" 却 "从未出现过等人审批的信号",而不是空泛地断言一个从没被测过的事件。
import { defineEval } from "niceeval";

export default defineEval({
  description: "HITL 反证:Codex SDK 没有审批回调,事件流从不出现 input.requested",
  async test(t) {
    const turn = await t.send("在当前工作目录跑 `echo niceeval-e2e-hitl-926`,把命令输出告诉我。");
    turn.expectOk();
    t.noFailedActions();
    t.calledTool("shell", { status: "completed" });
    t.notEvent("input.requested");
  },
});
