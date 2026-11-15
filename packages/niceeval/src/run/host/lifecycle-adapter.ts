import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DateTime, Effect } from "effect";
import type { ProjectStateDatabase } from "../../record/sqlite/project-state-database.ts";
import type { RunStorageCommandError } from "../storage/sqlite.ts";

import {
  currentPublicationCutoff,
  deleteRunResource,
  observeRunWriterTermination,
  createRunWriterGeneration,
  readRunResource,
  recoverRunResource,
} from "../storage/index.ts";

import type { RunDeleteReceipt, RunRecoverReceipt } from "./types.ts";
import { RunDeleteError, RunRecoverError } from "./types.ts";

/**
 * Narrow wiring seam for the Run-owned SQLite adapter. The current Record
 * runtime cannot yet delete terminal Runs or fence and recover an active
 * writer, so the public Host fails closed instead of rebranding `clean`.
 */
export interface RunLifecycleAdapter {
  readonly delete: (request: {
    readonly cwd: string;
    readonly runId: string;
  }) => Effect.Effect<RunDeleteReceipt, RunDeleteError, ProjectStateDatabase>;
  readonly recover: (request: {
    readonly cwd: string;
    readonly runId: string;
  }) => Effect.Effect<RunRecoverReceipt, RunRecoverError, ProjectStateDatabase>;
}

function storageRoot(cwd: string): string {
  return resolve(cwd, ".niceeval");
}

function databaseExists(root: string): boolean {
  return existsSync(resolve(root, "record.sqlite"));
}

function deleteFailure(runId: string, cause: RunDeleteError | RunStorageCommandError): RunDeleteError {
  switch (cause._tag) {
    case "RunDeleteError":
      return cause;
    case "RunStorageError": {
      const reason = cause.reason;
      switch (reason._tag) {
        case "run-not-found":
          return new RunDeleteError({
            operation: "delete",
            code: "run-not-found",
            message: `Run ${runId} was not found.`,
            cause,
          });
        case "run-delete-reference-conflict": {
          const dependencies = cause.dependencies
            .map(
              (dependency) =>
                `${dependency.dependentRunId}/${dependency.dependentSlotId} -> ${dependency.attemptLocator}`,
            )
            .join(", ");
          return new RunDeleteError({
            operation: "delete",
            code: "run-referenced",
            message: `Run ${runId} is referenced by ${cause.dependencies.length} published Attempt binding(s): ${dependencies}.`,
            cause,
          });
        }
        case "run-id-collision":
        case "run-not-active":
        case "writer-generation-mismatch":
        case "slot-not-found":
        case "slot-already-bound":
        case "attempt-already-published":
        case "attempt-not-published":
        case "source-run-deleted":
        case "absence-coverage-invalid":
        case "run-state-mismatch":
        case "recovery-evidence-required":
        case "publication-cutoff-restart-required":
        case "run-storage-invalid":
          break;
        default:
          return reason satisfies never;
      }
      break;
    }
    case "SqliteRecordError":
    case "Error":
    case "Object":
    case "ThrownValue":
      break;
    default:
      return cause satisfies never;
  }
  return new RunDeleteError({
    operation: "delete",
    code: "run-delete-failed",
    message:
      cause._tag === "Object" || cause._tag === "ThrownValue" ? `Run ${runId} could not be deleted.` : cause.message,
    cause,
  });
}

function recoverFailure(runId: string, cause: RunRecoverError | RunStorageCommandError): RunRecoverError {
  switch (cause._tag) {
    case "RunRecoverError":
      return cause;
    case "RunStorageError": {
      const reason = cause.reason;
      switch (reason._tag) {
        case "run-not-found":
          return new RunRecoverError({
            operation: "recover",
            code: "run-not-found",
            message: `Run ${runId} was not found.`,
            cause,
          });
        case "run-not-active":
        case "writer-generation-mismatch":
          return new RunRecoverError({
            operation: "recover",
            code: "run-recover-failed",
            message: `Run ${runId} changed before recovery could fence its writer.`,
            cause,
          });
        case "run-id-collision":
        case "slot-not-found":
        case "slot-already-bound":
        case "attempt-already-published":
        case "attempt-not-published":
        case "source-run-deleted":
        case "absence-coverage-invalid":
        case "run-state-mismatch":
        case "run-delete-reference-conflict":
        case "recovery-evidence-required":
        case "publication-cutoff-restart-required":
        case "run-storage-invalid":
          break;
        default:
          return reason satisfies never;
      }
      break;
    }
    case "SqliteRecordError":
    case "Error":
    case "Object":
    case "ThrownValue":
      break;
    default:
      return cause satisfies never;
  }
  return new RunRecoverError({
    operation: "recover",
    code: "run-recover-failed",
    message:
      cause._tag === "Object" || cause._tag === "ThrownValue" ? `Run ${runId} could not be recovered.` : cause.message,
    cause,
  });
}

