import { Effect } from "effect";
import {
  BeforeCacheAmbiguityError,
  BeforeCacheCaptureError,
  BeforeCacheCancellationError,
  BeforeCacheLookupError,
  BeforeCacheRestoreError,
  type AttemptBeforeCache,
  type BeforeCacheEligibility,
  type BeforeCacheStep,
} from "../backend.ts";
import {
  captureDockerProfileBeforeCache,
  DockerProfileControlError,
  DockerProfileControlAmbiguityError,
  DockerProfileControlCancellationError,
  restoreDockerProfileBeforeCache,
  type DockerProfileLease,
  type DockerProfileReservation,
  type DockerProfileBeforeCacheArtifactIdentityV1,
} from "./runtime.ts";

export interface DockerProfileBeforeCacheSession {
  readonly lease: DockerProfileLease;
  readonly currentReservation: () => DockerProfileReservation;
  /** Internal deterministic seam; production uses the bounded control default. */
  readonly controlTimeoutMs?: number;
  /** Scope-backed: release/scrub current ownership before acquiring a new private slot. */
  readonly replaceReservation: Effect.Effect<DockerProfileReservation, Error>;
}

export interface DockerProfileBeforeCacheTarget {
  readonly session: DockerProfileBeforeCacheSession;
  eligibility(): BeforeCacheEligibility;
  quiesceAndStop(signal: AbortSignal): Promise<void>;
  /** Drop Docker handles only after the outer container has been proven stopped. */
  retireStopped(): void;
  /** Create the original outer container spec against the session's current reservation. */
  createFromCurrent(signal: AbortSignal): Promise<string>;
  /** Reserved for a future strictly-verified terminal Host failure path. */
  resumeStopped(signal: AbortSignal): Promise<string>;
}

function reasonOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function promiseEffect<A>(operation: (signal: AbortSignal) => Promise<A>): Effect.Effect<A, Error> {
  return Effect.tryPromise({
    try: operation,
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  });
}

function freshReservation(target: DockerProfileBeforeCacheTarget): Effect.Effect<DockerProfileReservation, Error> {
  return Effect.andThen(
    Effect.sync(() => target.retireStopped()),
    target.session.replaceReservation,
  );
}

function createCurrent(target: DockerProfileBeforeCacheTarget): Effect.Effect<string, Error> {
  return promiseEffect((signal) => target.createFromCurrent(signal));
}

function restoreArtifact(
  target: DockerProfileBeforeCacheTarget,
  reservation: DockerProfileReservation,
  input: BeforeCacheStep,
  expected?: DockerProfileBeforeCacheArtifactIdentityV1,
) {
  return promiseEffect((signal) =>
    restoreDockerProfileBeforeCache(
      target.session.lease,
      reservation,
      input,
      expected,
      signal,
      target.session.controlTimeoutMs,
    ),
  );
}

function isArtifactMiss(cause: Error): boolean {
  return cause instanceof DockerProfileControlError && cause.code === "before-cache-miss";
}

function artifactReceipt(
  artifact: DockerProfileBeforeCacheArtifactIdentityV1,
  reservation: DockerProfileReservation,
): { readonly entryId: string; readonly generation: number; readonly artifactId: string } {
  return {
    entryId: artifact.artifactId,
    generation: reservation.slotGeneration ?? 0,
    artifactId: artifact.artifactId,
  };
}

function captureFailure(cause: Error, target: DockerProfileBeforeCacheTarget, input: BeforeCacheStep) {
  const common = {
    operation: "publish Docker profile before-cache artifact",
    beforeCacheKey: input.declaration.beforeCacheKey,
    domainId: target.session.lease.binding.profile.profileId,
    operationId: input.operationId,
  } as const;
  if (
    cause instanceof DockerProfileControlCancellationError ||
    (cause instanceof DockerProfileControlAmbiguityError && cause.terminal === "cancel-fenced")
  ) {
    return new BeforeCacheCancellationError({
      ...common,
      terminal: "cancel-fenced",
      reason: "the Host fenced the operation and proved its unpublished state was scrubbed",
    });
  }
  if (cause instanceof DockerProfileControlAmbiguityError) {
    return new BeforeCacheAmbiguityError({
      ...common,
      terminal: "unresolved",
      reason: "the Host could not prove whether before-cache publication completed",
      diagnosticCommand: `niceeval docker profile doctor ${target.session.lease.binding.alias}`,
    });
  }
  return new BeforeCacheCaptureError({
    operation: "capture Docker profile before-cache and restore a private continuation",
    reason: reasonOf(cause),
    beforeCacheKey: input.declaration.beforeCacheKey,
    domainId: target.session.lease.binding.profile.profileId,
    cause,
  });
}

