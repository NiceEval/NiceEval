// The one application runtime boundary. Library and command modules return
// Effect values; this file is the only place NiceEval starts NodeRuntime.

import { Cause, Effect, Exit } from "effect";
import { NodeRuntime } from "@effect/platform-node";
import { cliProgram, renderCliFailure } from "../cli.ts";

const application = Effect.scoped(cliProgram).pipe(
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

NodeRuntime.runMain(application, {
  disableErrorReporting: true,
  teardown: (exit, onExit) => {
    if (Exit.isFailure(exit)) {
      // NodeRuntime invokes this only after Effect scopes have finalized.
      onExit(Cause.isInterruptedOnly(exit.cause) ? 130 : 2);
      return;
    }
    onExit(0);
  },
});
