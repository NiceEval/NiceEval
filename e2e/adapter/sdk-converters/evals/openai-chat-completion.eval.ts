// owner: docs/engineering/testing/e2e/adapter/sdk-converters.md#openai-chat-completion-deterministic

import { defineEval } from "niceeval";
import { includes, satisfies } from "niceeval/expect";

export default defineEval({
  description:
    "openai@6.49 ChatCompletion raw response 保留 function/custom tool 与互斥 usage",
  async test(t) {
    const turn = await t.send("openai chat completion fixture");
    await t.require(turn.succeeded());
    t.assert(
      t.check(turn.message, includes("openai-chat-completion-message-marker")),
    );
    t.assert(
      turn.eventsSatisfy(
          "Chat function/custom calls retain official SDK ids and distinct input shapes",
          (events) =>
            events.some(
              (event) =>
                event.type === "operation.started" &&
                event.operationId === "openai-chat-function-call" &&
                event.operation.kind === "tool" &&
                event.operation.name === "weather_lookup" &&
                typeof event.operation.input === "object" &&
                event.operation.input !== null &&
                !Array.isArray(event.operation.input) &&
                event.operation.input["city"] === "Taipei",
            ) &&
            events.some(
              (event) =>
                event.type === "operation.started" &&
                event.operationId === "openai-chat-custom-call" &&
                event.operation.kind === "tool" &&
                event.operation.name === "grammar_query" &&
                event.operation.input === "SELECT fixture_marker",
            ) &&
            !events.some((event) => event.type === "operation.finished"),
        ),
    );
    t.assert(
      t.check(
        turn.usage,
        satisfies(
          "OpenAI chat completion usage",
          (usage) =>
            usage?.inputTokens === 10 &&
            usage.cacheReadTokens === 3 &&
            usage.outputTokens === 7 &&
            usage.reasoningTokens === 2,
        ),
      ),
    );
  },
});
