// @concord-file
// @concord-implements docs/feature/run/library.md
// @concord-implements docs/feature/run/cli.md
// @concord-implements docs/feature/inspection/architecture.md

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DateTime, Effect, Result, Schema } from "effect";

import { RunIdSchema } from "../../record/codec/identifiers.ts";
import type { ProjectStateDatabase } from "../../record/sqlite/project-state-database.ts";
import { acquireProjectRecordReadSession, openHostOwnedRecordReadSession, RECORD_SQLITE_VALIDATION_DEADLINE_MS } from "../../record/sqlite/index.ts";
import { startExternalRecordImport } from "../../record/sqlite/external-record-import.ts";
import { EMPTY_PUBLICATION_CUTOFF_IDENTITY, RunStateSchema, type RunOwnerObservation } from "../protocol.ts";
import {
  publicationCutoffIdentity,
  observeRunWriterTermination,
  type PublicationCutoff,
  type ReadableRunResource,
} from "../storage/index.ts";
import {
  sqliteRunLifecycleAdapter,
  type RunLifecycleAdapter,
} from "./lifecycle-adapter.ts";
import {
  RunDeleteError,
  RunReadError,
  RunRecoverError,
  type RunDeleteReceipt,
  type RunDetail,
  type RunDeleteRequest,
  type RunGetRequest,
  type RunListRequest,
  type RunListResult,
  type RunRecoverReceipt,
  type RunRecoverRequest,
  type RunResult,
  type RunSummary,
} from "./types.ts";

const CONTINUATION_PROTOCOL = "niceeval.run-continuation/v1";
const EMPTY_CUTOFF = Object.freeze({
  identity: EMPTY_PUBLICATION_CUTOFF_IDENTITY,
  revision: 0,
});

function readFailure(
  operation: "list" | "get",
  cause: unknown,
): RunReadError {
  const message = cause instanceof Error
    ? cause.message
    : `Run ${operation} failed.`;
  return new RunReadError({
    operation,
    code: "run-read-failed",
    message,
    cause,
  });
}

function recordStorageRoot(cwd: string): string {
  return resolve(cwd, ".niceeval");
}

function recordDatabaseExists(cwd: string): boolean {
  return existsSync(resolve(recordStorageRoot(cwd), "record.sqlite"));
}

interface RawRunHost {
  readonly list: (request: RunListRequest & { readonly record?: string }) => Effect.Effect<RunListResult, RunReadError, ProjectStateDatabase>;
  readonly get: (request: RunGetRequest) => Effect.Effect<RunResult, RunReadError, ProjectStateDatabase>;
  readonly delete: (request: RunDeleteRequest) => Effect.Effect<RunDeleteReceipt, RunDeleteError, ProjectStateDatabase>;
  readonly recover: (request: RunRecoverRequest) => Effect.Effect<RunRecoverReceipt, RunRecoverError, ProjectStateDatabase>;
}

function publicCutoff(cutoff: PublicationCutoff) {
  return Object.freeze({
    identity: publicationCutoffIdentity(cutoff),
    revision: cutoff.revision,
  });
}

function projectSummary(run: ReadableRunResource, observedAt: string, portable = false): RunSummary {
  let owner: RunOwnerObservation | undefined;
  if (run.state === "active" || run.state === "recovering") {
    const observation = portable ? undefined : observeRunWriterTermination(run.writerGeneration);
    owner = observation === undefined
      ? { state: "unknown", reason: "portable-record", observedAt }
      : observation.state === "unproven"
      ? { state: "unknown", reason: observation.reason, observedAt }
      : { state: observation.state === "active" ? "alive" : "gone", observedAt };
  }
  return Object.freeze({
    runId: run.runId,
    invocationId: run.invocationId,
    experimentId: run.experimentId,
    state: run.state,
    startedAt: run.startedAt,
    ...(run.completedAt === undefined ? {} : { completedAt: run.completedAt }),
    coverage: Object.freeze({
      published: run.published,
      expected: run.expected,
      missing: run.missing,
    }),
    ...(owner === undefined ? {} : { owner: Object.freeze(owner) }),
  });
}

