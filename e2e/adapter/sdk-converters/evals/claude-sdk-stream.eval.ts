// owner: docs/engineering/testing/e2e/adapter/sdk-converters.md#claude-sdk-stream-deterministic

import { defineEval } from "niceeval";
import { eventMatch, includes, satisfies, toolMatch } from "niceeval/expect";

export default defineEval({
  description:
    "Claude Agent SDK raw frames 经 converter 保留 tool_use_id、原生工具 canonical、usage/session 与 markRejected",
  async test(t) {
    const turn = await t.send("feed the locked Claude SDK protocol fixture");
    await t.require(turn.succeeded());
    t.assert(t.check(turn.message, includes("claude-sdk-assistant-marker")));
    t.assert(
      turn.event(
        eventMatch("operation.finished", {
          tool: toolMatch("shell", {
            input: satisfies(
              "Claude Bash input",
              (input) =>
                typeof input === "object" &&
                input !== null &&
                !Array.isArray(input) &&
                input["command"] === "printf claude-sdk-bash-marker",
            ),
            status: "completed",
          }),
          output: satisfies("Claude Bash output", (output) => output === "claude-sdk-bash-result-marker"),
        }),
        { count: 1 },
      ),
    );
    t.assert(
      turn.event(
        eventMatch("operation.finished", {
          tool: toolMatch("file_read", {
            input: satisfies(
              "Claude file read input",
              (input) =>
                typeof input === "object" &&
                input !== null &&
                !Array.isArray(input) &&
                input["file_path"] === "/offline/fixture.txt",
            ),
            status: "completed",
          }),
          output: satisfies("Claude file read output", (output) => output === "claude-sdk-read-result-marker"),
        }),
        { count: 1 },
      ),
    );
    t.assert(
      turn.event(
        eventMatch("operation.finished", {
          tool: toolMatch("file_write", {
            input: satisfies(
              "Claude file write input",
              (input) =>
                typeof input === "object" &&
                input !== null &&
                !Array.isArray(input) &&
                input["file_path"] === "/offline/out.txt" &&
                input["content"] === "claude-sdk-write-marker",
            ),
            status: "completed",
          }),
          output: satisfies("Claude file write output", (output) => output === "claude-sdk-write-result-marker"),
        }),
        { count: 1 },
      ),
    );
    t.assert(
      turn.event(
        eventMatch("operation.finished", {
          tool: toolMatch("shell", {
            input: satisfies(
              "Claude rejected Bash input",
              (input) =>
                typeof input === "object" &&
                input !== null &&
                !Array.isArray(input) &&
                input["command"] === "rm -f prohibited-fixture",
            ),
            status: "rejected",
          }),
          output: satisfies("Claude rejected Bash output", (output) => output === "claude-sdk-rejected-result-marker"),
        }),
        { count: 1 },
      ),
    );
    t.assert(
      turn.eventsSatisfy(
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
    t.assert(
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
      ),
    );
  },
});
