import { Effect, FiberSet, Layer } from "effect";
import type * as Scope from "effect/Scope";
import { cliProgram } from "./program.ts";
import { composeCliCommands } from "./contribution.ts";
import type { AnyCliFeatureError } from "./feature-failure.ts";
import { dockerCliCommand } from "../docker/cli/contribution.ts";
import { sandboxCliCommand } from "../sandbox/cli/contribution.ts";
import { evalCatalogCliCommand } from "../eval/cli/contribution.ts";
import { experimentCliContributions } from "../experiment/host/cli/contribution.ts";
import { ExperimentCliTerminal } from "../experiment/host/cli/terminal.ts";
import { showCliCommand, compareCliCommand } from "../show/contribution.ts";
import { viewCliCommand } from "../view/cli/contribution.ts";
import { runCliCommand } from "../run/cli/contribution.ts";
import { projectInitCliCommand } from "../project/cli/contribution.ts";
import { CliArguments, CliInterruption, CliInvocationFacts, CliOutput, CliPath } from "./application.ts";
import type { NodeCliPlatformLive } from "./node-application.ts";
import {
  ConfigModuleLoaderLive,
  ProjectConfiguration,
  ProjectConfigurationLayer,
  ProjectCredentials,
} from "./project-configuration.ts";
import { NodeRecordLive } from "../record/index.ts";
import { RecordCoordination } from "../coordination/record-leases.ts";
import { RecordEntropy, RecordFileSystem } from "../record/platform/services.ts";
import { ProjectStateDatabase } from "../record/sqlite/project-state-database.ts";
import { DockerCacheAdministration } from "../docker/cache-administration.ts";
import { DockerCacheAdministrationLive } from "../docker/cache-live.ts";
import type { NodeProjectLive } from "../project/node.ts";
import { ProjectFileSystem, ProjectManifestFacts, ProjectProcessFacts } from "../project/services.ts";
import { NodeViewBrowserLive, ViewBrowser } from "../view/browser.ts";
import { ViewApplicationRuntime } from "../view/application-runtime.ts";

type CliFeatureRequirements =
  | DockerCacheAdministration
  | CliArguments
  | CliInterruption
  | CliInvocationFacts
  | CliOutput
  | import("./application.ts").CliConfirmation
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
  | ViewApplicationRuntime
  | Scope.Scope;

const featureCommands = composeCliCommands<CliFeatureRequirements, AnyCliFeatureError>([
  ...experimentCliContributions,
  evalCatalogCliCommand,
  compareCliCommand,
  showCliCommand,
  runCliCommand,
  viewCliCommand,
  sandboxCliCommand,
  dockerCliCommand,
  projectInitCliCommand,
]);

interface CliPlatform {
  readonly project: typeof NodeProjectLive;
  readonly invocation: typeof NodeCliPlatformLive;
  readonly terminal: Layer.Layer<ExperimentCliTerminal>;
  readonly interruption: Layer.Layer<CliInterruption>;
  readonly credentials: Layer.Layer<ProjectCredentials>;
}

export const cliApplication = (platform: CliPlatform) =>
  Effect.scoped(
    Effect.gen(function* () {
      // Capture this application's services once. HTTP callbacks share its runtime;
      // the root Scope interrupts and drains every remaining callback fiber.
      const run = yield* FiberSet.makeRuntimePromise();
      return yield* cliProgram(featureCommands).pipe(Effect.provideService(ViewApplicationRuntime, { run }));
    }),
  ).pipe(
    // Application bootstrap is the sole provider of concrete Node services.
    // Command and library modules retain their real requirements for callers.
    Effect.provide(NodeRecordLive),
    // This is a lazy service value: ordinary commands and help do not probe Docker.
    Effect.provide(DockerCacheAdministrationLive),
    Effect.provide(platform.project),
    Effect.provide(NodeViewBrowserLive),
    Effect.provide(platform.terminal),
    Effect.provide(platform.interruption),
    Effect.provide(
      ProjectConfigurationLayer.pipe(Layer.provide(platform.credentials), Layer.provide(ConfigModuleLoaderLive)),
    ),
    Effect.provide(platform.invocation),
  );
