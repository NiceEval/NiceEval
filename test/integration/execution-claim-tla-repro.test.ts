import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Result } from "effect";
import { coordinationHost } from "niceeval/coordination/host";
import { expect, test, vi } from "vitest";
import type { CaseCoordinationCommand, StorageWorkerResult } from "../../packages/niceeval/src/record/sqlite/worker-protocol.ts";
import { ProjectStateDatabase, ProjectStateDatabaseLive } from "../../packages/niceeval/src/record/sqlite/project-state-database.ts";

// @feature docs/feature/experiments/README.md#concurrency-and-queues
test("a release that misses its write deadline can be retried on the same claim", async () => {
  const root = await mkdtemp(join(tmpdir(), "niceeval-claim-retry-"));
  try {
    const request = { projectDatabaseRoot: root, experimentId: "exp", evalId: "eval" };
    await Effect.runPromise(Effect.gen(function* () {
      const claim = yield* coordinationHost.claimExecution(request);
      // Expire just the first request at the real SQLite worker.
      const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() - 60_000);
      const first = yield* Effect.result(claim.release).pipe(Effect.ensuring(Effect.sync(() => clock.mockRestore())));
      expect(Result.isFailure(first)).toBe(true);
      yield* claim.release;
      const stop = new AbortController();
      const next = yield* Effect.result(coordinationHost.claimExecution({
        ...request,
        signal: stop.signal,
        onCaseWait: () => stop.abort(),
      }));
      expect(next._tag).toBe("Success");
      if (Result.isSuccess(next)) yield* next.success.release;
    }).pipe(Effect.provide(ProjectStateDatabaseLive)));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// @feature docs/feature/experiments/README.md#concurrency-and-queues
test.for([false, true])("release retries after a lost commit reply (successor already present: %s)", async (replaced) => {
  const root = await mkdtemp(join(tmpdir(), "niceeval-claim-reply-"));
  try {
    const request = { projectDatabaseRoot: root, experimentId: "exp", evalId: "eval" };
    let drop = true;
    await Effect.runPromise(Effect.gen(function* () {
      const claim = yield* coordinationHost.claimExecution(request);
      expect((yield* Effect.result(claim.release))._tag).toBe("Failure");
      const early = replaced ? yield* coordinationHost.claimExecution(request) : undefined;
      yield* claim.release;
      const replacement = early ?? (yield* coordinationHost.claimExecution(request));
      const stop = new AbortController();
      const third = yield* Effect.result(coordinationHost.claimExecution({
        ...request, signal: stop.signal, onCaseWait: () => stop.abort(),
      }));
      expect(third._tag).toBe("Failure");
      yield* replacement.release;
    }).pipe(
      Effect.updateService(ProjectStateDatabase, (database) => ({
        ...database,
        bind: (path) => database.bind(path).pipe(Effect.map((facets) => ({
          ...facets,
          caseCoordination: {
            async execute<A extends StorageWorkerResult>(command: CaseCoordinationCommand) {
              const result = await facets.caseCoordination.execute<A>(command);
              if (command._tag === "case-release" && drop) {
                drop = false;
                throw new Error("release reply was lost");
              }
              return result;
            },
          },
        }))),
      })),
      Effect.provide(ProjectStateDatabaseLive),
    ));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
