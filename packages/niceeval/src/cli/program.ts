// The root CLI is deliberately domain-neutral. Feature and Host modules own
// command schemas, preflight, execution, presentation, and command help; this
// module only composes their immutable contributions and routes one root token.

import { Data, Effect } from "effect";
import {
  CliArguments,
  CliInvocationFacts,
  CliOutput,
  PackageMetadata,
  type CliOptionDefinition,
} from "./application.ts";
import {
  CliFeatureError,
  composeCliOptionSchema,
  locateCliRoot,
  matchCliFeatureCommand,
  renderFeatureCommandIndex,
  type CliCommandContribution,
} from "./contribution.ts";
import { formatThrown } from "../util.ts";

/** A recoverable root-command usage error. */
export class CliUsageError extends Data.TaggedError("CliUsageError")<{
  readonly message: string;
  readonly exitCode: number;
}> {}

/** A recoverable failure from a root-owned terminal or process boundary. */
export class CliOperationError extends Data.TaggedError("CliOperationError")<{
  readonly operation: string;
  readonly cause: unknown;
  readonly exitCode: number;
}> {}

export type CliFailure = CliUsageError | CliOperationError | CliFeatureError;

const APPLICATION_CLI_OPTIONS = Object.freeze({
  help: Object.freeze({
    type: "boolean",
    short: "h",
    help: Object.freeze({
      summary: "Print the root command index.",
      visibility: "public",
    }),
  }),
  version: Object.freeze({
    type: "boolean",
    short: "v",
    help: Object.freeze({
      summary: "Print the installed NiceEval version.",
      visibility: "public",
    }),
  }),
} satisfies Readonly<Record<string, CliOptionDefinition>>);

function usageError(message: string, exitCode = 1): CliUsageError {
  return new CliUsageError({ message, exitCode });
}

function operationError(operation: string, cause: unknown, exitCode = 1): CliOperationError {
  return cause instanceof CliOperationError
    ? cause
    : new CliOperationError({ operation, cause, exitCode });
}

function parseError(cause: unknown): CliUsageError {
  const message = cause instanceof Error ? cause.message : String(cause);
  return usageError(`${message}
Run \`niceeval --help\` for usage.
`);
}

function parseErrorCode(cause: unknown): string | undefined {
  if (!(cause instanceof Error)) return undefined;
  const code = Reflect.get(cause, "code");
  return typeof code === "string" ? code : undefined;
}

/** Bootstrap owns presentation of typed failures; defects and interruption stay in Cause. */
export function renderCliFailure(failure: CliFailure): string {
  if (failure._tag === "CliUsageError") return failure.message;
  if (failure._tag === "CliFeatureError") {
    if (failure.display !== undefined) return failure.display;
    if (parseErrorCode(failure.cause)?.startsWith("ERR_PARSE_ARGS_") === true) {
      const message = failure.cause instanceof Error ? failure.cause.message : String(failure.cause);
      return `${message}
Run \`niceeval --help\` for usage.
`;
    }
    return `${failure.feature} ${failure.operation} failed: ${formatThrown(failure.cause)}\n`;
  }
  return `niceeval error: ${formatThrown(failure.cause)}
`;
}

function invocationFacts() {
  return Effect.flatMap(CliInvocationFacts, ({ facts }) => facts).pipe(
    Effect.mapError((cause) => operationError("read invocation facts", cause)),
  );
}

function writeStdout(text: string) {
  return Effect.flatMap(CliOutput, ({ writeStdout }) => writeStdout(text)).pipe(
    Effect.mapError((cause) => operationError("write stdout", cause)),
  );
}

function packageVersion() {
  return Effect.flatMap(PackageMetadata, ({ version }) => version).pipe(
    Effect.mapError((cause) => operationError("read package metadata", cause)),
  );
}

function rootHelp<R>(commands: readonly CliCommandContribution<R, CliFeatureError>[]): string {
  return `niceeval — agent-native evals

Usage:
  niceeval <command> [options]

Application options:
  -h, --help       print this command index
  -v, --version    print the installed version

Run \`niceeval <command> --help\` for command-specific usage.
` + renderFeatureCommandIndex(commands);
}

function optionBeforeRoot(
  option: "help" | "version",
  tokens: Parameters<typeof locateCliRoot>[0],
): boolean {
  const root = locateCliRoot(tokens);
  return tokens.some((token) => token.kind === "option" && token.name === option &&
    (root === undefined || token.index < root.index));
}

/**
 * Route one immutable contribution. The aggregate parse discovers the indexed
 * root token only; the selected command performs its own authoritative parse.
 */
export const cliProgram = <R>(
  commands: readonly CliCommandContribution<R, CliFeatureError>[],
) => Effect.gen(function* () {
  const facts = yield* invocationFacts();
  const argumentsService = yield* CliArguments;
  const parsed = yield* Effect.try({
    try: () => argumentsService.parse(
      facts.argv,
      composeCliOptionSchema(commands, APPLICATION_CLI_OPTIONS),
    ),
    catch: parseError,
  });
  const route = yield* Effect.try({
    try: () => matchCliFeatureCommand(facts.argv, parsed, commands),
    catch: (cause) => operationError("route CLI command", cause),
  });

  if (route?.kind === "application-option") {
    if (route.option === "help") {
      yield* writeStdout(rootHelp(commands));
      return 0;
    }
    yield* writeStdout(`${yield* packageVersion()}\n`);
    return 0;
  }
  if (route?.kind === "command") {
    return yield* route.command.run(route.argv);
  }

  const root = locateCliRoot(parsed.tokens);
  if (optionBeforeRoot("help", parsed.tokens)) {
    yield* writeStdout(rootHelp(commands));
    return 0;
  }
  if (optionBeforeRoot("version", parsed.tokens)) {
    yield* writeStdout(`${yield* packageVersion()}\n`);
    return 0;
  }
  if (root !== undefined) {
    return yield* Effect.fail(usageError(`Unknown command "${root.name}".
Run \`niceeval --help\` for usage.
`));
  }
  if (facts.argv.length === 0 || parsed.values.help === true) {
    yield* writeStdout(rootHelp(commands));
    return 0;
  }
  if (parsed.values.version === true) {
    yield* writeStdout(`${yield* packageVersion()}\n`);
    return 0;
  }
  return yield* Effect.fail(usageError(`No command specified.
Run \`niceeval --help\` for usage.
`));
});
