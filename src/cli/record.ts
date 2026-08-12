import { resolve } from "node:path";
import { Either, Effect, Layer } from "effect";
import { assertionsAttachmentFamilyV1 } from "../assertions/record/attachment.ts";
import { evaluationsAttachmentFamilyV1 } from "../eval/record/evaluation.ts";
import { scoreAttachmentFamilyV1 } from "../eval/record/score.ts";
import { verdictAttachmentFamilyV1 } from "../eval/record/verdict.ts";
import {
  AttemptPluginProvenanceV1Family,
  RunPluginProvenanceV1Family,
} from "../plugins/record/attachment.ts";
import {
  cleanIncompleteRuns,
  inspectIncompleteRuns,
  makeCurrentRecordMigrationRegistry,
  makeRecordRoot,
  migrateRecord,
  NodeRecordLive,
  planRecordMigration,
  RecordMigrationRegistry,
  type RecordMigrationPlanSummary,
  type RecordRoot,
} from "../record/index.ts";
import { defineRecordAttachmentRegistry } from "../record/attachment/internal.ts";

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

function requireOfficialAttachmentRegistry() {
  const registry = defineRecordAttachmentRegistry({
    families: [
      assertionsAttachmentFamilyV1,
      evaluationsAttachmentFamilyV1,
      verdictAttachmentFamilyV1,
      scoreAttachmentFamilyV1,
      RunPluginProvenanceV1Family,
      AttemptPluginProvenanceV1Family,
    ],
  });
  if (Either.isLeft(registry)) {
    throw new Error(
      `Official Record Attachment registry invariant failed: ${registry.left.code}`,
    );
  }
  return registry.right;
}

/**
 * This is intentionally an application composition edge. Generic Record stays
 * unaware of Assertion, Evaluation, Verdict, Score, and Plugin owners.
 */
export const OfficialRecordAttachmentRegistry = requireOfficialAttachmentRegistry();

export const NodeRecordCliLive = Layer.mergeAll(
  NodeRecordLive,
  Layer.succeed(
    RecordMigrationRegistry,
    makeCurrentRecordMigrationRegistry({
      attachments: OfficialRecordAttachmentRegistry,
    }),
  ),
);

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
    case "attachment-migration-required":
      return "Run: niceeval migrate";
    case "record-migration-interrupted":
      return "Restore the Record from Git or a backup; do not rerun migrate.";
    case "record-format-unsupported":
      return "Install a NiceEval version that supports this Record format.";
    case "record-maintenance-busy":
    case "record-writer-busy":
      return "Close the Record command holding the lock, then retry.";
    case "record-migration-plan-stale":
      return "The Record changed after planning; rerun niceeval migrate.";
    default:
      return undefined;
  }
}

function recordErrorOutput(error: unknown, stdout = ""): RecordCliCommandOutput {
  const code = recordErrorCode(error);
  const next = recordErrorNextStep(code);
  return output({
    exitCode: 1,
    stdout,
    stderr: `${code}\n${next === undefined ? "" : `${next}\n`}`,
  });
}

function renderAttachmentPlanSection(
  plan: RecordMigrationPlanSummary,
  state: RecordMigrationPlanSummary["attachments"][number]["state"],
): readonly string[] {
  const entries = plan.attachments.filter((entry) => entry.state === state);
  if (entries.length === 0) return ["    none"];
  return entries.map((entry) =>
    `    ${entry.owner} ${entry.name} (${entry.schemaId})${
      entry.reason === undefined ? "" : `: ${entry.reason}`
    }`,
  );
}

export function renderRecordMigrationPlan(
  plan: RecordMigrationPlanSummary,
): string {
  const lines = [
    `Record migration plan: ${plan.state}`,
    "Core",
    `  source: ${plan.core.sourceFormat}`,
    `  target: ${plan.core.targetFormat}`,
    `  status: ${plan.core.state}`,
  ];
  if (plan.core.steps.length > 0) {
    lines.push(...plan.core.steps.map((step) => `  ${step.from} -> ${step.to}`));
  }
  lines.push(
    "RecordAttachments",
    "  current:",
    ...renderAttachmentPlanSection(plan, "current"),
    "  migrate:",
    ...renderAttachmentPlanSection(plan, "migrate"),
    "  migration-unavailable:",
    ...renderAttachmentPlanSection(plan, "migration-unavailable"),
    "  unsupported:",
    ...renderAttachmentPlanSection(plan, "unsupported"),
    "Backup",
  );
  switch (plan.backup.state) {
    case "git-restore-point":
      lines.push(`  git restore point: ${plan.backup.commit}`);
      break;
    case "portable-root-dirty":
      lines.push("  no restore point: portable Record has uncommitted changes");
      for (const entry of plan.backup.entries) lines.push(`    ${entry}`);
      break;
    case "not-git-worktree":
      lines.push("  no restore point: Record is not in a Git worktree");
      break;
    case "root-outside-worktree":
      lines.push("  no restore point: Record is outside the Git worktree");
      break;
  }
  return `${lines.join("\n")}\n`;
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
  readonly yes: boolean;
}) {
  return Effect.gen(function* () {
    const plan = yield* planRecordMigration({ root: input.root });
    const planText = renderRecordMigrationPlan(plan.summary);
    const authorization = plan.summary.backup.state === "git-restore-point"
      ? { state: "git-restore-point" as const }
      : input.yes
        ? { state: "accept-data-loss" as const }
        : undefined;

    if (authorization === undefined) {
      return output({
        exitCode: 1,
        stdout: planText,
        stderr:
          "record-migration-confirmation-required\nNo Git restore point is available; rerun with --yes to accept possible data loss.\n",
      });
    }

    const migrated = yield* Effect.either(
      migrateRecord({ plan, authorization }),
    );
    if (Either.isLeft(migrated)) {
      return recordErrorOutput(migrated.left, planText);
    }
    return output({
      exitCode: 0,
      stdout: `${planText}Record migration ${migrated.right.state}.\n`,
    });
  });
}

/**
 * Effect-native command handling for the Record maintenance surface. The
 * legacy CLI owns the one Promise adaptation at its actual process boundary.
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
  return migrateCommand({ root: root.right, yes: input.yes }).pipe(
    Effect.provide(NodeRecordCliLive),
    Effect.catchAll((error) => Effect.succeed(recordErrorOutput(error))),
  );
}