function projectDetail(run: ReadableRunResource, observedAt: string): RunDetail {
  return Object.freeze({
    ...projectSummary(run, observedAt),
    slots: Object.freeze(run.slots.map((slot) => Object.freeze({
      slotId: slot.slotId,
      evalId: slot.evalId,
      attemptOrdinal: slot.attemptOrdinal,
      executionIdentityDigest: slot.executionIdentityDigest,
      publication: slot.publication.state === "published"
        ? Object.freeze({
          state: "published" as const,
          action: slot.publication.action,
          attemptId: slot.publication.attemptId,
          attemptLocator: slot.publication.attemptLocator,
          originRunId: slot.publication.originRunId,
          originSlotId: slot.publication.originSlotId,
        })
        : slot.publication.state === "absent"
        ? Object.freeze({ state: "absent" as const, reason: slot.publication.reason })
        : Object.freeze({ state: "pending" as const }),
    }))),
  });
}

function decodeContinuation(
  token: string,
  invocationId: string | undefined,
): Effect.Effect<{ readonly cutoff: PublicationCutoff; readonly afterRunId: string }, RunReadError> {
  return Effect.try({
    try: () => {
      const value = JSON.parse(Buffer.from(token, "base64url").toString("utf8")) as unknown;
      if (!Array.isArray(value) || value.length !== 5 || value[0] !== CONTINUATION_PROTOCOL ||
        typeof value[1] !== "string" || !Number.isSafeInteger(value[2]) || Number(value[2]) < 0 ||
        typeof value[3] !== "string" || (value[4] !== null && typeof value[4] !== "string") ||
        value[4] !== (invocationId ?? null)) {
        throw new Error("Run continuation binding is invalid.");
      }
      return Object.freeze({
        cutoff: Object.freeze({ storeGeneration: value[1], revision: Number(value[2]) }),
        afterRunId: value[3],
      });
    },
    catch: (cause) => new RunReadError({
      operation: "list",
      code: "run-continuation-invalid",
      message: "Run continuation is invalid or belongs to a different filter.",
      cause,
    }),
  });
}

function decodeRunId(
  value: string,
): Result.Result<Schema.Schema.Type<typeof RunIdSchema>, string> {
  const decoded = Schema.decodeUnknownResult(RunIdSchema)(value);
  return Result.isFailure(decoded)
    ? Result.fail(`Invalid exact Run ID ${JSON.stringify(value)}.`)
    : Result.succeed(decoded.success);
}

