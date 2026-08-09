// owner: docs/engineering/testing/e2e/adapter/sdk-converters.md#claude-sdk-stream-deterministic

import { defineEval } from "niceeval";
import { equals } from "niceeval/expect";

export default defineEval({
  description: "Claude Agent SDK raw frames 经 converter 保留 tool_use_id、原生工具 canonical、usage/session 与 markRejected",
  async test(t) {
    const turn = await t.send("feed the locked Claude SDK protocol fixture");
    await turn.succeeded().stopOnFailure();
    turn.messageIncludes("claude-sdk-assistant-marker");
    turn.calledTool("shell", {
      status: "completed",
      input: { command: "printf claude-sdk-bash-marker" },
      output: "claude-sdk-bash-result-marker",
      count: 1,
    });
    turn.calledTool("file_read", {
      status: "completed",
      input: { file_path: "/offline/fixture.txt" },
      output: "claude-sdk-read-result-marker",
      count: 1,
    });
    turn.calledTool("file_write", {
      status: "completed",
      input: { file_path: "/offline/out.txt", content: "claude-sdk-write-marker" },
      output: "claude-sdk-write-result-marker",
      count: 1,
    });
    turn.calledTool("shell", {
      status: "rejected",
      input: { command: "rm -f prohibited-fixture" },
      output: "claude-sdk-rejected-result-marker",
      count: 1,
    });
    turn.eventsSatisfy(
      "Claude tool_use_id values pair every native start and result",
      (events) =>
        [
          ["claude-bash-call", "completed"],
          ["claude-read-call", "completed"],
          ["claude-write-call", "completed"],
          ["claude-rejected-call", "rejected"],
        ].every(([operationId, status]) =>
          events.some((event) => event.type === "operation.started" && event.operationId === operationId) &&
          events.some(
            (event) =>
              event.type === "operation.finished" && event.operationId === operationId && event.status === status,
          ),
        ),
    );
    t.check(t.sessionId, equals("claude-sdk-converter-session"));
    t.check(turn.usage?.inputTokens, equals(100));
    t.check(turn.usage?.cacheReadTokens, equals(30));
    t.check(turn.usage?.cacheCreationTokens, equals(10));
    t.check(turn.usage?.outputTokens, equals(20));
    t.check(turn.usage?.requests, equals(2));
  },
});
