import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Cause, Deferred, Effect, Exit, Fiber } from "effect";
import { TestClock } from "effect/testing";
import fc from "fast-check";
import { expect, test, vi } from "vitest";
import type { BeforeCacheStep } from "../../packages/niceeval/src/sandbox/backend.ts";
import type { MaterializedSandboxCase } from "../../packages/niceeval/src/sandbox/case-types.ts";
import {
  BeforeCacheSnapshotError,
  type BeforeCacheSnapshotDriver,
} from "../../packages/niceeval/src/sandbox/remote-snapshot/driver.ts";
import { remoteSnapshotPreparer } from "../../packages/niceeval/src/sandbox/remote-snapshot/preparer.ts";
import type { SandboxRuntimeMaterializeContext } from "../../packages/niceeval/src/sandbox/runtime.ts";

type SnapshotOperations = Omit<
  BeforeCacheSnapshotDriver<void>,
  "resolveBase" | "preserves" | "sourceUsableAfterSnapshot" | "snapshotSettleMs"
>;

const settleMs = 32;
const snapshotId = "snapshot-fixture";
const step: BeforeCacheStep = {
  operationId: "before-prepare",
  declaration: {
    baseIdentity: "fixture-base",
    beforeCacheKey: "fixture-key",
    declarationDigest: "fixture-declaration",
    requiredState: "all",
    cacheFormat: "fixture-cache",
    changeFrequency: 1,
    declarationMetadata: {},
  },
  positions: ["prepare"],
  declaringOwner: "experiment:fixture",
  knownSensitiveValues: [],
};

// The fixture driver consumes no runtime metadata and only implements the Provider commands used by preparation.
const materialize = {} as SandboxRuntimeMaterializeContext;
const sandbox = {
  group: { primary: { sandboxId: "fixture-sandbox" } },
  authorBackend: {
    runCommand: (command: string, args: readonly string[]) => {
      if (command === "cat" && args[0] === "/proc/self/mountinfo")
        return Promise.resolve({ stdout: "1 0 0:1 / / rw - tmpfs tmpfs rw\n", stderr: "", exitCode: 0 });
      if (args.at(-1) === "/var/lib/niceeval/before-cache-artifact.json")
        return Promise.resolve({ stdout: "{}", stderr: "", exitCode: 0 });
      return Promise.reject(new Error(`Unexpected fixture command: ${command}`));
    },
  },
} as MaterializedSandboxCase;

function providerFailure(operation: string) {
  return new BeforeCacheSnapshotError({ operation, reason: "Fixture Provider failed" });
}

async function withLedger(
  primitives: SnapshotOperations,
  run: (fixture: ReturnType<typeof fixtureFor>) => Effect.Effect<void, unknown>,
) {
  const home = await mkdtemp(join(tmpdir(), "niceeval-snapshot-ledger-"));
  vi.stubEnv("NICEEVAL_HOME", home);
  try {
    await Effect.runPromise(run(fixtureFor(primitives)).pipe(Effect.provide(TestClock.layer())));
  } finally {
    vi.unstubAllEnvs();
    await rm(home, { recursive: true, force: true });
  }
}

function fixtureFor(primitives: SnapshotOperations) {
  const preparer = remoteSnapshotPreparer({
    ...primitives,
    snapshotSettleMs: settleMs,
    preserves: { disks: ["/"], memory: true },
    sourceUsableAfterSnapshot: true,
    resolveBase: () =>
      Effect.succeed({
        _tag: "Resolved",
        executionDomainId: "fixture-domain",
        baseIdentity: "fixture-base",
        baseReference: "fixture-base",
        keyScope: { cacheFormat: "fixture-cache", semanticIdentity: {} },
      }),
  });
  const context = {
    runId: "first-run",
    providerId: "fixture-provider",
    materializeBase: () => Effect.succeed(sandbox),
  };
  const captureFor = (runId: string) =>
    Effect.gen(function* () {
      const owner = { ...context, runId };
      const lookup = yield* preparer.lookup(undefined, owner, [step]);
      expect(lookup).toEqual({ _tag: "Miss" });
      const staging = yield* preparer.materializeFrom(undefined, owner, "staging", { _tag: "Base" }, materialize);
      if (staging._tag !== "Materialized") throw new Error(`Staging failed: ${staging.reason}`);
      return yield* preparer.capture(undefined, owner, staging.sandbox, step);
    });
  const collectAgain = Effect.scoped(
    preparer.lookup(undefined, { ...context, runId: "next-run" }, [], { reserve: false }),
  );
  return { preparer, capture: captureFor(context.runId), captureFor, collectAgain, context };
}

const settlementCases: { readonly mode: string; readonly parameters: fc.Parameters<[number]> }[] = [
  { mode: "replay", parameters: { examples: [[1]], seed: 92871, numRuns: 1 } },
  { mode: "explore", parameters: { seed: 92871, numRuns: 1 } },
];

