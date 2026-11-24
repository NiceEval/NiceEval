import { Effect } from "effect";
import { normalizeExternalCause } from "../../shared/external-cause.ts";
import {
  BeforeCacheAmbiguityError,
  BeforeCacheCaptureError,
  BeforeCacheCancellationError,
  BeforeCacheLookupError,
  BeforeCacheRestoreError,
  type AttemptBeforeCache,
  type AttemptBeforeCacheEligibility,
  type BeforeCacheBaseEligibility,
  type BeforeCacheStep,
} from "../backend.ts";
import { beforeCacheReplacementScope } from "../before-cache-replacement.ts";
import {
  captureDockerProfileBeforeCache,
  dockerProfileRequestError,
  type DockerProfileRequestError,
  restoreDockerProfileBeforeCache,
  type DockerProfileLease,
  type DockerProfileReservation,
  type DockerProfileBeforeCacheArtifactIdentityV2,
  type DockerProfileBeforeCacheStep,
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
  readonly baseReference: string;
  eligibility(): BeforeCacheBaseEligibility;
  quiesceAndStop(signal: AbortSignal): Promise<void>;
  /** Drop Docker handles only after the outer container has been proven stopped. */
  retireStopped(): void;
  /** Create the original outer container spec against the session's current reservation. */
  createFromCurrent(signal: AbortSignal): Promise<string>;
  /** Reserved for a future strictly-verified terminal Host failure path. */
  resumeStopped(signal: AbortSignal): Promise<string>;
}

function reasonOf(cause: DockerProfileRequestError): string {
  return cause.message;
}

function promiseEffect<A>(operation: (signal: AbortSignal) => Promise<A>): Effect.Effect<A, DockerProfileRequestError> {
  return Effect.tryPromise({
    try: operation,
    catch: dockerProfileRequestError,
  });
}

function freshReservation(
  target: DockerProfileBeforeCacheTarget,
): Effect.Effect<DockerProfileReservation, DockerProfileRequestError> {
  return Effect.andThen(
    Effect.sync(() => target.retireStopped()),
    target.session.replaceReservation,
  ).pipe(Effect.mapError(dockerProfileRequestError));
}

function createCurrent(target: DockerProfileBeforeCacheTarget): Effect.Effect<string, DockerProfileRequestError> {
  return promiseEffect((signal) => target.createFromCurrent(signal));
}

function restoreArtifact(
  target: DockerProfileBeforeCacheTarget,
  reservation: DockerProfileReservation,
  input: DockerProfileBeforeCacheStep,
  expected?: DockerProfileBeforeCacheArtifactIdentityV2,
) {
  return restoreDockerProfileBeforeCache(
    target.session.lease,
    reservation,
    input,
    expected,
    undefined,
    target.session.controlTimeoutMs,
  );
}

function isArtifactMiss(cause: DockerProfileRequestError): boolean {
  switch (cause._tag) {
    case "DockerProfileControlError": {
      const reason = cause.reason;
      switch (reason._tag) {
        case "ArtifactMiss":
          return true;
        case "OperationCancelled":
        case "OperationCancelFenced":
        case "ControlRejected":
          return false;
        default:
          return reason satisfies never;
      }
    }
    case "DockerProfileControlAmbiguityError":
    case "DockerProfileControlCancellationError":
    case "DockerProfileTransportError":
      return false;
    default:
      return cause satisfies never;
  }
}

function artifactReceipt(
  artifact: DockerProfileBeforeCacheArtifactIdentityV2,
  reservation: DockerProfileReservation,
): { readonly entryId: string; readonly generation: number; readonly artifactId: string; readonly imageId: undefined } {
  return {
    entryId: artifact.artifactId,
    generation: reservation.slotGeneration ?? 0,
    artifactId: artifact.artifactId,
    imageId: undefined,
  };
}

function captureFailure(
  cause: DockerProfileRequestError,
  target: DockerProfileBeforeCacheTarget,
  input: BeforeCacheStep,
) {
  const common = {
    operation: "publish Docker profile before-cache artifact",
    beforeCacheKey: input.declaration.beforeCacheKey,
    domainId: target.session.lease.binding.profile.profileId,
    operationId: input.operationId,
    cause: normalizeExternalCause(cause),
  } as const;
  const cancellation = () => {
    return new BeforeCacheCancellationError({
      ...common,
      terminal: "cancel-fenced",
      reason: "the Host fenced the operation and proved its unpublished state was scrubbed",
    });
  };
  switch (cause._tag) {
    case "DockerProfileControlCancellationError":
      return cancellation();
    case "DockerProfileControlAmbiguityError": {
      if (cause.terminal === "cancel-fenced") return cancellation();
      return new BeforeCacheAmbiguityError({
        ...common,
        terminal: "unresolved",
        reason: "the Host could not prove whether before-cache publication completed",
        diagnosticCommand: `niceeval docker profile doctor ${target.session.lease.binding.alias}`,
      });
    }
    case "DockerProfileControlError":
    case "DockerProfileTransportError":
      break;
    default:
      return cause satisfies never;
  }
  return new BeforeCacheCaptureError({
    operation: "capture Docker profile before-cache and restore a private continuation",
    reason: reasonOf(cause),
    beforeCacheKey: input.declaration.beforeCacheKey,
    domainId: target.session.lease.binding.profile.profileId,
    cause: normalizeExternalCause(cause),
  });
}

