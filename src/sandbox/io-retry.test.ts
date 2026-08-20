// owner: docs/engineering/testing/unit/sandbox.md#idempotent-io-retry
// cases: docs/engineering/testing/unit/sandbox.md
import { describe, expect, test } from "vitest";
import { Effect, Fiber, TestClock, TestContext } from "effect";
import { withSandboxIoRetryEffect } from "./io-retry.ts";

const runWithClock = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.runPromise(effect.pipe(Effect.provide(TestContext.TestContext)));

describe("Sandbox idempotent IO retry", () => {
  test("uses exponential full-jitter boundaries and stops at the configured attempt limit", async () => {
    const delays: number[] = [];
    let attempts = 0;
    const terminal = new Error("still unavailable");

    const failure = await runWithClock(Effect.gen(function*() {
      const fiber = yield* Effect.fork(withSandboxIoRetryEffect(
        () => Effect.sync(() => {
          attempts += 1;
        }).pipe(Effect.zipRight(Effect.fail(terminal))),
        {
          maxAttempts: 3,
          baseDelayMs: 100,
          classify: () => "network",
          onRetry: ({ delayMs }) => delays.push(delayMs),
        },
      ).pipe(Effect.withRandomFixed([0, 1])));

      yield* Effect.yieldNow();
      expect(Array.from(yield* TestClock.sleeps())).toEqual([50]);
      yield* TestClock.adjust(50);
      expect(Array.from(yield* TestClock.sleeps())).toEqual([350]);
      yield* TestClock.adjust(300);
      return yield* Fiber.join(fiber).pipe(Effect.flip);
    }));

    expect(failure).toBe(terminal);
    expect(attempts).toBe(3);
    expect(delays).toEqual([50, 300]);
  });

  test("fails a non-retryable error immediately without sleeping", async () => {
    const terminal = new Error("permission denied");
    let attempts = 0;

    const failure = await runWithClock(withSandboxIoRetryEffect(
      () => Effect.sync(() => {
        attempts += 1;
      }).pipe(Effect.zipRight(Effect.fail(terminal))),
      { classify: () => "unknown" },
    ).pipe(Effect.withRandomFixed([0]), Effect.flip));

    expect(failure).toBe(terminal);
    expect(attempts).toBe(1);
  });
});
