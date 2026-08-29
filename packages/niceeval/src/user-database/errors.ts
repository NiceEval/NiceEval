import { Data } from "effect";

export class UserDatabaseInvalid extends Data.TaggedError("UserDatabaseInvalid")<{
  readonly code: "user-database-invalid";
  readonly message: string;
  readonly repository?: string;
  readonly cause?: unknown;
}> {}

export class UserDatabaseBusy extends Data.TaggedError("UserDatabaseBusy")<{
  readonly code: "user-database-busy";
  readonly message: string;
  readonly repository?: string;
  readonly cause?: unknown;
}> {}

export class UserDatabaseUnsupported extends Data.TaggedError("UserDatabaseUnsupported")<{
  readonly code: "user-database-unsupported";
  readonly message: string;
  readonly repository: string;
  readonly databaseBaseline: string;
  readonly supportedBaseline: string;
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
