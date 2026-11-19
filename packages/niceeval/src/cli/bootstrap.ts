// The one application runtime boundary. Library and command modules return
// Effect values; this file is the only place NiceEval starts a runtime.

import { Cause, Effect, Exit, Layer } from "effect";
import { CliInterruption, type CliInterruptionService } from "./application.ts";
import { ignoreBrokenOutputPipe, NodeCliPlatformLive } from "./node-application.ts";
import { cliApplication } from "./node-program.ts";
import { renderCliFailure } from "./program.ts";
import { ProjectCredentialsLive } from "./project-configuration.ts";
import { NodeProjectLive } from "../project/node.ts";
import { NodeExperimentCliTerminalLive } from "../experiment/host/cli/terminal.ts";
import { summarizeUnknownError } from "../error-assistance/index.ts";

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
type SignalOwnership = "root" | "root-interrupted" | "graceful-dispatch" | "graceful-aborted";

let signalOwnership: SignalOwnership = "root";
let interruptedByClosedOutput = false;
const invocationInterruption = new AbortController();
let fiber: ReturnType<typeof Effect.runFork> | undefined;

const interruption: CliInterruptionService = {
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
  requestInterrupt: () => process.emit("SIGINT"),
};

const onInterrupt = (signal: NodeJS.Signals): void => {
  if (signalOwnership === "root") {
    signalOwnership = "root-interrupted";
    fiber?.interruptUnsafe();
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

// A pipe consumer may exit before an asynchronous stdout/stderr write completes.
// Keep this process-owned listener after the application fiber finishes so
// Node can flush pending writes without an unhandled EPIPE. While work is
// active, use its existing interruption owner so Scope finalizers still drain.
const onOutputError = (error: unknown): void => {
  ignoreBrokenOutputPipe(error);
  interruptedByClosedOutput = true;
  process.exitCode = 0;
  if (signalOwnership === "root") {
    signalOwnership = "root-interrupted";
    fiber?.interruptUnsafe();
  } else if (signalOwnership === "graceful-dispatch") {
    signalOwnership = "graceful-aborted";
    invocationInterruption.abort();
  }
};
process.stdout.on("error", onOutputError);
process.stderr.on("error", onOutputError);

const application = cliApplication({
  project: NodeProjectLive,
  invocation: NodeCliPlatformLive,
  terminal: NodeExperimentCliTerminalLive,
  interruption: Layer.succeed(CliInterruption, interruption),
  credentials: ProjectCredentialsLive,
}).pipe(
  // Typed CLI failures are expected, user-actionable outcomes. They become an
  // ordinary process status after their message has been written once.
  Effect.catch((failure) =>
    Effect.sync(() => {
      process.stderr.write(renderCliFailure(failure));
      return failure.exitCode;
    }),
  ),
  // A normal nonzero command result must flush through Node naturally; do not
  // use process.exit and skip Scope finalizers or piped stdout.
  Effect.tap((exitCode) =>
    Effect.sync(() => {
      process.exitCode = interruptedByClosedOutput ? 0 : exitCode;
    }),
  ),
  Effect.asVoid,
  // Defects remain defects and interruption remains interruption. Suppress
  // platform's generic logger so the CLI keeps its existing user-facing form.
  Effect.tapCause((cause) =>
    Cause.hasInterruptsOnly(cause)
      ? Effect.void
      : Effect.sync(() => {
          const command = /^[a-z][a-z0-9-]*$/u.test(process.argv[2] ?? "") ? process.argv[2] : "(startup)";
          process.stderr.write(
            `niceeval error: Internal defect during niceeval ${command} command execution.\n` +
              `Cause: ${summarizeUnknownError(Cause.squash(cause))}\n` +
              "Next: report this failure with the command, NiceEval version, and this diagnostic; preserve the project Record for investigation.\n",
          );
        }),
  ),
);

// Effect v4 keeps Node alive while live fibers await callbacks, so this
// boundary does not install a second process-liveness timer.
fiber = Effect.runFork(application);
// A signal cannot normally interleave with this synchronous bootstrap, but
// retaining the state makes that startup edge explicit and lossless as well.
const interruptRootIfPending = (): void => {
  if (signalOwnership !== "root-interrupted" || fiber === undefined) return;
  fiber.interruptUnsafe();
};
interruptRootIfPending();
fiber.addObserver((exit) => {
  process.removeListener("SIGINT", onInterrupt);
  process.removeListener("SIGTERM", onInterrupt);
  if (Exit.isFailure(exit)) {
    // Scope finalizers have settled before an observer sees the Exit. Typed
    // CLI failures already became a successful numeric result above; only a
    // signal interruption receives 130; a closed output consumer is normal
    // termination, and defects remain exit 2.
    process.exitCode = Cause.hasInterruptsOnly(exit.cause) ? (interruptedByClosedOutput ? 0 : 130) : 2;
  }
});
