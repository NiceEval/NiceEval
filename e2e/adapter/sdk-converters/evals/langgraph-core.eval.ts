// owner: docs/engineering/testing/e2e/adapter/sdk-converters.md#langgraph-core-deterministic

import { defineEval } from "niceeval";
import { equals } from "niceeval/expect";

export default defineEval({
  description: "LangGraph v3 real GraphRunStream envelope plus official message/tool protocol frames",
  async test(t) {
    const turn = await t.send("langgraph core fixture");
    await turn.succeeded().stopOnFailure();
    turn.messageIncludes("langgraph-runtime-methods:lifecycle");
    turn.calledTool("graph_lookup", {
      status: "completed",
      input: { query: "fixture" },
      output: { marker: "langgraph-core-tool-output" },
      count: 1,
    });
    turn.eventsSatisfy(
      "LangGraph official tool_call id pairs messages and tools channels",
      (events) =>
        events.filter(
          (event) => event.type === "operation.started" && event.operationId === "langgraph-core-tool-call",
        ).length === 1 &&
        events.some(
          (event) =>
            event.type === "operation.finished" &&
            event.operationId === "langgraph-core-tool-call" &&
            event.status === "completed",
        ),
    );
    turn.eventsSatisfy(
      "official methods without a standard mapping advance seq without inventing a subagent",
      (events) =>
        !events.some(
          (event) =>
            (event.type === "operation.started" || event.type === "operation.finished") &&
            event.operationId.startsWith("ignored-state"),
        ),
    );
    t.check(t.sessionId, equals("langgraph-core-runtime-v3"));
    t.check(turn.usage?.inputTokens, equals(8));
    t.check(turn.usage?.cacheReadTokens, equals(3));
    t.check(turn.usage?.cacheCreationTokens, equals(2));
    t.check(turn.usage?.outputTokens, equals(7));
    t.check(turn.usage?.reasoningTokens, equals(1));
  },
});
