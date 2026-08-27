// owner: docs/engineering/testing/unit/experiments-runner.md#证明范围规范
// cases: docs/engineering/testing/unit/experiments-runner.md

import { Cause, Effect, Exit, Fiber, Option } from "effect";
import { describe, expect, it } from "vitest";

import { pollFiber, runWithTestClock, TestClock } from "../test-support/effect-v4.ts";
import { CleanupTimeoutError, cleanupCallback, withCleanupTimeout } from "./cleanup-timeout.ts";

function runTest<A>(effect: Effect.Effect<A, unknown, never>): Promise<A> {
  return runWithTestClock(effect);
}

function awaitScheduledSleep(deadline: number): Effect.Effect<void> {
  return Effect.gen(function*() {
    while (!Array.from(yield* TestClock.sleeps()).includes(deadline)) {
      yield* Effect.yieldNow;
    }
  });
}

function timeoutFailure(exit: Exit.Exit<unknown, unknown>): CleanupTimeoutError | undefined {
  if (Exit.isSuccess(exit)) return undefined;
  const failure = Cause.findErrorOption(exit.cause);
  return Option.isSome(failure) && failure.value instanceof CleanupTimeoutError
    ? failure.value
    : undefined;
}

describe("cleanup timeout virtual time", () => {
  it("fails at the timeout boundary, interrupts the cleanup, and closes each scope once", async () => {
    const events: string[] = [];

    await runTest(Effect.gen(function*() {
      const inner = Effect.gen(function*() {
        yield* Effect.addFinalizer(() => Effect.sync(() => events.push("inner-finalizer")));
        yield* Effect.never;
      }).pipe(
        Effect.onInterrupt(() => Effect.sync(() => events.push("inner-interrupted"))),
        Effect.scoped,
      );
      const bounded = Effect.gen(function*() {
        yield* Effect.addFinalizer(() => Effect.sync(() => events.push("outer-finalizer")));
        return yield* withCleanupTimeout(inner, 1_000);
      }).pipe(Effect.scoped);
      const fiber = yield* Effect.forkChild(bounded);

      yield* awaitScheduledSleep(1_000);
      expect(Array.from(yield* TestClock.sleeps())).toEqual([1_000]);
      yield* TestClock.adjust(999);
      expect(Option.isNone(yield* pollFiber(fiber))).toBe(true);
      expect(events).toEqual([]);

      yield* TestClock.adjust(1);
      const exit = yield* Fiber.await(fiber);
      expect(timeoutFailure(exit)?.timeoutMs).toBe(1_000);
      expect(events).toEqual(["inner-interrupted", "inner-finalizer", "outer-finalizer"]);
    }));
  });

  it("aborts the tryPromise callback when its cleanup budget expires", async () => {
    let callbackSignal: AbortSignal | undefined;
    let aborts = 0;

    await runTest(Effect.gen(function*() {
      const fiber = yield* cleanupCallback(
        (signal) => new Promise<void>((resolve) => {
          callbackSignal = signal;
          signal.addEventListener("abort", () => {
            aborts += 1;
            resolve();
          }, { once: true });
        }),
        1_000,
      ).pipe(Effect.forkChild);

      yield* awaitScheduledSleep(1_000);
      expect(Array.from(yield* TestClock.sleeps())).toEqual([1_000]);
      yield* TestClock.adjust(999);
      expect(callbackSignal?.aborted).toBe(false);
      expect(Option.isNone(yield* pollFiber(fiber))).toBe(true);

      yield* TestClock.adjust(1);
      const exit = yield* Fiber.await(fiber);
      expect(timeoutFailure(exit)?.timeoutMs).toBe(1_000);
      expect(callbackSignal?.aborted).toBe(true);
      expect(aborts).toBe(1);
    }));
  });
});
