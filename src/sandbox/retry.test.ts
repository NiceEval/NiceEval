// owner: docs/engineering/testing/unit/sandbox.md#provision-retry
// cases: docs/engineering/testing/unit/sandbox.md
import { describe, expect, test } from "vitest";
import { Effect, Fiber, TestClock, TestContext } from "effect";
import { withProvisionRetryEffect } from "./retry.ts";

describe("Sandbox provisioning retry", () => {
  test("releases its slot during backoff, then reacquires and reconciles before retrying", async () => {
    const events: string[] = [];
    let creates = 0;
    let slotHeld = true;
    const original = new Error("ambiguous create");

    const program = Effect.gen(function*() {
      const fiber = yield* Effect.fork(withProvisionRetryEffect(
        () => Effect.sync(() => {
          creates += 1;
          events.push(`create:${creates}`);
          if (creates === 1) return original;
          return "sandbox-id";
        }).pipe(Effect.flatMap((value) => value instanceof Error ? Effect.fail(value) : Effect.succeed(value))),
        () => "ambiguous",
        {
          slot: {
            release: Effect.sync(() => {
              slotHeld = false;
              events.push("release");
            }),
            reacquire: Effect.sync(() => {
              slotHeld = true;
              events.push("reacquire");
            }),
          },
          reconcile: Effect.sync(() => {
            events.push("reconcile");
          }),
          feedback: { progress: () => {}, diagnostic: () => {} },
        },
      ).pipe(Effect.withRandomFixed([0])));

      yield* Effect.yieldNow();
      expect(slotHeld).toBe(false);
      expect(events).toEqual(["create:1", "release"]);
      expect(Array.from(yield* TestClock.sleeps())).toEqual([500]);

      yield* TestClock.adjust(500);
      const result = yield* Fiber.join(fiber);
      expect(result).toBe("sandbox-id");
      expect(slotHeld).toBe(true);
      expect(events).toEqual(["create:1", "release", "reacquire", "reconcile", "create:2"]);
    });

    await Effect.runPromise(program.pipe(Effect.provide(TestContext.TestContext)));
  });
});
