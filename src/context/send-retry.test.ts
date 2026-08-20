// owner: docs/engineering/testing/unit/experiments-runner.md#证明范围规范
// cases: docs/engineering/testing/unit/experiments-runner.md

import { Cause, Chunk, Effect, Exit, Fiber, Option, TestClock, TestContext } from "effect";
import { describe, expect, it } from "vitest";

import { isSendFailure, makeSendFailure, sendFailureText } from "./send-failures.ts";
import {
  ATTEMPT_MAX_RETRIES,
  sendWithTurnRetry,
  type AttemptRetryBudget,
  type ConcurrencySlot,
} from "./send-retry.ts";

function runTest<A>(effect: Effect.Effect<A, unknown, never>): Promise<A> {
  return Effect.runPromise(effect.pipe(Effect.provide(TestContext.TestContext)));
}

function awaitScheduledSleep(deadline: number): Effect.Effect<void> {
  return Effect.gen(function*() {
    while (!Array.from(yield* TestClock.sleeps()).includes(deadline)) {
      yield* Effect.yieldNow();
    }
  });
}

function retryableFailure() {
  return makeSendFailure({ acceptance: "rejected", message: "retryable fixture failure" });
}

describe("send retry virtual time", () => {
  it("retries only at the backoff boundary after releasing and reacquiring the global slot", async () => {
    const events: string[] = [];
    let calls = 0;
    const budget: AttemptRetryBudget = { remaining: ATTEMPT_MAX_RETRIES };
    const slot: ConcurrencySlot = {
      release: Effect.sync(() => events.push("release")),
      reacquire: Effect.sync(() => events.push("reacquire")),
    };

    await runTest(Effect.gen(function*() {
      const send = Effect.suspend(() => {
        calls += 1;
        events.push(`call:${calls}`);
        return calls === 1 ? Effect.fail(retryableFailure()) : Effect.succeed("sent");
      });
      const fiber = yield* sendWithTurnRetry(send, {
        budget,
        classifier: () => ({ retryable: true, reason: "fixture" }),
        random: () => 1,
        signal: new AbortController().signal,
        slot,
      }).pipe(Effect.fork);

      yield* awaitScheduledSleep(5_000);
      expect(Array.from(yield* TestClock.sleeps())).toEqual([5_000]);
      expect(events).toEqual(["call:1", "release"]);

      yield* TestClock.adjust(4_999);
      expect(Option.isNone(yield* Fiber.poll(fiber))).toBe(true);
      expect(calls).toBe(1);

      yield* TestClock.adjust(1);
      expect(yield* Fiber.join(fiber)).toBe("sent");
      expect(events).toEqual(["call:1", "release", "reacquire", "call:2"]);
      expect(budget.remaining).toBe(ATTEMPT_MAX_RETRIES - 1);
    }));
  });

  it("lets AbortSignal win the backoff race and cancels the sleeping side", async () => {
    const controller = new AbortController();
    let notifySleepStarted: (() => void) | undefined;
    const sleepStarted = new Promise<void>((resolve) => {
      notifySleepStarted = resolve;
    });
    let sleepAborts = 0;
    let sleepSignal: AbortSignal | undefined;
    let calls = 0;

    await runTest(Effect.gen(function*() {
      const fiber = yield* sendWithTurnRetry(
        Effect.suspend(() => {
          calls += 1;
          return Effect.fail(retryableFailure());
        }),
        {
          budget: { remaining: ATTEMPT_MAX_RETRIES },
          classifier: () => ({ retryable: true, reason: "fixture" }),
          random: () => 1,
          signal: controller.signal,
          sleep: (_delayMs, signal) => new Promise<void>((resolve) => {
            sleepSignal = signal;
            signal.addEventListener("abort", () => {
              sleepAborts += 1;
              resolve();
            }, { once: true });
            notifySleepStarted?.();
          }),
        },
      ).pipe(Effect.fork);

      yield* Effect.promise(() => sleepStarted);
      controller.abort();

      const exit = yield* Fiber.await(fiber);
      expect(Exit.isFailure(exit) && Cause.isInterruptedOnly(exit.cause)).toBe(true);
      expect(sleepSignal?.aborted).toBe(true);
      expect(sleepAborts).toBe(1);
      expect(calls).toBe(1);
    }));
  });

  it("stops when the attempt retry budget is exhausted", async () => {
    const budget: AttemptRetryBudget = { remaining: 1 };
    let calls = 0;

    await runTest(Effect.gen(function*() {
      const fiber = yield* sendWithTurnRetry(
        Effect.suspend(() => {
          calls += 1;
          return Effect.fail(retryableFailure());
        }),
        {
          budget,
          classifier: () => ({ retryable: true, reason: "fixture" }),
          random: () => 1,
          signal: new AbortController().signal,
        },
      ).pipe(Effect.fork);

      yield* awaitScheduledSleep(5_000);
      expect(Array.from(yield* TestClock.sleeps())).toEqual([5_000]);
      yield* TestClock.adjust(5_000);
      const exit = yield* Fiber.await(fiber);
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isSuccess(exit)) return;

      const failure = Cause.failureOption(exit.cause);
      expect(Option.isSome(failure)).toBe(true);
      if (Option.isSome(failure)) {
        expect(isSendFailure(failure.value)).toBe(true);
        if (isSendFailure(failure.value)) {
          expect(sendFailureText(failure.value)).toContain(String(ATTEMPT_MAX_RETRIES));
        }
      }
      expect(Chunk.isEmpty(yield* TestClock.sleeps())).toBe(true);
      expect(calls).toBe(2);
      expect(budget.remaining).toBe(0);
    }));
  });
});
