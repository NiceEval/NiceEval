// owner: docs/engineering/testing/e2e/adapter/sdk-converters.md#codex-thread-stream-deterministic

import { defineEval } from "niceeval";
import { equals, eventMatch, includes, satisfies, toolMatch } from "niceeval/expect";

export default defineEval({
  description:
    "Codex ThreadEvent raw frames 经 converter 保留 command/file canonical、call ID、usage/thread 与 terminal failure",
  async test(t) {
    const completed = await t.send("codex completed fixture");
    await t.require(completed.succeeded());
    t.assert(t.check(completed.message, includes("codex-sdk-message-marker")));
    t.assert(
      completed.event(
        eventMatch("operation.finished", {
          tool: toolMatch("shell", {
            input: satisfies(
              "Codex command input",
              (input) =>
                typeof input === "object" &&
                input !== null &&
                !Array.isArray(input) &&
                input["command"] === "printf codex-sdk-command-marker",
            ),
            status: "completed",
          }),
          output: satisfies("Codex command output", (output) =>
            typeof output === "object" &&
            output !== null &&
            !Array.isArray(output) &&
            output.output === "codex-sdk-command-result-marker" &&
            output.exit_code === 0,
          ),
        }),
        { count: 1 },
      ),
    );
    t.assert(
      completed.event(
        eventMatch("operation.finished", {
          tool: toolMatch("file_edit", {
            input: satisfies(
              "Codex file edit input",
              (input) =>
                typeof input === "object" &&
                input !== null &&
                !Array.isArray(input) &&
                input["path"] === "src/fixture.ts" &&
                input["kind"] === "update",
            ),
            status: "completed",
          }),
          output: satisfies("Codex file edit output", (output) =>
            typeof output === "object" &&
            output !== null &&
            !Array.isArray(output) &&
            output.path === "src/fixture.ts" &&
            output.kind === "update",
          ),
        }),
        { count: 1 },
      ),
    );
    t.assert(
      completed.eventsSatisfy(
          "Codex command_execution preserves its item id across start and result",
          (events) =>
            events.some(
              (event) =>
                event.type === "operation.started" &&
                event.operationId === "codex-command-call",
            ) &&
            events.some(
              (event) =>
                event.type === "operation.finished" &&
                event.operationId === "codex-command-call" &&
                event.status === "completed",
            ),
        ),
    );
    t.assert(
      t.check(
        { sessionId: t.sessionId, usage: completed.usage },
        satisfies(
          "Codex completed thread and usage",
          ({ sessionId, usage }) =>
            sessionId === "codex-sdk-completed-thread" &&
            usage?.inputTokens === 13 &&
            usage.cacheReadTokens === 8 &&
            usage.outputTokens === 13 &&
            usage.reasoningTokens === 5,
        ),
      ),
    );

    const terminalSession = t.newSession();
    const terminal = await terminalSession.send("codex terminal fixture");
    t.assert(t.check(terminal.status, equals("failed")));
    t.assert(
      terminal.eventsSatisfy(
        "error event count",
          (events) =>
            events.filter((event) => event.type === "error").length === 1,
      ),
    );
    t.assert(
      terminal.eventsSatisfy(
          "terminal ThreadEvent failure message remains observable",
          (events) =>
            events.some(
              (event) =>
                event.type === "error" &&
                event.message === "codex-sdk-terminal-failure-marker",
            ),
        ),
    );
    t.assert(
      terminal.event(
        eventMatch("operation.finished", {
          tool: toolMatch("shell", {
            input: satisfies(
              "Codex terminal command input",
              (input) =>
                typeof input === "object" &&
                input !== null &&
                !Array.isArray(input) &&
                input["command"] === "printf codex-sdk-terminal-marker",
            ),
            status: "completed",
          }),
          output: satisfies("Codex terminal command output", (output) =>
            typeof output === "object" &&
            output !== null &&
            !Array.isArray(output) &&
            output.output === "codex-sdk-terminal-output-marker" &&
            output.exit_code === 0,
          ),
        }),
        { count: 1 },
      ),
    );
    t.assert(
      t.check(
        { sessionId: terminalSession.sessionId, usage: terminal.usage },
        satisfies(
          "Codex failed thread and usage",
          ({ sessionId, usage }) =>
            sessionId === "codex-sdk-failed-thread" &&
            usage?.inputTokens === 7 &&
            usage.cacheReadTokens === 2 &&
            usage.outputTokens === 4,
        ),
      ),
    );
  },
});
