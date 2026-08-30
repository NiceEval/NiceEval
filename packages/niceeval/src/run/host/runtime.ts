import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Effect, Result, Schema } from "effect";

import { RunIdSchema } from "../../record/codec/identifiers.ts";
import { EMPTY_PUBLICATION_CUTOFF_IDENTITY } from "../protocol.ts";
import {
  currentPublicationCutoff,
  listRunResources,
  readRunResource,
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
  type RunDetail,
  type RunHost,
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

function publicCutoff(cutoff: PublicationCutoff) {
  return Object.freeze({
    identity: createHash("sha256")
      .update("niceeval.run-publication-cutoff/v1\0")
      .update(cutoff.storeGeneration)
      .update("\0")
      .update(String(cutoff.revision))
      .digest("hex"),
    revision: cutoff.revision,
  });
}

function projectSummary(run: ReadableRunResource): RunSummary {
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
  });
}

function projectDetail(run: ReadableRunResource): RunDetail {
  return Object.freeze({
    ...projectSummary(run),
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

function encodeContinuation(
  cutoff: PublicationCutoff,
  afterRunId: string,
  invocationId: string | undefined,
): string {
  return Buffer.from(JSON.stringify([
    CONTINUATION_PROTOCOL,
    cutoff.storeGeneration,
    cutoff.revision,
    afterRunId,
    invocationId ?? null,
  ]), "utf8").toString("base64url");
}

function decodeContinuation(
  token: string,
  invocationId: string | undefined,
): { readonly cutoff: PublicationCutoff; readonly afterRunId: string } {
  try {
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
  } catch (cause) {
    throw new RunReadError({
      operation: "list",
      code: "run-continuation-invalid",
      message: "Run continuation is invalid or belongs to a different filter.",
      cause,
    });
  }
}

function decodeRunId(
  value: string,
): Result.Result<Schema.Schema.Type<typeof RunIdSchema>, string> {
  const decoded = Schema.decodeUnknownResult(RunIdSchema)(value);
  return Result.isFailure(decoded)
    ? Result.fail(`Invalid exact Run ID ${JSON.stringify(value)}.`)
    : Result.succeed(decoded.success);
}

function makeRunHost(lifecycle: RunLifecycleAdapter): RunHost {
  const list: RunHost["list"] = (request) => {
    if (!recordDatabaseExists(request.cwd)) {
      return Effect.succeed(Object.freeze({
        operation: "run.list" as const,
        publicationCutoff: EMPTY_CUTOFF,
        runs: Object.freeze([]),
      }));
    }
    return Effect.try({
      try: () => {
        const continuation = request.continuation === undefined
          ? undefined
          : decodeContinuation(request.continuation, request.invocationId);
        const page = listRunResources(recordStorageRoot(request.cwd), {
          ...(continuation === undefined ? {} : {
            cutoff: continuation.cutoff,
            afterRunId: continuation.afterRunId,
          }),
          ...(request.invocationId === undefined ? {} : { invocationId: request.invocationId }),
        });
        return Object.freeze({
          operation: "run.list" as const,
          publicationCutoff: publicCutoff(page.cutoff),
          runs: Object.freeze(page.runs.map(projectSummary)),
          ...(page.nextAfterRunId === null ? {} : {
            continuation: encodeContinuation(page.cutoff, page.nextAfterRunId, request.invocationId),
          }),
        });
      },
      catch: (cause) => cause instanceof RunReadError ? cause : readFailure("list", cause),
    });
  };

  const get: RunHost["get"] = (request) => {
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
    return Effect.try({
      try: () => {
        const root = recordStorageRoot(request.cwd);
        const cutoff = currentPublicationCutoff(root);
        const run = readRunResource(root, runId.success, cutoff);
        if (run === undefined) {
          throw new RunReadError({
            operation: "get",
            code: "run-not-found",
            message: `Run ${runId.success} was not found.`,
          });
        }
        return Object.freeze({
          operation: "run.get" as const,
          publicationCutoff: publicCutoff(cutoff),
          run: projectDetail(run),
        });
      },
      catch: (cause) => cause instanceof RunReadError ? cause : readFailure("get", cause),
    });
  };

  const deleteRun: RunHost["delete"] = (request) => {
    const runId = decodeRunId(request.runId);
    return Result.isFailure(runId)
      ? Effect.fail(new RunDeleteError({
        operation: "delete",
        code: "run-id-invalid",
        message: runId.failure,
      }))
      : lifecycle.delete({ cwd: request.cwd, runId: runId.success });
  };

  const recover: RunHost["recover"] = (request) => {
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

export const runHost: RunHost = makeRunHost(sqliteRunLifecycleAdapter);
