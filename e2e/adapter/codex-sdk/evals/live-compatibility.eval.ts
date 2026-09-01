import { defineEval } from "niceeval";
import { includes, isDefined, jsonMatch, satisfies, toolMatch } from "niceeval/expect";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(
      `${name} must be injected by the native Codex SDK E2E test`,
    );
  }
  return value;
}

export default defineEval({
  description:
    "Codex SDK raw ThreadEvent 经公共 converter 保留 shell 配对、usage 与 thread resume",
  async test(t) {
    const marker = requiredEnv("CODEX_SDK_E2E_MARKER");
    const sentinel = requiredEnv("CODEX_SDK_E2E_SENTINEL");

    const first = await t.send(
      `In the current working directory, run exactly this safe command once: ` +
        "`printf '%s\\n' " +
        marker +
        "`. " +
        `Then report its output and remember this private sentinel for the next turn: ${sentinel}. ` +
        "Do not use network access, edit files, or run any other command.",
    );
    await first.succeeded().orStop();
    t.check(first.message, includes(marker));

    // The public converter supplies the canonical shell identity and the paired
    // completed result from the unmodified command_execution ThreadItem. The
    // marker regex keeps the containment check without depending on quoting.
    first.calledTool(
      toolMatch("shell", {
        input: jsonMatch({ command: new RegExp(marker) }),
        status: "completed",
      }),
    );
    t.check(
      first.events,
      satisfies<typeof first.events>(
        "no failed tool or subagent actions",
        (events) =>
          events.every(
            (event) =>
              event.type !== "operation.finished" ||
              event.status !== "failed",
          ),
      ),
    );
    t.check(
      first.usage?.inputTokens,
      satisfies(
        "input token usage is positive",
        (value) => typeof value === "number" && value > 0,
      ),
    );
    t.check(
      first.usage?.outputTokens,
      satisfies(
        "output token usage is positive",
        (value) => typeof value === "number" && value > 0,
      ),
    );
    t.check(
      t.sessionId,
      isDefined<string | undefined>(
        "thread.started must be captured as the session id",
      ),
    );

    const resumed = await t.send(
      `Continue this same thread without running a command. Acknowledge this resume probe: ${sentinel}.`,
    );
    await resumed.succeeded().orStop();
    t.succeeded().label("attempt completed");
  },
});
