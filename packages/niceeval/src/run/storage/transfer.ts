// @concord-file
// @concord-implements docs/feature/run/architecture/storage.md
import { createHash, randomUUID } from "node:crypto";
import { Result } from "effect";
import { decodeAttemptPublicationClosure, decodeRunDocument } from "../../record/codec/core.ts";
import type { SQLInputValue, SQLOutputValue } from "node:sqlite";
import {
  closeRecordDatabase, makeProjectDatabasePortable, openRecordReader, openRecordWriter,
  recordStatement, type RecordDatabase,
} from "../../record/sqlite/database.ts";
import { sqliteError } from "../../record/sqlite/errors.ts";
import { validatePortableRecordDatabase } from "../../record/sqlite/portable-capture.ts";
import { withImmediateTransaction } from "../../record/sqlite/transaction.ts";
import { exactLogicalSealIdentityFromOrdered, recordSealEntry } from "../../record/sqlite/seal.ts";
import type { SealEntry } from "../../record/sqlite/types.ts";
import { RunStorageError } from "./errors.ts";

type Row = Record<string, SQLOutputValue>;

// Fixed schema owners only. Each cursor retains at most one row (including one chunk).
const tables = [
  ["runs", "run_id=?", "run_id"],
  ["slots", "run_id=?", "ordinal"],
  ["attempts", "origin_run_id=?", "attempt_id"],
  ["members", "target_run_id=?", "slot_id"],
  ["attachments", "owner_run_id=?", "attachment_id"],
  ["attachment_references", "attachment_id IN (SELECT attachment_id FROM ne19_attachments WHERE owner_run_id=?)", "attachment_id,ordinal"],
  ["collection_items", "attachment_id IN (SELECT attachment_id FROM ne19_attachments WHERE owner_run_id=?)", "attachment_id,ordinal"],
  ["contents", "attachment_id IN (SELECT attachment_id FROM ne19_attachments WHERE owner_run_id=?)", "content_id"],
  ["content_chunks", "content_id IN (SELECT c.content_id FROM ne19_contents c JOIN ne19_attachments a USING(attachment_id) WHERE a.owner_run_id=?)", "content_id,ordinal"],
  ["run_seal_entries", "run_id=?", "ordinal"],
  ["run_resources", "run_id=?", "run_id"],
  ["run_expected_slots", "run_id=?", "ordinal"],
  ["attempt_publications", "origin_run_id=?", "attempt_id"],
  ["run_slot_bindings", "target_run_id=?", "slot_id"],
  ["run_slot_absences", "run_id=?", "slot_id"],
  ["run_recoveries", "run_id=?", "run_id"],
] as const;
type Table = typeof tables[number][0];
const publicationRevisions = new Set([
  "created_revision", "close_revision", "published_revision", "attempt_publication_revision",
  "binding_revision", "absence_revision", "recovery_revision",
]);

function rows(connection: RecordDatabase, table: Table, runId: string): Iterable<Row> {
  const [, predicate, order] = tables.find(([name]) => name === table)!;
  return recordStatement(connection, `SELECT * FROM ne19_${table} WHERE ${predicate} ORDER BY ${order}`)
    .iterate(runId) as Iterable<Row>;
}
function checkDeadline(deadline: number): void {
  if (Date.now() >= deadline) throw sqliteError("record-resource-limit-exceeded", "transfer-runs", "Run transfer exceeded its deadline");
}
function insert(connection: RecordDatabase, table: Table, row: Row): void {
  const names = Object.keys(row);
  recordStatement(connection, `INSERT INTO ne19_${table}(${names.join(",")}) VALUES (${names.map(() => "?").join(",")})`)
    .run(...Object.values(row) as SQLInputValue[]);
}
function fingerprint(connection: RecordDatabase, runId: string, deadline: number): string {
  const hash = createHash("sha256");
  for (const [table] of tables) {
    hash.update(table);
    for (const row of rows(connection, table, runId)) {
      checkDeadline(deadline);
      if (table === "run_seal_entries" && row.entry_kind === "record") continue;
      // Revisions belong to the destination clock, not immutable Run content.
      hash.update(JSON.stringify(Object.entries(row).filter(([name]) =>
        !publicationRevisions.has(name) && name !== "mutation_sequence" &&
        !(table === "runs" && (name === "candidate_seal_identity" || name === "logical_seal_identity"))).map(([name, value]) =>
        [name, typeof value === "bigint" ? value.toString() : value instanceof Uint8Array ? Buffer.from(value).toString("hex") : value])));
    }
  }
  return hash.digest("hex");
}

