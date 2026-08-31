// The one application runtime boundary. Library and command modules return
// Effect values; this file is the only place NiceEval starts a runtime.

import { Cause, Effect, Exit, Layer } from "effect";
import type * as Scope from "effect/Scope";
import { cliProgram, renderCliFailure } from "./program.ts";
import { composeCliCommands, type CliFeatureError } from "./contribution.ts";
import { dockerCliCommand } from "../docker/cli/contribution.ts";
import { sandboxCliCommand } from "../sandbox/cli/contribution.ts";
import { evalCatalogCliCommand } from "../eval/cli/contribution.ts";
import { experimentCliContributions } from "../experiment/host/cli/contribution.ts";
import {
  ExperimentCliTerminal,
  NodeExperimentCliTerminalLive,
} from "../experiment/host/cli/terminal.ts";
import { inspectionQueryCliCommand } from "../inspection/cli/contribution.ts";
import { showCliCommand } from "../show/contribution.ts";
import { viewCliCommand } from "../view/cli/contribution.ts";
import { runCliCommand } from "../run/cli/contribution.ts";
import { stateCliCommand } from "../state/cli/contribution.ts";
import { projectInitCliCommand } from "../project/cli/contribution.ts";
import {
  CliArguments,
  CliInterruption,
  CliInvocationFacts,
  CliOutput,
  CliPath,
  type CliInterruptionService,
} from "./application.ts";
import { NodeCliPlatformLive } from "./node-application.ts";
import { ConfigModuleLoaderLive, ProjectConfiguration, ProjectConfigurationLayer, ProjectCredentialsLive } from "./project-configuration.ts";
import { NodeRecordLive } from "../record/index.ts";
import { RecordCoordination } from "../coordination/record-leases.ts";
import { RecordEntropy, RecordFileSystem } from "../record/platform/services.ts";
import { ProjectStateDatabase } from "../record/sqlite/project-state-database.ts";
import { DockerCacheAdministration } from "../docker/cache-administration.ts";
import { DockerCacheAdministrationLive } from "../docker/cache-live.ts";
import { NodeProjectLive } from "../project/node.ts";
import { ProjectFileSystem, ProjectManifestFacts, ProjectProcessFacts } from "../project/services.ts";
import { NodeViewBrowserLive, ViewBrowser } from "../view/browser.ts";

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

const NodeCliInterruptionLive = Layer.succeed(CliInterruption, interruption);

// This is the only Node composition edge. The application layer itself keeps
// its two capability requirements visible and portable.
const NodeCliApplicationLive = ProjectConfigurationLayer.pipe(
  Layer.provide(ProjectCredentialsLive),
  Layer.provide(ConfigModuleLoaderLive),
);

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

type CliFeatureRequirements =
  | DockerCacheAdministration
  | CliArguments
  | CliInterruption
  | CliInvocationFacts
  | CliOutput
  | CliPath
  | ExperimentCliTerminal
  | ProjectConfiguration
  | RecordCoordination
  | RecordEntropy
  | RecordFileSystem
  | ProjectStateDatabase
  | ProjectFileSystem
  | ProjectManifestFacts
  | ProjectProcessFacts
  | ViewBrowser
  | Scope.Scope;

const featureCommands = composeCliCommands<CliFeatureRequirements, CliFeatureError>(
  [
    ...experimentCliContributions,
    evalCatalogCliCommand,
    inspectionQueryCliCommand,
    showCliCommand,
    runCliCommand,
    viewCliCommand,
    sandboxCliCommand,
    dockerCliCommand,
    stateCliCommand,
    projectInitCliCommand,
  ],
);

const application = Effect.scoped(cliProgram(featureCommands)).pipe(
  // Application bootstrap is the sole provider of concrete Node services.
  // Command and library modules retain their real requirements for callers.
  Effect.provide(NodeRecordLive),
  // This is a lazy service value: ordinary commands and help do not probe Docker.
  Effect.provide(DockerCacheAdministrationLive),
  Effect.provide(NodeProjectLive),
  Effect.provide(NodeViewBrowserLive),
  Effect.provide(NodeExperimentCliTerminalLive),
  Effect.provide(NodeCliInterruptionLive),
  Effect.provide(NodeCliApplicationLive),
  Effect.provide(NodeCliPlatformLive),
  // Typed CLI failures are expected, user-actionable outcomes. They become an
  // ordinary process status after their message has been written once.
  Effect.catch((failure) => Effect.sync(() => {
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
  Effect.tapCause((cause) => Cause.hasInterruptsOnly(cause)
    ? Effect.void
    : Effect.sync(() => process.stderr.write(`niceeval error:\n${Cause.pretty(cause)}\n`))),
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
    // real unhandled interruption receives 130, and defects remain exit 2.
    process.exitCode = Cause.hasInterruptsOnly(exit.cause) ? 130 : 2;
  }
});
