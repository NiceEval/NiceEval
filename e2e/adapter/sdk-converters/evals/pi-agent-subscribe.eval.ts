// owner: docs/engineering/testing/e2e/adapter/sdk-converters.md#pi-agent-subscribe-deterministic

import { defineEval } from "niceeval";
import { equals, eventMatch, includes, satisfies, toolMatch } from "niceeval/expect";

export default defineEval({
  description:
    "真实 Pi Agent prompt/subscribe 生命周期直入 converter，覆盖成功、工具配对、usage 与 terminal failure",
  async test(t) {
    const completed = await t.send("pi agent completed fixture");
    await t.require(completed.succeeded());
    t.assert(
      t.check(completed.message, includes("pi-agent-subscribe-success-marker")),
    );
    t.assert(
      completed.event(
        eventMatch("operation.finished", {
          tool: toolMatch("inventory_lookup", {
            input: satisfies(
              "Pi inventory lookup input",
              (input) =>
                typeof input === "object" &&
                input !== null &&
                !Array.isArray(input) &&
                input["sku"] === "pi-001",
            ),
            status: "completed",
          }),
          output: satisfies("Pi inventory lookup output", (output) =>
            typeof output === "object" &&
            output !== null &&
            !Array.isArray(output) &&
            Array.isArray(output.content) &&
            output.content.length === 1 &&
            typeof output.content[0] === "object" &&
            output.content[0] !== null &&
            !Array.isArray(output.content[0]) &&
            output.content[0].type === "text" &&
            output.content[0].text === "inventory pi-001" &&
            typeof output.details === "object" &&
            output.details !== null &&
            !Array.isArray(output.details) &&
            output.details.toolCallId === "pi-inventory-call" &&
            output.details.sku === "pi-001" &&
            output.details.marker === "pi-agent-tool-result-marker",
          ),
        }),
        { count: 1 },
      ),
    );
    t.assert(
      completed.eventsSatisfy(
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
    t.assert(
      t.check(
        { sessionId: t.sessionId, usage: completed.usage },
        satisfies(
          "Pi completed session and usage",
          ({ sessionId, usage }) =>
            sessionId === "pi-agent-completed-session" &&
            usage?.inputTokens === 10 &&
            usage.outputTokens === 5 &&
            usage.cacheReadTokens === 4 &&
            usage.cacheCreationTokens === 2,
        ),
      ),
    );

    const failedSession = t.newSession();
    const failed = await failedSession.send(
      "pi agent terminal failure fixture",
    );
    t.assert(t.check(failed.status, equals("failed")));
    t.assert(
      failed.eventsSatisfy(
        "error event count",
          (events) =>
            events.filter((event) => event.type === "error").length === 1,
      ),
    );
    t.assert(
      failed.eventsSatisfy(
          "Pi Agent terminal provider error remains observable",
          (events) =>
            events.some(
              (event) =>
                event.type === "error" &&
                event.message === "pi-agent-terminal-failure-marker",
            ),
        ),
    );
    t.assert(
      t.check(
        { sessionId: failedSession.sessionId, usage: failed.usage },
        satisfies(
          "Pi failed session and usage",
          ({ sessionId, usage }) =>
            sessionId === "pi-agent-failed-session" &&
            usage?.inputTokens === 5 &&
            usage.outputTokens === 1,
        ),
      ),
    );
  },
});
