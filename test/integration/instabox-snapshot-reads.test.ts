import { Effect, Exit, Fiber } from "effect";
import { TestClock } from "effect/testing";
import fc from "fast-check";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { MaterializedSandboxCase } from "../../packages/niceeval/src/sandbox/case-types.ts";
import type { InstaboxProviderPlan } from "../../packages/niceeval/src/sandbox/instabox.ts";
import { instaboxSnapshotDriver } from "../../packages/niceeval/src/sandbox/instabox/snapshot-driver.ts";

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

beforeEach(() => vi.stubEnv("INSTABOX_API_KEY", "fixture"));
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
test.for([
  { fault: 503, attempts: 3 },
  { fault: 403, attempts: 1 },
] as const)("status GET stops after $attempts attempts on HTTP $fault", async ({ fault, attempts }) => {
  const requests = stubRequests((request) => {
    if (request === `POST ${createPath}`) return Response.json({ ...snapshot, status: "pending" }, { status: 202 });
    expect(request).toBe(`GET ${snapshotPath}`);
    return failRequest(fault);
  });

  await expect(advanceToSettlement(instaboxSnapshotDriver.createSnapshot(plan, staging, snapshot.name))).rejects
    .toMatchObject({ _tag: "BeforeCacheSnapshotError" });
  expect(requests).toEqual([`POST ${createPath}`, ...Array.from({ length: attempts }, () => `GET ${snapshotPath}`)]);
});

// @feature docs/feature/sandbox/README.md#safe-resource-retries
test("a lost snapshot POST response stays uncertain after one POST", async () => {
  const requests = stubRequests(() => failRequest("fetch failed"));

  await expect(advanceToSettlement(instaboxSnapshotDriver.createSnapshot(plan, staging, snapshot.name))).rejects
    .toMatchObject({ _tag: "BeforeCacheSnapshotError" });
  expect(requests).toEqual([`POST ${createPath}`]);
});

// @feature docs/feature/sandbox/README.md#safe-resource-retries
test("the snapshot settlement deadline aborts an in-flight status GET retry", async () => {
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
      const fiber = yield* Effect.forkChild(instaboxSnapshotDriver.createSnapshot(plan, staging, snapshot.name));
      yield* TestClock.adjust(instaboxSnapshotDriver.snapshotSettleMs - 1);
      expect(retrySignal?.aborted).toBe(false);
      yield* TestClock.adjust(1);
      expect(Exit.isFailure(yield* Fiber.await(fiber))).toBe(true);
      expect(retrySignal?.aborted).toBe(true);
    }).pipe(Effect.provide(TestClock.layer())),
  );
  expect(requests).toEqual([`POST ${createPath}`, `GET ${snapshotPath}`, `GET ${snapshotPath}`]);
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
      yield* TestClock.adjust("1 second");
    }).pipe(Effect.provide(TestClock.layer())),
  );
  expect(requests).toEqual([`POST ${createPath}`, `GET ${snapshotPath}`]);
});