// @feature docs/feature/sandbox/README.md#snapshot-takeover
test.for(settlementCases)("an early empty lookup leaves late snapshots discoverable ($mode)", async ({ parameters }) => {
  await fc.assert(
    fc.asyncProperty(fc.integer({ min: 1, max: 3 }), async (lead) => {
      const remote = new Set<string>();
      let requestedName: string | undefined;
      await withLedger(
        {
          createSnapshot: (_, __, name) => {
            requestedName = name;
            return Effect.andThen(TestClock.adjust(settleMs - lead), Effect.fail(providerFailure("create")));
          },
          findSnapshot: (_, name) =>
            Effect.gen(function* () {
              if (name !== requestedName) throw new Error("GC looked up a different snapshot");
              if (remote.has(snapshotId)) return { _tag: "Ready", snapshotId };
              remote.add(snapshotId);
              yield* TestClock.adjust(lead);
              return { _tag: "Absent" };
            }),
          deleteSnapshot: (_, id) =>
            Effect.sync(() => {
              remote.delete(id);
              return "deleted";
            }),
          createFromSnapshot: () => Effect.fail(providerFailure("restore")),
        },
        ({ capture, collectAgain }) =>
          Effect.gen(function* () {
            const result = yield* Effect.scoped(capture);
            expect(result).toMatchObject({ _tag: "Degraded", reason: "snapshot-uncertain" });
            expect([...remote]).toEqual([snapshotId]);
            yield* collectAgain;
            expect([...remote]).toEqual([]);
          }),
      );
    }),
    parameters,
  );
});

const deletionCases = [
  { mode: "unconfirmed deletion", confirmed: false },
  { mode: "confirmed deletion", confirmed: true },
];

// @feature docs/feature/sandbox/README.md#snapshot-takeover
test("collecting failed snapshots skips Base and continues after a failed deletion", async () => {
  const snapshots = new Map<string, string>();
  const snapshotIds = ["fixture-base", "failed-delete", "confirmed-delete"];
  const deleted: string[] = [];
  let posted = 0;
  await withLedger(
    {
      createSnapshot: (_, __, name) => {
        snapshots.set(name, snapshotIds[posted++]!);
        return Effect.fail(providerFailure("create"));
      },
      findSnapshot: (_, name) => {
        const id = snapshots.get(name);
        return Effect.succeed(id === undefined ? { _tag: "Absent" } : { _tag: "Failed", snapshotId: id });
      },
      deleteSnapshot: (_, id) => {
        deleted.push(id);
        return id === "failed-delete" ? Effect.fail(providerFailure("delete")) : Effect.succeed("deleted");
      },
      createFromSnapshot: () => Effect.fail(providerFailure("restore")),
    },
    ({ capture }) =>
      Effect.gen(function* () {
        const exit = yield* Effect.exit(Effect.scoped(Effect.all([capture, capture, capture])));
        if (!Exit.isFailure(exit)) throw new Error("Expected the unsuccessful rows in the cleanup summary");
        const summary = Cause.pretty(exit.cause);
        expect(summary).toContain("matched the declared Base");
        expect(summary).toContain("snapshot deletion failed");
        expect(deleted).toEqual(["failed-delete", "confirmed-delete"]);
      }),
  );
});

// @feature docs/feature/sandbox/README.md#snapshot-takeover
test("a takeover that sees Pending then Failed retires the old request and publishes a new one", async () => {
  const started = Deferred.makeUnsafe<void>();
  const checked = Deferred.makeUnsafe<void>();
  const posted: string[] = [];
  const deleted: string[] = [];
  let reads = 0;
  await withLedger(
    {
      createSnapshot: (_, __, name) => {
        posted.push(name);
        return posted.length === 1
          ? Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never))
          : Effect.succeed({ _tag: "Ready", snapshotId: "new-snapshot" });
      },
      findSnapshot: (_, name) => {
        expect(name).toBe(posted[0]);
        return reads++ === 0
          ? Deferred.succeed(checked, undefined).pipe(Effect.as({ _tag: "Pending" }))
          : Effect.succeed({ _tag: "Failed", snapshotId: "old-snapshot" });
      },
      deleteSnapshot: (_, id) => {
        deleted.push(id);
        return Effect.succeed("absent");
      },
      createFromSnapshot: () => Effect.fail(providerFailure("restore")),
    },
    ({ capture, captureFor }) =>
      Effect.gen(function* () {
        const old = yield* Effect.forkChild(Effect.scoped(capture));
        yield* Deferred.await(started);
        const result = yield* Effect.gen(function* () {
          // The old owner's clock stays frozen while the new owner observes its expired lease.
          yield* TestClock.setTime(120_001);
          const takeover = yield* Effect.forkChild(Effect.scoped(captureFor("takeover-run")));
          yield* Deferred.await(checked);
          yield* TestClock.adjust("1 second");
          return yield* Fiber.join(takeover);
        }).pipe(Effect.provide(TestClock.layer()));
        yield* Fiber.interrupt(old);
        expect(result).toMatchObject({ _tag: "Published", artifact: { locator: { artifactId: posted[1]?.slice(9) } } });
        expect(new Set(posted).size).toBe(2);
        expect(deleted).toEqual(["old-snapshot"]);
      }),
  );
});

