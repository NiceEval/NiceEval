import { Effect } from "effect";
import {
  CliArguments,
  CliInvocationFacts,
  CliOutput,
  CliPath,
  type CliOptionDefinition,
  type CliParsedTokens,
} from "../../cli/application.ts";
import { CliFeatureError, type CliCommandContribution } from "../../cli/contribution.ts";
import { ProjectConfiguration } from "../../cli/project-configuration.ts";
import {
  runSandboxCommandEffect,
  type SandboxCommandFacts,
  type SandboxCommandFlags,
} from "../cli-commands.ts";

/** Sandbox owns this schema: its flags never enter the core CLI parser. */
export const SANDBOX_CLI_OPTIONS = Object.freeze({
  all: Object.freeze({ type: "boolean", help: Object.freeze({ summary: "Destroy every kept sandbox.", visibility: "public" }) }),
  window: Object.freeze({ type: "string", help: Object.freeze({ summary: "Select one recorded change window.", visibility: "public" }) }),
  path: Object.freeze({ type: "string", help: Object.freeze({ summary: "Select one path in a sandbox diff.", visibility: "public" }) }),
  "leave-running": Object.freeze({ type: "boolean", help: Object.freeze({ summary: "Keep a sandbox alive after leaving its shell.", visibility: "public" }) }),
  record: Object.freeze({ type: "string", help: Object.freeze({ summary: "Use a specific NiceEval record root.", visibility: "public" }) }),
  orphans: Object.freeze({ type: "boolean", help: Object.freeze({ summary: "Inspect unregistered sandbox instances left by terminated runs.", visibility: "public" }) }),
  force: Object.freeze({ type: "boolean", help: Object.freeze({ summary: "Prune unverified orphan candidates too.", visibility: "public" }) }),
  help: Object.freeze({ type: "boolean", short: "h", help: Object.freeze({ summary: "Show Sandbox command help.", visibility: "public" }) }),
} satisfies Readonly<Record<string, CliOptionDefinition>>);

const SANDBOX_HELP = `niceeval sandbox — inspect and manage kept sandboxes

Usage:
  niceeval sandbox list [--orphans] [--record <record-root>]
  niceeval sandbox enter <id> [--leave-running] [--record <record-root>]
  niceeval sandbox history <id> [--record <record-root>]
  niceeval sandbox diff <id> [--window <window>] [--path <file>] [--record <record-root>]
  niceeval sandbox stop <id...> [--all] [--record <record-root>]
  niceeval sandbox prune [--force] [--record <record-root>]

Commands:
  list       list kept sandboxes or inspect orphan candidates
  enter      open a shell in a kept sandbox
  history    show the kept sandbox's change windows
  diff       print patches from one or all change windows
  stop       destroy kept sandboxes and remove their registry entries
  prune      destroy orphaned sandbox instances
`;

const SANDBOX_SUBCOMMANDS = ["list", "enter", "history", "diff", "stop", "prune"] as const;
type SandboxSubcommand = (typeof SANDBOX_SUBCOMMANDS)[number];

interface ParsedSandboxArgs {
  readonly positionals: readonly string[];
  readonly providedOptions: readonly string[];
  readonly flags: SandboxCommandFlags;
  readonly help: boolean;
}

type SandboxCliError = CliFeatureError;

function sandboxFailure(operation: string, cause: unknown, exitCode = 1): SandboxCliError {
  return new CliFeatureError({ feature: "sandbox", operation, cause, exitCode });
}

function isSandboxSubcommand(value: string | undefined): value is SandboxSubcommand {
  return value !== undefined && (SANDBOX_SUBCOMMANDS as readonly string[]).includes(value);
}

function parseSandboxArgs(
  argv: readonly string[],
  parse: (argv: readonly string[], options: Readonly<Record<string, CliOptionDefinition>>) => CliParsedTokens,
): ParsedSandboxArgs {
  const parsed = parse(argv, SANDBOX_CLI_OPTIONS);
  return Object.freeze({
    positionals: Object.freeze([...parsed.positionals]),
    providedOptions: Object.freeze(parsed.tokens
      .filter((token) => token.kind === "option")
      .map((token) => token.name)),
    help: parsed.values.help === true,
    flags: Object.freeze({
      all: parsed.values.all === true,
      ...(typeof parsed.values.window === "string" ? { window: parsed.values.window } : {}),
      ...(typeof parsed.values.path === "string" ? { path: parsed.values.path } : {}),
      leaveRunning: parsed.values["leave-running"] === true,
      ...(typeof parsed.values.record === "string" ? { record: parsed.values.record } : {}),
      orphans: parsed.values.orphans === true,
      force: parsed.values.force === true,
    }),
  });
}

