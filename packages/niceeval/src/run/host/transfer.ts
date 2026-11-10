// @concord-file
// @concord-implements docs/feature/run/cli.md
import { link, mkdtemp, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Effect } from "effect";
import { startExternalRecordImport } from "../../record/sqlite/external-record-import.ts";
import { ProjectStateDatabase } from "../../record/sqlite/project-state-database.ts";
import { SqliteRecordError } from "../../record/sqlite/errors.ts";

function transferFailure(cause: unknown): SqliteRecordError {
  return cause instanceof SqliteRecordError ? cause : new SqliteRecordError(
    "record-sqlite-error", "transfer-runs", cause instanceof Error ? cause.message : "Run transfer failed", { cause },
  );
}

export const importRuns = Effect.fn("run.import")(function*(cwd: string, path: string) {
  return yield* Effect.scoped(Effect.gen(function*() {
    const deadlineEpochMs = Date.now() + 60_000;
    const capture = yield* Effect.acquireRelease(
      Effect.try({ try: () => startExternalRecordImport(resolve(cwd, path), deadlineEpochMs), catch: transferFailure }),
      (handle) => Effect.promise(() => handle.close()),
    );
    const generation = yield* Effect.tryPromise({ try: () => capture.result, catch: transferFailure });
    const service = yield* ProjectStateDatabase;
    const facets = yield* service.bind(resolve(cwd, ".niceeval"));
    return yield* Effect.tryPromise({
      try: () => facets.run.execute<{ imported: readonly string[]; alreadyPresent: readonly string[] }>({
        _tag: "run-import", path: generation.path, deadlineEpochMs,
      }), catch: transferFailure,
    });
  }));
});

export const exportRuns = Effect.fn("run.export")(function*(cwd: string, runIds: readonly string[], out: string) {
  return yield* Effect.scoped(Effect.gen(function*() {
    const path = resolve(cwd, out);
    const root = yield* Effect.acquireRelease(
      Effect.tryPromise({ try: () => mkdtemp(join(dirname(path), ".niceeval-export-")), catch: transferFailure }),
      (temporary) => Effect.promise(() => rm(temporary, { recursive: true, force: true })),
    );
    const service = yield* ProjectStateDatabase;
    const facets = yield* service.bind(resolve(cwd, ".niceeval"));
    const temporaryPath = join(root, "record.sqlite");
    const receipt = yield* Effect.tryPromise({
      try: () => facets.run.execute<{ runIds: readonly string[] }>({
        _tag: "run-export", path: temporaryPath, runIds, deadlineEpochMs: Date.now() + 60_000,
      }), catch: transferFailure,
    });
    // Atomic no-clobber delivery on the destination filesystem, after validation.
    yield* Effect.tryPromise({ try: () => link(temporaryPath, path), catch: transferFailure });
    return receipt;
  }));
});
