// owner: docs/engineering/testing/e2e/adapter/sdk-converters.md#openai-responses-deterministic
import { defineEval } from "niceeval";
import { equals, includes, satisfies } from "niceeval/expect";
export default defineEval({
  description:
    "openai@6.49 Responses raw response 保留 message/function_call 与互斥 usage",
  async test(t) {
    const turn = await t.send("openai responses fixture");
    // Responses 的 status 通道如实声明 partial(converter 只映射返回的响应，
    // 不观察完整请求生命周期)，succeeded() 在非 complete 通道上不可判定；这里断言
    // 转换器映射出的 status 值本身(显式值断言，不依赖通道 coverage)。
    t.check(turn.status, equals("completed"));
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
    t.check(
      turn.usage,
      satisfies<typeof turn.usage>(
        "OpenAI Responses usage",
        (usage) =>
          usage?.inputTokens === 12 &&
          usage.cacheReadTokens === 5 &&
          usage.outputTokens === 8 &&
          usage.reasoningTokens === 3,
      ),
    );
  },
});
