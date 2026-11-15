import { normalizeExternalCause, type ExternalCause } from "../../shared/external-cause.ts";
import {
  UserDatabaseBusy,
  UserDatabaseInvalid,
  UserDatabaseLegacyFound,
  UserDatabaseUnsupported,
  type UserDatabaseFailure,
} from "../../user-database/errors.ts";

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
