// Shared-state leases reuse the project-local coordination lock algorithm. They intentionally add
// no storage or transaction layer: a key only grants one Invocation exclusive access to external
// mutable state on this machine/project coordination domain.

import { Effect } from "effect";
import {
  acquireCaseLockEffect,
  type CaseLockEffectClaim,
} from "./lock.ts";

// The NUL prefix cannot be produced by a discovered Experiment path, so this private namespace
// cannot collide with the public (experimentId, evalId) case-lock identity space.
const SHARED_STATE_LEASE_NAMESPACE = "\u0000niceeval/shared-state/v1";

export interface SharedStateLeaseEffectClaim extends CaseLockEffectClaim {}

export interface AcquireSharedStateLeaseEffectResult {
  readonly claim: SharedStateLeaseEffectClaim;
  readonly takenOver: boolean;
}

const held = new Set<Effect.Effect<void, unknown>>();

/**
 * Acquire a project-local lease for one public shared-state key. Waiting remains interruptible;
 * callers must acquire it before entering Experiment or Sandbox setup and release it only after
 * their complete teardown/finalizer lifecycle has settled.
 */
export function acquireSharedStateLeaseEffect(
  niceevalRoot: string,
  key: string,
  identity: { readonly pid: number; readonly host: string },
  opts: { readonly signal?: AbortSignal } = {},
): Effect.Effect<AcquireSharedStateLeaseEffectResult, unknown> {
  return acquireCaseLockEffect(
    niceevalRoot,
    SHARED_STATE_LEASE_NAMESPACE,
    key,
    identity,
    opts.signal === undefined ? {} : { signal: opts.signal },
  ).pipe(
    Effect.map(({ claim, takenOver }) => {
      let released = false;
      let release: Effect.Effect<void, unknown>;
      release = Effect.uninterruptible(Effect.suspend(() => {
        if (released) return Effect.void;
        released = true;
        held.delete(release);
        return claim.release;
      }));
      held.add(release);
      return Object.freeze({ claim: Object.freeze({ release }), takenOver });
    }),
  );
}

/** Best-effort process-exit sweep, kept separate so teardown can run before this final fallback. */
export function drainHeldSharedStateLeasesEffect(): Effect.Effect<number> {
  const releases = [...held];
  return Effect.forEach(releases, (release) => Effect.exit(release), { discard: true }).pipe(
    Effect.as(releases.length),
  );
}
