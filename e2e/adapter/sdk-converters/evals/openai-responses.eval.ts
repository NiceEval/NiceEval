// owner: docs/engineering/testing/e2e/adapter/sdk-converters.md#openai-responses-deterministic

import { defineEval } from "niceeval";
import { equals } from "niceeval/expect";

export default defineEval({
  description: "openai@6.49 Responses raw response 保留 message/function_call 与互斥 usage",
  async test(t) {
    const turn = await t.send("openai responses fixture");
    await turn.succeeded().stopOnFailure();
    turn.messageIncludes("openai-responses-message-marker");
    turn.calledTool("calendar_lookup", {
      status: "pending",
      input: { date: "2026-08-09" },
      count: 1,
    });
    turn.eventsSatisfy(
      "Responses function_call retains the official call_id",
      (events) =>
        events.some(
          (event) => event.type === "operation.started" && event.operationId === "openai-responses-function-call",
        ),
    );
    t.check(turn.usage?.inputTokens, equals(12));
    t.check(turn.usage?.cacheReadTokens, equals(5));
    t.check(turn.usage?.outputTokens, equals(8));
    t.check(turn.usage?.reasoningTokens, equals(3));
  },
});