/**
 * The host owns artifacts and private slots. Every lookup rotates away from the
 * initially-created Base container, restores only into a fresh granted slot,
 * and then replays the exact original container.create spec. This module never
 * enters the ordinary local-Docker image/index cache path.
 */
export function makeDockerProfileBeforeCacheCapability(target: DockerProfileBeforeCacheTarget): AttemptBeforeCache {
  const profile = target.session.lease.binding.profile;
  const domain = profile.backend.filesystem.beforeCache?.executionDomain;
  const replacementScope =
    domain === undefined
      ? undefined
      : { provider: "docker", executionDomainId: domain, baseReference: target.baseReference };
  const wireStep = (input: BeforeCacheStep): DockerProfileBeforeCacheStep => {
    if (replacementScope === undefined) throw new Error("Docker Profile has no before-cache domain.");
    return { ...input, replacementScope: beforeCacheReplacementScope(replacementScope, input) };
  };
  let continuation:
    | { step: DockerProfileBeforeCacheStep; artifact: DockerProfileBeforeCacheArtifactIdentityV2 }
    | undefined;
  return {
    eligibility: () =>
      Effect.sync((): AttemptBeforeCacheEligibility => {
        const eligibility = target.eligibility();
        if (eligibility._tag !== "Eligible") return eligibility;
        if (replacementScope === undefined) {
          return {
            _tag: "Unsupported",
            code: "profile-backed-dind",
            reason: "Docker Profile has no before-cache domain.",
          };
        }
        return { ...eligibility, replacementScope };
      }),

    lookupAndRestore: (input: BeforeCacheStep) =>
      Effect.gen(function* () {
        const step = wireStep(input);
        const metadata = input.declaration.declarationMetadata;
        const parent =
          continuation !== undefined &&
          metadata !== null &&
          typeof metadata === "object" &&
          !Array.isArray(metadata) &&
          metadata.parentKey === continuation.step.declaration.beforeCacheKey
            ? continuation
            : undefined;
        continuation = undefined;
        yield* promiseEffect((signal) => target.quiesceAndStop(signal));
        let reservation = yield* freshReservation(target);
        const restored = yield* Effect.result(restoreArtifact(target, reservation, step));
        if (restored._tag === "Success") {
          const sandboxId = yield* createCurrent(target);
          continuation = { step, artifact: restored.success.artifact };
          return {
            _tag: "Restored" as const,
            beforeCacheKey: input.declaration.beforeCacheKey,
            ...artifactReceipt(restored.success.artifact, reservation),
            sandboxId,
          };
        }
        const miss = isArtifactMiss(restored.failure);
        if (!miss) reservation = yield* freshReservation(target);
        // Probing rotates the slot. A miss on a child must leave its already
        // satisfied parent in the new writable slot before the child executes.
        if (parent !== undefined) yield* restoreArtifact(target, reservation, parent.step, parent.artifact);
        yield* createCurrent(target);
        continuation = parent;
        return {
          _tag: "Miss" as const,
          beforeCacheKey: input.declaration.beforeCacheKey,
          recovery: miss ? undefined : ("restore-failed-replayed" as const),
        };
      }).pipe(
        Effect.mapError(
          (cause) =>
            new BeforeCacheLookupError({
              operation: "restore Docker profile before-cache artifact into a new private slot",
              reason: reasonOf(cause),
              beforeCacheKey: input.declaration.beforeCacheKey,
              domainId: target.session.lease.binding.profile.profileId,
              cause: normalizeExternalCause(cause),
            }),
        ),
      ),

    capture: (input: BeforeCacheStep) =>
      Effect.gen(function* () {
        const step = wireStep(input);
        if (input.knownSensitiveValues.some((value) => value.length > 0)) {
          return {
            _tag: "Unsupported" as const,
            code: "sensitive-state" as const,
            reason: "Docker Profile before-cache capture refuses actions with framework-known sensitive values",
          };
        }
        yield* promiseEffect((signal) => target.quiesceAndStop(signal));
        // A transport error, client timeout, decoder rejection, or interruption
        // cannot prove whether the Host is still copying with the source slot
        // unmounted. The Attempt fails and its Scope
        // owner perform reservation release/reconciliation; it never restarts the
        // old outer container from this ambiguous boundary.
        const captured = yield* captureDockerProfileBeforeCache(
          target.session.lease,
          target.session.currentReservation(),
          step,
          undefined,
          target.session.controlTimeoutMs,
        );

        let reservation = yield* freshReservation(target);
        let restored = yield* Effect.result(restoreArtifact(target, reservation, step, captured.artifact));
        if (restored._tag === "Failure") {
          // The action has already succeeded, so Base/shorter-prefix replay is
          // forbidden. Scrub and retry the just-verified artifact once in another
          // fresh slot; a second failure terminates the Attempt.
          reservation = yield* freshReservation(target);
          restored = yield* Effect.result(restoreArtifact(target, reservation, step, captured.artifact));
          if (restored._tag === "Failure") return yield* Effect.fail(restored.failure);
        }
        const sandboxId = yield* createCurrent(target);
        continuation = { step, artifact: captured.artifact };
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
        continuation = undefined;
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
              beforeCacheKey: undefined,
              cause: normalizeExternalCause(cause),
            }),
        ),
      ),
  };
}
