import { Effect } from "effect";

/**
 * Attempt-owned provisioning capacity. Every path that temporarily gives back
 * the ordinary Sandbox permit shares this stateful owner; no caller may issue a
 * raw semaphore release for a permit it did not acquire.
 */
export interface ProvisioningPermitOwner {
  readonly acquire: Effect.Effect<void>;
  readonly release: Effect.Effect<void>;
  readonly reacquire: Effect.Effect<void>;
}

export function makeProvisioningPermitOwner(
  semaphore: Effect.Semaphore,
): ProvisioningPermitOwner {
  let held = false;

  const acquire = Effect.uninterruptibleMask((restore) =>
    restore(semaphore.take(1)).pipe(
      Effect.tap(() => Effect.sync(() => { held = true; })),
    )
  );

  const release = Effect.uninterruptible(
    Effect.suspend(() => held
      ? semaphore.release(1).pipe(Effect.tap(() => Effect.sync(() => { held = false; })))
      : Effect.void
    ),
  );

  const reacquire = Effect.uninterruptibleMask((restore) =>
    Effect.suspend(() => held
      ? Effect.void
      : restore(semaphore.take(1)).pipe(
          Effect.tap(() => Effect.sync(() => { held = true; })),
        )
    )
  );

  return { acquire, release, reacquire };
}
