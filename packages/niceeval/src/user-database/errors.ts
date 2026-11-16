import { Data } from "effect";
import type { ExternalCause } from "../shared/external-cause.ts";

export class UserDatabaseInvalid extends Data.TaggedError("UserDatabaseInvalid")<{
  readonly code: "user-database-invalid";
  readonly message: string;
  readonly repository: string | undefined;
  readonly cause: ExternalCause | undefined;
}> {}

export class UserDatabaseBusy extends Data.TaggedError("UserDatabaseBusy")<{
  readonly code: "user-database-busy";
  readonly message: string;
  readonly repository: string | undefined;
  readonly cause: ExternalCause | undefined;
}> {}

export class UserDatabaseUnsupported extends Data.TaggedError("UserDatabaseUnsupported")<{
  readonly code: "user-database-unsupported";
  readonly message: string;
  readonly repository: string;
  readonly databasePath: string;
  readonly cause: ExternalCause | undefined;
}> {}

export class UserDatabaseLegacyFound extends Data.TaggedError("UserDatabaseLegacyFound")<{
  readonly code: "user-database-legacy-found";
  readonly message: string;
  readonly legacyPath: string;
  readonly databasePath: string;
}> {}

export type UserDatabaseFailure =
  | UserDatabaseInvalid
  | UserDatabaseBusy
  | UserDatabaseUnsupported
  | UserDatabaseLegacyFound;
