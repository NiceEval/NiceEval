import { Effect } from "effect";
import {
  CliArguments,
  CliOutput,
  type CliOptionDefinition,
  type CliParsedTokens,
} from "../../cli/application.ts";
import { CliFeatureError, type CliCommandContribution } from "../../cli/contribution.ts";
import {
  doctorExitCode,
  doctorIncusProvider,
  renderIncusDoctorReport,
} from "../incus.ts";
import { runIncusMaintenance } from "../incus/maintenance.ts";

/** Sandbox owns this schema: its flags never enter the core CLI parser. */
export const SANDBOX_CLI_OPTIONS = Object.freeze({
  development: Object.freeze({ type: "boolean", help: Object.freeze({ summary: "Diagnose the isolated Incus development domain instead of reference.", visibility: "public" }) }),
  json: Object.freeze({ type: "boolean", help: Object.freeze({ summary: "Print Incus artifact inventory or GC as JSON.", visibility: "public" }) }),
  apply: Object.freeze({ type: "string", help: Object.freeze({ summary: "Apply an immutable Incus GC preview by plan id.", visibility: "public" }) }),
  "unused-for": Object.freeze({ type: "string", help: Object.freeze({ summary: "Preview Incus artifacts unused for a duration such as 30d.", visibility: "public" }) }),
  help: Object.freeze({ type: "boolean", short: "h", help: Object.freeze({ summary: "Show Sandbox command help.", visibility: "public" }) }),
} satisfies Readonly<Record<string, CliOptionDefinition>>);

const SANDBOX_HELP = `niceeval sandbox — inspect and manage kept sandboxes

Usage:
  niceeval sandbox list [--orphans] [--record-root <record-root>]
  niceeval sandbox enter <id> [--leave-running] [--record-root <record-root>]
  niceeval sandbox history <id> [--record-root <record-root>]
  niceeval sandbox diff <id> [--window <window>] [--path <file>] [--record-root <record-root>]
  niceeval sandbox stop <id...> [--all] [--record-root <record-root>]
  niceeval sandbox prune [--force] [--record-root <record-root>]
  niceeval sandbox provider doctor incus [--development]
  niceeval sandbox provider inventory incus [--development] [--json]
  niceeval sandbox provider gc incus [--development] [--unused-for <duration>] [--json]
  niceeval sandbox provider gc incus [--development] --apply <plan-id> [--json]

Commands:
  list       list kept sandboxes or inspect orphan candidates
  enter      open a shell in a kept sandbox
  history    show the kept sandbox's change windows
  diff       print patches from one or all change windows
  stop       destroy kept sandboxes and remove their registry entries
  prune      destroy orphaned sandbox instances
  provider   diagnose a sandbox provider (currently incus)
`;

const PROVIDER_DOCTOR_HELP = `niceeval sandbox provider doctor — diagnose a sandbox provider

Usage:
  niceeval sandbox provider doctor incus [--development]
  niceeval sandbox provider inventory incus [--development] [--json]
  niceeval sandbox provider gc incus [--development] [--unused-for <duration>] [--json]
  niceeval sandbox provider gc incus [--development] --apply <plan-id> [--json]

Default reports the Incus reference domain. --development reports the isolated
development domain separately. Doctor is fail closed and read-only; it never
creates, pulls, imports, or destroys allocations.
`;

const RETIRED_SANDBOX_SUBCOMMANDS: readonly string[] = ["list", "enter", "history", "diff", "stop", "prune"];
const SANDBOX_SUBCOMMANDS = ["provider"] as const;
type SandboxSubcommand = (typeof SANDBOX_SUBCOMMANDS)[number];

interface ParsedSandboxArgs {
  readonly positionals: readonly string[];
  readonly providedOptions: readonly string[];
  readonly help: boolean;
  readonly development: boolean;
  readonly json: boolean;
  readonly apply?: string;
  readonly unusedFor?: string;
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
    development: parsed.values.development === true,
    json: parsed.values.json === true,
    ...(typeof parsed.values.apply === "string" ? { apply: parsed.values.apply } : {}),
    ...(typeof parsed.values["unused-for"] === "string" ? { unusedFor: parsed.values["unused-for"] } : {}),
  });
}