const SANDBOX_SUBCOMMAND_OPTIONS: Readonly<Record<SandboxSubcommand, readonly string[]>> = Object.freeze({
  list: Object.freeze(["orphans", "record", "help"]),
  enter: Object.freeze(["leave-running", "record", "help"]),
  history: Object.freeze(["record", "help"]),
  diff: Object.freeze(["window", "path", "record", "help"]),
  stop: Object.freeze(["all", "record", "help"]),
  prune: Object.freeze(["force", "record", "help"]),
});

function write(
  channel: "stdout" | "stderr",
  text: string,
): Effect.Effect<void, SandboxCliError, CliOutput> {
  return Effect.flatMap(CliOutput, (output) => channel === "stdout" ? output.writeStdout(text) : output.writeStderr(text)).pipe(
    Effect.mapError((cause) => sandboxFailure(`write ${channel}`, cause)),
  );
}

function unknownSandboxCommand(command: string | undefined): string {
  return command === undefined
    ? `usage: niceeval sandbox <${SANDBOX_SUBCOMMANDS.join("|")}> …\n`
    : `unknown sandbox command ${JSON.stringify(command)}\n${SANDBOX_HELP}`;
}

/**
 * Feature-owned root contribution. Syntax outcomes deliberately finish before
 * credential preparation, so help, version, empty input, and unknown input do
 * not load .env, config, or a provider SDK.
 */
export const sandboxCliCommand: CliCommandContribution<
  CliArguments | CliInvocationFacts | CliOutput | CliPath | ProjectConfiguration,
  SandboxCliError
> = Object.freeze({
  name: "sandbox",
  summary: "inspect, enter, and clean up kept sandboxes",
  options: SANDBOX_CLI_OPTIONS,
  run: (argv: readonly string[]) => Effect.gen(function* () {
    const argumentsService = yield* CliArguments;
    const parsed = yield* Effect.try({
      try: () => parseSandboxArgs(argv, argumentsService.parse),
      catch: (cause) => sandboxFailure("parse sandbox command", cause, 1),
    });

    const subcommand = parsed.positionals[0];
    if (subcommand === undefined && parsed.help) {
      yield* write("stdout", SANDBOX_HELP);
      return 0;
    }
    if (!isSandboxSubcommand(subcommand)) {
      yield* write("stderr", unknownSandboxCommand(subcommand));
      return 1;
    }
    const unsupportedOption = parsed.providedOptions.find(
      (name) => !SANDBOX_SUBCOMMAND_OPTIONS[subcommand].includes(name),
    );
    if (unsupportedOption !== undefined) {
      yield* write(
        "stderr",
        `niceeval sandbox ${subcommand} does not accept --${unsupportedOption}.\n`,
      );
      return 1;
    }
    if (parsed.help) {
      yield* write("stdout", SANDBOX_HELP);
      return 0;
    }

    const invocation = yield* CliInvocationFacts;
    const facts = yield* invocation.facts.pipe(Effect.mapError((cause) => sandboxFailure("read invocation facts", cause)));
    const configuration = yield* ProjectConfiguration;
    yield* configuration.prepare(facts.cwd).pipe(
      Effect.mapError((cause) => sandboxFailure("prepare project credentials", cause)),
    );
    const path = yield* CliPath;
    const record = parsed.flags.record === undefined ? undefined : path.resolve(facts.cwd, parsed.flags.record);
    const commandFacts: SandboxCommandFacts = Object.freeze({
      leaseHolder: `${facts.pid}@${facts.hostname}`,
      ...(facts.noColor === undefined ? {} : { noColor: facts.noColor }),
      stdout: facts.stdout,
    });
    const output = yield* CliOutput;
    return yield* runSandboxCommandEffect(
      facts.cwd,
      [...parsed.positionals],
      record === undefined ? parsed.flags : { ...parsed.flags, record },
      { out: output.writeStdoutSync, err: output.writeStderrSync },
      commandFacts,
    ).pipe(Effect.mapError((cause) => sandboxFailure("run sandbox command", cause)));
  }),
});
