import { defineEval } from "niceeval";
import { isDefined, satisfies, includes, toolMatch } from "niceeval/expect";

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
    await t.require(first.succeeded());
    t.assert(t.check(first.message, includes(marker)));

    // The public converter supplies the canonical shell identity and the paired
    // completed result from the unmodified command_execution ThreadItem.
    t.assert(
      first.calledTool(
        toolMatch("shell", {
          input: satisfies(
            '"shell" input',
            (input) =>
              typeof input === "object" &&
              input !== null &&
              !Array.isArray(input) &&
              (typeof input["command"] === "string"
                ? new RegExp(marker).test(input["command"])
                : new RegExp(marker).test(JSON.stringify(input) ?? "")),
          ),
          status: "completed",
        }),
      ),
    );
    t.assert(first.noFailedActions());
    t.assert(
      t.check(
        first.usage?.inputTokens,
        satisfies(
          "input token usage is positive",
          (value) => typeof value === "number" && value > 0,
        ),
      ),
    );
    t.assert(
      t.check(
        first.usage?.outputTokens,
        satisfies(
          "output token usage is positive",
          (value) => typeof value === "number" && value > 0,
        ),
      ),
    );
    t.assert(
      t.check(
        t.sessionId,
        isDefined("thread.started must be captured as the session id"),
      ),
    );

    const resumed = await t.send(
      "Without running a command, tell me the private sentinel from my preceding message exactly.",
    );
    await t.require(resumed.succeeded());
    t.assert(t.check(resumed.message, includes(sentinel)));
    t.assert(t.succeeded());
  },
});