const SANDBOX_SUBCOMMAND_OPTIONS: Readonly<Record<SandboxSubcommand, readonly string[]>> = Object.freeze({
  provider: Object.freeze(["development", "help", "json", "apply", "unused-for"]),
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

function runProviderDoctor(
  parsed: ParsedSandboxArgs,
): Effect.Effect<number, SandboxCliError, CliOutput> {
  return Effect.gen(function* () {
    const [, action, provider] = parsed.positionals;
    if (action === "inventory" || action === "gc") {
      if (provider !== "incus" || parsed.positionals.length !== 3 || (action === "inventory" && (parsed.apply !== undefined || parsed.unusedFor !== undefined)) || (parsed.apply !== undefined && (parsed.apply.trim() === "" || parsed.unusedFor !== undefined))) {
        yield* write("stderr", `Invalid Incus maintenance arguments.\n${PROVIDER_DOCTOR_HELP}`);
        return 2;
      }
      const result = yield* runIncusMaintenance({ action, domain: parsed.development ? "development" : "reference", json: parsed.json,
        ...(parsed.apply === undefined ? {} : { apply: parsed.apply }), ...(parsed.unusedFor === undefined ? {} : { unusedFor: parsed.unusedFor }) });
      if (result.stdout !== "") yield* write("stdout", result.stdout);
      if (result.stderr !== "") yield* write("stderr", result.stderr);
      return result.exitCode;
    }
    if (parsed.json || parsed.apply !== undefined || parsed.unusedFor !== undefined) {
      yield* write("stderr", `Incus maintenance flags require inventory or gc.\n`);
      return 2;
    }
    if (action === undefined || action === "help") {
      yield* write("stdout", PROVIDER_DOCTOR_HELP);
      return action === undefined ? 1 : 0;
    }
    if (action !== "doctor") {
      yield* write("stderr", `unknown sandbox provider command ${JSON.stringify(action)}\n${PROVIDER_DOCTOR_HELP}`);
      return 1;
    }
    if (provider === undefined) {
      yield* write("stderr", `usage: niceeval sandbox provider doctor <provider>\n${PROVIDER_DOCTOR_HELP}`);
      return 1;
    }
    if (provider !== "incus") {
      yield* write(
        "stderr",
        `sandbox provider doctor does not support ${JSON.stringify(provider)}. Currently only incus is implemented.\n`,
      );
      return 1;
    }
    if (parsed.positionals.length > 3) {
      yield* write(
        "stderr",
        `niceeval sandbox provider doctor incus does not accept extra arguments.\n${PROVIDER_DOCTOR_HELP}`,
      );
      return 1;
    }
    const report = yield* Effect.tryPromise({
      try: () => doctorIncusProvider({
        domain: parsed.development ? "development" : "reference",
      }),
      catch: (cause) => sandboxFailure("doctor incus provider", cause),
    });
    yield* write("stdout", renderIncusDoctorReport(report));
    return doctorExitCode(report);
  });
}

/**
 * Feature-owned root contribution. Syntax outcomes deliberately finish before
 * credential preparation, so help, version, empty input, and unknown input do
 * not load .env, config, or a provider SDK.
 */
export const sandboxCliCommand: CliCommandContribution<
  CliArguments | CliOutput,
  SandboxCliError
> = Object.freeze({
  name: "sandbox",
  summary: "diagnose and maintain sandbox providers",
  options: SANDBOX_CLI_OPTIONS,
  run: (argv: readonly string[]) => Effect.gen(function* () {
    if (argv[0] !== undefined && RETIRED_SANDBOX_SUBCOMMANDS.includes(argv[0])) {
      yield* write("stderr", `niceeval sandbox ${argv[0]} has been retired. Use native provider CLIs instead.\n\nDocker: docker ps -a; docker exec -it <sandboxId> /bin/bash; docker rm -f <sandboxId>.\nInstabox: instabox list; instabox ssh <sandboxId>; instabox rm <sandboxId>.\nInspect workspace changes with git status, git log, and git diff inside the sandbox.\n`);
      return 1;
    }
    const argumentsService = yield* CliArguments;
    const parsed = yield* Effect.try({
      try: () => parseSandboxArgs(argv, argumentsService.parse),
      catch: (cause) => sandboxFailure("parse sandbox command", cause, argv[0] === "provider" && (argv[1] === "inventory" || argv[1] === "gc") ? 2 : 1),
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
      return 2;
    }
    if (parsed.help) {
      yield* write("stdout", PROVIDER_DOCTOR_HELP);
      return 0;
    }
    return yield* runProviderDoctor(parsed);
  }),
});
