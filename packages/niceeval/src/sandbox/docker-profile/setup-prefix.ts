import { Effect } from "effect";
import {
  SandboxSetupPrefixCacheCaptureError,
  SandboxSetupPrefixCacheLookupError,
  SandboxSetupPrefixCacheRestoreError,
  type SandboxSetupPrefixCacheCapability,
  type SandboxSetupPrefixCacheEligibility,
  type SandboxSetupPrefixCacheOperation,
} from "../backend.ts";
import {
  captureDockerProfileSetupPrefix,
  DockerProfileControlError,
  DockerProfileControlAmbiguityError,
  DockerProfileControlCancellationError,
  restoreDockerProfileSetupPrefix,
  type DockerProfileLease,
  type DockerProfileReservation,
  type DockerProfileSetupPrefixArtifactIdentityV1,
} from "./runtime.ts";

export interface DockerProfileSetupPrefixSession {
  readonly lease: DockerProfileLease;
  readonly currentReservation: () => DockerProfileReservation;
  /** Internal deterministic seam; production uses the bounded control default. */
  readonly controlTimeoutMs?: number;
  /** Scope-backed: release/scrub current ownership before acquiring a new private slot. */
  readonly replaceReservation: Effect.Effect<DockerProfileReservation, Error>;
}

export interface DockerProfileSetupPrefixTarget {
  readonly session: DockerProfileSetupPrefixSession;
  eligibility(): SandboxSetupPrefixCacheEligibility;
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
    catch: (cause) => cause instanceof Error ? cause : new Error(String(cause)),
  });
}

function freshReservation(target: DockerProfileSetupPrefixTarget): Effect.Effect<DockerProfileReservation, Error> {
  return Effect.zipRight(
    Effect.sync(() => target.retireStopped()),
    target.session.replaceReservation,
  );
}

function createCurrent(target: DockerProfileSetupPrefixTarget): Effect.Effect<string, Error> {
  return promiseEffect((signal) => target.createFromCurrent(signal));
}

function restoreArtifact(
  target: DockerProfileSetupPrefixTarget,
  reservation: DockerProfileReservation,
  input: SandboxSetupPrefixCacheOperation,
  expected?: DockerProfileSetupPrefixArtifactIdentityV1,
) {
  return promiseEffect((signal) => restoreDockerProfileSetupPrefix(
    target.session.lease,
    reservation,
    input,
    expected,
    signal,
    target.session.controlTimeoutMs,
  ));
}

function isArtifactMiss(cause: Error): boolean {
  return cause instanceof DockerProfileControlError && cause.code === "setup-prefix-miss";
}

function artifactReceipt(
  artifact: DockerProfileSetupPrefixArtifactIdentityV1,
  reservation: DockerProfileReservation,
): { readonly entryId: string; readonly generation: number; readonly artifactId: string } {
  return {
    entryId: artifact.artifactId,
    generation: reservation.slotGeneration ?? 0,
    artifactId: artifact.artifactId,
  };
}

/**
 * The host owns artifacts and private slots. Every lookup rotates away from the
 * initially-created Base container, restores only into a fresh granted slot,
 * and then replays the exact original container.create spec. This module never
 * enters the ordinary local-Docker image/index cache path.
 */
