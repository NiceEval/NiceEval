// owner: docs/engineering/testing/e2e/adapter/sdk-converters.md#langgraph-core-deterministic
import { defineEval } from "niceeval";
import { atLeast, atMost, equals, includes, jsonMatch, satisfies, toolMatch } from "niceeval/expect";
export default defineEval({
  description:
    "LangGraph v3 real GraphRunStream envelope plus official message/tool protocol frames",
  async test(t) {
    const turn = await t.send("langgraph core fixture");
    await turn.succeeded().orStop();
    t.check(turn.message, includes("langgraph-runtime-methods:lifecycle"));
    turn.check(turn.toolCalls, toolMatch("graph_lookup", {
        input: jsonMatch({ query: "fixture" }),
        status: "completed",
      }).exactly(1));
    t.check(
      turn.events,
      satisfies<typeof turn.events>(
        "LangGraph official tool_call id pairs messages and tools channels",
        (events) =>
          events.filter(
            (event) =>
              event.type === "operation.started" &&
              event.operationId === "langgraph-core-tool-call",
          ).length === 1 &&
          events.some(
            (event) =>
              event.type === "operation.finished" &&
              event.operationId === "langgraph-core-tool-call" &&
              event.status === "completed" &&
              typeof event.output === "object" &&
              event.output !== null &&
              !Array.isArray(event.output) &&
              event.output["marker"] === "langgraph-core-tool-output",
          ),
      ),
    );
    t.check(
      turn.events,
      satisfies<typeof turn.events>(
        "official methods without a standard mapping advance seq without inventing a subagent",
        (events) =>
          !events.some(
            (event) =>
              (event.type === "operation.started" ||
                event.type === "operation.finished") &&
              event.operationId.startsWith("ignored-state"),
          ),
      ),
    );
    t.check(t.sessionId, equals("langgraph-core-runtime-v3"));
    t.check(turn.usage.inputTokens, atLeast(8));
    t.check(turn.usage.inputTokens, atMost(8));
    t.check(turn.usage.cacheReadTokens, atLeast(3));
    t.check(turn.usage.cacheReadTokens, atMost(3));
    t.check(turn.usage.cacheWriteTokens, atLeast(2));
    t.check(turn.usage.cacheWriteTokens, atMost(2));
    t.check(turn.usage.outputTokens, atLeast(7));
    t.check(turn.usage.outputTokens, atMost(7));
  },
});
