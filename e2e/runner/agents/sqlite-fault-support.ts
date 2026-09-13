import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const projectDatabasePath = (): string =>
  join(process.cwd(), ".niceeval", "record.sqlite");

/**
 * Runner-only fault seam for failures that must occur below the public CLI.
 * Keep physical ProjectDatabase names and SQLite mechanics out of Agent fixtures.
 */
export function holdProjectDatabaseWriteLock(durationMs: number): void {
  const database = new DatabaseSync(projectDatabasePath());
  try {
    database.exec("BEGIN EXCLUSIVE");
  } catch (error) {
    database.close();
    throw error;
  }
  setTimeout(() => {
    try {
      database.exec("ROLLBACK");
    } finally {
      database.close();
    }
  }, durationMs);
}

export function rejectAttemptPublication(): void {
  const publicationTable = "ne18_attempt_publications";
  const triggerName = "reject_attempt_publication";
  const rejectionMessage = "fixture rejected attempt publication";
  const database = new DatabaseSync(projectDatabasePath());
  try {
    const table = database
      .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = ?")
      .get(publicationTable) as { readonly name?: unknown } | undefined;
    if (table?.name !== publicationTable) {
      throw new Error(`runner SQLite fault seam could not find ${publicationTable}`);
    }

    database.exec(`CREATE TRIGGER ${triggerName}
      BEFORE INSERT ON ${publicationTable}
      BEGIN SELECT RAISE(ABORT, '${rejectionMessage}'); END`);

    const trigger = database
      .prepare(
        "SELECT name, tbl_name AS tableName FROM sqlite_schema WHERE type = 'trigger' AND name = ?",
      )
      .get(triggerName) as
      | { readonly name?: unknown; readonly tableName?: unknown }
      | undefined;
    if (trigger?.name !== triggerName || trigger.tableName !== publicationTable) {
      throw new Error(`runner SQLite fault seam did not install ${triggerName}`);
    }
  } finally {
    database.close();
  }
}
