// Protocol behavior: HITL 审批 — a tool-approval-request part stops the turn at
// "waiting" with an input.requested event; approving rewrites the part in place and
// resends the full message history, and the resumed turn carries a completed
// operation.finished. Denying produces a rejected result with no tool output ever having
// existed — the reverse guard below rules out "execute first, ask forgiveness later".
import { defineEval } from "niceeval";
import { equals, satisfies } from "niceeval/expect";
export default defineEval({
  description:
    "审批请求(approval-requested)会阻塞执行直到给出答复;approve 恢复为 completed,deny 则为 rejected 且从未产生工具结果",
  async test(t) {
    const draft = await t.send(
      "[REQUIRE_CALCULATE_TOOL] 用计算器算一下 (23+19)*3 等于多少",
    );
    t.check(draft.status, equals("waiting"));
    t.check(
      draft.events,
      satisfies<typeof draft.events>(
        "审批前不应存在已完成的 calculate 结果",
        (events) => {
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
        },
      ),
    );
    draft.calledTool("calculate", { status: "pending", count: 1 });
    t.requireInputRequest({ action: "calculate" });
    const approved = await t.respond("approve");
    approved.succeeded();
    t.calledTool("calculate", { status: "completed" });
    t.check(
      t.events,
      satisfies<typeof t.events>(
        "assistant 回复包含计算器结果",
        (events) =>
          events.some(
            (event) =>
              event.type === "message" &&
              event.role === "assistant" &&
              /126/.test(event.text),
          ),
      ),
    );
    // Deny branch on an independent session line — same prompt, the opposite decision.
    const denied = t.newSession();
    const deniedDraft = await denied.send(
      "[REQUIRE_CALCULATE_TOOL] 用计算器算 (23+19)*3。",
    );
    t.check(deniedDraft.status, equals("waiting"));
    t.check(
      denied.events,
      satisfies<typeof denied.events>(
        "deny 会话停在等待审批",
        (events) => {
          let parked = false;
          for (let i = events.length - 1; i >= 0; i--) {
            const type = events[i]!.type;
            if (type === "thinking" || type === "compaction") continue;
            parked = type === "input.requested";
            break;
          }
          return parked;
        },
      ),
    );
    denied.calledTool("calculate", { status: "pending", count: 1 });
    denied.requireInputRequest({ action: "calculate" });
    const turn = await denied.respond("deny");
    t.check(turn.status, equals("completed"));
    denied.calledTool("calculate", { status: "rejected" });
    denied.calledTool("calculate", { status: "completed", count: 0 });
    t.check(
      denied.events,
      satisfies<typeof denied.events>(
        "no failed tool or subagent actions",
        (events) =>
          !events.some(
            (event) =>
              event.type === "operation.finished" && event.status === "failed",
          ),
      ),
    );
  },
});
