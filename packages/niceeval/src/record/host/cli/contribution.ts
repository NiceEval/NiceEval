import { Effect, Result, Exit, Scope } from "effect";
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
  recordRootPaths,
  type RecordRoot,
  type RecordRootConstructionError,
} from "../../platform/root.ts";
import { RecordFileSystem } from "../../platform/services.ts";
import { recordHost } from "../runtime.ts";
import { createRecordSnapshot } from "../../sqlite/index.ts";
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

const RECORD_SNAPSHOT_CLI_OPTIONS = Object.freeze({
  output: Object.freeze({
    type: "string",
    help: Object.freeze({
      summary: "Write the sealed RecordSnapshot to this new path.",
      visibility: "public",
    }),
  }),
  help: Object.freeze({
    type: "boolean",
    short: "h",
    help: Object.freeze({
      summary: "Print help for this Record snapshot command.",
      visibility: "public",
    }),
  }),
} satisfies Readonly<Record<string, CliOptionDefinition>>);

const RECORD_SNAPSHOT_HELP = `niceeval record snapshot — create a sealed-only portable RecordSnapshot

Usage:
  niceeval record snapshot --output <snapshot>

Options:
  --output <snapshot>  new destination for the RecordSnapshot
  -h, --help           print this help
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
      typeof parsed.values.record === "string" ? parsed.values.record : ".niceeval",
    );
    const root = makeRecordRoot(rootPath);
    if (Result.isFailure(root)) {
      yield* write(command, "stderr", `${recordRootErrorCode(root.failure)}\n`);
      return 1;
    }
    return Object.freeze({ rootPath, root: root.success, yes: parsed.values.yes === true });
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
    const planned = yield* Effect.result(recordHost.maintenance.planClean({ root: input.root }));
    if (Result.isFailure(planned)) return yield* emitMaintenanceFailure("clean", planned.failure, input.rootPath);
    const plan: RecordCleanOperationPlan = planned.success;
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
        const applied = yield* Effect.result(recordHost.maintenance.applyClean({
          root: input.root,
          plan,
        }));
        if (Result.isFailure(applied)) return yield* emitMaintenanceFailure("clean", applied.failure, input.rootPath);
        const lines = ["Cleaned incomplete Runs:"];
        if (applied.success.deleted.length === 0) lines.push("  deleted: none");
        else lines.push(...applied.success.deleted.map((runId) => `  deleted: ${runId}`));
        lines.push(...applied.success.skipped.map((runId) => `  skipped complete: ${runId}`));
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
    const planned = yield* Effect.result(recordHost.maintenance.planMigrate({ root: input.root }));
    if (Result.isFailure(planned)) return yield* emitMaintenanceFailure("migrate", planned.failure, input.rootPath);
    const plan: RecordMigrateOperationPlan = planned.success;
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
        const applied = yield* Effect.result(recordHost.maintenance.applyMigrate({
          root: input.root,
          plan,
        }));
        if (Result.isFailure(applied)) return yield* emitMaintenanceFailure("migrate", applied.failure, input.rootPath);
        switch (applied.success._tag) {
          case "RecordMigrationAlreadyCurrent":
            yield* write("migrate", "stdout", "Record migration already-current.\n");
            return 0;
          case "RecordMigrationApplied":
            yield* write(
              "migrate",
              "stdout",
              `Record migration migrated: committed ${applied.success.committed}, skipped ${applied.success.skipped}, failed ${applied.success.failed}.\n`,
            );
            return 0;
          default:
            return assertNever(applied.success);
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

function snapshotFailure(operation: string, cause: unknown): RecordCliError {
  return new CliFeatureError({
    feature: "record snapshot",
    operation,
    cause,
    exitCode: 1,
  });
}

function writeSnapshot(
  channel: "stdout" | "stderr",
  text: string,
): Effect.Effect<void, RecordCliError, CliOutput> {
  return Effect.flatMap(CliOutput, (output) =>
    channel === "stdout" ? output.writeStdout(text) : output.writeStderr(text)
  ).pipe(Effect.mapError((cause) => snapshotFailure(`write ${channel}`, cause)));
}

interface RecordSnapshotCommand {
  readonly root: RecordRoot;
  readonly destination: string;
}

function parseRecordSnapshot(
  argv: readonly string[],
): Effect.Effect<RecordSnapshotCommand | number, RecordCliError, CliArguments | CliInvocationFacts | CliOutput | CliPath> {
  return Effect.gen(function* () {
    const parser = yield* CliArguments;
    const parsed = yield* Effect.try({
      try: () => parser.parse(argv, RECORD_SNAPSHOT_CLI_OPTIONS),
      catch: (cause) => snapshotFailure("parse command", cause),
    });
    if (parsed.values.help === true) {
      yield* writeSnapshot("stdout", RECORD_SNAPSHOT_HELP);
      return 0;
    }
    if (parsed.positionals.length !== 1 || parsed.positionals[0] !== "snapshot") {
      yield* writeSnapshot("stderr", `${`error: usage: niceeval record snapshot --output <snapshot>`}\n`);
      return 1;
    }
    if (typeof parsed.values.output !== "string" || parsed.values.output.trim() === "") {
      yield* writeSnapshot("stderr", `${`error: niceeval record snapshot requires --output <snapshot>`}\n`);
      return 1;
    }
    const invocation = yield* CliInvocationFacts;
    const facts = yield* invocation.facts.pipe(
      Effect.mapError((cause) => snapshotFailure("read invocation facts", cause)),
    );
    const path = yield* CliPath;
    const root = makeRecordRoot(path.resolve(facts.cwd, ".niceeval"));
    if (Result.isFailure(root)) {
      yield* writeSnapshot("stderr", `${recordRootErrorCode(root.failure)}\n`);
      return 1;
    }
    return Object.freeze({
      root: root.success,
      destination: path.resolve(facts.cwd, parsed.values.output),
    });
  });
}

function runRecordSnapshot(
  input: RecordSnapshotCommand,
): Effect.Effect<number, RecordCliError, CliOutput | RecordCoordination> {
  return Effect.scoped(Effect.gen(function* () {
    const coordination = yield* RecordCoordination;
    const deadline = Date.now() + 30_000;
    const barrierScope = yield* Scope.make();
    let barrierReleased = false;
    const releaseBarrier = async (): Promise<void> => {
      if (barrierReleased) return;
      barrierReleased = true;
      await Effect.runPromise(Scope.close(barrierScope, Exit.void));
    };
    yield* coordination.enterRecordSnapshotBarrier({
      root: input.root,
      deadlineEpochMs: deadline,
    }).pipe(
      Effect.provideService(Scope.Scope, barrierScope),
      Effect.mapError((cause) => snapshotFailure("acquire snapshot barrier", cause)),
    );
    const root = recordRootPaths(input.root);
    if (root === undefined) {
      return yield* Effect.fail(snapshotFailure("resolve Record root", new Error("record root is not host-issued")));
    }
    const receipt = yield* Effect.tryPromise({
      try: () => createRecordSnapshot(root.portableRoot, input.destination, deadline, releaseBarrier),
      catch: (cause) => snapshotFailure("create snapshot", cause),
    }).pipe(Effect.ensuring(Effect.promise(releaseBarrier)));
    yield* writeSnapshot("stdout", `Created RecordSnapshot: ${receipt.path} (${receipt.sealedRunCount} sealed Runs)
`);
    return 0;
  }));
}

export const recordCliCommand: CliCommandContribution<
  RecordCliBaseRequirement | RecordCoordination,
  RecordCliError
> = Object.freeze({
  name: "record",
  summary: "create a sealed-only portable RecordSnapshot",
  options: RECORD_SNAPSHOT_CLI_OPTIONS,
  run: (argv: readonly string[]) => Effect.gen(function* () {
    const parsed = yield* parseRecordSnapshot(argv);
    if (typeof parsed === "number") return parsed;
    return yield* runRecordSnapshot(parsed);
  }),
});
