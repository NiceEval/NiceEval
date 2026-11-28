import { Clock, Effect, Exit, Fiber } from "effect";
import { TestClock } from "effect/testing";
import fc from "fast-check";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { MaterializedSandboxCase } from "../../packages/niceeval/src/sandbox/case-types.ts";
import type { InstaboxProviderPlan } from "../../packages/niceeval/src/sandbox/instabox.ts";
import {
  instaboxSnapshotDriver,
  instaboxSnapshotSourceExpirations,
} from "../../packages/niceeval/src/sandbox/instabox/snapshot-driver.ts";

const plan: InstaboxProviderPlan = {
  source: { _tag: "Template", id: "minimal" },
  lifetimeMs: undefined,
  resources: { vcpus: 4, memMiB: 8192 },
  pathPrepend: [],
};
// The HTTP fixture represents an already materialized staging Machine.
const staging = { group: { primary: { sandboxId: "machine-fixture" } } } as MaterializedSandboxCase;
const snapshot = { id: "sn_fixture", name: "niceeval-fixture", status: "ready" };
const snapshotPath = `/v1/snapshots/${snapshot.id}`;
const createPath = `/v1/machines/${staging.group.primary.sandboxId}/snapshots`;

const transientFaults = ["fetch failed", "timeout", 503] as const;
function failRequest(fault: (typeof transientFaults)[number] | 403) {
  if (fault === "fetch failed") throw new TypeError(fault);
  if (fault === "timeout") throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
  return Response.json({ error: { code: "fixture-failure" } }, { status: fault });
}

beforeEach(() => {
  vi.stubEnv("INSTABOX_API_KEY", "fixture");
  instaboxSnapshotSourceExpirations.set(staging.group, 40 * 60_000);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function stubRequests(respond: (request: string, signal: AbortSignal | null | undefined) => Response | Promise<Response>) {
  const requests: string[] = [];
  vi.stubGlobal("fetch", (async (input, init) => {
    const url = new URL(String(input));
    expect(url.origin).toBe("https://api.instabox.sh");
    const request = `${init?.method ?? "GET"} ${url.pathname}${url.search}`;
    requests.push(request);
    return respond(request, init?.signal);
  }) satisfies typeof fetch);
  return requests;
}

function advanceToSettlement<A, E>(effect: Effect.Effect<A, E>) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(effect);
      yield* TestClock.adjust("10 seconds");
      return yield* Fiber.join(fiber);
    }).pipe(Effect.provide(TestClock.layer())),
  );
}

// @feature docs/feature/sandbox/README.md#safe-resource-retries
test("an accepted snapshot becomes Ready after a transient status GET failure without another POST", async () => {
  await fc.assert(
    fc.asyncProperty(fc.constantFrom(...transientFaults), fc.integer({ min: 0, max: 2 }), async (fault, pendingReads) => {
      let reads = 0;
      const requests = stubRequests((request) => {
        if (request === `POST ${createPath}`) return Response.json({ ...snapshot, status: "pending" }, { status: 202 });
        expect(request).toBe(`GET ${snapshotPath}`);
        if (reads++ < pendingReads) return Response.json({ ...snapshot, status: "pending" });
        if (reads === pendingReads + 1) return failRequest(fault);
        return Response.json(snapshot);
      });

      await expect(advanceToSettlement(instaboxSnapshotDriver.createSnapshot(plan, staging, snapshot.name))).resolves
        .toEqual({ _tag: "Ready", snapshotId: snapshot.id });
      expect(requests).toEqual([`POST ${createPath}`, ...Array.from({ length: pendingReads + 2 }, () => `GET ${snapshotPath}`)]);
    }),
    { examples: [["fetch failed", 0], ["timeout", 0], [503, 0]], seed: 451652, numRuns: 6 },
  );
});

// @feature docs/feature/sandbox/README.md#safe-resource-retries
test.for(transientFaults)("a transient %s is retried on the same snapshot-list GET", async (fault) => {
  let reads = 0;
  const requests = stubRequests((request) => {
    expect(request).toBe("GET /v1/snapshots");
    if (reads++ === 0) return failRequest(fault);
    return Response.json({ snapshots: [{ ...snapshot, id: "sn_other", name: `${snapshot.name}-other` }, snapshot] });
  });

  await expect(advanceToSettlement(instaboxSnapshotDriver.findSnapshot(plan, snapshot.name))).resolves.toEqual({
    _tag: "Ready",
    snapshotId: snapshot.id,
  });
  expect(requests).toEqual(["GET /v1/snapshots", "GET /v1/snapshots"]);
});

