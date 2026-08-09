// owner: docs/engineering/testing/e2e/adapter/openai-compat.md#responses-live

import { defineEval } from "niceeval";
import { satisfies } from "niceeval/expect";

export default defineEval({
  description: "真实 Response 保留强制 function_call 的 call_id/name/arguments 与 usage",
  async test(t) {
    const turn = await t.send("run the one-request Responses compatibility check");
    await turn.succeeded().stopOnFailure();
    turn.calledTool("lookup_live_responses_fixture", {
      status: "pending",
      input: { marker: "responses-live-20260809" },
      count: 1,
    });
    turn.eventsSatisfy(
      "live Responses value exposes a provider call_id",
      (events) =>
        events.some(
          (event) =>
            event.type === "operation.started" &&
            event.operationId.length > 0 &&
            event.operation.name === "lookup_live_responses_fixture",
        ),
    );
    t.check(
      turn.usage?.inputTokens,
      satisfies((value) => typeof value === "number" && value > 0, "input token usage is positive"),
    );
    t.check(
      turn.usage?.outputTokens,
      satisfies((value) => typeof value === "number" && value > 0, "output token usage is positive"),
    );
  },
});
