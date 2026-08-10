// owner: docs/engineering/testing/e2e/adapter/openai-compat.md#chat-completion-live

import { defineEval } from "niceeval";
import { satisfies } from "niceeval/expect";

export default defineEval({
  description: "真实 ChatCompletion 保留强制 function call 的 id/name/arguments 与 usage",
  async test(t) {
    const turn = await t.send("run the one-request Chat Completions compatibility check");
    await turn.succeeded().stopOnFailure();
    turn.calledTool("lookup_live_chat_fixture", {
      status: "pending",
      input: { marker: "chat-live-20260809" },
      count: 1,
    });
    turn.eventsSatisfy(
      "live Chat Completion exposes a provider call id",
      (events) =>
        events.some(
          (event) =>
            event.type === "operation.started" &&
            event.operationId.length > 0 &&
            event.operation.name === "lookup_live_chat_fixture",
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
