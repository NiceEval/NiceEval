/**
 * Platform-neutral CLI application contract. Command parsing, selection and
 * presentation consume these capabilities; Node wiring lives only in the
 * bootstrap adapter.
 */
import { Context, Data, Effect } from "effect";
import type { Config } from "../runner/types.ts";
import type { FeedbackIO } from "../runner/feedback/io.ts";
import type { InputGuardStdin } from "../runner/feedback/input-guard.ts";
import type { ReportDefinition } from "../report/definition/report.ts";
import type { ThemeDefinition } from "../report/theme.ts";
import type { ConfigModuleLoadError, ProjectCredentialsFailure } from "./project-configuration.ts";

export interface CliInvocation {
  readonly cwd: string;
  readonly argv: readonly string[];
  readonly hostname: string;
  readonly noColor?: string;
  readonly platform: "darwin" | "win32" | "linux" | string;
  readonly stdout: { readonly isTTY: boolean; readonly columns?: number };
  readonly stderr: { readonly isTTY: boolean; readonly columns?: number };
}

export type CliOptionDefinition = Readonly<{ type: "string" | "boolean"; multiple?: true; short?: string }>;
export interface CliParsedTokens {
  readonly values: Record<string, string | boolean | string[] | undefined>;
  readonly positionals: string[];
  readonly tokens: readonly { readonly kind: string; readonly name?: string }[];
}
export interface CliArgumentsService {
  readonly parse: (argv: readonly string[], options: Readonly<Record<string, CliOptionDefinition>>) => CliParsedTokens;
}
export class CliArguments extends Context.Tag("niceeval/cli/CliArguments")<CliArguments, CliArgumentsService>() {}

export class CliInvocationError extends Data.TaggedError("CliInvocationError")<{
  readonly operation: string;
  readonly cause: unknown;
}> {}

export interface CliInvocationService {
  readonly facts: Effect.Effect<CliInvocation, CliInvocationError>;
}

export class CliInvocationFacts extends Context.Tag("niceeval/cli/CliInvocationFacts")<
  CliInvocationFacts,
  CliInvocationService
>() {}

export interface CliOutputService {
  readonly writeStdout: (text: string) => Effect.Effect<void, CliInvocationError>;
  readonly writeStderr: (text: string) => Effect.Effect<void, CliInvocationError>;
  /** Callback bridge for Host observer contracts that cannot return Effect. */
  readonly writeStdoutSync: (text: string) => void;
  readonly writeStderrSync: (text: string) => void;
}
export class CliOutput extends Context.Tag("niceeval/cli/CliOutput")<CliOutput, CliOutputService>() {}

export interface ProjectInitializerService {
  readonly initialize: (cwd: string) => Effect.Effect<{ readonly prefersEsm: boolean }, CliInvocationError>;
}
export class ProjectInitializer extends Context.Tag("niceeval/cli/ProjectInitializer")<
  ProjectInitializer,
  ProjectInitializerService
>() {}

export interface PackageMetadataService {
  readonly version: Effect.Effect<string, CliInvocationError>;
}
export class PackageMetadata extends Context.Tag("niceeval/cli/PackageMetadata")<
  PackageMetadata,
  PackageMetadataService
>() {}

export interface BrowserLauncherService {
  readonly open: (url: string) => Effect.Effect<boolean, CliInvocationError>;
}
export class BrowserLauncher extends Context.Tag("niceeval/cli/BrowserLauncher")<
  BrowserLauncher,
  BrowserLauncherService
>() {}

export interface CliPathService {
  readonly resolve: (...parts: readonly string[]) => string;
  readonly isAbsolute: (path: string) => boolean;
}
export class CliPath extends Context.Tag("niceeval/cli/CliPath")<CliPath, CliPathService>() {}

export interface CliTerminalService {
  readonly feedback: FeedbackIO;
  readonly stdin: InputGuardStdin;
}
export class CliTerminal extends Context.Tag("niceeval/cli/CliTerminal")<CliTerminal, CliTerminalService>() {}

export interface CliReportPlatformService {
  readonly loadConfig: (cwd: string) => Effect.Effect<{ readonly report?: ReportDefinition; readonly theme?: ThemeDefinition; readonly watchInputs: readonly string[] }, CliInvocationError>;
  readonly loadReport: (path: string) => Effect.Effect<{ readonly report: ReportDefinition; readonly watchInputs: readonly string[] }, CliInvocationError>;
  readonly loadTheme: (path: string) => Effect.Effect<{ readonly theme: ThemeDefinition; readonly watchInputs: readonly string[] }, CliInvocationError>;
  readonly resolveModulePath: (cwd: string, value: string) => string;
}
export class CliReportPlatform extends Context.Tag("niceeval/cli/CliReportPlatform")<CliReportPlatform, CliReportPlatformService>() {}

/** A narrow application facade; config always follows credential preparation. */
export interface ProjectConfigurationFacade {
  readonly load: (cwd: string) => Effect.Effect<Config, ProjectCredentialsFailure | ConfigModuleLoadError>;
  readonly rebuild: (cwd: string) => Effect.Effect<Config, ProjectCredentialsFailure | ConfigModuleLoadError>;
}