function selectedClosure(source: RecordDatabase, selected: readonly string[], deadline: number): readonly string[] {
  const result = new Set(selected);
  for (const runId of result) {
    checkDeadline(deadline);
    const run = recordStatement(source, `SELECT r.status,rr.terminal_state,d.run_id deleted
      FROM ne19_runs r LEFT JOIN ne19_run_resources rr USING(run_id)
      LEFT JOIN ne19_run_deletion_tombstones d USING(run_id) WHERE r.run_id=?`).get(runId) as Row | undefined;
    if (run === undefined || run.deleted !== null) throw new RunStorageError("run-not-found", `Run ${runId} does not exist`);
    if (run.status !== "sealed" || run.terminal_state === null) {
      throw new RunStorageError("run-not-active", `Run ${runId} must be completely sealed before transfer`);
    }
    for (const row of recordStatement(source, `SELECT DISTINCT origin_run_id FROM ne19_members
      WHERE target_run_id=? AND origin_run_id IS NOT NULL UNION SELECT DISTINCT origin_run_id
      FROM ne19_run_slot_bindings WHERE target_run_id=?`).iterate(runId, runId) as Iterable<Row>) {
      result.add(String(row.origin_run_id));
    }
  }
  return [...result];
}

/** Seal validation covers immutable facts; these checks cover the publication envelope. */
function validatePublication(source: RecordDatabase, runId: string, deadline: number): void {
  const invalid = () => sqliteError("record-seal-incomplete", "transfer-runs", `Run ${runId} publication closure is invalid`);
  const resource = [...rows(source, "run_resources", runId)][0];
  if (resource === undefined) throw invalid();
  const stored = [...rows(source, "runs", runId)][0]!;
  const payload = stored.core_payload;
  if (!(payload instanceof Uint8Array)) throw invalid();
  let core;
  try { core = decodeRunDocument(JSON.parse(Buffer.from(payload).toString("utf8"))); }
  catch { throw invalid(); }
  if (Result.isFailure(core) || core.success.runId !== runId || core.success.experimentId !== resource.experiment_id ||
    stored.experiment_id !== resource.experiment_id || stored.started_at !== resource.started_at ||
    core.success.startedAt !== Date.parse(String(resource.started_at))) throw invalid();
  const expected = [...rows(source, "run_expected_slots", runId)];
  if (expected.length !== core.success.expectedSlots.length || expected.some((row, index) => {
    const slot = core.success.expectedSlots[index]!;
    return row.ordinal !== BigInt(index) || row.slot_id !== slot.slotId || row.eval_id !== slot.evalId ||
      row.attempt_ordinal !== BigInt(slot.attemptOrdinal) || row.execution_identity_digest !== slot.executionIdentityDigest;
  })) throw invalid();
  const clock = recordStatement(source, "SELECT revision FROM ne19_run_publication_clock WHERE singleton=1").get() as Row;
  if (BigInt(resource.close_revision as bigint) > BigInt(clock.revision as bigint)) throw invalid();
  const mismatches = recordStatement(source, `SELECT
    (SELECT count(*) FROM ne19_run_expected_slots e LEFT JOIN ne19_slots s ON s.run_id=e.run_id AND s.slot_id=e.slot_id
      LEFT JOIN ne19_run_slot_bindings b ON b.target_run_id=e.run_id AND b.slot_id=e.slot_id
      LEFT JOIN ne19_run_slot_absences a ON a.run_id=e.run_id AND a.slot_id=e.slot_id
      WHERE e.run_id=? AND (s.slot_id IS NULL OR s.ordinal!=e.ordinal OR
        (b.attempt_id IS NULL AND a.reason IS NULL) OR (b.attempt_id IS NOT NULL AND a.reason IS NOT NULL)))+
    (SELECT count(*) FROM ne19_slots s WHERE s.run_id=? AND NOT EXISTS
      (SELECT 1 FROM ne19_run_expected_slots e WHERE e.run_id=s.run_id AND e.slot_id=s.slot_id))+
    (SELECT count(*) FROM ne19_run_slot_bindings b JOIN ne19_attempt_publications p USING(attempt_id)
      LEFT JOIN ne19_members m ON m.target_run_id=b.target_run_id AND m.slot_id=b.slot_id
      WHERE b.target_run_id=? AND (p.origin_run_id!=b.origin_run_id OR p.origin_slot_id!=b.origin_slot_id OR
        p.published_revision!=b.attempt_publication_revision OR p.published_revision>b.binding_revision OR
        b.binding_revision<=? OR b.binding_revision>=? OR m.attempt_id IS NULL OR m.attempt_id!=b.attempt_id OR
        m.origin_run_id!=b.origin_run_id OR m.action!=b.action))+
    (SELECT count(*) FROM ne19_run_slot_absences WHERE run_id=? AND absence_revision!=?)+
    (SELECT count(*) FROM ne19_attempts a LEFT JOIN ne19_attempt_publications p ON p.attempt_id=a.attempt_id
      WHERE a.origin_run_id=? AND (a.publication_state!='published' OR p.attempt_id IS NULL OR
        p.origin_run_id!=a.origin_run_id OR p.attempt_locator!=a.attempt_locator)) AS count`).get(
      runId, runId, runId, resource.created_revision!, resource.close_revision!, runId, resource.close_revision!, runId,
    ) as Row;
  if (mismatches.count !== 0n) throw invalid();
  for (const publication of rows(source, "attempt_publications", runId)) {
    checkDeadline(deadline);
    const payload = publication.closure_payload;
    if (!(payload instanceof Uint8Array) || createHash("sha256").update(payload).digest("hex") !== publication.closure_digest ||
      BigInt(publication.published_revision as bigint) <= BigInt(resource.created_revision as bigint) ||
      BigInt(publication.published_revision as bigint) >= BigInt(resource.close_revision as bigint)) throw invalid();
    let decoded;
    try { decoded = decodeAttemptPublicationClosure(JSON.parse(Buffer.from(payload).toString("utf8"))); }
    catch { throw invalid(); }
    if (Result.isFailure(decoded) || decoded.success.originRun.runId !== runId ||
      decoded.success.originRun.experimentId !== resource.experiment_id ||
      JSON.stringify(decoded.success.originRun.expectedSlots) !== JSON.stringify(core.success.expectedSlots)) throw invalid();
    const origin = recordStatement(source, `SELECT b.attempt_id FROM ne19_run_slot_bindings b
      JOIN ne19_attempts a ON a.origin_run_id=b.origin_run_id AND a.attempt_id=b.attempt_id
      WHERE b.target_run_id=? AND b.slot_id=? AND b.attempt_id=? AND b.action='executed' AND b.binding_revision=?
        AND a.publication_state='published'`)
      .get(runId, publication.origin_slot_id!, publication.attempt_id!, publication.published_revision!);
    if (origin === undefined) throw invalid();
  }
}

