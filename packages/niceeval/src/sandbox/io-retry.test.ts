// owner: docs/engineering/testing/unit/sandbox.md#idempotent-io-retry
// cases: docs/engineering/testing/unit/sandbox.md
import { describe, expect, test } from "vitest";
import { Effect, Fiber } from "effect";
import { runWithTestClock, TestClock, withRandomFixed } from "../test-support/effect-v4.ts";
import { withSandboxIoRetry } from "./io-retry.ts";

const runWithClock = <A, E>(effect: Effect.Effect<A, E>) =>
  runWithTestClock(effect);

describe("Sandbox idempotent IO retry", () => {
  test("uses exponential full-jitter boundaries and stops at the configured attempt limit", async () => {
    const delays: number[] = [];
    let attempts = 0;
    const terminal = new Error("still unavailable");

    const failure = await runWithClock(Effect.gen(function*() {
      const fiber = yield* Effect.forkChild(withSandboxIoRetry(
        Effect.sync(() => {
          attempts += 1;
        }).pipe(Effect.andThen(Effect.fail(terminal))),
        {
          maxAttempts: 3,
          baseDelayMs: 100,
          classify: () => "network",
          onRetry: ({ delayMs }) => delays.push(delayMs),
        },
      ).pipe(withRandomFixed([0, 1])));

      yield* Effect.yieldNow;
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

    const failure = await runWithClock(withSandboxIoRetry(
      Effect.sync(() => {
        attempts += 1;
      }).pipe(Effect.andThen(Effect.fail(terminal))),
      { classify: () => "unknown" },
    ).pipe(withRandomFixed([0]), Effect.flip));

    expect(failure).toBe(terminal);
    expect(attempts).toBe(1);
  });
});