export function makeDockerProfileSetupPrefixCacheCapability(
  target: DockerProfileSetupPrefixTarget,
): SandboxSetupPrefixCacheCapability {
  return Object.freeze({
    eligibility: () => target.eligibility(),

    lookupAndRebase: (input: SandboxSetupPrefixCacheOperation) => Effect.gen(function* () {
      yield* promiseEffect((signal) => target.quiesceAndStop(signal));
      let reservation = yield* freshReservation(target);
      const restored = yield* Effect.either(restoreArtifact(target, reservation, input));
      if (restored._tag === "Right") {
        const sandboxId = yield* createCurrent(target);
        return {
          _tag: "Restored" as const,
          setupPrefixKey: input.manifest.setupPrefixKey,
          ...artifactReceipt(restored.right.artifact, reservation),
          sandboxId,
        };
      }
      if (isArtifactMiss(restored.left)) {
        yield* createCurrent(target);
        return { _tag: "Miss" as const, setupPrefixKey: input.manifest.setupPrefixKey };
      }

      // A corrupt/interrupted restore may quarantine or partially populate its
      // target. Release proves scrub, then continue from a different clean slot
      // so the runner can try a shorter verified prefix.
      reservation = yield* freshReservation(target);
      yield* createCurrent(target);
      return {
        _tag: "Miss" as const,
        setupPrefixKey: input.manifest.setupPrefixKey,
        recovery: "restore-failed-replayed" as const,
      };
    }).pipe(Effect.mapError((cause) => new SandboxSetupPrefixCacheLookupError({
      operation: "restore Docker profile setup-prefix artifact into a new private slot",
      reason: reasonOf(cause),
      setupPrefixKey: input.manifest.setupPrefixKey,
      domainId: target.session.lease.binding.profile.profileId,
      cause,
    }))),

    captureAndRebase: (input: SandboxSetupPrefixCacheOperation) => Effect.gen(function* () {
      if ((input.knownSensitiveValues?.filter((value) => value.length > 0).length ?? 0) > 0) {
        return {
          _tag: "Unsupported" as const,
          code: "sensitive-state" as const,
          reason: "Docker Profile setup-prefix capture refuses actions with framework-known sensitive values",
        };
      }
      yield* promiseEffect((signal) => target.quiesceAndStop(signal));
      // A transport error, client timeout, decoder rejection, or interruption
      // cannot prove whether the Host is still copying with the source slot
      // unmounted. V1 therefore fails the Attempt and lets the existing Scope
      // owner perform reservation release/reconciliation; it never restarts the
      // old outer container from this ambiguous boundary.
      const captured = yield* promiseEffect((signal) => captureDockerProfileSetupPrefix(
        target.session.lease,
        target.session.currentReservation(),
        input,
        signal,
        target.session.controlTimeoutMs,
      ));

      let reservation = yield* freshReservation(target);
      let restored = yield* Effect.either(restoreArtifact(target, reservation, input, captured.artifact));
      if (restored._tag === "Left") {
        // The action has already succeeded, so Base/shorter-prefix replay is
        // forbidden. Scrub and retry the just-verified artifact once in another
        // fresh slot; a second failure terminates the Attempt.
        reservation = yield* freshReservation(target);
        restored = yield* Effect.either(restoreArtifact(target, reservation, input, captured.artifact));
        if (restored._tag === "Left") return yield* Effect.fail(restored.left);
      }
      const sandboxId = yield* createCurrent(target);
      if (captured.state === "already-published") {
        return {
          _tag: "Contended" as const,
          setupPrefixKey: input.manifest.setupPrefixKey,
          reason: "indexed-generation" as const,
        };
      }
      return {
        _tag: "Captured" as const,
        setupPrefixKey: input.manifest.setupPrefixKey,
        ...artifactReceipt(captured.artifact, reservation),
        sandboxId,
      };
    }).pipe(Effect.mapError((cause) => cause instanceof DockerProfileControlAmbiguityError || cause instanceof DockerProfileControlCancellationError
      ? cause
      : new SandboxSetupPrefixCacheCaptureError({
        operation: "capture Docker profile setup-prefix and restore a private continuation",
        reason: reasonOf(cause),
        setupPrefixKey: input.manifest.setupPrefixKey,
        domainId: target.session.lease.binding.profile.profileId,
        cause,
      }))),

    recoverCleanBase: () => Effect.gen(function* () {
      yield* promiseEffect((signal) => target.quiesceAndStop(signal));
      yield* freshReservation(target);
      const sandboxId = yield* createCurrent(target);
      const eligibility = target.eligibility();
      if (eligibility._tag !== "Eligible") return eligibility;
      return {
        _tag: "RecoveredCleanBase" as const,
        baseImageId: eligibility.baseImageId,
        sandboxId,
      };
    }).pipe(Effect.mapError((cause) => new SandboxSetupPrefixCacheRestoreError({
      operation: "scrub Docker profile private slot and restore clean Base",
      reason: reasonOf(cause),
      domainId: target.session.lease.binding.profile.profileId,
      cause,
    }))),
  });
}
