// owner: docs/engineering/testing/e2e/adapter/sdk-converters.md#codex-thread-stream-deterministic

import { defineEval } from "niceeval";
import { equals } from "niceeval/expect";

export default defineEval({
  description: "Codex ThreadEvent raw frames 经 converter 保留 command/file canonical、call ID、usage/thread 与 terminal failure",
  async test(t) {
    const completed = await t.send("codex completed fixture");
    await completed.succeeded().stopOnFailure();
    completed.messageIncludes("codex-sdk-message-marker");
    completed.calledTool("shell", {
      status: "completed",
      input: { command: "printf codex-sdk-command-marker" },
      output: { output: "codex-sdk-command-result-marker", exit_code: 0 },
      count: 1,
    });
    completed.calledTool("file_edit", {
      status: "completed",
      input: { path: "src/fixture.ts", kind: "update" },
      output: { path: "src/fixture.ts", kind: "update" },
      count: 1,
    });
    completed.eventsSatisfy(
      "Codex command_execution preserves its item id across start and result",
      (events) =>
        events.some((event) => event.type === "operation.started" && event.operationId === "codex-command-call") &&
        events.some(
          (event) =>
            event.type === "operation.finished" &&
            event.operationId === "codex-command-call" &&
            event.status === "completed",
        ),
    );
    t.check(t.sessionId, equals("codex-sdk-completed-thread"));
    t.check(completed.usage?.inputTokens, equals(13));
    t.check(completed.usage?.cacheReadTokens, equals(8));
    t.check(completed.usage?.outputTokens, equals(13));
    t.check(completed.usage?.reasoningTokens, equals(5));

    const terminalSession = t.newSession();
    const terminal = await terminalSession.send("codex terminal fixture");
    t.check(terminal.status, equals("failed"));
    terminal.event("error", { count: 1 });
    terminal.eventsSatisfy(
      "terminal ThreadEvent failure message remains observable",
      (events) => events.some((event) => event.type === "error" && event.message === "codex-sdk-terminal-failure-marker"),
    );
    terminal.calledTool("shell", {
      status: "completed",
      input: { command: "printf codex-sdk-terminal-marker" },
      output: { output: "codex-sdk-terminal-output-marker", exit_code: 0 },
      count: 1,
    });
    t.check(terminalSession.sessionId, equals("codex-sdk-failed-thread"));
    t.check(terminal.usage?.inputTokens, equals(7));
    t.check(terminal.usage?.cacheReadTokens, equals(2));
    t.check(terminal.usage?.outputTokens, equals(4));
  },
});
