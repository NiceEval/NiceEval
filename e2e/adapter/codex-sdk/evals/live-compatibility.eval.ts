import { defineEval } from "niceeval";
import { isDefined, satisfies } from "niceeval/expect";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} must be injected by the native Codex SDK E2E test`);
  }
  return value;
}

export default defineEval({
  description: "Codex SDK raw ThreadEvent 经公共 converter 保留 shell 配对、usage 与 thread resume",
  async test(t) {
    const marker = requiredEnv("CODEX_SDK_E2E_MARKER");
    const sentinel = requiredEnv("CODEX_SDK_E2E_SENTINEL");

    const first = await t.send(
      `In the current working directory, run exactly this safe command once: ` +
        "`printf '%s\\n' " + marker + "`. " +
        `Then report its output and remember this private sentinel for the next turn: ${sentinel}. ` +
        "Do not use network access, edit files, or run any other command.",
    );
    await first.succeeded().stopOnFailure();
    first.messageIncludes(marker);

    // The public converter supplies the canonical shell identity and the paired
    // completed result from the unmodified command_execution ThreadItem.
    first.calledTool("shell", {
      status: "completed",
      input: { command: new RegExp(marker) },
    });
    first.noFailedActions();
    t.check(
      first.usage?.inputTokens,
      satisfies((value) => typeof value === "number" && value > 0, "input token usage is positive"),
    );
    t.check(
      first.usage?.outputTokens,
      satisfies((value) => typeof value === "number" && value > 0, "output token usage is positive"),
    );
    t.check(t.sessionId, isDefined("thread.started must be captured as the session id"));

    const resumed = await t.send(
      "Without running a command, tell me the private sentinel from my preceding message exactly.",
    );
    await resumed.succeeded().stopOnFailure();
    resumed.messageIncludes(sentinel);
    t.succeeded();
  },
});
