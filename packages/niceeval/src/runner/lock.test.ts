// owner: docs/engineering/testing/unit/experiments-runner.md#证明范围规范
// cases: docs/engineering/testing/unit/experiments-runner.md

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Deferred, Effect, Fiber, Option } from "effect";
import { pollFiber, runWithTestClock, TestClock } from "../test-support/effect-v4.ts";
import {
  acquireCaseLockEffect,
  drainHeldCaseLocksEffect,
  readCaseLockEffect,
} from "./lock.ts";

const EXPERIMENT_ID = "compare/test-clock";
const EVAL_ID = "case/lock";

const roots: string[] = [];

async function makeRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "niceeval-case-lock-clock-"));
  roots.push(dir);
  return join(dir, ".niceeval");
}

function runTest<A>(effect: Effect.Effect<A, unknown, never>): Promise<A> {
  return runWithTestClock(effect);
}

function waitForHeartbeat(root: string, expected: string): Effect.Effect<void, unknown> {
  return Effect.gen(function*() {
    while (true) {
      const record = yield* readCaseLockEffect(root, EXPERIMENT_ID, EVAL_ID);
      if (record?.heartbeatAt === expected) return;
      yield* Effect.yieldNow;
    }
  });
}

function waitForSleep(expected: number): Effect.Effect<void, unknown> {
  return Effect.gen(function*() {
    for (let turn = 0; turn < 200; turn++) {
      if (Array.from(yield* TestClock.sleeps()).includes(expected)) return;
      yield* Effect.yieldNow;
    }
    return yield* Effect.die(new Error(`timed out waiting for clock sleep ${expected}`));
  });
}

afterEach(async () => {
  await Effect.runPromise(drainHeldCaseLocksEffect());
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("case lock virtual time", () => {
  it("polls only when the configured boundary is reached", async () => {
    const root = await makeRoot();
    let waitStarts = 0;

    await runTest(Effect.gen(function*() {
      const first = yield* acquireCaseLockEffect(
        root,
        EXPERIMENT_ID,
        EVAL_ID,
        { pid: 1, host: "first" },
        { heartbeatIntervalMs: 60_000 },
      );
      const waiting = yield* Deferred.make<void>();
      const secondFiber = yield* acquireCaseLockEffect(
        root,
        EXPERIMENT_ID,
        EVAL_ID,
        { pid: 2, host: "second" },
        {
          pollIntervalMs: 1_000,
          heartbeatIntervalMs: 60_000,
          onWaitStart: () => {
            waitStarts += 1;
            Effect.runFork(Deferred.succeed(waiting, undefined));
          },
        },
      ).pipe(Effect.forkChild);

      yield* Deferred.await(waiting);
      yield* TestClock.adjust(999);
      expect(Option.isNone(yield* pollFiber(secondFiber))).toBe(true);

      yield* first.claim.release;
      yield* TestClock.adjust(1);
      const second = yield* Fiber.join(secondFiber);
      expect(second.takenOver).toBe(false);
      expect(waitStarts).toBe(1);
      yield* second.claim.release;
    }));
  });

  it("renews once per heartbeat period and never writes after release", async () => {
    const root = await makeRoot();

    await runTest(Effect.gen(function*() {
      yield* TestClock.setTime(1_000_000);
      const acquired = yield* acquireCaseLockEffect(
        root,
        EXPERIMENT_ID,
        EVAL_ID,
        { pid: 3, host: "heartbeat" },
        { heartbeatIntervalMs: 1_000 },
      );
      const initial = yield* readCaseLockEffect(root, EXPERIMENT_ID, EVAL_ID);
      // The daemon must register its sleep before this fiber advances virtual time.
      yield* waitForSleep(1_001_000);

      yield* TestClock.adjust(999);
      expect((yield* readCaseLockEffect(root, EXPERIMENT_ID, EVAL_ID))?.heartbeatAt).toBe(initial?.heartbeatAt);

      yield* TestClock.adjust(1);
      yield* waitForHeartbeat(root, new Date(1_001_000).toISOString());
      expect((yield* readCaseLockEffect(root, EXPERIMENT_ID, EVAL_ID))?.heartbeatAt)
        .toBe(new Date(1_001_000).toISOString());

      yield* acquired.claim.release;
      yield* TestClock.adjust(10_000);
      expect(yield* readCaseLockEffect(root, EXPERIMENT_ID, EVAL_ID)).toBeUndefined();
    }));
  });
});
