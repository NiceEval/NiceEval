// owner: docs/engineering/testing/e2e/adapter/sdk-converters.md#turnfromaisdk-deterministic
import { defineEval } from "niceeval";
import {
  equals,
  includes,
  satisfies,
} from "niceeval/expect";
export default defineEval({
  description:
    "AI SDK generateText seam 经 turnFromAiSdk 保留 call/result 配对、HITL 与互斥 usage 桶",
  async test(t) {
    const draft = await t.send(
      "produce deterministic AI SDK tool calls and wait for approval",
    );
    t.check(draft.status, equals("waiting"));
    draft.calledTool("inventory_lookup", {
      input: { sku: "fixture-001" },
      status: "completed",
      count: 1,
    });
    t.check(
      draft.events,
      satisfies<typeof draft.events>(
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
              event.status === "completed" &&
              typeof event.output === "object" &&
              event.output !== null &&
              !Array.isArray(event.output) &&
              event.output["marker"] === "ai-sdk-tool-result-marker",
          ) &&
          events.some(
            (event) =>
              event.type === "operation.started" &&
              event.operationId === "ai-sdk-approval-call" &&
              event.operation.kind === "tool" &&
              event.operation.name === "approval_tool" &&
              typeof event.operation.input === "object" &&
              event.operation.input !== null &&
              !Array.isArray(event.operation.input) &&
              event.operation.input["change"] === "apply-fixture-change",
          ) &&
          !events.some(
            (event) =>
              event.type === "operation.finished" &&
              event.operationId === "ai-sdk-approval-call",
          ),
      ),
    );
    t.requireInputRequest({ action: "approval_tool" });
    t.check(
      draft.usage,
      satisfies<typeof draft.usage>(
        "AI SDK input usage buckets total 13",
        (usage) =>
          typeof usage?.inputTokens === "number" &&
          typeof usage.cacheReadTokens === "number" &&
          typeof usage.cacheCreationTokens === "number" &&
          usage.inputTokens === 7 &&
          usage.cacheReadTokens === 4 &&
          usage.cacheCreationTokens === 2 &&
          usage.inputTokens +
            usage.cacheReadTokens +
            usage.cacheCreationTokens ===
            13,
      ),
    );
    const approved = await t.respond("approve");
    approved.succeeded();
    t.check(approved.message, includes("ai-sdk-approved-marker"));
    t.check(
      approved.events,
      satisfies<typeof approved.events>(
        "AI SDK approval response finishes the same native call id",
        (events) =>
          events.some(
            (event) =>
              event.type === "operation.finished" &&
              event.operationId === "ai-sdk-approval-call" &&
              event.status === "completed",
          ) &&
          !events.some(
            (event) =>
              event.type === "operation.finished" &&
              event.operationId === "ai-sdk-approval-call" &&
              event.status !== "completed",
          ),
      ),
    );
    const denied = t.newSession();
    const deniedDraft = await denied.send(
      "produce deterministic AI SDK tool calls and wait for approval",
    );
    t.check(deniedDraft.status, equals("waiting"));
    denied.requireInputRequest({ action: "approval_tool" });
    const rejection = await denied.respond("deny");
    rejection.succeeded();
    t.check(rejection.message, includes("ai-sdk-rejected-marker"));
    t.check(
      denied.events,
      satisfies<typeof denied.events>(
        "AI SDK denial finishes the same native call id as rejected",
        (events) =>
          events.some(
            (event) =>
              event.type === "operation.started" &&
              event.operationId === "ai-sdk-approval-call" &&
              event.operation.kind === "tool" &&
              event.operation.name === "approval_tool" &&
              typeof event.operation.input === "object" &&
              event.operation.input !== null &&
              !Array.isArray(event.operation.input) &&
              event.operation.input["change"] === "apply-fixture-change",
          ) &&
          events.some(
            (event) =>
              event.type === "operation.finished" &&
              event.operationId === "ai-sdk-approval-call" &&
              event.status === "rejected",
          ) &&
          !events.some(
            (event) =>
              event.type === "operation.finished" &&
              event.operationId === "ai-sdk-approval-call" &&
              event.status === "completed",
          ),
      ),
    );
  },
});