function makeRunHost(lifecycle: RunLifecycleAdapter): RawRunHost {
  const list: RawRunHost["list"] = (request) => {
    const invalidFilter = request.states !== undefined &&
      (!Array.isArray(request.states) || request.states.length === 0 || request.states.some((state) => !Schema.is(RunStateSchema)(state))) ||
      request.limit !== undefined && (!Number.isSafeInteger(request.limit) || request.limit < 1);
    if (invalidFilter) return Effect.fail(new RunReadError({ operation: "list", code: "run-filter-invalid", message: "Run states must be a nonempty selection of known states and limit must be a positive safe integer." }));
    if (request.record === undefined && !recordDatabaseExists(request.cwd)) {
      return Effect.succeed(Object.freeze({
        operation: "run.list" as const,
        publicationCutoff: EMPTY_CUTOFF,
        runs: Object.freeze([]),
        omitted: 0,
      }));
    }
    return Effect.gen(function* () {
        const continuation = request.continuation === undefined
          ? undefined
          : yield* decodeContinuation(request.continuation, request.invocationId);
        const importer = request.record === undefined ? undefined : yield* Effect.acquireRelease(
          Effect.try({ try: () => startExternalRecordImport(resolve(request.cwd, request.record!), Date.now() + RECORD_SQLITE_VALIDATION_DEADLINE_MS), catch: (cause) => cause }),
          (handle) => Effect.promise(() => handle.close()),
        );
        const generation = importer === undefined ? undefined : yield* Effect.tryPromise({ try: (_signal) => importer.result, catch: (cause) => cause });
        const session = generation === undefined
          ? yield* acquireProjectRecordReadSession(recordStorageRoot(request.cwd))
          : yield* Effect.acquireRelease(Effect.try({ try: () => openHostOwnedRecordReadSession(generation.path), catch: (cause) => cause }), (opened) => Effect.sync(() => opened.close()));
        const runs: ReadableRunResource[] = [];
        let afterRunId = continuation?.afterRunId;
        const cutoff = continuation?.cutoff ?? session.publicationCutoff();
        do {
          const page = yield* Effect.try({ try: () => session.listRunResources({
            cutoff,
            ...(afterRunId === undefined ? {} : { afterRunId }),
            ...(request.invocationId === undefined ? {} : { invocationId: request.invocationId }),
          }), catch: (cause) => cause });
          runs.push(...page.runs);
          afterRunId = page.nextAfterRunId ?? undefined;
        } while (afterRunId !== undefined);
        const matching = runs.filter((run) =>
          (request.states === undefined || request.states.includes(run.state)) &&
          (request.experimentIdPrefix === undefined || run.experimentId === request.experimentIdPrefix || run.experimentId.startsWith(`${request.experimentIdPrefix}/`))
        ).sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt) || (a.runId < b.runId ? -1 : a.runId > b.runId ? 1 : 0));
        const selected = request.limit === undefined ? matching : matching.slice(0, request.limit);
        const observedAt = DateTime.formatIso(yield* DateTime.now);
        return Object.freeze({
          operation: "run.list" as const,
          publicationCutoff: publicCutoff(cutoff),
          runs: Object.freeze(selected.map((run) => projectSummary(run, observedAt, request.record !== undefined))),
          omitted: matching.length - selected.length,
        });
    }).pipe(Effect.scoped, Effect.mapError((cause) => cause instanceof RunReadError ? cause : readFailure("list", cause)));
  };

  const get: RawRunHost["get"] = (request) => {
    const runId = decodeRunId(request.runId);
    if (Result.isFailure(runId)) {
      return Effect.fail(new RunReadError({
        operation: "get",
        code: "run-id-invalid",
        message: runId.failure,
      }));
    }
    if (!recordDatabaseExists(request.cwd)) {
      return Effect.fail(new RunReadError({
        operation: "get",
        code: "run-not-found",
        message: `Run ${runId.success} was not found.`,
      }));
    }
    return Effect.gen(function* () {
        const root = recordStorageRoot(request.cwd);
        const session = yield* acquireProjectRecordReadSession(root);
        const cutoff = yield* Effect.try({ try: () => session.publicationCutoff(), catch: (cause) => cause });
        const run = yield* Effect.try({ try: () => session.readRunResource(runId.success), catch: (cause) => cause });
        if (run === undefined) {
          return yield* Effect.fail(new RunReadError({
            operation: "get",
            code: "run-not-found",
            message: `Run ${runId.success} was not found.`,
          }));
        }
        return Object.freeze({
          operation: "run.get" as const,
          publicationCutoff: publicCutoff(cutoff),
          run: projectDetail(run, DateTime.formatIso(yield* DateTime.now)),
        });
    }).pipe(Effect.scoped, Effect.mapError((cause) => cause instanceof RunReadError ? cause : readFailure("get", cause)));
  };

  const deleteRun: RawRunHost["delete"] = (request) => {
    const runId = decodeRunId(request.runId);
    return Result.isFailure(runId)
      ? Effect.fail(new RunDeleteError({
        operation: "delete",
        code: "run-id-invalid",
        message: runId.failure,
      }))
      : lifecycle.delete({ cwd: request.cwd, runId: runId.success });
  };

  const recover: RawRunHost["recover"] = (request) => {
    const runId = decodeRunId(request.runId);
    return Result.isFailure(runId)
      ? Effect.fail(new RunRecoverError({
        operation: "recover",
        code: "run-id-invalid",
        message: runId.failure,
      }))
      : lifecycle.recover({ cwd: request.cwd, runId: runId.success });
  };

  return Object.freeze({ list, get, delete: deleteRun, recover });
}

export const rawRunHost: RawRunHost = makeRunHost(sqliteRunLifecycleAdapter);
