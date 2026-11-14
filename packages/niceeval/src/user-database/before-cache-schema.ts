import { DatabaseSync } from "node:sqlite";
import { UserDatabaseInvalid } from "./errors.ts";

/** Shared snapshot ledger; provider locators never serve as artifact identities. */
export const BEFORE_CACHE_SNAPSHOT_SCHEMA_SQL = `
CREATE TABLE before_cache_snapshots (
  artifact_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  execution_domain_id TEXT NOT NULL,
  before_cache_key TEXT NOT NULL,
  base_identity TEXT NOT NULL,
  declaration_json TEXT NOT NULL,
  replacement_scope TEXT NOT NULL,
  generation INTEGER UNIQUE NOT NULL CHECK(generation > 0),
  snapshot_name TEXT UNIQUE NOT NULL,
  snapshot_id TEXT,
  requested_at INTEGER,
  state TEXT NOT NULL CHECK(state IN ('preparing', 'ready', 'deleting', 'deleted')),
  lease_token TEXT,
  lease_until INTEGER,
  created_at INTEGER NOT NULL,
  published_at INTEGER,
  UNIQUE(provider, execution_domain_id, snapshot_id),
  CHECK(
    (state = 'preparing' AND lease_token IS NOT NULL AND lease_until IS NOT NULL) OR
    (state IN ('ready', 'deleted') AND lease_token IS NULL AND lease_until IS NULL) OR
    (state = 'deleting' AND ((lease_token IS NULL AND lease_until IS NULL) OR (lease_token IS NOT NULL AND lease_until IS NOT NULL)))
  ),
  CHECK(state != 'ready' OR snapshot_id IS NOT NULL)
) STRICT;
CREATE UNIQUE INDEX before_cache_snapshots_ready_key
  ON before_cache_snapshots(provider, execution_domain_id, before_cache_key) WHERE state = 'ready';
CREATE INDEX before_cache_snapshots_lookup ON before_cache_snapshots(provider, execution_domain_id, before_cache_key, state);
CREATE INDEX before_cache_snapshots_replacement ON before_cache_snapshots(provider, execution_domain_id, replacement_scope, state);
CREATE INDEX before_cache_snapshots_cleanup ON before_cache_snapshots(provider, execution_domain_id, state, lease_until);
CREATE TABLE before_cache_snapshot_holds (
  hold_id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL REFERENCES before_cache_snapshots(artifact_id),
  holder TEXT NOT NULL CHECK(holder IN ('run', 'sandbox')),
  sandbox_id TEXT,
  expires_at INTEGER,
  created_at INTEGER NOT NULL,
  CHECK((holder = 'run' AND expires_at IS NOT NULL AND sandbox_id IS NULL) OR (holder = 'sandbox' AND expires_at IS NULL))
) STRICT;
CREATE INDEX before_cache_snapshot_holds_artifact ON before_cache_snapshot_holds(artifact_id);
`;

type SchemaObject = {
  readonly type: string;
  readonly name: string;
  readonly tbl_name: string;
  readonly sql: string | null;
};
const schema = (database: DatabaseSync): readonly SchemaObject[] =>
  database
    .prepare(
      "SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE tbl_name IN ('before_cache_snapshots', 'before_cache_snapshot_holds') ORDER BY type, name",
    )
    .all() as unknown as readonly SchemaObject[];
const reference = new DatabaseSync(":memory:");
reference.exec(BEFORE_CACHE_SNAPSHOT_SCHEMA_SQL);
const expected = schema(reference);
reference.close();

export const BEFORE_CACHE_SNAPSHOT_SCHEMA_OBJECTS = expected.map(
  ({ type, name, tbl_name }) => [type, name, tbl_name] as const,
);

export function assertBeforeCacheSnapshotSchema(database: DatabaseSync): void {
  const normalize = (objects: readonly SchemaObject[]) =>
    JSON.stringify(
      objects.map((object) => ({
        ...object,
        sql: object.sql?.trim().replace(/;+$/u, "").replace(/\s+/gu, " ") ?? null,
      })),
    );
  if (normalize(schema(database)) !== normalize(expected)) {
    throw new UserDatabaseInvalid({
      code: "user-database-invalid",
      message: "Before cache snapshot schema does not match the current UserDatabase format",
      repository: "before-cache-snapshots",
    });
  }
}