// @feature docs/feature/sandbox/README.md#safe-resource-retries
test("status GET stops immediately on HTTP 403", async () => {
  const requests = stubRequests((request) => {
    if (request === `POST ${createPath}`) return Response.json({ ...snapshot, status: "pending" }, { status: 202 });
    expect(request).toBe(`GET ${snapshotPath}`);
    return failRequest(403);
  });

  await expect(advanceToSettlement(instaboxSnapshotDriver.createSnapshot(plan, staging, snapshot.name))).rejects
    .toMatchObject({ _tag: "BeforeCacheSnapshotError", operation: "wait-ready" });
  expect(requests).toEqual([`POST ${createPath}`, `GET ${snapshotPath}`]);
});

// @feature docs/feature/sandbox/README.md#safe-resource-retries
test("status GET resumes after exhausting the three attempts for one transient read", async () => {
  let reads = 0;
  const requests = stubRequests((request) => {
    if (request === `POST ${createPath}`) return Response.json({ ...snapshot, status: "pending" }, { status: 202 });
    expect(request).toBe(`GET ${snapshotPath}`);
    return reads++ < 3 ? failRequest(503) : Response.json(snapshot);
  });
  await Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(instaboxSnapshotDriver.createSnapshot(plan, staging, snapshot.name));
      yield* TestClock.adjust("3 seconds");
      expect(reads).toBe(3);
      yield* TestClock.adjust("5 seconds");
      expect(yield* Fiber.join(fiber)).toEqual({ _tag: "Ready", snapshotId: snapshot.id });
    }).pipe(Effect.provide(TestClock.layer())),
  );
  expect(requests).toEqual([ `POST ${createPath}`, ...Array.from({ length: 4 }, () => `GET ${snapshotPath}`) ]);
});

// @feature docs/feature/sandbox/README.md#safe-resource-retries
test("a lost snapshot POST response stays uncertain after one POST", async () => {
  const requests = stubRequests((request) => {
    if (request === `POST ${createPath}`) return failRequest("fetch failed");
    expect(request).toBe("GET /v1/snapshots");
    return failRequest(403);
  });

  await expect(advanceToSettlement(instaboxSnapshotDriver.createSnapshot(plan, staging, snapshot.name))).rejects
    .toMatchObject({ _tag: "BeforeCacheSnapshotError", operation: "find-after-post" });
  expect(requests).toEqual([`POST ${createPath}`, "GET /v1/snapshots"]);
});

// @feature docs/feature/sandbox/README.md#safe-resource-retries
test("a slow accepted snapshot keeps its staging scope open until Ready", async () => {
  await fc.assert(
    fc.asyncProperty(fc.boolean(), fc.integer({ min: 301, max: 320 }), async (lost, readyAt) => {
      let live = false;
      let clock: Clock.Clock | undefined;
      let listed = 0;
      const requests = stubRequests((request) => {
        expect(live).toBe(true);
        const pending = { ...snapshot, status: "pending" };
        if (request === `POST ${createPath}`)
          return lost ? failRequest("fetch failed") : Response.json(pending, { status: 202 });
        if (request === "GET /v1/snapshots") return Response.json({ snapshots: listed++ === 0 ? [] : [pending] });
        expect(request).toBe(`GET ${snapshotPath}`);
        return Response.json((clock?.currentTimeMillisUnsafe() ?? 0) >= readyAt * 1_000 ? snapshot : pending);
      });
      await Effect.runPromise(
        Effect.gen(function* () {
          clock = yield* Clock.Clock;
          const capture = Effect.scoped(
            Effect.acquireRelease(
              Effect.sync(() => { live = true; }),
              () => Effect.sync(() => { live = false; }),
            ).pipe(Effect.andThen(instaboxSnapshotDriver.createSnapshot(plan, staging, snapshot.name))),
          );
          const fiber = yield* Effect.forkChild(capture);
          yield* TestClock.adjust("5 minutes");
          expect(live).toBe(true);
          yield* TestClock.adjust((readyAt - 300) * 1_000);
          expect(yield* Fiber.join(fiber)).toEqual({ _tag: "Ready", snapshotId: snapshot.id });
          expect(live).toBe(false);
        }).pipe(Effect.provide(TestClock.layer())),
      );
      expect(requests.filter((request) => request.startsWith("POST"))).toEqual([`POST ${createPath}`]);
    }),
    { examples: [[true, 301], [false, 301]], seed: 451653, numRuns: 1 },
  );
});