/** Source is an already validated private generation, or a pinned local read transaction. */
function merge(source: RecordDatabase, target: RecordDatabase, selected: readonly string[], deadline: number) {
  const closure = selectedClosure(source, selected, deadline);
  for (const runId of closure) validatePublication(source, runId, deadline);
  return withImmediateTransaction(target, deadline, "import-runs", () => {
    const imported: string[] = [];
    const alreadyPresent: string[] = [];
    for (const runId of closure) {
      checkDeadline(deadline);
      const existing = recordStatement(target, `SELECT run_id FROM ne19_runs WHERE run_id=?
        UNION SELECT run_id FROM ne19_run_resources WHERE run_id=?`).get(runId, runId);
      if (existing === undefined) imported.push(runId);
      else if (recordStatement(target, "SELECT run_id FROM ne19_run_deletion_tombstones WHERE run_id=?").get(runId) !== undefined ||
        fingerprint(source, runId, deadline) !== fingerprint(target, runId, deadline)) {
        throw new RunStorageError("run-id-collision", `Run ${runId} already exists with different content`);
      } else alreadyPresent.push(runId);
    }
    if (imported.length === 0) return { imported, alreadyPresent };
    const metadata = recordStatement(target, "SELECT barrier_state,record_digest FROM ne19_record_metadata WHERE singleton=1").get() as Row;
    if (metadata.barrier_state === "draining") throw sqliteError("record-command-conflict", "import-runs", "ProjectDatabase portable gate is draining");
    const header = recordStatement(source, "SELECT record_payload,record_digest FROM ne19_record_metadata WHERE singleton=1").get() as Row;
    if (metadata.barrier_state === "portable") {
      const generation = randomUUID();
      recordStatement(target, `UPDATE ne19_record_metadata SET barrier_state='open',storage_generation=?,portable_generation=NULL,
        portable_revision=NULL,portable_gate_id=NULL WHERE singleton=1`).run(generation);
      recordStatement(target, "UPDATE ne19_coordination_state SET operational_generation=?,revision=revision+1 WHERE singleton=1").run(generation);
    }
    if (metadata.record_digest === null) {
      recordStatement(target, "UPDATE ne19_record_metadata SET record_payload=?,record_digest=? WHERE singleton=1")
        .run(header.record_payload!, header.record_digest!);
    }
    const recordDigest = String(metadata.record_digest ?? header.record_digest);
    const clock = recordStatement(target, "SELECT revision FROM ne19_run_publication_clock WHERE singleton=1").get() as Row;
    const offset = BigInt(clock.revision as bigint);
    const sourceClock = recordStatement(source, "SELECT revision FROM ne19_run_publication_clock WHERE singleton=1").get() as Row;
    if (offset + BigInt(sourceClock.revision as bigint) > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw sqliteError("record-resource-limit-exceeded", "import-runs", "Publication clock exceeds safe integer range");
    }
    const copy = (table: Table, transform: (row: Row) => Row = (row) => row) => {
      for (const runId of imported) for (const original of rows(source, table, runId)) {
        checkDeadline(deadline);
        const row = { ...original };
        for (const name of Object.keys(row)) if (publicationRevisions.has(name) && row[name] !== null) row[name] = BigInt(row[name] as bigint) + offset;
        insert(target, table, transform(row));
      }
    };
    copy("runs", (row) => ({ ...row, status: "open", candidate_seal_identity: null, candidate_seal_entry_count: null,
      candidate_seal_staged_count: 0n, logical_seal_identity: null }));
    copy("slots");
    copy("attempts", (row) => ({ ...row, publication_state: "staging" }));
    for (const table of ["members", "attachments", "attachment_references", "collection_items", "contents", "content_chunks",
      "run_resources", "run_expected_slots", "attempt_publications"] as const) copy(table);
    copy("run_slot_bindings", (row) => {
      const publication = recordStatement(target, "SELECT published_revision FROM ne19_attempt_publications WHERE attempt_id=?").get(row.attempt_id!) as Row;
      return { ...row, attempt_publication_revision: publication.published_revision! };
    });
    copy("run_slot_absences");
    copy("run_recoveries");
    for (const runId of imported) {
      recordStatement(target, "UPDATE ne19_attempts SET publication_state='published' WHERE origin_run_id=?").run(runId);
      const run = [...rows(source, "runs", runId)][0]!;
      // The immutable Run facts survive a change of Record envelope. Only the
      // record entry and the derived envelope Seal identity are regenerated.
      const envelopeEntry = recordSealEntry(recordDigest);
      function* sealEntries(): Iterable<SealEntry> {
        for (const row of rows(source, "run_seal_entries", runId)) {
          checkDeadline(deadline);
          yield row.entry_kind === "record" ? envelopeEntry : {
            kind: row.entry_kind as SealEntry["kind"], logicalIdentity: String(row.logical_identity), digest: String(row.digest),
          };
        }
      }
      const identity = exactLogicalSealIdentityFromOrdered(sealEntries(), Number(run.candidate_seal_entry_count));
      recordStatement(target, `UPDATE ne19_runs SET status='sealing',candidate_seal_identity=?,candidate_seal_entry_count=?,candidate_seal_staged_count=? WHERE run_id=?`)
        .run(identity, run.candidate_seal_entry_count!, run.candidate_seal_staged_count!, runId);
      for (const row of rows(source, "run_seal_entries", runId)) {
        checkDeadline(deadline);
        insert(target, "run_seal_entries", row.entry_kind === "record" ? { ...row, digest: envelopeEntry.digest } : row);
      }
      recordStatement(target, "UPDATE ne19_runs SET status='sealed',logical_seal_identity=? WHERE run_id=?").run(identity, runId);
    }
    recordStatement(target, "UPDATE ne19_run_publication_clock SET revision=? WHERE singleton=1")
      .run(offset + BigInt(sourceClock.revision as bigint));
    return { imported, alreadyPresent };
  });
}

export function importRunsOnConnection(target: RecordDatabase, path: string, deadline: number) {
  const source = openRecordReader(path);
  try {
    source.db.exec("BEGIN");
    const selected = recordStatement(source, `SELECT run_id FROM ne19_runs WHERE status='sealed'
      AND run_id NOT IN (SELECT run_id FROM ne19_run_deletion_tombstones) ORDER BY run_id`).all() as Row[];
    return merge(source, target, selected.map((row) => String(row.run_id)), deadline);
  } finally { closeRecordDatabase(source); }
}

export function exportRunsOnConnection(source: RecordDatabase, selected: readonly string[], path: string, deadline: number) {
  const target = openRecordWriter(path);
  try {
    source.db.exec("BEGIN");
    try { merge(source, target, selected, deadline); }
    finally { source.db.exec("ROLLBACK"); }
  } finally { closeRecordDatabase(target); }
  if (!makeProjectDatabasePortable(path)) throw sqliteError("record-command-conflict", "export-runs", "Export could not become portable");
  const reader = openRecordReader(path);
  try { validatePortableRecordDatabase(reader, deadline); }
  finally { closeRecordDatabase(reader); }
  return { runIds: [...new Set(selected)] };
}
