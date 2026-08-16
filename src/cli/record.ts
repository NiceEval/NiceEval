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
      return "Restore the Record from Git; do not rerun migrate on mixed bytes.";
    case "record-format-unsupported":
      return "Install a NiceEval version that supports this Record format.";
    case "record-maintenance-busy":
    case "record-writer-busy":
      return "Close the Record command holding the lock, then retry.";
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
  return Effect.scoped(Effect.gen(function* () {
    const session = yield* recordHost.maintenance.open({ root: input.root });
    const plan = yield* session.planMigrate();
    const planText = plan.state === "already-current"
      ? `Record migration plan: already-current\nformat: ${plan.format}\n`
      : `Record migration plan: unsupported-format\nformat: ${plan.format}\n`;
    if (plan.state !== "already-current") {
      return output({
        exitCode: 1,
        stdout: planText,
        stderr: "record-format-unsupported\nInstall a NiceEval version that supports this Record format.\n",
      });
    }
    const receipt = yield* session.applyMigrate(plan);
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
  return migrateCommand({ root: root.right, yes: input.yes }).pipe(
    Effect.provide(NodeRecordCliLive),
    Effect.catchAll((error) => Effect.succeed(recordErrorOutput(error))),
  );
}
