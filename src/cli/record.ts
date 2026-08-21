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
import type { RecordAttachmentMigrationTarget } from "../record/host/types.ts";
import {
  RecordAutoMigrationGitSaveRequired,
  RecordMigrationRequired,
} from "../record/reader/errors.ts";
import { RecordFileSystem, recordPortablePath } from "../record/platform/services.ts";

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

export interface AutomaticRecordMigrationReceipt {
  readonly restoreCommit: string;
  readonly attachments: readonly RecordAttachmentMigrationTarget[];
}

/**
 * Preflight for ordinary CLI entry points. Every Scope is closed before the
 * next lease kind is acquired: read check -> exclusive maintenance -> caller's
 * fresh ordinary open.
 */
export function ensureAutomaticRecordMigration(input: {
  readonly cwd: string;
  readonly record?: string;
}) {
  const root = makeRecordRoot(resolve(input.cwd, input.record ?? ".niceeval/record"));
  if (Either.isLeft(root)) return Effect.fail(root.left);
  return Effect.gen(function* () {
    const fileSystem = yield* RecordFileSystem;
    if ((yield* fileSystem.pathKind(recordPortablePath(root.right, "record.json"))) === "missing") {
      return null;
    }
    const checked = yield* Effect.either(Effect.scoped(recordHost.current.openRead({ root: root.right })));
    if (Either.isRight(checked)) return null;
    if (!(checked.left instanceof RecordMigrationRequired)) return yield* Effect.fail(checked.left);

    return yield* Effect.scoped(Effect.gen(function* () {
      const session = yield* recordHost.maintenance.open({ root: root.right });
      const plan = yield* session.planMigrate();
      if (plan.state !== "migration-required") {
        return yield* Effect.fail(checked.left);
      }
      if (plan.backup.state !== "git-restore-point") {
        return yield* Effect.fail(new RecordAutoMigrationGitSaveRequired({
          code: "record-auto-migration-git-save-required",
        }));
      }
      const receipt = yield* session.applyMigrate(plan).pipe(
        Effect.catchTag("RecordMigrationGitRestoreRequired", () =>
          Effect.fail(new RecordAutoMigrationGitSaveRequired({
            code: "record-auto-migration-git-save-required",
          }))),
      );
      return Object.freeze({
        restoreCommit: plan.backup.commit,
        attachments: receipt.state === "migrated" ? receipt.attachments : Object.freeze([]),
      });
    }));
  });
}

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
    case "record-migration-recovery-required":
      return "Restore the complete Record from Git before retrying migration.";
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
  return Reflect.get(error, "restoreSafe") === true &&
      typeof restoreCommit === "string" && /^[0-9a-f]{40,64}$/.test(restoreCommit)
    ? recoveryCommands(restoreCommit, recordPath)
    : "";
}

function recordErrorOutput(
  error: unknown,
  stdout = "",
  recordPath?: string,
): RecordCliCommandOutput {
  const code = recordErrorCode(error);
  const automaticRestoreUnsafe =
    (code === "record-migration-interrupted" || code === "record-migration-recovery-required") &&
    (typeof error !== "object" || error === null || Reflect.get(error, "restoreSafe") !== true);
  const next = automaticRestoreUnsafe
    ? "Inspect and preserve concurrent Record edits before choosing a manual recovery; no automatic Git restore command is safe."
    : recordErrorNextStep(code);
  const causeCode = typeof error === "object" && error !== null &&
      typeof Reflect.get(error, "causeCode") === "string"
    ? String(Reflect.get(error, "causeCode"))
    : undefined;
  return output({
    exitCode: 1,
    stdout,
    stderr: `${code}\n${next === undefined ? "" : `${next}\n`}${
      causeCode === undefined ? "" : `Cause: ${causeCode}\n`
    }${
      code === "record-migration-interrupted" || code === "record-migration-recovery-required"
        ? interruptedRecovery(error, recordPath)
        : ""
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
    const impactText = plan.state !== "migration-required"
      ? ""
      : [...new Map(plan.attachments.map((attachment) => {
          const key = `${attachment.family}@${attachment.fromSchemaVersion}->${attachment.toSchemaVersion}`;
          return [key, attachment] as const;
        })).values()].map((attachment) => {
          const retention = attachment.retention;
          const lines = [
            `impact ${attachment.family}@${attachment.fromSchemaVersion}->${attachment.toSchemaVersion}:`,
            `  retained facts: ${retention.retainedFacts.length === 0 ? "none" : retention.retainedFacts.join(", ")}`,
            `  dropped facts: ${retention.droppedFacts.length === 0 ? "none" : retention.droppedFacts.join(", ")}`,
          ];
          if (retention.rerunRecommendation !== null) {
            lines.push(`  rerun recommendation: ${retention.rerunRecommendation}`);
          }
          return lines.join("\n");
        }).join("\n");
    const planText = plan.state === "already-current"
      ? `Record migration plan: already-current\nformat: ${plan.format}\n`
      : plan.state === "unsupported-format"
        ? `Record migration plan: unsupported-format\nformat: ${plan.format}\n`
        : `Record migration plan: migration-required\nformat: ${plan.format}\nattachments: ${plan.attachments.length}\n${impactText === "" ? "" : `${impactText}\n`}backup: ${plan.backup.state}${plan.backup.state === "git-restore-point" ? `\nrestore commit: ${plan.backup.commit}` : ""}\n`;
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
      return recordErrorOutput(migrated.left, planText, input.recordPath);
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
