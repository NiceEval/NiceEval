import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Exit, Result } from "effect";
import { coordinationHost } from "niceeval/coordination/host";
import { expect, test } from "vitest";
import {
  type CaseCoordinationFacet,
  ProjectStateDatabase,
  ProjectStateDatabaseLive,
} from "../../packages/niceeval/src/record/sqlite/project-state-database.ts";
import type { CaseCoordinationCommand, StorageWorkerResult } from "../../packages/niceeval/src/record/sqlite/worker-protocol.ts";

function interposeCaseCommand(
  wrap: (facet: CaseCoordinationFacet) => CaseCoordinationFacet,
) {
  return Effect.updateService(ProjectStateDatabase, (database) => ({
    ...database,
    bind: (path) =>
      database.bind(path).pipe(Effect.map((facets) => ({ ...facets, caseCoordination: wrap(facets.caseCoordination) }))),
  }));
}

// @feature docs/feature/experiments/README.md#concurrency-and-queues
test("a live Host can claim the case again after an acquire commit reply is lost", async () => {
  const root = await mkdtemp(join(tmpdir(), "niceeval-claim-delivery-"));
  const request = { projectDatabaseRoot: root, experimentId: "exp", evalId: "eval" };
  let drop = true;
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const first = yield* Effect.result(coordinationHost.claimExecution(request));
        if (Result.isSuccess(first)) yield* first.success.release;

        const stop = new AbortController();
        const next = yield* Effect.result(coordinationHost.claimExecution({
          ...request,
          signal: stop.signal,
          onCaseWait: () => stop.abort(),
        }));
        expect(next._tag).toBe("Success");
        if (Result.isSuccess(next)) yield* next.success.release;
      }).pipe(
        interposeCaseCommand((facet) => ({
          async execute<A extends StorageWorkerResult>(command: CaseCoordinationCommand) {
            const result = await facet.execute<A>(command);
            if (command._tag === "case-acquire" && drop) {
              drop = false;
              throw new Error("acquire reply was lost after commit");
            }
            return result;
          },
        })),
        Effect.provide(ProjectStateDatabaseLive),
      ),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// @feature docs/feature/experiments/README.md#concurrency-and-queues
test("interrupting after the acquire commit leaves the case available", async () => {
  const root = await mkdtemp(join(tmpdir(), "niceeval-claim-interrupt-"));
  const request = { projectDatabaseRoot: root, experimentId: "exp", evalId: "eval" };
  const stop = new AbortController();
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const context = yield* Effect.context<ProjectStateDatabase>();
        const interrupted = yield* Effect.promise(() =>
          Effect.runPromiseExit(
            coordinationHost.claimExecution(request).pipe(
              interposeCaseCommand((facet) => ({
                async execute<A extends StorageWorkerResult>(command: CaseCoordinationCommand) {
                  const result = await facet.execute<A>(command);
                  if (command._tag === "case-acquire") stop.abort();
                  return result;
                },
              })),
              Effect.provideContext(context),
            ),
            { signal: stop.signal },
          ),
        );
        expect(Exit.hasInterrupts(interrupted)).toBe(true);
        const waiter = new AbortController();
        const claim = yield* coordinationHost.claimExecution({
          ...request,
          signal: waiter.signal,
          onCaseWait: () => waiter.abort(),
        });
        yield* claim.release;
      }).pipe(Effect.provide(ProjectStateDatabaseLive)),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// @feature docs/feature/experiments/README.md#concurrency-and-queues
test("a concurrent release between the acquire conflict and holder read lets the waiter continue", async () => {
  const root = await mkdtemp(join(tmpdir(), "niceeval-claim-no-holder-"));
  const request = { projectDatabaseRoot: root, experimentId: "exp", evalId: "eval" };
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const holder = yield* coordinationHost.claimExecution(request);
        let released = false;
        const waiter = yield* coordinationHost.claimExecution(request).pipe(
          interposeCaseCommand((facet) => ({
            async execute<A extends StorageWorkerResult>(command: CaseCoordinationCommand) {
              if (command._tag === "case-read" && !released) {
                released = true;
                await Effect.runPromise(holder.release);
              }
              return facet.execute<A>(command);
            },
          })),
        );
        expect(waiter.caseTakenOver).toBe(false);
        yield* waiter.release;
      }).pipe(Effect.provide(ProjectStateDatabaseLive)),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
