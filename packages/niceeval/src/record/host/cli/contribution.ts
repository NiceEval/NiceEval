import { Effect, Either } from "effect";
import {
  CliArguments,
  CliInvocationFacts,
  CliOutput,
  CliPath,
  type CliOptionDefinition,
} from "../../../cli/application.ts";
import {
  CliFeatureError,
  type CliCommandContribution,
} from "../../../cli/contribution.ts";
import { RecordCoordination } from "../../../coordination/record-leases.ts";
import {
  makeRecordRoot,
  type RecordRoot,
  type RecordRootConstructionError,
} from "../../platform/root.ts";
import { RecordFileSystem } from "../../platform/services.ts";
import { recordHost } from "../runtime.ts";
import type {
  RecordCleanOperationPlan,
  RecordMaintenanceOperationFailure,
  RecordMigrateOperationPlan,
} from "../types.ts";
import {
  renderMigrationPlan,
  renderRecordMaintenanceFailure,
} from "./presentation.ts";

export const RECORD_MAINTENANCE_CLI_OPTIONS = Object.freeze({
  record: Object.freeze({
    type: "string",
    help: Object.freeze({
      summary: "Use a specific NiceEval record root.",
      visibility: "public",
    }),
  }),
  yes: Object.freeze({
    type: "boolean",
    help: Object.freeze({
      summary: "Confirm the planned Record maintenance operation.",
      visibility: "public",
    }),
  }),
  help: Object.freeze({
    type: "boolean",
    short: "h",
    help: Object.freeze({
      summary: "Print help for this Record maintenance command.",
      visibility: "public",
    }),
  }),
} satisfies Readonly<Record<string, CliOptionDefinition>>);

const CLEAN_HELP = `niceeval clean — delete incomplete Record Runs

Usage:
  niceeval clean [--record <root>] [--yes]

Options:
  --record <root>  use a specific NiceEval Record root
  --yes            confirm deletion of the listed incomplete Runs
  -h, --help       print this help
`;

const MIGRATE_HELP = `niceeval migrate — migrate a Record through fixed adjacent steps

Usage:
  niceeval migrate [--record <root>] [--yes]

Options:
  --record <root>  use a specific NiceEval Record root
  --yes            confirm application of the displayed migration plan
  -h, --help       print this help
`;

type RecordCliBaseRequirement =
  | CliArguments
  | CliInvocationFacts
  | CliOutput
  | CliPath;

type RecordCliError = CliFeatureError;

function assertNever(value: never): never {
  throw new Error(`Unreachable Record CLI contribution value: ${String(value)}`);
}

function recordCliFailure(
  command: "clean" | "migrate",
  operation: string,
  cause: unknown,
): RecordCliError {
  return new CliFeatureError({
    feature: `record ${command}`,
    operation,
    cause,
    exitCode: 1,
  });
}

function write(
  command: "clean" | "migrate",
  channel: "stdout" | "stderr",
  text: string,
): Effect.Effect<void, RecordCliError, CliOutput> {
  return Effect.flatMap(CliOutput, (output) =>
    channel === "stdout" ? output.writeStdout(text) : output.writeStderr(text)
  ).pipe(Effect.mapError((cause) => recordCliFailure(command, `write ${channel}`, cause)));
}

function recordRootErrorCode(error: RecordRootConstructionError): string {
  switch (error.code) {
    case "record-root-empty":
    case "record-root-relative":
    case "record-root-non-file-url":
    case "record-root-file-url-invalid":
      return error.code;
  }
}

interface ParsedRecordCommand {
  readonly rootPath: string;
  readonly root: RecordRoot;
  readonly yes: boolean;
}

function parseRecordCommand(
  command: "clean" | "migrate",
  argv: readonly string[],
): Effect.Effect<ParsedRecordCommand | number, RecordCliError, CliArguments | CliInvocationFacts | CliOutput | CliPath> {
  return Effect.gen(function* () {
    const parser = yield* CliArguments;
    const parsed = yield* Effect.try({
      try: () => parser.parse(argv, RECORD_MAINTENANCE_CLI_OPTIONS),
      catch: (cause) => recordCliFailure(command, "parse command", cause),
    });
    if (parsed.values.help === true) {
      yield* write(command, "stdout", command === "clean" ? CLEAN_HELP : MIGRATE_HELP);
      return 0;
    }
    if (parsed.positionals.length > 0) {
      yield* write(command, "stderr", `niceeval ${command} does not accept positional arguments.\n`);
      return 1;
    }
    const invocation = yield* CliInvocationFacts;
    const facts = yield* invocation.facts.pipe(
      Effect.mapError((cause) => recordCliFailure(command, "read invocation facts", cause)),
    );
    const path = yield* CliPath;
    const rootPath = path.resolve(
      facts.cwd,
      typeof parsed.values.record === "string" ? parsed.values.record : ".niceeval/record",
    );
    const root = makeRecordRoot(rootPath);
    if (Either.isLeft(root)) {
      yield* write(command, "stderr", `${recordRootErrorCode(root.left)}\n`);
      return 1;
    }
    return Object.freeze({ rootPath, root: root.right, yes: parsed.values.yes === true });
  });
}

