// owner: docs/engineering/testing/e2e/adapter/sdk-converters.md#openai-responses-deterministic
import { defineEval } from "niceeval";
import { atLeast, atMost, includes, satisfies, toolMatch } from "niceeval/expect";
export default defineEval({
  description:
    "openai@6.49 Responses raw response 保留 message/function_call 与互斥 usage",
  async test(t) {
    const turn = await t.send("openai responses fixture");
    await turn.succeeded().orStop();
    turn.calledTool(toolMatch("calendar_lookup", { status: "pending" }));
    t.check(turn.message, includes("openai-responses-message-marker"));
    t.check(
      turn.events,
      satisfies<typeof turn.events>(
        "Responses function_call retains the official call_id",
        (events) =>
          events.some(
            (event) =>
              event.type === "operation.started" &&
              event.operationId === "openai-responses-function-call" &&
              event.operation.kind === "tool" &&
              event.operation.name === "calendar_lookup" &&
              typeof event.operation.input === "object" &&
              event.operation.input !== null &&
              !Array.isArray(event.operation.input) &&
              event.operation.input["date"] === "2026-08-09",
          ) && !events.some((event) => event.type === "operation.finished"),
      ),
    );
    t.check(turn.usage.inputTokens, atLeast(12));
    t.check(turn.usage.inputTokens, atMost(12));
    t.check(turn.usage.cacheReadTokens, atLeast(5));
    t.check(turn.usage.cacheReadTokens, atMost(5));
    t.check(turn.usage.outputTokens, atLeast(8));
    t.check(turn.usage.outputTokens, atMost(8));
  },
});
