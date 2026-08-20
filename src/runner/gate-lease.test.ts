// owner: docs/engineering/testing/unit/experiments-runner.md#证明范围规范
// cases: docs/engineering/testing/unit/experiments-runner.md

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Deferred, Effect, Fiber, Option, TestClock, TestContext } from "effect";
import {
  acquireGateSlotEffect,
  drainHeldGateLeasesEffect,
  readGateLeasesEffect,
} from "./gate-lease.ts";

const EXPERIMENT_ID = "compare/test-clock";
const roots: string[] = [];

async function makeRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "niceeval-gate-clock-"));
  roots.push(dir);
  return join(dir, ".niceeval");
}

function runTest<A>(effect: Effect.Effect<A, unknown, never>): Promise<A> {
  return Effect.runPromise(effect.pipe(Effect.provide(TestContext.TestContext)));
}

afterEach(async () => {
  await Effect.runPromise(drainHeldGateLeasesEffect());
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("experiment gate lease virtual time", () => {
  it("keeps a full gate asleep until the poll boundary", async () => {
    const root = await makeRoot();
    let waitStarts = 0;

    await runTest(Effect.gen(function*() {
      const first = yield* acquireGateSlotEffect(
        root,
        EXPERIMENT_ID,
        1,
        { pid: 1, host: "first" },
        { heartbeatIntervalMs: 60_000 },
      );
      const waiting = yield* Deferred.make<void>();
      const secondFiber = yield* acquireGateSlotEffect(
        root,
        EXPERIMENT_ID,
        1,
        { pid: 2, host: "second" },
        {
          pollIntervalMs: 1_000,
          heartbeatIntervalMs: 60_000,
          onWaitStart: () => {
            waitStarts += 1;
            Effect.runFork(Deferred.succeed(waiting, undefined));
          },
        },
      ).pipe(Effect.fork);

      yield* Deferred.await(waiting);
      yield* TestClock.adjust(999);
      expect(Option.isNone(yield* Fiber.poll(secondFiber))).toBe(true);

      yield* first.claim.release;
      yield* TestClock.adjust(1);
      const second = yield* Fiber.join(secondFiber);
      expect(second.claim.slot).toBe(0);
      expect(waitStarts).toBe(1);
      yield* second.claim.release;
    }));
  });

  it("stops the heartbeat fiber before removing the lease", async () => {
    const root = await makeRoot();

    await runTest(Effect.gen(function*() {
      yield* TestClock.setTime(2_000_000);
      const acquired = yield* acquireGateSlotEffect(
        root,
        EXPERIMENT_ID,
        1,
        { pid: 3, host: "heartbeat" },
        { heartbeatIntervalMs: 1_000 },
      );
      const initial = (yield* readGateLeasesEffect(root, EXPERIMENT_ID))[0];

      yield* TestClock.adjust(999);
      expect((yield* readGateLeasesEffect(root, EXPERIMENT_ID))[0]?.heartbeatAt).toBe(initial?.heartbeatAt);

      yield* TestClock.adjust(1);
      expect((yield* readGateLeasesEffect(root, EXPERIMENT_ID))[0]?.heartbeatAt)
        .toBe(new Date(2_001_000).toISOString());

      yield* acquired.claim.release;
      yield* TestClock.adjust(10_000);
      expect(yield* readGateLeasesEffect(root, EXPERIMENT_ID)).toEqual([]);
    }));
  });
});
