import { existsSync } from "node:fs";
import type { SQLOutputValue } from "node:sqlite";
import { Effect, Either, Schema } from "effect";
import { RecordCoordination } from "../../coordination/record-leases.ts";
import { RunIdSchema } from "../codec/identifiers.ts";
import { compareCanonicalIdentity, type RunId } from "../model/identifiers.ts";
import type { RecordIncompleteRunWarning } from "../model/read-state.ts";
import { recordRootPaths } from "../platform/root.ts";
import {
  closeRecordDatabase,
  inspectProjectRecordDatabase,
  openRecordMaintenance,
  recordSqlitePath,
  validateExactSchema,
} from "../sqlite/database.ts";
import { SqliteRecordError } from "../sqlite/errors.ts";
import {
  RECORD_MAINTENANCE_MAXIMUM_RUNS,
  type CleanIncompleteRuns,
  type InspectIncompleteRunWarnings,
  type InspectIncompleteRuns,
  type RecordCleanReceipt,
  type RecordIncompleteRun,
} from "./types.ts";

function canonicalRunIds(runIds: readonly RunId[]): readonly RunId[] {
  return Object.freeze([...new Set(runIds)].sort(compareCanonicalIdentity));
}

function incompleteRun(runId: RunId): RecordIncompleteRun {
  return Object.freeze({ runId });
}

function sqliteFailure(operation: string, cause: unknown): SqliteRecordError {
  return cause instanceof SqliteRecordError
    ? cause
    : new SqliteRecordError("record-sqlite-error", operation, "Record maintenance failed", { cause });
}

function databasePath(root: Parameters<InspectIncompleteRuns>[0]["root"]): string {
  const paths = recordRootPaths(root);
  if (paths === undefined) throw new SqliteRecordError("record-database-invalid", "locate", "Record root is invalid");
  return recordSqlitePath(paths.portableRoot);
}

function maintenancePath(root: Parameters<InspectIncompleteRuns>[0]["root"]): string | undefined {
  const path = databasePath(root);
  const inspection = inspectProjectRecordDatabase(path);
  if (inspection.state === "current") return inspection.exists ? path : undefined;
  throw new SqliteRecordError(
    "record-schema-unsupported",
    "inspect-maintenance",
    inspection.state === "foreign"
      ? "foreign SQLite database is not a ProjectDatabase"
      : `Record database format is unsupported: ${inspection.format}`,
  );
}

function readIncomplete(path: string): readonly RecordIncompleteRun[] {
  if (!existsSync(path)) return Object.freeze([]);
  const connection = openRecordMaintenance(path);
  try {
    validateExactSchema(connection, "operational");
    const rows = connection.db.prepare(
      "SELECT run_id FROM runs WHERE status <> 'sealed' ORDER BY run_id LIMIT ?",
    ).all(RECORD_MAINTENANCE_MAXIMUM_RUNS + 1) as unknown as readonly Record<string, SQLOutputValue>[];
    if (rows.length > RECORD_MAINTENANCE_MAXIMUM_RUNS) {
      throw new SqliteRecordError("record-resource-limit-exceeded", "inspect-incomplete", "incomplete Run discovery exceeded its bounded limit");
    }
    const result: RecordIncompleteRun[] = [];
    for (const row of rows) {
      const decoded = Schema.decodeUnknownEither(RunIdSchema)(row.run_id);
      if (Either.isLeft(decoded)) throw new SqliteRecordError("record-database-invalid", "inspect-incomplete", "runs.run_id is invalid");
      result.push(incompleteRun(decoded.right));
    }
    return Object.freeze(result);
  } finally {
    closeRecordDatabase(connection);
  }
}

function cleanRows(path: string, runIds: readonly RunId[]): RecordCleanReceipt {
  if (!existsSync(path)) return Object.freeze({ deleted: Object.freeze([]), skipped: Object.freeze([...runIds]) });
  const connection = openRecordMaintenance(path);
  try {
    validateExactSchema(connection, "operational");
    const statement = connection.db.prepare("DELETE FROM runs WHERE run_id = ? AND status <> 'sealed'");
    const reopenSealing = connection.db.prepare(`UPDATE runs SET status='open',candidate_seal_identity=NULL,
      candidate_seal_entry_count=NULL,candidate_seal_staged_count=0 WHERE run_id=? AND status='sealing'`);
    const deleted: RunId[] = [];
    const skipped: RunId[] = [];
    connection.db.exec("BEGIN IMMEDIATE");
    try {
      for (const runId of canonicalRunIds(runIds)) {
        reopenSealing.run(runId);
        const receipt = statement.run(runId);
        if (receipt.changes === 1n) deleted.push(runId); else skipped.push(runId);
      }
      connection.db.exec("COMMIT");
    } catch (cause) {
      connection.db.exec("ROLLBACK");
      throw cause;
    }
    return Object.freeze({ deleted: Object.freeze(deleted), skipped: Object.freeze(skipped) });
  } finally {
    closeRecordDatabase(connection);
  }
}

function incompleteRunWarning(runId: RunId): RecordIncompleteRunWarning {
  return Object.freeze({ code: "incomplete-run", runId, cleanupCommand: "niceeval clean" });
}

export function incompleteRunWarnings(incompleteRuns: readonly RecordIncompleteRun[]): readonly RecordIncompleteRunWarning[] {
  return Object.freeze(canonicalRunIds(incompleteRuns.map(({ runId }) => runId)).map(incompleteRunWarning));
}

export const inspectIncompleteRuns: InspectIncompleteRuns = ({ root }) =>
  Effect.scoped(Effect.gen(function* () {
    const path = yield* Effect.try({
      try: () => maintenancePath(root),
      catch: (cause) => sqliteFailure("inspect-incomplete", cause),
    });
    if (path === undefined) return Object.freeze([]);
    const coordination = yield* RecordCoordination;
    yield* coordination.enterRecordMaintenance(root);
    return yield* Effect.try({ try: () => readIncomplete(path), catch: (cause) => sqliteFailure("inspect-incomplete", cause) });
  }));

export const inspectIncompleteRunWarnings: InspectIncompleteRunWarnings = (input) =>
  Effect.map(inspectIncompleteRuns(input), incompleteRunWarnings);

export const cleanIncompleteRuns: CleanIncompleteRuns = ({ root, runIds }) =>
  Effect.scoped(Effect.gen(function* () {
    const path = yield* Effect.try({
      try: () => maintenancePath(root),
      catch: (cause) => sqliteFailure("clean-incomplete", cause),
    });
    if (path === undefined) {
      return Object.freeze({ deleted: Object.freeze([]), skipped: canonicalRunIds(runIds) });
    }
    const coordination = yield* RecordCoordination;
    yield* coordination.enterRecordMaintenance(root);
    return yield* Effect.uninterruptible(Effect.try({ try: () => cleanRows(path, runIds), catch: (cause) => sqliteFailure("clean-incomplete", cause) }));
  }));