/**
 * The host owns artifacts and private slots. Every lookup rotates away from the
 * initially-created Base container, restores only into a fresh granted slot,
 * and then replays the exact original container.create spec. This module never
 * enters the ordinary local-Docker image/index cache path.
 */
export function makeDockerProfileBeforeCacheCapability(target: DockerProfileBeforeCacheTarget): AttemptBeforeCache {
  return Object.freeze({
    eligibility: () => target.eligibility(),

    lookupAndRestore: (input: BeforeCacheStep) =>
      Effect.gen(function* () {
        yield* promiseEffect((signal) => target.quiesceAndStop(signal));
        let reservation = yield* freshReservation(target);
        const restored = yield* Effect.result(restoreArtifact(target, reservation, input));
        if (restored._tag === "Success") {
          const sandboxId = yield* createCurrent(target);
          return {
            _tag: "Restored" as const,
            beforeCacheKey: input.declaration.beforeCacheKey,
            ...artifactReceipt(restored.success.artifact, reservation),
            sandboxId,
          };
        }
        if (isArtifactMiss(restored.failure)) {
          yield* createCurrent(target);
          return { _tag: "Miss" as const, beforeCacheKey: input.declaration.beforeCacheKey };
        }

        // A corrupt/interrupted restore may quarantine or partially populate its
        // target. Release proves scrub, then continue from a different clean slot
        // so the runner can try a shorter verified prefix.
        reservation = yield* freshReservation(target);
        yield* createCurrent(target);
        return {
          _tag: "Miss" as const,
          beforeCacheKey: input.declaration.beforeCacheKey,
          recovery: "restore-failed-replayed" as const,
        };
      }).pipe(
        Effect.mapError(
          (cause) =>
            new BeforeCacheLookupError({
              operation: "restore Docker profile before-cache artifact into a new private slot",
              reason: reasonOf(cause),
              beforeCacheKey: input.declaration.beforeCacheKey,
              domainId: target.session.lease.binding.profile.profileId,
              cause,
            }),
        ),
      ),

    capture: (input: BeforeCacheStep) =>
      Effect.gen(function* () {
        if ((input.knownSensitiveValues?.filter((value) => value.length > 0).length ?? 0) > 0) {
          return {
            _tag: "Unsupported" as const,
            code: "sensitive-state" as const,
            reason: "Docker Profile before-cache capture refuses actions with framework-known sensitive values",
          };
        }
        yield* promiseEffect((signal) => target.quiesceAndStop(signal));
        // A transport error, client timeout, decoder rejection, or interruption
        // cannot prove whether the Host is still copying with the source slot
        // unmounted. V1 therefore fails the Attempt and lets the existing Scope
        // owner perform reservation release/reconciliation; it never restarts the
        // old outer container from this ambiguous boundary.
        const captured = yield* promiseEffect((signal) =>
          captureDockerProfileBeforeCache(
            target.session.lease,
            target.session.currentReservation(),
            input,
            signal,
            target.session.controlTimeoutMs,
          ),
        );

        let reservation = yield* freshReservation(target);
        let restored = yield* Effect.result(restoreArtifact(target, reservation, input, captured.artifact));
        if (restored._tag === "Failure") {
          // The action has already succeeded, so Base/shorter-prefix replay is
          // forbidden. Scrub and retry the just-verified artifact once in another
          // fresh slot; a second failure terminates the Attempt.
          reservation = yield* freshReservation(target);
          restored = yield* Effect.result(restoreArtifact(target, reservation, input, captured.artifact));
          if (restored._tag === "Failure") return yield* Effect.fail(restored.failure);
        }
        const sandboxId = yield* createCurrent(target);
        if (captured.state === "already-published") {
          return {
            _tag: "Contended" as const,
            beforeCacheKey: input.declaration.beforeCacheKey,
            reason: "indexed-generation" as const,
          };
        }
        return {
          _tag: "Captured" as const,
          beforeCacheKey: input.declaration.beforeCacheKey,
          ...artifactReceipt(captured.artifact, reservation),
          sandboxId,
        };
      }).pipe(Effect.mapError((cause) => captureFailure(cause, target, input))),

    fallBackToBase: () =>
      Effect.gen(function* () {
        yield* promiseEffect((signal) => target.quiesceAndStop(signal));
        yield* freshReservation(target);
        const sandboxId = yield* createCurrent(target);
        const eligibility = target.eligibility();
        if (eligibility._tag !== "Eligible") return eligibility;
        return {
          _tag: "FellBackToBase" as const,
          baseIdentity: eligibility.baseIdentity,
          sandboxId,
        };
      }).pipe(
        Effect.mapError(
          (cause) =>
            new BeforeCacheRestoreError({
              operation: "scrub Docker profile private slot and restore clean Base",
              reason: reasonOf(cause),
              domainId: target.session.lease.binding.profile.profileId,
              cause,
            }),
        ),
      ),
  });
}
