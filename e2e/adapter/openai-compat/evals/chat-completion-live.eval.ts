// owner: docs/engineering/testing/e2e/adapter/openai-compat.md#chat-completion-live
import { defineEval } from "niceeval";
import { satisfies, toolMatch } from "niceeval/expect";
export default defineEval({
  description:
    "真实 ChatCompletion 保留强制 function call 的 id/name/arguments 与 usage",
  async test(t) {
    const turn = await t.send(
      "run the one-request Chat Completions compatibility check",
    );
    await t.require(turn.succeeded());
    t.check(
      turn.calledTool(
        toolMatch("lookup_live_chat_fixture", {
          input: satisfies(
            '"lookup_live_chat_fixture" input',
            (input) =>
              typeof input === "object" &&
              input !== null &&
              !Array.isArray(input) &&
              Object.is(input["marker"], "chat-live-20260809"),
          ),
          status: "pending",
        }),
        { count: 1 },
      ),
    );
    t.check(
      turn.events,
      satisfies<typeof turn.events>(
        "live Chat Completion exposes a provider call id",
        (events) =>
          events.some(
            (event) =>
              event.type === "operation.started" &&
              event.operationId.length > 0 &&
              event.operation.name === "lookup_live_chat_fixture",
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
