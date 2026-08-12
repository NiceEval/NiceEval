// The one application runtime boundary. Library and command modules return
// Effect values; this file is the only place NiceEval starts a runtime.

import { Cause, Effect, Exit } from "effect";
import { cliProgram, renderCliFailure } from "../cli.ts";

// A SIGINT must request cancellation through the Invocation's AbortSignal,
// rather than interrupting this root fiber directly. A root interruption stays
// pending in Effect v3: it correctly stops dispatch and runs finalizers, but
// immediately interrupts the subsequent Record publish / feedback receipt
// continuation as soon as it becomes interruptible again. `runEvals` races
// this signal into dispatch, consumes only the interrupted Cause, then performs
// its short durable closure before the CLI emits the receipt.
const interruption = new AbortController();
let receivedSignal = false;
const onInterrupt = (): void => {
  if (receivedSignal) return;
  receivedSignal = true;
  process.removeListener("SIGINT", onInterrupt);
  process.removeListener("SIGTERM", onInterrupt);
  interruption.abort();
};
process.on("SIGINT", onInterrupt);
process.on("SIGTERM", onInterrupt);

const application = Effect.scoped(cliProgram(interruption.signal)).pipe(
  // Typed CLI failures are expected, user-actionable outcomes. They become an
  // ordinary process status after their message has been written once.
  Effect.catchAll((failure) => Effect.sync(() => {
    process.stderr.write(renderCliFailure(failure));
    return failure.exitCode;
  })),
  // A normal nonzero command result must flush through Node naturally; do not
  // use process.exit and skip Scope finalizers or piped stdout.
  Effect.tap((exitCode) => Effect.sync(() => {
    process.exitCode = exitCode;
  })),
  Effect.asVoid,
  // Defects remain defects and interruption remains interruption. Suppress
  // platform's generic logger so the CLI keeps its existing user-facing form.
  Effect.tapErrorCause((cause) => Cause.isInterruptedOnly(cause)
    ? Effect.void
    : Effect.sync(() => process.stderr.write(`niceeval error:\n${Cause.pretty(cause)}\n`))),
);

// Match NodeRuntime.runMain's liveness contract: an Effect.async boundary may
// be awaiting a callback that owns no Node event-loop handle of its own.
const keepAlive = setInterval(() => {}, 2 ** 31 - 1);
const fiber = Effect.runFork(application);
fiber.addObserver((exit) => {
  clearInterval(keepAlive);
  process.removeListener("SIGINT", onInterrupt);
  process.removeListener("SIGTERM", onInterrupt);
  if (Exit.isFailure(exit)) {
    // Scope finalizers have settled before an observer sees the Exit. Typed
    // CLI failures already became a successful numeric result above; only a
    // real unhandled interruption receives 130, and defects remain exit 2.
    process.exitCode = Cause.isInterruptedOnly(exit.cause) ? 130 : 2;
  }
});
