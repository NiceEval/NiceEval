import { defineEval } from "niceeval";
import { equals } from "niceeval/expect";

// canUseTool 审批门:calculate 经 canUseTool 挂了审批(见 src/backend/agent.ts、
// agents/claude-agent-sdk.ts),approve 与 reject 是同一个协议行为的两个分支,合并成一个 Eval
// (docs/engineering/e2e-ci/adapters/README.md「仓库 Eval 预算」:一种协议行为一个 Eval)。
// 两个分支各用独立 session(t.newSession())隔离,避免上一分支的挂起状态串到下一个分支。
//
// 提示词不提"审批"——不同模型在提示词里看到"审批"字样时,有的会倾向于用文字问"可以吗"而不是
// 真的发起工具调用;审批门是服务端 canUseTool 自动挂的,跟用户怎么问无关。
export default defineEval({
  description: "canUseTool gate: calculate is approved (completed) or rejected (rejected, no result) via HITL",

  async test(t) {
    await t.group("approved: calculate runs normally and returns a result", async () => {
      const draft = await t.send("Use the calculator to work out (23+19)*3");
      t.check(draft.status, equals("waiting"));
      t.requireInputRequest({ action: "mcp__demo-tools__calculate" });

      const approved = await t.respond("approve");
      approved.succeeded();
      t.calledTool("mcp__demo-tools__calculate", { status: "completed" });
      t.messageIncludes(/126/);
      approved.maxTokens(50_000);
    });

    // 独立 session:上面那条 calculate 调用已经 resolve,这里开一条全新的对话线,避免与上面
    // 的审批状态混在一起。
    const denySession = t.newSession();
    await t.group("rejected: calculate is marked rejected, not failed, and produces no result", async () => {
      await denySession.send("Use the calculator to work out (23+19)*3");
      denySession.requireInputRequest({ action: "mcp__demo-tools__calculate" });

      // deepseek-v4-flash 被拒绝一次后偶尔会不死心、原样再试一次同一个工具调用(新的 tool_use
      // id,同一个 gated 工具)——不是 adapter 映射 bug(每次拒绝都正确落 rejected),是模型行为。
      // deny 到它放弃为止,给个上限避免死循环。
      let denied = await denySession.respond("deny");
      for (let attempt = 0; attempt < 3 && denied.status === "waiting"; attempt++) {
        denied = await denySession.respond("deny");
      }
      t.check(denied.status, equals("completed"));
      denySession.calledTool("mcp__demo-tools__calculate", { status: "rejected" });
      denySession.noFailedActions();
      denied.maxTokens(50_000);
    });
  },
});
