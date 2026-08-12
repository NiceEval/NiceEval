// The one application runtime boundary. Library and command modules return
// Effect values; this file is the only place NiceEval starts a runtime.

import { Cause, Effect, Exit } from "effect";
import { cliProgram, renderCliFailure, type CliInterruptionOwnership } from "../cli.ts";

// There is exactly one synchronous ownership state for the first signal. Node
// invokes both signal handlers and Effect continuations serially, so the CLI's
// hand-off cannot race a SIGINT into an unowned interval:
//
// root -> root-interrupted              (interrupt the application fiber)
// root -> graceful-dispatch             (CLI is about to call runEvals)
// graceful-dispatch -> graceful-aborted (abort only the Invocation signal)
//
// Graceful ownership is deliberately one-way. Returning it after `runEvals`
// would create a second boundary where a first signal could miss both the
// durable closure and root interruption.
type SignalOwnership =
  | "root"
  | "root-interrupted"
  | "graceful-dispatch"
  | "graceful-aborted";

let signalOwnership: SignalOwnership = "root";
const invocationInterruption = new AbortController();
let fiber: ReturnType<typeof Effect.runFork> | undefined;

const interruption: CliInterruptionOwnership = {
  invocationSignal: invocationInterruption.signal,
  enterGracefulDispatch: () => {
    if (signalOwnership === "root") {
      signalOwnership = "graceful-dispatch";
      return true;
    }
    // A root-owned first signal has already scheduled root interruption. Let
    // the CLI preserve that Cause rather than start an Invocation underneath it.
    return signalOwnership !== "root-interrupted";
  },
};

const onInterrupt = (signal: NodeJS.Signals): void => {
  if (signalOwnership === "root") {
    signalOwnership = "root-interrupted";
    fiber?.unsafeInterruptAsFork(fiber.id());
    return;
  }
  if (signalOwnership === "graceful-dispatch") {
    signalOwnership = "graceful-aborted";
    invocationInterruption.abort();
    return;
  }
  // Keep this listener through the first-signal drain: libuv may already have
  // captured a second signal before the first handler runs. On escalation,
  // remove it and re-raise that exact OS signal so default forced termination
  // cannot become a queued no-op.
  process.removeListener("SIGINT", onInterrupt);
  process.removeListener("SIGTERM", onInterrupt);
  process.kill(process.pid, signal);
};
process.on("SIGINT", onInterrupt);
process.on("SIGTERM", onInterrupt);

const application = Effect.scoped(cliProgram(interruption)).pipe(
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
fiber = Effect.runFork(application);
// A signal cannot normally interleave with this synchronous bootstrap, but
// retaining the state makes that startup edge explicit and lossless as well.
const interruptRootIfPending = (): void => {
  if (signalOwnership !== "root-interrupted" || fiber === undefined) return;
  fiber.unsafeInterruptAsFork(fiber.id());
};
interruptRootIfPending();
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
