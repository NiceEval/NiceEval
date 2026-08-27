import { Chunk, Clock, Duration, Effect, Fiber, Option, Random } from "effect";
import { TestClock as EffectTestClock } from "effect/testing";

const ScheduledSleeps = Symbol("NiceEval/TestClock/ScheduledSleeps");

type TrackingTestClock = EffectTestClock.TestClock & {
  readonly [ScheduledSleeps]: ReadonlyMap<object, number>;
};

function trackingTestClock(base: EffectTestClock.TestClock): TrackingTestClock {
  const scheduled = new Map<object, number>();
  return {
    ...base,
    [ScheduledSleeps]: scheduled,
    sleep: (duration: Duration.Duration) => Effect.suspend(() => {
      const token = {};
      scheduled.set(token, base.currentTimeMillisUnsafe() + Duration.toMillis(duration));
      return base.sleep(duration).pipe(
        Effect.ensuring(Effect.sync(() => {
          scheduled.delete(token);
        })),
      );
    }),
  };
}

const sleeps = EffectTestClock.testClockWith((clock) => Effect.sync(() => {
  const scheduled = (clock as TrackingTestClock)[ScheduledSleeps];
  return Chunk.fromIterable([...scheduled.values()].sort((left, right) => left - right));
}));

/** v4 test-clock facade that preserves the existing scheduled-boundary receipts. */
export const TestClock = {
  adjust: EffectTestClock.adjust,
  setTime: EffectTestClock.setTime,
  sleeps: () => sleeps,
} as const;

export function runWithTestClock<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
  return Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const clock = trackingTestClock(yield* EffectTestClock.make());
    return yield* Effect.provideService(effect, Clock.Clock, clock);
  })));
}

/** Effect v4 exposes immediate polling on the Fiber handle. */
export function pollFiber<A, E>(fiber: Fiber.Fiber<A, E>): Effect.Effect<Option.Option<import("effect").Exit.Exit<A, E>>> {
  return Effect.sync(() => Option.fromUndefinedOr(fiber.pollUnsafe()));
}

/** v4 replacement for the removed Effect.withRandomFixed test helper. */
export function withRandomFixed(values: readonly number[]) {
  if (values.length === 0) throw new TypeError("withRandomFixed requires at least one value");
  let index = 0;
  const next = (): number => {
    const value = values[index++ % values.length]!;
    return Math.max(0, Math.min(1, value));
  };
  return <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.provideService(effect, Random.Random, {
      nextDoubleUnsafe: next,
      nextIntUnsafe: () => Math.round(next()),
    });
}
