// owner: docs/engineering/testing/e2e/adapter/sdk-converters.md#claude-sdk-stream-deterministic
import { defineEval } from "niceeval";
import { includes, jsonMatch, satisfies, toolMatch } from "niceeval/expect";
export default defineEval({
  description:
    "Claude Agent SDK raw frames 经 converter 保留 tool_use_id、原生工具 canonical、usage/session 与 markRejected",
  async test(t) {
    const turn = await t.send("feed the locked Claude SDK protocol fixture");
    await turn.succeeded().orStop();
    t.check(turn.message, includes("claude-sdk-assistant-marker"));
    turn.calledTool(
      toolMatch("shell", {
        input: jsonMatch({ command: "printf claude-sdk-bash-marker" }),
        status: "completed",
      }),
      { count: 1 },
    );
    turn.calledTool(
      toolMatch("file_read", {
        input: jsonMatch({ file_path: "/offline/fixture.txt" }),
        status: "completed",
      }),
      { count: 1 },
    );
    turn.calledTool(
      toolMatch("file_write", {
        input: jsonMatch({
          file_path: "/offline/out.txt",
          content: "claude-sdk-write-marker",
        }),
        status: "completed",
      }),
      { count: 1 },
    );
    turn.calledTool(
      toolMatch("shell", {
        input: jsonMatch({ command: "rm -f prohibited-fixture" }),
        status: "rejected",
      }),
      { count: 1 },
    );
    t.check(
      turn.events,
      satisfies<typeof turn.events>(
        "Claude tool_use_id values pair every native start and result",
        (events) =>
          [
            ["claude-bash-call", "completed"],
            ["claude-read-call", "completed"],
            ["claude-write-call", "completed"],
            ["claude-rejected-call", "rejected"],
          ].every(
            ([operationId, status]) =>
              events.some(
                (event) =>
                  event.type === "operation.started" &&
                  event.operationId === operationId,
              ) &&
              events.some(
                (event) =>
                  event.type === "operation.finished" &&
                  event.operationId === operationId &&
                  event.status === status,
              ),
          ),
      ),
    );
    t.check(
      turn.events,
      satisfies<typeof turn.events>(
        "Claude native tool outputs remain observable",
        (events) =>
          [
            ["claude-bash-call", "claude-sdk-bash-result-marker"],
            ["claude-read-call", "claude-sdk-read-result-marker"],
            ["claude-write-call", "claude-sdk-write-result-marker"],
            ["claude-rejected-call", "claude-sdk-rejected-result-marker"],
          ].every(([operationId, output]) =>
            events.some(
              (event) =>
                event.type === "operation.finished" &&
                event.operationId === operationId &&
                event.output === output,
            ),
          ),
      ),
    );
    t.check(
      { sessionId: t.sessionId, usage: turn.usage },
      satisfies(
        "Claude converter session and usage",
        ({ sessionId, usage }) =>
          sessionId === "claude-sdk-converter-session" &&
          usage?.inputTokens === 100 &&
          usage.cacheReadTokens === 30 &&
          usage.cacheCreationTokens === 10 &&
          usage.outputTokens === 20 &&
          usage.requests === 2,
      ),
    );
  },
});
