import { Effect } from "effect";
import {
  CliArguments,
  CliInvocationFacts,
  CliOutput,
  type CliOptionDefinition,
} from "../../cli/application.ts";
import { CliFeatureError, type CliCommandContribution } from "../../cli/contribution.ts";
import { ProjectConfiguration } from "../../cli/project-configuration.ts";
import { evalHost } from "../host/index.ts";

export const EVAL_CATALOG_OPTIONS = Object.freeze({
  tag: Object.freeze({
    type: "string",
    help: Object.freeze({ summary: "List only evals carrying this tag.", visibility: "public" }),
  }),
  help: Object.freeze({
    type: "boolean",
    short: "h",
    help: Object.freeze({ summary: "Show Eval catalog command help.", visibility: "public" }),
  }),
} satisfies Readonly<Record<string, CliOptionDefinition>>);

const EVAL_CATALOG_HELP = `niceeval list — list discovered Evals

Usage:
  niceeval list [--tag <tag>]
`;

const failure = (operation: string, cause: unknown, exitCode = 1) =>
  new CliFeatureError({ feature: "eval", operation, cause, exitCode });

function write(text: string): Effect.Effect<void, CliFeatureError, CliOutput> {
  return Effect.flatMap(CliOutput, (output) => output.writeStdout(text)).pipe(
    Effect.mapError((cause) => failure("write eval catalog", cause)),
  );
}

export const evalCatalogCliCommand: CliCommandContribution<
  CliArguments | CliInvocationFacts | CliOutput | ProjectConfiguration,
  CliFeatureError
> = Object.freeze({
  name: "list",
  summary: "list discovered evals",
  options: EVAL_CATALOG_OPTIONS,
  run: (argv: readonly string[]) => Effect.gen(function* () {
    const parser = yield* CliArguments;
    const parsed = yield* Effect.try({
      try: () => parser.parse(argv, EVAL_CATALOG_OPTIONS),
      catch: (cause) => failure("parse eval catalog command", cause),
    });
    if (parsed.positionals.length > 0) {
      return yield* Effect.fail(failure(
        "parse eval catalog command",
        new Error("niceeval list accepts no positional arguments."),
      ));
    }
    if (parsed.values.help === true) {
      yield* write(EVAL_CATALOG_HELP);
      return 0;
    }
    const invocation = yield* CliInvocationFacts;
    const facts = yield* invocation.facts.pipe(
      Effect.mapError((cause) => failure("read invocation facts", cause)),
    );
    const configuration = yield* ProjectConfiguration;
    yield* configuration.load(facts.cwd).pipe(
      Effect.mapError((cause) => failure("load project configuration", cause)),
    );
    const catalog = yield* evalHost.catalog({
      cwd: facts.cwd,
      ...(typeof parsed.values.tag === "string" ? { tag: parsed.values.tag } : {}),
    }).pipe(Effect.mapError((cause) => failure("discover eval catalog", cause)));
    yield* write(`Discovered ${catalog.entries.length} evals:
`);
    for (const entry of catalog.entries) {
      yield* write(`  ${entry.id}${entry.description ? `  — ${entry.description}` : ""}\n`);
    }
    return 0;
  }),
});
