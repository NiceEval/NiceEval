import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Exit } from "effect";
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
  const capture = Effect.gen(function* () {
    const lookup = yield* preparer.lookup(undefined, context, [step]);
    expect(lookup).toEqual({ _tag: "Miss" });
    const staging = yield* preparer.materializeFrom(undefined, context, "staging", { _tag: "Base" }, materialize);
    if (staging._tag !== "Materialized") throw new Error(`Staging failed: ${staging.reason}`);
    return yield* preparer.capture(undefined, context, staging.sandbox, step);
  });
  const collectAgain = Effect.scoped(
    preparer.lookup(undefined, { ...context, runId: "next-run" }, [], { reserve: false }),
  );
  return { preparer, capture, collectAgain, context };
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
