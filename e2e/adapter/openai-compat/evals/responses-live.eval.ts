// owner: docs/engineering/testing/e2e/adapter/openai-compat.md#responses-live
import { defineEval } from "niceeval";
import { satisfies, toolMatch } from "niceeval/expect";
export default defineEval({
  description:
    "真实 Response 保留强制 function_call 的 call_id/name/arguments 与 usage",
  async test(t) {
    const turn = await t.send(
      "run the one-request Responses compatibility check",
    );
    await turn.succeeded().orStop();
    turn.calledTool(
      toolMatch("lookup_live_responses_fixture", {
        input: satisfies(
          "arguments 保留 marker responses-live-20260809",
          (input) =>
            typeof input === "object" &&
            input !== null &&
            !Array.isArray(input) &&
            Object.is(
              (input as Record<string, unknown>)["marker"],
              "responses-live-20260809",
            ),
        ),
        status: "pending",
      }),
    );
    t.check(
      turn.events,
      satisfies<typeof turn.events>(
        "live Responses value exposes a provider call_id",
        (events) =>
          events.some(
            (event) =>
              event.type === "operation.started" &&
              event.operationId.length > 0 &&
              event.operation.name === "lookup_live_responses_fixture",
          ),
      ),
    );
    t.check(
      turn.usage?.inputTokens,
      satisfies(
        "input token usage is positive",
        (value) => typeof value === "number" && value > 0,
      ),
    );
    t.check(
      turn.usage?.outputTokens,
      satisfies(
        "output token usage is positive",
        (value) => typeof value === "number" && value > 0,
      ),
    );
  },
});
