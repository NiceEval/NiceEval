// Protocol behavior: HITL 审批 — a tool-approval-request part stops the turn at
// "waiting" with an input.requested event; approving rewrites the part in place and
// resends the full message history, and the resumed turn carries a completed
// operation.finished. Denying produces a rejected result with no tool output ever having
// existed — the reverse guard below rules out "execute first, ask forgiveness later".
import { defineEval } from "niceeval";
import { equals } from "niceeval/expect";

export default defineEval({
  description: "审批请求(approval-requested)会阻塞执行直到给出答复;approve 恢复为 completed,deny 则为 rejected 且从未产生工具结果",
  async test(t) {
    const draft = await t.send("用计算器算一下 (23+19)*3 等于多少");
    t.check(draft.status, equals("waiting"));
    draft.eventsSatisfy("审批前不应存在已完成的 calculate 结果", (events) => {
      const calcIds = new Set(
        events.flatMap((event) =>
          event.type === "operation.started" &&
          event.operation.kind === "tool" &&
          event.operation.name === "calculate"
            ? [event.operationId]
            : [],
        ),
      );
      return !events.some(
        (event) =>
          event.type === "operation.finished" &&
          event.kind === "tool" &&
          calcIds.has(event.operationId) &&
          event.status === "completed",
      );
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
