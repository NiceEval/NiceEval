import { isMainThread, parentPort, workerData } from "node:worker_threads";
import { closeRecordDatabase, openRecordMaintenance, openRecordReader, validateExactSchema } from "./database.ts";
import { sqliteError } from "./errors.ts";
import { verifyAllSealedRuns } from "./storage.ts";
import { withImmediateTransaction } from "./transaction.ts";

interface SnapshotMaintenanceInput {
  readonly backupPath: string;
  readonly vacuumPath: string;
  readonly snapshotIdentity: string;
  readonly sourceStorageGeneration: string;
  readonly createdAt: string;
  readonly deadlineEpochMs: number;
}

function deadline(input: SnapshotMaintenanceInput, phase: string): void {
  if (!Number.isSafeInteger(input.deadlineEpochMs) || Date.now() >= input.deadlineEpochMs) {
    throw sqliteError("record-snapshot-busy", "snapshot", `snapshot ${phase} exceeded its deadline`);
  }
}

function run(input: SnapshotMaintenanceInput): number {
  deadline(input, "maintenance startup");
  const copied = openRecordMaintenance(input.backupPath, {
    vacuumIntoPath: input.vacuumPath,
    allowSnapshotPragmas: true,
  });
  try {
    validateExactSchema(copied, "operational");
    withImmediateTransaction(copied, input.deadlineEpochMs, "snapshot-prune", () => {
      // Tickets, process ownership, leases, and the source barrier are
      // host-local operational facts. A portable generation never retains
      // them, even though the coordination tables share ProjectDatabase.
      copied.db.prepare("DELETE FROM coordination_tickets").run();
      const scrubbed = copied.db.prepare(`UPDATE coordination_state SET
        revision=0,operational_generation=?,next_writer_sequence=1,
        writer_ticket_id=NULL,writer_sequence=NULL,writer_host=NULL,writer_pid=NULL,
        writer_deadline=NULL,writer_enqueued_at=NULL,writer_nonce=NULL,
        writer_admitted_at=NULL,writer_lease_expires_at=NULL,
        barrier_id=NULL,barrier_nonce=NULL,barrier_host=NULL,barrier_pid=NULL,
        barrier_deadline=NULL,barrier_requested_at=NULL,barrier_lease_expires_at=NULL,
        barrier_status=NULL,barrier_active_at=NULL WHERE singleton=1`)
        .run(input.snapshotIdentity);
      if (Number(scrubbed.changes) !== 1) {
        throw sqliteError("record-database-invalid", "snapshot-prune", "snapshot coordination generation was not rebuilt");
      }
      copied.db.prepare(`UPDATE runs SET status='open',candidate_seal_identity=NULL,candidate_seal_entry_count=NULL,candidate_seal_staged_count=0
        WHERE status='sealing'`).run();
      copied.db.prepare("DELETE FROM runs WHERE status IN ('open','sealing')").run();
      const marked = copied.db.prepare(`UPDATE record_metadata SET artifact_kind='snapshot',snapshot_identity=?,
        snapshot_source_generation=?,snapshot_created_at=? WHERE singleton=1 AND artifact_kind='operational'`)
        .run(input.snapshotIdentity, input.sourceStorageGeneration, input.createdAt);
      if (Number(marked.changes) !== 1) {
        throw sqliteError("record-database-invalid", "snapshot-prune", "snapshot artifact marker was not established exactly once");
      }
    });
    deadline(input, "prune");
    copied.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE;");
    deadline(input, "checkpoint");
    copied.db.prepare("VACUUM INTO ?").run(input.vacuumPath);
    deadline(input, "vacuum");
  } finally {
    closeRecordDatabase(copied);
  }

  const validated = openRecordReader(input.vacuumPath, "snapshot");
  try {
    validateExactSchema(validated, "snapshot");
    return verifyAllSealedRuns(validated, true, input.deadlineEpochMs);
  } finally {
    closeRecordDatabase(validated);
  }
}

if (!isMainThread && parentPort !== null) {
  try {
    const input = workerData as SnapshotMaintenanceInput;
    parentPort.postMessage(Object.freeze({ state: "success", sealedRunCount: run(input) }));
  } catch (cause) {
    const error = cause instanceof Error ? cause : new Error(String(cause));
    parentPort.postMessage(Object.freeze({ state: "failure", message: error.message }));
  }
}
