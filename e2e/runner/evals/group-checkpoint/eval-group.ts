import { writeFile } from "node:fs/promises";
import { defineEvalGroup } from "niceeval";
import { sandboxLayer } from "niceeval/sandbox";
import first from "./first.eval.ts";
import timedOut from "./timeout.eval.ts";

export default defineEvalGroup({
  evals: [first, timedOut],
  onUnavailable: "stop-group",
  sandbox: sandboxLayer().after(async (sandbox, context) => {
    const saved = await sandbox.runShellOrThrow("sleep 0.1; cat /tmp/group-checkpoint-state", {
      signal: context.signal,
    });
    await writeFile("group-checkpoint-saved.txt", saved.stdout);
    // after runs for each Attempt. Only retire the instance with the explicit
    // command-timeout probe after the final member has saved its checkpoint.
    if (saved.stdout !== "second") return;
    const limited = await sandbox
      .runShell("sleep 10; printf timeout-was-ignored", {
        signal: context.signal,
        timeoutMs: 100,
      })
      .then(
        () => "unexpected-success",
        (cause: unknown) => (cause instanceof Error ? cause.message : String(cause)),
      );
    await writeFile("group-checkpoint-explicit-timeout.txt", limited);
  }),
});