// @feature docs/feature/sandbox/README.md#snapshot-takeover
test("an exact failed snapshot remains discoverable without a mutating request", async () => {
  const requests = stubRequests((request) => {
    expect(request).toBe("GET /v1/snapshots");
    return Response.json({ snapshots: [{ ...snapshot, status: "failed" }] });
  });
  await expect(advanceToSettlement(instaboxSnapshotDriver.findSnapshot(plan, snapshot.name))).resolves.toEqual({
    _tag: "Failed",
    snapshotId: snapshot.id,
  });
  expect(requests).toEqual(["GET /v1/snapshots"]);
});

// @feature docs/feature/sandbox/README.md#safe-resource-retries
test.for([
  { mode: "the Ready cap", expiresAt: 40 * 60_000, waitMs: 20 * 60_000 },
  { mode: "the Machine lifetime", expiresAt: 8 * 60_000 + 10_000, waitMs: 5 * 60_000 + 10_000 },
])("exhausting $mode while Pending aborts an in-flight status GET retry", async ({ expiresAt, waitMs }) => {
  instaboxSnapshotSourceExpirations.set(staging.group, expiresAt);
  let reads = 0;
  let retrySignal: AbortSignal | undefined;
  const requests = stubRequests((request, signal) => {
    if (request === `POST ${createPath}`) return Response.json({ ...snapshot, status: "pending" }, { status: 202 });
    expect(request).toBe(`GET ${snapshotPath}`);
    if (reads++ === 0) return failRequest(503);
    retrySignal = signal ?? undefined;
    return new Promise<Response>((_resolve, reject) => {
      signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  });

  await Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(Effect.result(instaboxSnapshotDriver.createSnapshot(plan, staging, snapshot.name)));
      yield* TestClock.adjust(waitMs - 1);
      expect(retrySignal?.aborted).toBe(false);
      yield* TestClock.adjust(1);
      expect(yield* Fiber.join(fiber)).toMatchObject({
        _tag: "Failure",
        failure: { operation: "wait-ready", reason: expect.stringContaining("status: pending") },
      });
      expect(retrySignal?.aborted).toBe(true);
    }).pipe(Effect.provide(TestClock.layer())),
  );
  expect(requests).toEqual([`POST ${createPath}`, `GET ${snapshotPath}`, `GET ${snapshotPath}`]);
});

// @feature docs/feature/sandbox/README.md#safe-resource-retries
test("a Pending snapshot that becomes Failed stops polling and emits a redacted failure", async () => {
  const requests = stubRequests((request) => {
    if (request === `POST ${createPath}`) return Response.json({ ...snapshot, status: "pending" }, { status: 202 });
    expect(request).toBe(`GET ${snapshotPath}`);
    return Response.json({ ...snapshot, status: "failed", error: "fixture private provider response" });
  });
  await expect(advanceToSettlement(instaboxSnapshotDriver.createSnapshot(plan, staging, snapshot.name))).rejects
    .toMatchObject({
      operation: "wait-ready",
      reason: "Instabox reported a failed snapshot (last observed snapshot status: failed)",
    });
  expect(requests).toEqual([`POST ${createPath}`, `GET ${snapshotPath}`]);
});

// @feature docs/feature/sandbox/README.md#safe-resource-retries
test("cancelling during snapshot GET backoff stops further polling", async () => {
  const requests = stubRequests((request) => {
    if (request === `POST ${createPath}`) return Response.json({ ...snapshot, status: "pending" }, { status: 202 });
    expect(request).toBe(`GET ${snapshotPath}`);
    return failRequest(503);
  });

  await Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(instaboxSnapshotDriver.createSnapshot(plan, staging, snapshot.name));
      yield* TestClock.adjust("1 second");
      expect(requests).toEqual([`POST ${createPath}`, `GET ${snapshotPath}`]);
      yield* Fiber.interrupt(fiber);
      expect(Exit.isFailure(yield* Fiber.await(fiber))).toBe(true);
      yield* TestClock.adjust("1 second");
    }).pipe(Effect.provide(TestClock.layer())),
  );
  expect(requests).toEqual([`POST ${createPath}`, `GET ${snapshotPath}`]);
});
