import type { DatabaseSync } from "node:sqlite";
import { defineSqliteMigrationCatalog } from "../../sqlite-migration-kernel.ts";
import {
  RECORD_SQLITE_REVISION_1_DIGEST,
  RECORD_SQLITE_REVISION_1_SQL,
} from "./schema.ts";
import {
  RECORD_SQLITE_FORMAT,
  RECORD_SQLITE_STORAGE_REVISION,
} from "./types.ts";

interface RecordBootstrapMigration {
  readonly kind: "bootstrap";
  readonly revision: 1;
  readonly digest: string;
  readonly apply: (database: DatabaseSync, context: RecordMigrationContext) => void;
}

interface RecordLogicalDataMigration {
  readonly kind: "logical-data";
  readonly revision: number;
  readonly digest: string;
  readonly families: readonly {
    readonly family: string;
    readonly fromRevision: number;
    readonly toRevision: number;
  }[];
  readonly apply: (database: DatabaseSync, context: RecordMigrationContext) => void;
}

type RecordStorageMigration =
  | RecordBootstrapMigration
  | RecordLogicalDataMigration;

interface RecordMigrationContext {
  readonly storageGeneration: string;
  readonly appliedAt: string;
}

const revision1: RecordBootstrapMigration = Object.freeze({
  kind: "bootstrap",
  revision: 1,
  digest: RECORD_SQLITE_REVISION_1_DIGEST,
  apply(database: DatabaseSync, context: RecordMigrationContext) {
    database.exec(RECORD_SQLITE_REVISION_1_SQL);
    database.prepare(`INSERT INTO record_metadata(singleton, format, storage_revision, storage_generation,artifact_kind,
      snapshot_identity,snapshot_source_generation,snapshot_created_at,created_at,record_payload,record_digest)
      VALUES (1, ?, ?, ?, 'operational', NULL, NULL, NULL, ?, NULL, NULL)`).run(
      RECORD_SQLITE_FORMAT,
      1,
      context.storageGeneration,
      context.appliedAt,
    );
    database.prepare(`INSERT INTO coordination_state(singleton,revision,operational_generation,next_writer_sequence)
      VALUES (1,0,?,1)`).run(context.storageGeneration);
  },
});

export function recordSqliteMigrations(context: RecordMigrationContext) {
  return defineSqliteMigrationCatalog(
    RECORD_SQLITE_MIGRATIONS.map((migration) => ({
      version: migration.revision,
      digest: migration.digest,
      apply(database: DatabaseSync) {
        migration.apply(database, context);
        if (migration.revision > 1) database.prepare("UPDATE record_metadata SET storage_revision=? WHERE singleton=1").run(migration.revision);
      },
    })),
    RECORD_SQLITE_STORAGE_REVISION,
  );
}

export const RECORD_SQLITE_MIGRATIONS: readonly RecordStorageMigration[] = Object.freeze([revision1]);
