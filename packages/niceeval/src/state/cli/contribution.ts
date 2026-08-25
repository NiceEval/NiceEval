import { Effect } from "effect";
import {
  CliArguments,
  CliOutput,
  type CliOptionDefinition,
} from "../../cli/application.ts";
import { CliFeatureError, type CliCommandContribution } from "../../cli/contribution.ts";
import { t } from "../../i18n/index.ts";
import { userStateStoreHost } from "../composition.ts";

const STATE_MIGRATE_OPTIONS = Object.freeze({
  all: Object.freeze({
    type: "boolean",
    help: Object.freeze({
      summary: "Migrate every registered first-party Service state module.",
      visibility: "public",
    }),
  }),
  help: Object.freeze({
    type: "boolean",
    short: "h",
    help: Object.freeze({
      summary: "Print help for this State migration command.",
      visibility: "public",
    }),
  }),
} satisfies Readonly<Record<string, CliOptionDefinition>>);

const STATE_MIGRATE_HELP = `niceeval state migrate — migrate OS-user Service state

Usage:
  niceeval state migrate --all

Options:
  --all       migrate every registered first-party Service state module
  -h, --help  print this help
`;

function failure(operation: string, cause: unknown): CliFeatureError {
  return new CliFeatureError({ feature: "state migrate", operation, cause, exitCode: 1 });
}

function write(
  channel: "stdout" | "stderr",
  text: string,
): Effect.Effect<void, CliFeatureError, CliOutput> {
  return Effect.flatMap(CliOutput, (output) =>
    channel === "stdout" ? output.writeStdout(text) : output.writeStderr(text)
  ).pipe(Effect.mapError((cause) => failure(`write ${channel}`, cause)));
}

export const stateCliCommand: CliCommandContribution<CliArguments | CliOutput, CliFeatureError> = Object.freeze({
  name: "state",
  summary: "migrate OS-user Service state",
  options: STATE_MIGRATE_OPTIONS,
  run: (argv: readonly string[]) => Effect.scoped(Effect.gen(function* () {
    const parser = yield* CliArguments;
    const parsed = yield* Effect.try({
      try: () => parser.parse(argv, STATE_MIGRATE_OPTIONS),
      catch: (cause) => failure("parse command", cause),
    });
    if (parsed.values.help === true) {
      yield* write("stdout", STATE_MIGRATE_HELP);
      return 0;
    }
    if (parsed.positionals.length !== 1 || parsed.positionals[0] !== "migrate") {
      yield* write("stderr", `${t("cli.state.migrate.usage")}\n`);
      return 1;
    }
    if (parsed.values.all !== true) {
      yield* write("stderr", `${t("cli.state.migrate.allRequired")}\n`);
      return 1;
    }
    const state = yield* userStateStoreHost.open({ automaticMigrations: false }).pipe(
      Effect.mapError((cause) => failure("open user state", cause)),
    );
    yield* state.migrateAll.pipe(Effect.mapError((cause) => failure("migrate user state", cause)));
    yield* write("stdout", t("cli.state.migrate.complete", { path: state.path }));
    return 0;
  })),
});
