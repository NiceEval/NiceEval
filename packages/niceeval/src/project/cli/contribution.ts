import { Effect } from "effect";
import {
  CliArguments,
  CliOutput,
  type CliOptionDefinition,
} from "../../cli/application.ts";
import {
  CliFeatureError,
  type CliCommandContribution,
} from "../../cli/contribution.ts";
import { projectHost } from "../host.ts";
import {
  ProjectFileSystem,
  ProjectManifestFacts,
  ProjectProcessFacts,
} from "../services.ts";

export const PROJECT_INIT_CLI_OPTIONS = Object.freeze({
  help: Object.freeze({
    type: "boolean",
    short: "h",
    help: Object.freeze({
      summary: "Print help for project initialization.",
      visibility: "public",
    }),
  }),
} satisfies Readonly<Record<string, CliOptionDefinition>>);

const PROJECT_INIT_HELP = `niceeval init — initialize NiceEval in the current project

Usage:
  niceeval init

Options:
  -h, --help  print this help
`;

type ProjectCliRequirement =
  | CliArguments
  | CliOutput
  | ProjectFileSystem
  | ProjectManifestFacts
  | ProjectProcessFacts;

type ProjectCliError = CliFeatureError;

function projectFailure(operation: string, cause: unknown): ProjectCliError {
  return new CliFeatureError({
    feature: "project init",
    operation,
    cause,
    exitCode: 1,
  });
}

function stdout(text: string): Effect.Effect<void, ProjectCliError, CliOutput> {
  return Effect.flatMap(CliOutput, (output) => output.writeStdout(text)).pipe(
    Effect.mapError((cause) => projectFailure("write stdout", cause)),
  );
}

function stderr(text: string): Effect.Effect<void, ProjectCliError, CliOutput> {
  return Effect.flatMap(CliOutput, (output) => output.writeStderr(text)).pipe(
    Effect.mapError((cause) => projectFailure("write stderr", cause)),
  );
}

export const projectInitCliCommand: CliCommandContribution<
  ProjectCliRequirement,
  ProjectCliError
> = Object.freeze({
  name: "init",
  summary: "initialize NiceEval in the current project",
  options: PROJECT_INIT_CLI_OPTIONS,
  run: (argv: readonly string[]) => Effect.gen(function* () {
    const parser = yield* CliArguments;
    const parsed = yield* Effect.try({
      try: () => parser.parse(argv, PROJECT_INIT_CLI_OPTIONS),
      catch: (cause) => projectFailure("parse init command", cause),
    });
    if (parsed.values.help === true) {
      yield* stdout(PROJECT_INIT_HELP);
      return 0;
    }
    if (parsed.positionals.length > 0) {
      yield* stderr("niceeval init does not accept positional arguments.\n");
      return 1;
    }
    const initialized = yield* projectHost.initialize().pipe(
      Effect.mapError((cause) => projectFailure("initialize project", cause)),
    );
    yield* stdout(
      "Ready: evals/, niceeval.config.ts, and the niceeval agent-rules block in AGENTS.md (tells coding agents to read the bundled docs before writing evals).\n",
    );
    if (!initialized.prefersEsm) {
      yield* stdout(
        'tip: this project\'s package.json has no "type": "module". niceeval runs either way, but CommonJS mode disallows top-level await in config/eval files — add "type": "module" to package.json for the smoothest path.\n',
      );
    }
    return 0;
  }),
});
