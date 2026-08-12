// owner: docs/engineering/testing/e2e/adapter/sdk-converters.md#codex-thread-stream-deterministic
import { defineEval } from "niceeval";
import {
  equals,
  includes,
  jsonMatch,
  satisfies,
  toolMatch,
} from "niceeval/expect";
export default defineEval({
  description:
    "Codex ThreadEvent raw frames 经 converter 保留 command/file canonical、call ID、usage/thread 与 terminal failure",
  async test(t) {
    const completed = await t.send("codex completed fixture");
    await completed.succeeded().orStop();
    t.check(completed.message, includes("codex-sdk-message-marker"));
    completed.calledTool(
      toolMatch("shell", {
        input: jsonMatch({ command: "printf codex-sdk-command-marker" }),
        status: "completed",
      }),
      { count: 1 },
    );
    completed.calledTool(
      toolMatch("file_edit", {
        input: jsonMatch({ path: "src/fixture.ts", kind: "update" }),
        status: "completed",
      }),
      { count: 1 },
    );
    t.check(
      completed.events,
      satisfies<typeof completed.events>(
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
              event.status === "completed" &&
              typeof event.output === "object" &&
              event.output !== null &&
              !Array.isArray(event.output) &&
              event.output.output === "codex-sdk-command-result-marker" &&
              event.output.exit_code === 0,
          ) &&
          events.some(
            (event) =>
              event.type === "operation.finished" &&
              event.operationId === "codex-file-change-call#0" &&
              typeof event.output === "object" &&
              event.output !== null &&
              !Array.isArray(event.output) &&
              event.output.path === "src/fixture.ts" &&
              event.output.kind === "update",
          ),
      ),
    );
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
    );
    const terminalSession = t.newSession();
    const terminal = await terminalSession.send("codex terminal fixture");
    t.check(terminal.status, equals("failed"));
    t.check(
      terminal.events,
      satisfies<typeof terminal.events>(
        "error event count",
        (events) =>
          events.filter((event) => event.type === "error").length === 1,
      ),
    );
    t.check(
      terminal.events,
      satisfies<typeof terminal.events>(
        "terminal ThreadEvent failure message remains observable",
        (events) =>
          events.some(
            (event) =>
              event.type === "error" &&
              event.message === "codex-sdk-terminal-failure-marker",
          ),
      ),
    );
    terminal.calledTool(
      toolMatch("shell", {
        input: jsonMatch({ command: "printf codex-sdk-terminal-marker" }),
        status: "completed",
      }),
      { count: 1 },
    );
    t.check(
      terminal.events,
      satisfies<typeof terminal.events>(
        "Codex terminal command output",
        (events) =>
          events.some(
            (event) =>
              event.type === "operation.finished" &&
              event.operationId === "codex-failed-command-call" &&
              typeof event.output === "object" &&
              event.output !== null &&
              !Array.isArray(event.output) &&
              event.output.output === "codex-sdk-terminal-output-marker" &&
              event.output.exit_code === 0,
          ),
      ),
    );
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
    );
  },
});
