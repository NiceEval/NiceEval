// Protocol behavior: HITL 审批 — a tool-approval-request part stops the turn at
// "waiting" with an input.requested event; approving rewrites the part in place and
// resends the full message history, and the resumed turn carries a completed
// action.result. Denying produces a rejected result with no tool output ever having
// existed — the reverse guard below rules out "execute first, ask forgiveness later".
import { defineEval } from "niceeval";
import { equals } from "niceeval/expect";

export default defineEval({
  description: "approval-requested blocks execution until answered; approve resumes to completed, deny to rejected with no tool result",
  async test(t) {
    const draft = await t.send("用计算器算一下 (23+19)*3 等于多少");
    t.check(draft.status, equals("waiting"));
    draft.eventsSatisfy("no completed calculator result before approval", (events) => {
      const calcIds = new Set(
        events.flatMap((e) => (e.type === "action.called" && e.name === "calculate" ? [e.callId] : [])),
      );
      return !events.some((e) => e.type === "action.result" && calcIds.has(e.callId) && e.status === "completed");
    });
    t.requireInputRequest({ action: "calculate" });

    const approved = await t.respond("approve");
    approved.succeeded();
    t.calledTool("calculate", { status: "completed" });
    t.messageIncludes(/126/);

    // Deny branch on an independent session line — same prompt, the opposite decision.
    const denied = t.newSession();
    await denied.send("用计算器算一下 (23+19)*3 等于多少");
    denied.requireInputRequest({ action: "calculate" });
    let turn = await denied.respond("deny");
    for (let attempt = 0; attempt < 3 && turn.status === "waiting"; attempt++) {
      turn = await denied.respond("deny");
    }
    t.check(turn.status, equals("completed"));
    denied.calledTool("calculate", { status: "rejected" });
    denied.notCalledTool("calculate", { status: "completed" });
    denied.noFailedActions();
  },
});
