/**
 * Platform-neutral CLI application contract. Command parsing, selection and
 * presentation consume these capabilities; Node wiring lives only in the
 * bootstrap adapter.
 */
import { Context, Data, Effect } from "effect";

export interface CliInvocation {
  readonly cwd: string;
  readonly argv: readonly string[];
  readonly hostname: string;
  /** Process identity exposed by the Node adapter for feature-owned lease coordination. */
  readonly pid: number;
  readonly noColor?: string;
  readonly platform: "darwin" | "win32" | "linux" | string;
  readonly stdout: { readonly isTTY: boolean; readonly columns?: number };
  readonly stderr: { readonly isTTY: boolean; readonly columns?: number };
}

/** Immutable display metadata owned with an option, rather than reconstructed by a central CLI registry. */
export interface CliOptionHelp {
  readonly summary: string;
  /** Hidden options remain parser-recognized but do not become part of user help or generated reference. */
  readonly visibility: "public" | "hidden";
}

/** A parser option plus the feature-owned metadata needed to compose and document it. */
export interface CliOptionalOptionValue {
  /** Value produced by a bare option. Boolean `true` preserves ordinary flag semantics. */
  readonly default: string | true;
  /** Accept one following token as the value. Inline `--name=value` is always accepted. */
  readonly separated?: true;
  /** Closed value vocabulary. Omit for an arbitrary non-empty string. */
  readonly values?: readonly string[];
}

export type CliOptionDefinition = Readonly<{
  readonly type: "string" | "boolean";
  readonly multiple?: true;
  readonly short?: string;
  /** Generic boolean|string union syntax owned by this option, not by the root router. */
  readonly optionalValue?: CliOptionalOptionValue;
  readonly help?: CliOptionHelp;
}>;

export type CliParsedToken =
  | Readonly<{
      readonly kind: "option";
      readonly index: number;
      readonly name: string;
      readonly rawName: string;
      readonly value?: string;
      readonly inlineValue?: boolean;
    }>
  | Readonly<{
      readonly kind: "positional";
      readonly index: number;
      readonly name?: undefined;
      readonly rawName?: undefined;
      readonly value: string;
      readonly inlineValue?: undefined;
    }>
  | Readonly<{
      readonly kind: "option-terminator";
      readonly index: number;
      readonly name?: undefined;
      readonly rawName?: undefined;
      readonly value?: undefined;
      readonly inlineValue?: undefined;
    }>;

export interface CliParsedTokens {
  readonly values: Record<string, string | boolean | string[] | undefined>;
  readonly positionals: readonly string[];
  /** Exact Node parseArgs tokens, including raw argv indexes used for root projection. */
  readonly tokens: readonly CliParsedToken[];
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

/**
 * Process-signal ownership stays at the application boundary. A feature may
 * claim the Invocation signal immediately before dispatch, but it never reads
 * Node globals or installs handlers of its own.
 */
export interface CliInterruptionService {
  readonly invocationSignal: AbortSignal;
  /** False means bootstrap already accepted a root-owned first signal. */
  readonly enterGracefulDispatch: () => boolean;
  readonly requestInterrupt: () => void;
}

export class CliInterruption extends Context.Tag("niceeval/cli/CliInterruption")<
  CliInterruption,
  CliInterruptionService
>() {}

export interface CliOutputService {
  readonly writeStdout: (text: string) => Effect.Effect<void, CliInvocationError>;
  readonly writeStderr: (text: string) => Effect.Effect<void, CliInvocationError>;
  /** Callback bridge for Host observer contracts that cannot return Effect. */
  readonly writeStdoutSync: (text: string) => void;
  readonly writeStderrSync: (text: string) => void;
}
export class CliOutput extends Context.Tag("niceeval/cli/CliOutput")<CliOutput, CliOutputService>() {}

export interface PackageMetadataService {
  readonly version: Effect.Effect<string, CliInvocationError>;
}
export class PackageMetadata extends Context.Tag("niceeval/cli/PackageMetadata")<
  PackageMetadata,
  PackageMetadataService
>() {}

export interface CliPathService {
  readonly resolve: (...parts: readonly string[]) => string;
  readonly isAbsolute: (path: string) => boolean;
}
export class CliPath extends Context.Tag("niceeval/cli/CliPath")<CliPath, CliPathService>() {}
