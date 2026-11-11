// @concord-file
// @concord-implements docs/feature/sandbox/use-case/sandbox-pause-on-failure-debug.md
import { Effect, Semaphore } from "effect";
import { reportPausePrompt } from "./feedback/sink.ts";

// stdin belongs to the process. Concurrent Attempts must not consume the same Enter.
const terminal = Semaphore.makeUnsafe(1);

export const pauseOnFailure = Effect.fn("pauseOnFailure")(function* (
  nativeCommand: string | undefined,
  invocationSignal: AbortSignal | undefined,
  options: { readonly nonInteractive?: boolean } = {},
) {
  if (process.stdin.isTTY !== true || options.nonInteractive === true) {
    try {
      reportPausePrompt([
        "Sandbox retained for debugging. Continuing without waiting for input.",
        ...(nativeCommand === undefined ? [] : [`  ➜ Debug natively: ${nativeCommand}`]),
      ].join("\n"));
    } catch {
      // A closed output stream must not prevent cleanup.
    }
    return;
  }
  yield* terminal.withPermit(Effect.callback<void>((resume) => {
    const input = process.stdin;
    if (invocationSignal?.aborted || input.destroyed || input.readableEnded) {
      resume(Effect.void);
      return;
    }
    const wasFlowing = input.readableFlowing === true;
    const cleanup = () => {
      input.off("data", onData);
      input.off("end", finish);
      input.off("close", finish);
      input.off("error", finish);
      invocationSignal?.removeEventListener("abort", finish);
      if (!wasFlowing) {
        input.pause();
        // A piped stdin can retain a referenced handle even after pause().
        input.unref?.();
      }
    };
    const finish = () => {
      cleanup();
      resume(Effect.void);
    };
    const onData = (chunk: Buffer | string) => {
      if (/[\r\n]/u.test(chunk.toString())) finish();
    };
    input.on("data", onData);
    input.once("end", finish);
    input.once("close", finish);
    input.once("error", finish);
    invocationSignal?.addEventListener("abort", finish, { once: true });
    if (!wasFlowing) input.ref?.();
    try {
      reportPausePrompt([
        "⏸ Attempt paused on failure. Sandbox retained for debugging.",
        ...(nativeCommand === undefined ? [] : [`  ➜ Debug natively: ${nativeCommand}`]),
        "Press [Enter] to resume cleanup and exit...",
      ].join("\n"));
      input.resume();
    } catch {
      // A closed output stream cannot leave managed resources waiting for input.
      finish();
    }
    return Effect.sync(cleanup);
  }));
});
