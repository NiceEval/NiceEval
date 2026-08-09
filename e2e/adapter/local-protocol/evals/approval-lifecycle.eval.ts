// owner: docs/engineering/testing/e2e/adapter/ui-message-stream.md#adapter-local-protocol

import { defineEval } from "niceeval";
import { equals } from "niceeval/expect";

const CALL_ID = "local-approval-call";

export default defineEval({
  description: "approval-requested 先产生 pending operation，approve / deny 再结束同一 call id",
  async test(t) {
    const draft = await t.send("request the deterministic approval fixture");
    t.check(draft.status, equals("waiting"));
    draft.parked();
    draft.calledTool("calculate", {
      status: "pending",
      input: { expression: "(23+19)*3" },
      count: 1,
    });
    t.requireInputRequest({ action: "calculate" });
    draft.eventsSatisfy(
      "approval request exposes its native call as pending before a decision",
      (events) =>
        events.filter(
          (event) =>
            event.type === "operation.started" &&
            event.operationId === CALL_ID &&
            event.operation.name === "calculate",
        ).length === 1 && !events.some((event) => event.type === "operation.finished" && event.operationId === CALL_ID),
    );

    const approved = await t.respond("approve");
    await approved.succeeded().stopOnFailure();
    approved.messageIncludes("local-approval-approved");
    t.calledTool("calculate", {
      status: "completed",
      output: { value: 126, marker: "local-approval-output" },
      count: 1,
    });
    approved.notEvent("operation.started");
    approved.eventsSatisfy(
      "approval resume only finishes the pending native call",
      (events) =>
        events.filter(
          (event) =>
            event.type === "operation.finished" &&
            event.operationId === CALL_ID &&
            event.status === "completed",
        ).length === 1,
    );

    const denied = t.newSession();
    const deniedDraft = await denied.send("request the deterministic approval fixture");
    deniedDraft.parked();
    deniedDraft.calledTool("calculate", { status: "pending", count: 1 });
    denied.requireInputRequest({ action: "calculate" });
    const rejected = await denied.respond("deny");
    await rejected.succeeded().stopOnFailure();
    rejected.messageIncludes("local-approval-denied");
    denied.calledTool("calculate", { status: "rejected", count: 1 });
    denied.notCalledTool("calculate", { status: "completed" });
    denied.eventsSatisfy(
      "denial finishes the pending call as rejected without duplicating its start",
      (events) =>
        events.filter((event) => event.type === "operation.started" && event.operationId === CALL_ID).length === 1 &&
        events.filter(
          (event) =>
            event.type === "operation.finished" &&
            event.operationId === CALL_ID &&
            event.status === "rejected",
        ).length === 1,
    );
  },
});