function emitMaintenanceFailure(
  command: "clean" | "migrate",
  failure: RecordMaintenanceOperationFailure,
  recordPath: string,
): Effect.Effect<number, RecordCliError, CliOutput> {
  return write(command, "stderr", renderRecordMaintenanceFailure(failure, recordPath)).pipe(Effect.as(1));
}

function runClean(
  input: ParsedRecordCommand,
): Effect.Effect<number, RecordCliError, CliOutput | RecordCoordination | RecordFileSystem> {
  return Effect.gen(function* () {
    const planned = yield* Effect.either(recordHost.maintenance.planClean({ root: input.root }));
    if (Either.isLeft(planned)) return yield* emitMaintenanceFailure("clean", planned.left, input.rootPath);
    const plan: RecordCleanOperationPlan = planned.right;
    switch (plan._tag) {
      case "RecordCleanAlreadyClean":
        yield* write("clean", "stdout", "No incomplete Runs found.\n");
        return 0;
      case "RecordCleanConfirmationRequired": {
        const listed = plan.runIds.map((runId) => `  ${runId}`).join("\n");
        if (!input.yes) {
          yield* write("clean", "stdout", `Incomplete Runs:\n${listed}\n`);
          yield* write(
            "clean",
            "stderr",
            "record-clean-confirmation-required\nReview the listed Runs and rerun with --yes.\n",
          );
          return 1;
        }
        const applied = yield* Effect.either(recordHost.maintenance.applyClean({
          root: input.root,
          plan,
        }));
        if (Either.isLeft(applied)) return yield* emitMaintenanceFailure("clean", applied.left, input.rootPath);
        const lines = ["Cleaned incomplete Runs:"];
        if (applied.right.deleted.length === 0) lines.push("  deleted: none");
        else lines.push(...applied.right.deleted.map((runId) => `  deleted: ${runId}`));
        lines.push(...applied.right.skipped.map((runId) => `  skipped complete: ${runId}`));
        yield* write("clean", "stdout", `${lines.join("\n")}\n`);
        return 0;
      }
      default:
        return assertNever(plan);
    }
  });
}

function runMigrate(
  input: ParsedRecordCommand,
): Effect.Effect<number, RecordCliError, CliOutput | RecordCoordination | RecordFileSystem> {
  return Effect.gen(function* () {
    const planned = yield* Effect.either(recordHost.maintenance.planMigrate({ root: input.root }));
    if (Either.isLeft(planned)) return yield* emitMaintenanceFailure("migrate", planned.left, input.rootPath);
    const plan: RecordMigrateOperationPlan = planned.right;
    const planText = renderMigrationPlan(plan);
    switch (plan._tag) {
      case "RecordMigrationAlreadyCurrent":
        yield* write("migrate", "stdout", `${planText}Record migration already-current.\n`);
        return 0;
      case "RecordMigrationUnsupported":
        yield* write("migrate", "stdout", planText);
        yield* write(
          "migrate",
          "stderr",
          "record-format-unsupported\nInstall a NiceEval version that supports this Record format.\n",
        );
        return 1;
      case "RecordMigrationReady": {
        yield* write("migrate", "stdout", planText);
        if (!input.yes) {
          yield* write(
            "migrate",
            "stderr",
            "record-migration-confirmation-required\nReview the migration plan and rerun with --yes.\n",
          );
          return 1;
        }
        const applied = yield* Effect.either(recordHost.maintenance.applyMigrate({
          root: input.root,
          plan,
        }));
        if (Either.isLeft(applied)) return yield* emitMaintenanceFailure("migrate", applied.left, input.rootPath);
        switch (applied.right._tag) {
          case "RecordMigrationAlreadyCurrent":
            yield* write("migrate", "stdout", "Record migration already-current.\n");
            return 0;
          case "RecordMigrationApplied":
            yield* write(
              "migrate",
              "stdout",
              `Record migration migrated: committed ${applied.right.committed}, skipped ${applied.right.skipped}, failed ${applied.right.failed}.\n`,
            );
            return 0;
          default:
            return assertNever(applied.right);
        }
      }
      default:
        return assertNever(plan);
    }
  });
}

function makeRecordCliCommand<R>(
  command: "clean" | "migrate",
  summary: string,
  execute: (input: ParsedRecordCommand) => Effect.Effect<number, RecordCliError, CliOutput | R>,
): CliCommandContribution<RecordCliBaseRequirement | R, RecordCliError> {
  return Object.freeze({
    name: command,
    summary,
    options: RECORD_MAINTENANCE_CLI_OPTIONS,
    run: (argv: readonly string[]) => Effect.gen(function* () {
      const parsed = yield* parseRecordCommand(command, argv);
      if (typeof parsed === "number") return parsed;
      return yield* execute(parsed);
    }),
  });
}

export const cleanCliCommand = makeRecordCliCommand(
  "clean",
  "delete incomplete Record Runs",
  runClean,
);

export const migrateCliCommand = makeRecordCliCommand(
  "migrate",
  "migrate a Record through fixed adjacent steps",
  runMigrate,
);
