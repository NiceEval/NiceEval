// owner: docs/engineering/testing/e2e/adapter/sdk-converters.md#openai-chat-completion-deterministic

import { defineEval } from "niceeval";
import { equals } from "niceeval/expect";

export default defineEval({
  description: "openai@6.49 ChatCompletion raw response 保留 function/custom tool 与互斥 usage",
  async test(t) {
    const turn = await t.send("openai chat completion fixture");
    await turn.succeeded().stopOnFailure();
    turn.messageIncludes("openai-chat-completion-message-marker");
    turn.calledTool("weather_lookup", {
      status: "pending",
      input: { city: "Taipei" },
      count: 1,
    });
    turn.calledTool("grammar_query", {
      status: "pending",
      input: "SELECT fixture_marker",
      count: 1,
    });
    turn.eventsSatisfy(
      "Chat function/custom calls retain official SDK ids and distinct input shapes",
      (events) =>
        events.some(
          (event) => event.type === "operation.started" && event.operationId === "openai-chat-function-call",
        ) &&
        events.some(
          (event) => event.type === "operation.started" && event.operationId === "openai-chat-custom-call",
        ),
    );
    t.check(turn.usage?.inputTokens, equals(10));
    t.check(turn.usage?.cacheReadTokens, equals(3));
    t.check(turn.usage?.outputTokens, equals(7));
    t.check(turn.usage?.reasoningTokens, equals(2));
  },
});
