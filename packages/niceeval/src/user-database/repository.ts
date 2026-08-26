import type { DatabaseSync } from "node:sqlite";

export interface NamedUserDatabaseRepositoryRequest {
  readonly repository: string;
}

export interface NamedUserDatabaseRepositoryResult {
  readonly repository: string;
}

export interface UserDatabaseRepositoryHandler<
  Request extends NamedUserDatabaseRepositoryRequest = NamedUserDatabaseRepositoryRequest,
  Result extends NamedUserDatabaseRepositoryResult = NamedUserDatabaseRepositoryResult,
> {
  readonly id: Request["repository"];
  readonly currentRevision: number;
  readonly migrateAdjacent: (database: DatabaseSync, fromRevision: number) => number;
  readonly assertCurrentSchema: (database: DatabaseSync) => void;
  readonly dispatch: (database: DatabaseSync, request: Request) => Result;
}
