// owner: docs/engineering/testing/e2e/adapter/ui-message-stream.md#adapter-local-protocol
import { defineEval } from "niceeval";
import { equals, includes, satisfies } from "niceeval/expect";
const CALL_ID = "local-approval-call";
export default defineEval({
  description:
    "approval-requested 先产生 pending operation，approve / deny 再结束同一 call id",
  async test(t) {
    const draft = await t.send("request the deterministic approval fixture");
    t.check(draft.status, equals("waiting"));
    t.check(draft.parked());
    t.requireInputRequest({ action: "calculate" });
    t.check(
      draft.events,
      satisfies<typeof draft.events>(
        "approval request exposes its native call as pending before a decision",
        (events) =>
          events.filter(
            (event) =>
              event.type === "operation.started" &&
              event.operationId === CALL_ID &&
              event.operation.kind === "tool" &&
              event.operation.name === "calculate" &&
              typeof event.operation.input === "object" &&
              event.operation.input !== null &&
              !Array.isArray(event.operation.input) &&
              event.operation.input["expression"] === "(23+19)*3",
          ).length === 1 &&
          !events.some(
            (event) =>
              event.type === "operation.finished" &&
              event.operationId === CALL_ID,
          ),
      ),
    );
    const approved = await t.respond("approve");
    await t.require(approved.succeeded());
    t.check(approved.message, includes("local-approval-approved"));
    t.check(
      approved.events,
      satisfies<typeof approved.events>(
        "approval resume only finishes the pending native call",
        (events) =>
          events.filter(
            (event) =>
              event.type === "operation.finished" &&
              event.operationId === CALL_ID &&
              event.status === "completed" &&
              typeof event.output === "object" &&
              event.output !== null &&
              !Array.isArray(event.output) &&
              event.output["value"] === 126 &&
              event.output["marker"] === "local-approval-output",
          ).length === 1 &&
          !events.some((event) => event.type === "operation.started"),
      ),
    );
    const denied = t.newSession();
    const deniedDraft = await denied.send(
      "request the deterministic approval fixture",
    );
    t.check(deniedDraft.parked());
    denied.requireInputRequest({ action: "calculate" });
    const rejected = await denied.respond("deny");
    await t.require(rejected.succeeded());
    t.check(rejected.message, includes("local-approval-denied"));
    t.check(
      denied.events,
      satisfies<typeof denied.events>(
        "denial finishes the pending call as rejected without duplicating its start",
        (events) =>
          events.filter(
            (event) =>
              event.type === "operation.started" &&
              event.operationId === CALL_ID &&
              event.operation.kind === "tool" &&
              event.operation.name === "calculate" &&
              typeof event.operation.input === "object" &&
              event.operation.input !== null &&
              !Array.isArray(event.operation.input) &&
              event.operation.input["expression"] === "(23+19)*3",
          ).length === 1 &&
          events.filter(
            (event) =>
              event.type === "operation.finished" &&
              event.operationId === CALL_ID &&
              event.status === "rejected",
          ).length === 1 &&
          !events.some(
            (event) =>
              event.type === "operation.finished" &&
              event.operationId === CALL_ID &&
              event.status === "completed",
          ),
      ),
    );
  },
});
