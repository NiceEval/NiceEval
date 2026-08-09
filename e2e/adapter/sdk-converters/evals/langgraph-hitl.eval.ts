// owner: docs/engineering/testing/e2e/adapter/sdk-converters.md#langgraph-hitl-deterministic

import { defineEval } from "niceeval";
import { equals, includes } from "niceeval/expect";

export default defineEval({
  description:
    "LangGraph interrupt/Command 使用每 official run 新 converter，由 session 累计跨 Turn call 配对",
  async test(t) {
    const draft = await t.send("langgraph hitl approve fixture");
    t.assert(t.check(draft.status, equals("waiting")));
    t.assert(draft.parked());
    t.assert(
      draft.eventsSatisfy("initial HITL run exposes one pending native call", (events) =>
        events.filter(
          (event) =>
            event.type === "operation.started" &&
            event.operationId === "langgraph-hitl-call" &&
            event.operation.kind === "tool" &&
            event.operation.name === "approve_change" &&
            typeof event.operation.input === "object" &&
            event.operation.input !== null &&
            !Array.isArray(event.operation.input) &&
            event.operation.input["target"] === "langgraph-fixture",
        ).length === 1 &&
        !events.some((event) => event.type === "operation.finished"),
      ),
    );
    t.requireInputRequest({ action: "approve_change" });
    t.assert(
      t.check(
        draft.message,
        includes("langgraph-hitl-runtime-initial:lifecycle"),
      ),
    );

    const approved = await t.respond("accept");
    await t.require(approved.succeeded());
    t.assert(
      t.check(approved.message, includes("langgraph-hitl-approved-marker")),
    );
    t.assert(
      approved.eventsSatisfy("approved run retains the native tool output", (events) =>
          events.some(
            (event) =>
              event.type === "operation.finished" &&
              event.operationId === "langgraph-hitl-call" &&
              event.status === "completed" &&
              typeof event.output === "object" &&
              event.output !== null &&
              !Array.isArray(event.output) &&
              event.output["marker"] === "langgraph-hitl-approved-output",
          ) &&
          !events.some((event) => event.type === "operation.started"),
        ),
    );

    const rejectedSession = t.newSession();
    const rejectedDraft = await rejectedSession.send(
      "langgraph hitl reject fixture",
    );
    t.assert(rejectedDraft.parked());
    rejectedSession.requireInputRequest({ action: "approve_change" });
    const rejected = await rejectedSession.respond("ignore");
    await t.require(rejected.succeeded());
    t.assert(
      t.check(rejected.message, includes("langgraph-hitl-rejected-marker")),
    );
    t.assert(
      rejectedSession.eventsSatisfy(
          "resumed rejected run closes the prior Turn call id without re-emitting start",
          (events) =>
            events.filter(
              (event) =>
                event.type === "operation.started" &&
                event.operationId === "langgraph-hitl-call" &&
                event.operation.kind === "tool" &&
                event.operation.name === "approve_change" &&
                typeof event.operation.input === "object" &&
                event.operation.input !== null &&
                !Array.isArray(event.operation.input) &&
                event.operation.input["target"] === "langgraph-fixture",
            ).length === 1 &&
            events.some(
              (event) =>
                event.type === "operation.finished" &&
                event.operationId === "langgraph-hitl-call" &&
                event.status === "rejected" &&
                event.output === undefined,
            ) &&
            !events.some(
              (event) =>
                event.type === "operation.finished" &&
                event.operationId === "langgraph-hitl-call" &&
                (event.status === "failed" || event.status === "completed"),
            ),
        ),
    );
  },
});
