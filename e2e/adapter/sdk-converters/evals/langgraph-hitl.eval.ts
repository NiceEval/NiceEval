// owner: docs/engineering/testing/e2e/adapter/sdk-converters.md#langgraph-hitl-deterministic

import { defineEval } from "niceeval";
import { equals } from "niceeval/expect";

export default defineEval({
  description: "LangGraph interrupt/Command 使用每 official run 新 converter，由 session 累计跨 Turn call 配对",
  async test(t) {
    const draft = await t.send("langgraph hitl approve fixture");
    t.check(draft.status, equals("waiting"));
    draft.parked();
    draft.calledTool("approve_change", {
      status: "pending",
      input: { target: "langgraph-fixture" },
      count: 1,
    });
    t.requireInputRequest({ action: "approve_change" });
    draft.messageIncludes("langgraph-hitl-runtime-initial:lifecycle");

    const approved = await t.respond("accept");
    await approved.succeeded().stopOnFailure();
    approved.messageIncludes("langgraph-hitl-approved-marker");
    t.calledTool("approve_change", {
      status: "completed",
      output: { marker: "langgraph-hitl-approved-output" },
      count: 1,
    });

    const rejectedSession = t.newSession();
    const rejectedDraft = await rejectedSession.send("langgraph hitl reject fixture");
    rejectedDraft.parked();
    rejectedSession.requireInputRequest({ action: "approve_change" });
    const rejected = await rejectedSession.respond("ignore");
    await rejected.succeeded().stopOnFailure();
    rejected.messageIncludes("langgraph-hitl-rejected-marker");
    rejectedSession.calledTool("approve_change", { status: "rejected", count: 1 });
    rejectedSession.notCalledTool("approve_change", { status: "failed" });
    rejectedSession.eventsSatisfy(
      "resumed rejected run closes the prior Turn call id without re-emitting start",
      (events) =>
        events.filter(
          (event) => event.type === "operation.started" && event.operationId === "langgraph-hitl-call",
        ).length === 1 &&
        events.some(
          (event) =>
            event.type === "operation.finished" &&
            event.operationId === "langgraph-hitl-call" &&
            event.status === "rejected" &&
            event.output === undefined,
        ),
    );
  },
});
