/**
 * The initial public Record release has no predecessor to migrate. Keep the
 * package-owned adjacent-step shape here so a later released schema can add a
 * fixed `n -> n + 1` entry without reviving registries or third-party hooks.
 * This module is intentionally outside the ordinary reader import graph.
 */
export interface RecordAdjacentMigration {
  readonly fromSchemaVersion: number;
  readonly toSchemaVersion: number;
}

export const currentRecordAdjacentMigrations = Object.freeze(
  [] as const satisfies readonly RecordAdjacentMigration[],
);
