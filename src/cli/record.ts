import { resolve } from "node:path";
import { Either, Effect, Layer } from "effect";
import {
  cleanIncompleteRuns,
  inspectIncompleteRuns,
  makeRecordRoot,
  NodeRecordLive,
  type RecordRoot,
} from "../record/index.ts";
import { recordHost } from "../record/host/index.ts";

export type RecordCliCommand = "clean" | "migrate";

export interface RunRecordCliCommandInput {
  readonly command: RecordCliCommand;
  readonly cwd: string;
  /** An actual Record root, never a `.niceeval` parent directory. */
  readonly record?: string;
  readonly yes: boolean;
}

/** The outer CLI owns process streams and exit; this value is its pure receipt. */
export interface RecordCliCommandOutput {
  readonly exitCode: 0 | 1;
  readonly stdout: string;
  readonly stderr: string;
}

function output(input: {
  readonly exitCode: 0 | 1;
  readonly stdout?: string;
  readonly stderr?: string;
}): RecordCliCommandOutput {
  return Object.freeze({
    exitCode: input.exitCode,
    stdout: input.stdout ?? "",
    stderr: input.stderr ?? "",
  });
}

export const NodeRecordCliLive = NodeRecordLive;

function resolveRecordRoot(
  input: RunRecordCliCommandInput,
): Either.Either<RecordRoot, RecordCliCommandOutput> {
  const root = makeRecordRoot(
    resolve(input.cwd, input.record ?? ".niceeval/record"),
  );
  return Either.isLeft(root)
    ? Either.left(
        output({
          exitCode: 1,
          stderr: `${root.left.code}\n`,
        }),
      )
    : Either.right(root.right);
}

function recordErrorCode(error: unknown): string {
  if (typeof error !== "object" || error === null) return "record-command-failed";
  const candidate = Reflect.get(error, "code");
  return typeof candidate === "string" ? candidate : "record-command-failed";
}

