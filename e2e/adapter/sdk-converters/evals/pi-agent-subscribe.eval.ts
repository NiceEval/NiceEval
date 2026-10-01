// owner: docs/engineering/testing/e2e/adapter/sdk-converters.md#pi-agent-subscribe-deterministic
import { defineEval } from "niceeval";
import {
  atLeast,
  atMost,
  equals,
  includes,
  jsonMatch,
  satisfies,
  toolMatch,
} from "niceeval/expect";
export default defineEval({
  description:
    "真实 Pi Agent prompt/subscribe 生命周期直入 converter，覆盖成功、工具配对、usage 与 terminal failure",
  async test(t) {
    const completed = await t.send("pi agent completed fixture");
    await completed.succeeded().orStop();
    t.check(completed.message, includes("pi-agent-subscribe-success-marker"));
    completed.check(completed.toolCalls, toolMatch("inventory_lookup", {
        input: jsonMatch({ sku: "pi-001" }),
        status: "completed",
      }).exactly(1));
    t.check(
      completed.events,
      satisfies<typeof completed.events>(
        "Pi Agent preserves its native toolCallId across subscribe start/result callbacks",
        (events) =>
          events.some(
            (event) =>
              event.type === "operation.started" &&
              event.operationId === "pi-inventory-call",
          ) &&
          events.some(
            (event) =>
              event.type === "operation.finished" &&
              event.operationId === "pi-inventory-call" &&
              event.status === "completed" &&
              typeof event.output === "object" &&
              event.output !== null &&
              !Array.isArray(event.output) &&
              Array.isArray(event.output["content"]) &&
              event.output["content"].length === 1 &&
              typeof event.output["content"][0] === "object" &&
              event.output["content"][0] !== null &&
              !Array.isArray(event.output["content"][0]) &&
              event.output["content"][0]["type"] === "text" &&
              event.output["content"][0]["text"] === "inventory pi-001" &&
              typeof event.output["details"] === "object" &&
              event.output["details"] !== null &&
              !Array.isArray(event.output["details"]) &&
              event.output["details"]["toolCallId"] === "pi-inventory-call" &&
              event.output["details"]["sku"] === "pi-001" &&
              event.output["details"]["marker"] ===
                "pi-agent-tool-result-marker",
          ),
      ),
    );
    t.check(t.sessionId, equals("pi-agent-completed-session"));
    t.check(completed.usage.inputTokens, atLeast(10));
    t.check(completed.usage.inputTokens, atMost(10));
    t.check(completed.usage.outputTokens, atLeast(5));
    t.check(completed.usage.outputTokens, atMost(5));
    t.check(completed.usage.cacheReadTokens, atLeast(4));
    t.check(completed.usage.cacheReadTokens, atMost(4));
    t.check(completed.usage.cacheWriteTokens, atLeast(2));
    t.check(completed.usage.cacheWriteTokens, atMost(2));
    const failedSession = t.newSession();
    const failed = await failedSession.send(
      "pi agent terminal failure fixture",
    );
    t.check(failed.status, equals("failed"));
    t.check(
      failed.events,
      satisfies<typeof failed.events>(
        "error event count",
        (events) =>
          events.filter((event) => event.type === "error").length === 1,
      ),
    );
    t.check(
      failed.events,
      satisfies<typeof failed.events>(
        "Pi Agent terminal provider error remains observable",
        (events) =>
          events.some(
            (event) =>
              event.type === "error" &&
              event.message === "pi-agent-terminal-failure-marker",
          ),
      ),
    );
    t.check(failedSession.sessionId, equals("pi-agent-failed-session"));
    t.check(failed.usage.inputTokens, atLeast(5));
    t.check(failed.usage.inputTokens, atMost(5));
    t.check(failed.usage.outputTokens, atLeast(1));
    t.check(failed.usage.outputTokens, atMost(1));
  },
});
