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
    await t.require(turn.succeeded());
    t.assert(
      turn.calledTool(
        toolMatch("lookup_live_responses_fixture", {
          input: satisfies(
            '"lookup_live_responses_fixture" input',
            (input) =>
              typeof input === "object" &&
              input !== null &&
              !Array.isArray(input) &&
              Object.is(input["marker"], "responses-live-20260809"),
          ),
          status: "pending",
        }),
        { count: 1 },
      ),
    );
    t.assert(
      turn.eventsSatisfy("live Responses value exposes a provider call_id", (events) =>
          events.some(
            (event) =>
              event.type === "operation.started" &&
              event.operationId.length > 0 &&
              event.operation.name === "lookup_live_responses_fixture",
          ),
        ),
    );
    t.assert(
      t.check(
        turn.usage?.inputTokens,
        satisfies(
          "input token usage is positive",
          (value) => typeof value === "number" && value > 0,
        ),
      ),
    );
    t.assert(
      t.check(
        turn.usage?.outputTokens,
        satisfies(
          "output token usage is positive",
          (value) => typeof value === "number" && value > 0,
        ),
      ),
    );
  },
});