function recordErrorNextStep(code: string): string | undefined {
  switch (code) {
    case "record-migration-required":
      return "Run: niceeval migrate";
    case "record-migration-interrupted":
      return "Restore the complete Record from the recorded Git commit; do not rerun migrate on mixed bytes.";
    case "record-migration-plan-stale":
      return "Review the new migration plan and rerun migrate.";
    case "record-migration-git-restore-required":
      return "Commit, restore, or otherwise obtain a clean Git restore point for this Record before migrating.";
    case "record-migration-invalid":
      return "Restore the Record from Git before retrying migration.";
    case "record-format-unsupported":
      return "Install a NiceEval version that supports this Record format.";
    case "record-maintenance-busy":
    case "record-writer-busy":
      return "Close the Record command holding the lock, then retry.";
    default:
      return undefined;
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function recoveryCommands(restoreCommit: string, recordPath: string): string {
  const root = shellQuote(recordPath);
  const commit = shellQuote(restoreCommit);
  const sentinel = shellQuote(resolve(recordPath, "migration.in-progress"));
  return [
    `Restore command: git -C ${root} restore --source=${commit} --staged --worktree -- .`,
    `Verify command: git -C ${root} diff --quiet ${commit} -- . && git -C ${root} diff --cached --quiet ${commit} -- .`,
    `Clear sentinel after verification: rm -f -- ${sentinel}`,
  ].join("\n") + "\n";
}

function interruptedRecovery(error: unknown, recordPath: string | undefined): string {
  if (typeof error !== "object" || error === null || recordPath === undefined) return "";
  const restoreCommit = Reflect.get(error, "restoreCommit");
  return typeof restoreCommit === "string" && /^[0-9a-f]{40,64}$/.test(restoreCommit)
    ? recoveryCommands(restoreCommit, recordPath)
    : "";
}

function recordErrorOutput(
  error: unknown,
  stdout = "",
  recordPath?: string,
): RecordCliCommandOutput {
  const code = recordErrorCode(error);
  const next = recordErrorNextStep(code);
  return output({
    exitCode: 1,
    stdout,
    stderr: `${code}\n${next === undefined ? "" : `${next}\n`}${
      code === "record-migration-interrupted" ? interruptedRecovery(error, recordPath) : ""
    }`,
  });
}

function recordMigrationErrorOutput(
  error: unknown,
  stdout: string,
  restoreCommit: string,
  recordPath: string,
): RecordCliCommandOutput {
  const code = recordErrorCode(error);
  const next = recordErrorNextStep(code);
  return output({
    exitCode: 1,
    stdout,
    stderr: `${code}\n${next === undefined ? "" : `${next}\n`}Restore commit: ${restoreCommit}\n${
      recoveryCommands(restoreCommit, recordPath)
    }`,
  });
}

function cleanCommand(input: {
  readonly root: RecordRoot;
  readonly yes: boolean;
}) {
  return Effect.gen(function* () {
    const incomplete = yield* inspectIncompleteRuns({ root: input.root });
    if (incomplete.length === 0) {
      return output({
        exitCode: 0,
        stdout: "No incomplete Runs found.\n",
      });
    }

    const listed = incomplete.map((entry) => `  ${entry.runId}`).join("\n");
    if (!input.yes) {
      return output({
        exitCode: 1,
        stdout: `Incomplete Runs:\n${listed}\n`,
        stderr:
          "record-clean-confirmation-required\nReview the listed Runs and rerun with --yes.\n",
      });
    }

    const cleaned = yield* Effect.either(
      cleanIncompleteRuns({
        root: input.root,
        runIds: incomplete.map((entry) => entry.runId),
      }),
    );
    if (Either.isLeft(cleaned)) {
      return recordErrorOutput(cleaned.left, `Incomplete Runs:\n${listed}\n`);
    }

    const lines = ["Cleaned incomplete Runs:"];
    if (cleaned.right.deleted.length === 0) lines.push("  deleted: none");
    else lines.push(...cleaned.right.deleted.map((runId) => `  deleted: ${runId}`));
    if (cleaned.right.skipped.length > 0) {
      lines.push(...cleaned.right.skipped.map((runId) => `  skipped complete: ${runId}`));
    }
    return output({ exitCode: 0, stdout: `${lines.join("\n")}\n` });
  });
}

function migrateCommand(input: {
  readonly root: RecordRoot;
  readonly recordPath: string;
  readonly yes: boolean;
}) {
  return Effect.scoped(Effect.gen(function* () {
    const session = yield* recordHost.maintenance.open({ root: input.root });
    const plan = yield* session.planMigrate();
    const planText = plan.state === "already-current"
      ? `Record migration plan: already-current\nformat: ${plan.format}\n`
      : plan.state === "unsupported-format"
        ? `Record migration plan: unsupported-format\nformat: ${plan.format}\n`
        : `Record migration plan: migration-required\nformat: ${plan.format}\nattachments: ${plan.attachments.length}\nbackup: ${plan.backup.state}${plan.backup.state === "git-restore-point" ? `\nrestore commit: ${plan.backup.commit}` : ""}\n`;
    if (plan.state === "unsupported-format") {
      return output({
        exitCode: 1,
        stdout: planText,
        stderr: "record-format-unsupported\nInstall a NiceEval version that supports this Record format.\n",
      });
    }
    if (plan.state === "migration-required" && plan.backup.state !== "git-restore-point") {
      return output({
        exitCode: 1,
        stdout: planText,
        stderr: "record-migration-git-restore-required\nA clean Git restore point is required; --yes cannot bypass this preflight.\n",
      });
    }
    if (plan.state === "migration-required" && !input.yes) {
      return output({
        exitCode: 1,
        stdout: planText,
        stderr: "record-migration-confirmation-required\nReview the migration plan and rerun with --yes.\n",
      });
    }
    const migrated = yield* Effect.either(session.applyMigrate(plan));
    if (Either.isLeft(migrated)) {
      return plan.state === "migration-required" && plan.backup.state === "git-restore-point"
        ? recordMigrationErrorOutput(migrated.left, planText, plan.backup.commit, input.recordPath)
        : recordErrorOutput(migrated.left, planText);
    }
    const receipt = migrated.right;
    return output({
      exitCode: 0,
      stdout: `${planText}Record migration ${receipt.state}.\n`,
    });
  }));
}

/**
 * Effect-native command handling for the Record maintenance surface. The
 * CLI owns the one Promise adaptation at its actual process boundary.
 */
export function runRecordCliCommand(
  input: RunRecordCliCommandInput,
): Effect.Effect<RecordCliCommandOutput> {
  const root = resolveRecordRoot(input);
  if (Either.isLeft(root)) return Effect.succeed(root.left);

  if (input.command === "clean") {
    return cleanCommand({ root: root.right, yes: input.yes }).pipe(
      Effect.provide(NodeRecordCliLive),
      Effect.catchAll((error) => Effect.succeed(recordErrorOutput(error))),
    );
  }
  const recordPath = resolve(input.cwd, input.record ?? ".niceeval/record");
  return migrateCommand({ root: root.right, recordPath, yes: input.yes }).pipe(
    Effect.provide(NodeRecordCliLive),
    Effect.catchAll((error) => Effect.succeed(recordErrorOutput(error, "", recordPath))),
  );
}
