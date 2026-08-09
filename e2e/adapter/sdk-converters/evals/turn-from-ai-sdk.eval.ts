// owner: docs/engineering/testing/e2e/adapter/sdk-converters.md#turnfromaisdk-deterministic

import { defineEval } from "niceeval";
import { equals } from "niceeval/expect";

export default defineEval({
  description: "AI SDK generateText seam 经 turnFromAiSdk 保留 call/result 配对、HITL 与互斥 usage 桶",
  async test(t) {
    const draft = await t.send("produce deterministic AI SDK tool calls and wait for approval");
    t.check(draft.status, equals("waiting"));
    draft.parked();
    draft.calledTool("inventory_lookup", {
      status: "completed",
      input: { sku: "fixture-001" },
      output: { marker: "ai-sdk-tool-result-marker" },
      count: 1,
    });
    draft.calledTool("approval_tool", {
      status: "pending",
      input: { change: "apply-fixture-change" },
      count: 1,
    });
    draft.eventsSatisfy(
      "AI SDK inventory toolCallId pairs its raw call and result",
      (events) =>
        events.some(
          (event) =>
            event.type === "operation.started" &&
            event.operationId === "ai-sdk-inventory-call" &&
            event.operation.name === "inventory_lookup",
        ) &&
        events.some(
          (event) =>
            event.type === "operation.finished" &&
            event.operationId === "ai-sdk-inventory-call" &&
            event.status === "completed",
        ),
    );
    t.requireInputRequest({ action: "approval_tool" });
    t.check(draft.usage?.inputTokens, equals(7));
    t.check(draft.usage?.cacheReadTokens, equals(4));
    t.check(draft.usage?.cacheCreationTokens, equals(2));
    t.check(
      (draft.usage?.inputTokens ?? 0) + (draft.usage?.cacheReadTokens ?? 0) + (draft.usage?.cacheCreationTokens ?? 0),
      equals(13),
    );

    const approved = await t.respond("approve");
    approved.succeeded();
    approved.messageIncludes("ai-sdk-approved-marker");
    t.calledTool("approval_tool", { status: "completed", count: 1 });
    t.eventsSatisfy(
      "AI SDK approval response finishes the same native call id",
      (events) =>
        events.some((event) => event.type === "operation.started" && event.operationId === "ai-sdk-approval-call") &&
        events.some(
          (event) =>
            event.type === "operation.finished" &&
            event.operationId === "ai-sdk-approval-call" &&
            event.status === "completed",
        ),
    );

    const denied = t.newSession();
    const deniedDraft = await denied.send("produce deterministic AI SDK tool calls and wait for approval");
    deniedDraft.parked();
    denied.requireInputRequest({ action: "approval_tool" });
    const rejection = await denied.respond("deny");
    rejection.succeeded();
    rejection.messageIncludes("ai-sdk-rejected-marker");
    denied.calledTool("approval_tool", { status: "rejected", count: 1 });
    denied.notCalledTool("approval_tool", { status: "completed" });
    denied.eventsSatisfy(
      "AI SDK denial finishes the same native call id as rejected",
      (events) =>
        events.some((event) => event.type === "operation.started" && event.operationId === "ai-sdk-approval-call") &&
        events.some(
          (event) =>
            event.type === "operation.finished" &&
            event.operationId === "ai-sdk-approval-call" &&
            event.status === "rejected",
        ),
    );
  },
});