// @feature docs/feature/sandbox/README.md#snapshot-takeover
test.for(deletionCases)("a restored instance protects its snapshot until deletion ($mode)", async ({ confirmed }) => {
  await fc.assert(
    fc.asyncProperty(fc.constant(confirmed), async (confirmed) => {
      const snapshots = new Set<string>();
      const instances = new Set<string>();
      await withLedger(
        {
          createSnapshot: () =>
            Effect.sync(() => {
              snapshots.add(snapshotId);
              return { _tag: "Ready", snapshotId };
            }),
          findSnapshot: () => Effect.succeed({ _tag: "Absent" }),
          deleteSnapshot: (_, id) =>
            Effect.sync(() => {
              snapshots.delete(id);
              return "deleted";
            }),
          createFromSnapshot: (_, id) =>
            Effect.gen(function* () {
              instances.add(id);
              yield* Effect.addFinalizer(() =>
                Effect.sync(() => {
                  if (!confirmed) throw providerFailure("delete-instance");
                  instances.delete(id);
                }),
              );
              return sandbox;
            }),
        },
        ({ preparer, capture, context, collectAgain }) =>
          Effect.gen(function* () {
            yield* Effect.scoped(
              Effect.gen(function* () {
                const published = yield* capture;
                if (published._tag !== "Published") throw new Error(`Capture failed: ${published.reason}`);
                const restore = preparer.materializeFrom(
                  undefined,
                  context,
                  "consumer",
                  { _tag: "Artifact", artifact: published.artifact },
                  materialize,
                );
                const restoreExit = yield* Effect.exit(Effect.scoped(restore));
                expect(Exit.isSuccess(restoreExit)).toBe(confirmed);
              }),
            );
            yield* collectAgain;
            const expected = confirmed ? [] : [snapshotId];
            expect([...instances]).toEqual(expected);
            expect([...snapshots]).toEqual(expected);
          }),
      );
    }),
    { examples: [[confirmed]], seed: 92872, numRuns: 1 },
  );
});

// @feature docs/feature/sandbox/README.md#preparation-failure
test.for([true, false])("a failed restore retains its cause through Base fallback (snapshot absent=%s)", async (absent) => {
  await fc.assert(
    fc.asyncProperty(fc.nat(1000), async (request) => {
      const causes = absent
        ? [{ code: "not-found", summary: `Snapshot lookup failed with HTTP 404. requestId=req-${request}` }]
        : [{ code: "no-capacity", summary: `Startup wait failed with retryable=false. requestId=req-${request}` }];
      const events: string[] = [];
      await withLedger(
        {
          createSnapshot: () => Effect.succeed({ _tag: "Ready", snapshotId }),
          findSnapshot: () => Effect.succeed({ _tag: "Absent" }),
          deleteSnapshot: () => Effect.succeed("deleted"),
          createFromSnapshot: (_, id) =>
            Effect.gen(function* () {
              expect(id).toBe(snapshotId);
              events.push("restore");
              if (!absent) yield* Effect.addFinalizer(() => Effect.sync(() => { events.push("retire"); }));
              return yield* new BeforeCacheSnapshotError({
                operation: absent ? "snapshot lookup" : "startup wait",
                reason: causes[0]!.code,
                causes,
                ...(absent ? { snapshotAbsent: true as const } : {}),
              });
            }),
        },
        ({ preparer, capture, context, collectAgain }) =>
          Effect.gen(function* () {
            yield* Effect.scoped(
              Effect.gen(function* () {
                const published = yield* capture;
                if (published._tag !== "Published") throw new Error(`Capture failed: ${published.reason}`);
                const owner = {
                  ...context,
                  materializeBase: () => Effect.sync(() => { events.push("base"); return sandbox; }),
                };
                const source = { _tag: "Artifact", artifact: published.artifact } as const;
                const restored = yield* preparer.materializeFrom(undefined, owner, "consumer", source, materialize);
                expect(restored).toMatchObject({
                  _tag: "Materialized",
                  start: {
                    _tag: "FellBackToBase",
                    reason: absent ? "snapshot-gone" : "snapshot-restore-failed",
                    causes,
                  },
                });
                const next = yield* preparer.materializeFrom(undefined, owner, "consumer", source, materialize);
                expect(next).toMatchObject({
                  _tag: "Materialized",
                  start: { _tag: "FellBackToBase", reason: "artifact-unavailable" },
                });
              }),
            );
            yield* collectAgain;
          }),
      );
      expect(events).toEqual(absent ? ["restore", "base", "base"] : ["restore", "retire", "base", "base"]);
    }),
    { seed: 92873, numRuns: 1 },
  );
});
