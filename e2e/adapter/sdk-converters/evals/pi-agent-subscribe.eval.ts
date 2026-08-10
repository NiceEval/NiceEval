// owner: docs/engineering/testing/e2e/adapter/sdk-converters.md#pi-agent-subscribe-deterministic

import { defineEval } from "niceeval";
import { equals } from "niceeval/expect";

export default defineEval({
  description: "真实 Pi Agent prompt/subscribe 生命周期直入 converter，覆盖成功、工具配对、usage 与 terminal failure",
  async test(t) {
    const completed = await t.send("pi agent completed fixture");
    await completed.succeeded().stopOnFailure();
    completed.messageIncludes("pi-agent-subscribe-success-marker");
    completed.calledTool("inventory_lookup", {
      status: "completed",
      input: { sku: "pi-001" },
      output: {
        content: [{ type: "text", text: "inventory pi-001" }],
        details: { toolCallId: "pi-inventory-call", sku: "pi-001", marker: "pi-agent-tool-result-marker" },
      },
      count: 1,
    });
    completed.eventsSatisfy(
      "Pi Agent preserves its native toolCallId across subscribe start/result callbacks",
      (events) =>
        events.some((event) => event.type === "operation.started" && event.operationId === "pi-inventory-call") &&
        events.some(
          (event) =>
            event.type === "operation.finished" &&
            event.operationId === "pi-inventory-call" &&
            event.status === "completed",
        ),
    );
    t.check(t.sessionId, equals("pi-agent-completed-session"));
    t.check(completed.usage?.inputTokens, equals(10));
    t.check(completed.usage?.outputTokens, equals(5));
    t.check(completed.usage?.cacheReadTokens, equals(4));
    t.check(completed.usage?.cacheCreationTokens, equals(2));

    const failedSession = t.newSession();
    const failed = await failedSession.send("pi agent terminal failure fixture");
    t.check(failed.status, equals("failed"));
    failed.event("error", { count: 1 });
    failed.eventsSatisfy(
      "Pi Agent terminal provider error remains observable",
      (events) => events.some((event) => event.type === "error" && event.message === "pi-agent-terminal-failure-marker"),
    );
    t.check(failedSession.sessionId, equals("pi-agent-failed-session"));
    t.check(failed.usage?.inputTokens, equals(5));
    t.check(failed.usage?.outputTokens, equals(1));
  },
});
