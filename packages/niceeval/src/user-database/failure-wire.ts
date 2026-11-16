import {
  UserDatabaseBusy,
  UserDatabaseInvalid,
  UserDatabaseLegacyFound,
  UserDatabaseUnsupported,
  type UserDatabaseFailure,
} from "./errors.ts";
import type { UserDatabaseWorkerFailure } from "./protocol.ts";

export function encodeUserDatabaseFailure(failure: UserDatabaseFailure): UserDatabaseWorkerFailure {
  switch (failure._tag) {
    case "UserDatabaseInvalid":
    case "UserDatabaseBusy":
      if (failure.repository === undefined) {
        return { scope: "host", code: failure.code, message: failure.message, cause: failure.cause };
      }
      return {
        scope: "repository",
        code: failure.code,
        message: failure.message,
        repository: failure.repository,
        cause: failure.cause,
      };
    case "UserDatabaseUnsupported":
      return {
        code: failure.code,
        message: failure.message,
        repository: failure.repository,
        databasePath: failure.databasePath,
        cause: failure.cause,
      };
    case "UserDatabaseLegacyFound":
      return {
        code: failure.code,
        message: failure.message,
        legacyPath: failure.legacyPath,
        databasePath: failure.databasePath,
      };
  }
}

export function decodeUserDatabaseFailure(failure: UserDatabaseWorkerFailure): UserDatabaseFailure {
  switch (failure.code) {
    case "user-database-invalid":
      return new UserDatabaseInvalid({
        code: failure.code,
        message: failure.message,
        repository: failure.scope === "repository" ? failure.repository : undefined,
        cause: failure.cause,
      });
    case "user-database-busy":
      return new UserDatabaseBusy({
        code: failure.code,
        message: failure.message,
        repository: failure.scope === "repository" ? failure.repository : undefined,
        cause: failure.cause,
      });
    case "user-database-unsupported":
      return new UserDatabaseUnsupported(failure);
    case "user-database-legacy-found":
      return new UserDatabaseLegacyFound(failure);
  }
}
