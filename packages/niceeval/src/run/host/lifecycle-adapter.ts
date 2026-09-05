import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DateTime, Effect } from "effect";
import type { ProjectStateDatabase } from "../../record/sqlite/project-state-database.ts";
import { SqliteRecordError } from "../../record/sqlite/errors.ts";

import {
  currentPublicationCutoff,
  deleteRunResource,
  observeRunWriterTermination,
  readRunResource,
  recoverRunResource,
  RunStorageError,
} from "../storage/index.ts";

import type {
  RunDeleteReceipt,
  RunRecoverReceipt,
} from "./types.ts";
import {
  RunDeleteError,
  RunRecoverError,
} from "./types.ts";

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

function deleteFailure(runId: string, cause: unknown): RunDeleteError {
  if (cause instanceof RunDeleteError) return cause;
  if (cause instanceof SqliteRecordError && cause.cause instanceof Error && cause.cause.name === "run-delete-reference-conflict") {
    const details = Reflect.get(cause.cause, "details");
    if (Array.isArray(details)) {
      const dependencies = details as RunStorageError["dependencies"];
      return new RunDeleteError({
        operation: "delete",
        code: "run-referenced",
        message: `Run ${runId} is referenced by ${dependencies.length} published Attempt binding(s): ${dependencies.map((dependency) =>
          `${dependency.dependentRunId}/${dependency.dependentSlotId} -> ${dependency.attemptLocator}`).join(", ")}.`,
        cause,
      });
    }
  }
  if (cause instanceof RunStorageError) {
    if (cause.code === "run-not-found") {
      return new RunDeleteError({
        operation: "delete",
        code: "run-not-found",
        message: `Run ${runId} was not found.`,
        cause,
      });
    }
    if (cause.code === "run-delete-reference-conflict") {
      const dependencies = cause.dependencies.map((dependency) =>
        `${dependency.dependentRunId}/${dependency.dependentSlotId} -> ${dependency.attemptLocator}`,
      ).join(", ");
      return new RunDeleteError({
        operation: "delete",
        code: "run-referenced",
        message: `Run ${runId} is referenced by ${cause.dependencies.length} published Attempt binding(s): ${dependencies}.`,
        cause,
      });
    }
  }
  return new RunDeleteError({
    operation: "delete",
    code: "run-delete-failed",
    message: cause instanceof Error ? cause.message : `Run ${runId} could not be deleted.`,
    cause,
  });
}

function recoverFailure(runId: string, cause: unknown): RunRecoverError {
  if (cause instanceof RunRecoverError) return cause;
  if (cause instanceof RunStorageError) {
    if (cause.code === "run-not-found") {
      return new RunRecoverError({
        operation: "recover",
        code: "run-not-found",
        message: `Run ${runId} was not found.`,
        cause,
      });
    }
    if (cause.code === "run-not-active" || cause.code === "writer-generation-mismatch") {
      return new RunRecoverError({
        operation: "recover",
        code: "run-recover-failed",
        message: `Run ${runId} changed before recovery could fence its writer.`,
        cause,
      });
    }
  }
  return new RunRecoverError({
    operation: "recover",
    code: "run-recover-failed",
    message: cause instanceof Error ? cause.message : `Run ${runId} could not be recovered.`,
    cause,
  });
}

export const sqliteRunLifecycleAdapter: RunLifecycleAdapter = Object.freeze({
  delete: ({ cwd, runId }: { readonly cwd: string; readonly runId: string }) => {
    const root = storageRoot(cwd);
    if (!databaseExists(root)) {
      return Effect.fail(new RunDeleteError({
        operation: "delete",
        code: "run-not-found",
        message: `Run ${runId} was not found.`,
      }));
    }
    return Effect.flatMap(DateTime.now, (now) => Effect.gen(function* () {
        const cutoff = yield* currentPublicationCutoff(root);
        const run = yield* readRunResource(root, runId, cutoff);
        if (run === undefined) {
          return yield* Effect.fail(new RunDeleteError({
            operation: "delete",
            code: "run-not-found",
            message: `Run ${runId} was not found.`,
          }));
        }
        if (run.state === "active") {
          return yield* Effect.fail(new RunDeleteError({
            operation: "delete",
            code: "run-active",
            message: `Run ${runId} is active and cannot be deleted.`,
          }));
        }
        yield* deleteRunResource(root, {
          runId,
          expectedState: run.state,
          deletedAt: DateTime.formatIso(now),
          deadlineEpochMs: DateTime.toEpochMillis(now) + 30_000,
        });
        return Object.freeze({ runId, state: "deleted" as const });
    }).pipe(Effect.mapError((cause) => deleteFailure(runId, cause))));
  },
  recover: ({ cwd, runId }: { readonly cwd: string; readonly runId: string }) => {
    const root = storageRoot(cwd);
    if (!databaseExists(root)) {
      return Effect.fail(new RunRecoverError({
        operation: "recover",
        code: "run-not-found",
        message: `Run ${runId} was not found.`,
      }));
    }
    return Effect.flatMap(DateTime.now, (now) => Effect.gen(function* () {
        const cutoff = yield* currentPublicationCutoff(root);
        const run = yield* readRunResource(root, runId, cutoff);
        if (run === undefined) {
          return yield* Effect.fail(new RunRecoverError({
            operation: "recover",
            code: "run-not-found",
            message: `Run ${runId} was not found.`,
          }));
        }
        if (run.state !== "active") {
          return yield* Effect.fail(new RunRecoverError({
            operation: "recover",
            code: "run-terminal",
            message: `Run ${runId} is already ${run.state}.`,
          }));
        }
        const observation = observeRunWriterTermination(run.writerGeneration);
        if (observation.state === "active") {
          return yield* Effect.fail(new RunRecoverError({
            operation: "recover",
            code: "run-owner-active",
            message: `Run ${runId} still has a live writer; recovery is refused.`,
          }));
        }
        if (observation.state === "unproven") {
          return yield* Effect.fail(new RunRecoverError({
            operation: "recover",
            code: "run-owner-termination-unproven",
            message: `Run ${runId} recovery requires verified owner-termination evidence.`,
          }));
        }
        yield* recoverRunResource(root, {
          runId,
          expectedWriterGeneration: run.writerGeneration,
          recoveryWriterGeneration: `recovery-v1:${randomUUID()}`,
          completedAt: DateTime.formatIso(now),
          evidence: {
            kind: "local-linux-process-terminated-v1",
            identity: observation.evidenceIdentity,
            observedAt: DateTime.formatIso(now),
          },
          deadlineEpochMs: DateTime.toEpochMillis(now) + 30_000,
        });
        return Object.freeze({ runId, state: "interrupted" as const });
    }).pipe(Effect.mapError((cause) => recoverFailure(runId, cause))));
  },
});

export const unavailableRunLifecycleAdapter: RunLifecycleAdapter = Object.freeze({
  delete: ({ runId }: { readonly cwd: string; readonly runId: string }) => Effect.fail(new RunDeleteError({
    operation: "delete",
    code: "run-lifecycle-adapter-unavailable",
    message: `Run ${runId} cannot be deleted because the Run lifecycle adapter is not installed.`,
  })),
  recover: ({ runId }: { readonly cwd: string; readonly runId: string }) => Effect.fail(new RunRecoverError({
    operation: "recover",
    code: "run-lifecycle-adapter-unavailable",
    message: `Run ${runId} cannot be recovered because the Run lifecycle adapter is not installed.`,
  })),
});