export const sqliteRunLifecycleAdapter: RunLifecycleAdapter = Object.freeze({
  delete: ({ cwd, runId }: { readonly cwd: string; readonly runId: string }) => {
    const root = storageRoot(cwd);
    if (!databaseExists(root)) {
      return Effect.fail(
        new RunDeleteError({
          operation: "delete",
          code: "run-not-found",
          message: `Run ${runId} was not found.`,
          cause: undefined,
        }),
      );
    }
    return Effect.flatMap(DateTime.now, (now) =>
      Effect.gen(function* () {
        const cutoff = yield* currentPublicationCutoff(root);
        const run = yield* readRunResource(root, runId, cutoff);
        if (run === undefined) {
          return yield* Effect.fail(
            new RunDeleteError({
              operation: "delete",
              code: "run-not-found",
              message: `Run ${runId} was not found.`,
              cause: undefined,
            }),
          );
        }
        if (run.state === "active" || run.state === "recovering") {
          return yield* Effect.fail(
            new RunDeleteError({
              operation: "delete",
              code: "run-active",
              message: `Run ${runId} is active and cannot be deleted.`,
              cause: undefined,
            }),
          );
        }
        yield* deleteRunResource(root, {
          runId,
          expectedState: run.state,
          deletedAt: DateTime.formatIso(now),
          deadlineEpochMs: DateTime.toEpochMillis(now) + 30_000,
        });
        return { runId, state: "deleted" as const };
      }).pipe(Effect.mapError((cause) => deleteFailure(runId, cause))),
    );
  },
  recover: ({ cwd, runId }: { readonly cwd: string; readonly runId: string }) => {
    const root = storageRoot(cwd);
    if (!databaseExists(root)) {
      return Effect.fail(
        new RunRecoverError({
          operation: "recover",
          code: "run-not-found",
          message: `Run ${runId} was not found.`,
          cause: undefined,
        }),
      );
    }
    return Effect.flatMap(DateTime.now, (now) =>
      Effect.gen(function* () {
        const cutoff = yield* currentPublicationCutoff(root);
        const run = yield* readRunResource(root, runId, cutoff);
        if (run === undefined) {
          return yield* Effect.fail(
            new RunRecoverError({
              operation: "recover",
              code: "run-not-found",
              message: `Run ${runId} was not found.`,
              cause: undefined,
            }),
          );
        }
        if (run.state !== "active" && run.state !== "recovering") {
          return yield* Effect.fail(
            new RunRecoverError({
              operation: "recover",
              code: "run-terminal",
              message: `Run ${runId} is already ${run.state}.`,
              cause: undefined,
            }),
          );
        }
        const observation = observeRunWriterTermination(run.writerGeneration);
        if (observation.state === "active") {
          return yield* Effect.fail(
            new RunRecoverError({
              operation: "recover",
              code: "run-owner-active",
              message: `Run ${runId} still has a live writer; recovery is refused.`,
              cause: undefined,
            }),
          );
        }
        if (observation.state === "unproven") {
          return yield* Effect.fail(
            new RunRecoverError({
              operation: "recover",
              code: "run-owner-termination-unproven",
              message: `Run ${runId} recovery requires verified owner-termination evidence.`,
              cause: undefined,
            }),
          );
        }
        yield* recoverRunResource(root, {
          runId,
          expectedWriterGeneration: run.writerGeneration,
          recoveryWriterGeneration: createRunWriterGeneration(`recovery-v1:${randomUUID()}`),
          completedAt: DateTime.formatIso(now),
          evidence: {
            kind: observation.evidenceKind,
            identity: observation.evidenceIdentity,
            observedAt: DateTime.formatIso(now),
          },
          deadlineEpochMs: DateTime.toEpochMillis(now) + 30_000,
        });
        return { runId, state: "interrupted" as const };
      }).pipe(Effect.mapError((cause) => recoverFailure(runId, cause))),
    );
  },
});

export const unavailableRunLifecycleAdapter: RunLifecycleAdapter = Object.freeze({
  delete: ({ runId }: { readonly cwd: string; readonly runId: string }) =>
    Effect.fail(
      new RunDeleteError({
        operation: "delete",
        code: "run-lifecycle-adapter-unavailable",
        message: `Run ${runId} cannot be deleted because the Run lifecycle adapter is not installed.`,
        cause: undefined,
      }),
    ),
  recover: ({ runId }: { readonly cwd: string; readonly runId: string }) =>
    Effect.fail(
      new RunRecoverError({
        operation: "recover",
        code: "run-lifecycle-adapter-unavailable",
        message: `Run ${runId} cannot be recovered because the Run lifecycle adapter is not installed.`,
        cause: undefined,
      }),
    ),
});
