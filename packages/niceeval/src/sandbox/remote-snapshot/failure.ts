import { Option, Schema } from "effect";
import { normalizeExternalCause, type ExternalCause } from "../../shared/external-cause.ts";
import {
  UserDatabaseBusy,
  UserDatabaseInvalid,
  UserDatabaseLegacyFound,
  UserDatabaseUnsupported,
  type UserDatabaseFailure,
} from "../../user-database/errors.ts";
import type { BeforeCacheArtifact } from "../layer.ts";

const Locator = Schema.Struct({ artifactId: Schema.String, executionDomainId: Schema.String });
const locatorOptions = { onExcessProperty: "error" } as const;
export const decodeSnapshotLocator = Schema.decodeUnknownSync(Locator, locatorOptions);
const parseSnapshotLocator = Schema.decodeUnknownOption(Locator, locatorOptions);

export function snapshotRestoreDiagnostic(artifact: BeforeCacheArtifact | undefined, reason: string) {
  const artifactId = Option.getOrUndefined(parseSnapshotLocator(artifact?.locator))?.artifactId;
  const stage =
    reason === "snapshot-gone"
      ? "snapshot-lookup"
      : reason === "snapshot-restore-failed"
        ? "create-instance"
        : reason === "marker-mismatch"
          ? "verify-marker"
          : reason === "hold-missing"
            ? "acquire-hold"
            : "resolve-artifact";
  return { stage, artifactId };
}

export function beforeCacheFailureCause(cause: unknown): UserDatabaseFailure | ExternalCause {
  if (
    cause instanceof UserDatabaseBusy ||
    cause instanceof UserDatabaseInvalid ||
    cause instanceof UserDatabaseLegacyFound ||
    cause instanceof UserDatabaseUnsupported
  )
    return cause;
  return normalizeExternalCause(cause);
}

/** Only classified database messages are safe to publish. SDK payloads and stacks stay private. */
export function beforeCacheFailureDetail(
  cause: UserDatabaseFailure | ExternalCause | undefined,
  fallback: string,
): string {
  if (cause === undefined) return fallback;
  switch (cause._tag) {
    case "UserDatabaseBusy":
    case "UserDatabaseInvalid":
    case "UserDatabaseLegacyFound":
      return `${cause.code}: ${cause.message}`;
    case "UserDatabaseUnsupported":
      return `Unsupported user database format (${cause.code}). Stop consumers, reconcile retained provider artifacts and holds, then remove the user database and rerun (${cause.databasePath}).`;
    case "Error":
    case "Object":
    case "ThrownValue":
      return fallback;
  }
}
