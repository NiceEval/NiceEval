import { createHash } from "node:crypto";
import { unlinkSync } from "node:fs";
import type { SQLOutputValue } from "node:sqlite";
import { decodeAttemptLocator } from "../../record/locator.ts";
import {
  closeRecordDatabase,
  checkpointRecordDatabase,
  openRecordReader,
  openRecordWriter,
  recordSqlitePath,
  recordStatement,
  type RecordDatabase,
} from "../../record/sqlite/database.ts";
import { sqliteError } from "../../record/sqlite/errors.ts";
import { withImmediateTransaction } from "../../record/sqlite/transaction.ts";
import { RECORD_SQLITE_MAX_ROW_BYTES } from "../../record/sqlite/types.ts";
import { RunStorageError } from "./errors.ts";
import {
  RUN_ABSENCE_REASONS,
  RUN_TERMINAL_STATES,
  type AttemptPublicationIdentity,
  type AttemptPublicationReceipt,
  type BindAttemptReferenceInput,
  type CloseRunResourceInput,
  type CreateRunResourceInput,
  type DeleteRunReceipt,
  type DeleteRunResourceInput,
  type ExpectedRunSlot,
  type PublicationCutoff,
  type PublishedAttempt,
  type PublishOriginAttemptInput,
  type ReadableRunResource,
  type RecoverRunReceipt,
  type RecoverRunResourceInput,
  type ReferenceBindingReceipt,
  type RunAbsenceReason,
  type RunMutationReceipt,
  type RunReferenceDependency,
  type RunResourcePage,
  type RunSlotPublication,
  type RunState,
  type RunTerminalState,
} from "./types.ts";

type Row = Readonly<Record<string, SQLOutputValue>>;

function text(row: Row, field: string): string {
  const value = row[field];
  if (typeof value !== "string") throw invalid(`SQLite field ${field} is not text`);
  return value;
}

function optionalText(row: Row, field: string): string | undefined {
  const value = row[field];
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "string") throw invalid(`SQLite field ${field} is not nullable text`);
  return value;
}

function integer(row: Row, field: string): number {
  const value = row[field];
  const number = typeof value === "bigint" ? Number(value) : value;
  if (typeof number !== "number" || !Number.isSafeInteger(number)) {
    throw invalid(`SQLite field ${field} is not a safe integer`);
  }
  return number;
}

function bytes(row: Row, field: string): Uint8Array {
  const value = row[field];
  if (!(value instanceof Uint8Array)) throw invalid(`SQLite field ${field} is not bytes`);
  return new Uint8Array(value);
}

function invalid(message: string): RunStorageError {
  return new RunStorageError("run-storage-invalid", message);
}

function requireIdentity(value: string, field: string): void {
  if (value.length === 0 || value.length > 1_024 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw invalid(`${field} is not a bounded domain identity`);
  }
}

function requireIsoInstant(value: string, field: string): void {
  requireIdentity(value, field);
  if (!Number.isFinite(Date.parse(value))) throw invalid(`${field} is not an ISO instant`);
}

function requireDigest(value: string, field: string): void {
  if (!/^[a-f0-9]{64}$/u.test(value)) throw invalid(`${field} is not a lowercase SHA-256 digest`);
}

function requireTerminalState(value: string): asserts value is RunTerminalState {
  if (!(RUN_TERMINAL_STATES as readonly string[]).includes(value)) throw invalid(`Run state ${value} is not terminal`);
}

function requireAbsenceReason(value: string): asserts value is RunAbsenceReason {
  if (!(RUN_ABSENCE_REASONS as readonly string[]).includes(value)) throw invalid(`Run absence reason ${value} is invalid`);
}

function requireClosure(bytes: Uint8Array, digest: string): void {
  requireDigest(digest, "closureDigest");
  if (bytes.byteLength > RECORD_SQLITE_MAX_ROW_BYTES) {
    throw invalid(`Attempt closure exceeds the ${RECORD_SQLITE_MAX_ROW_BYTES} byte row ceiling`);
  }
  if (createHash("sha256").update(bytes).digest("hex") !== digest) {
    throw invalid("Attempt closure bytes do not match closureDigest");
  }
}

function copyRows(
  target: RecordDatabase,
  source: RecordDatabase,
  table: string,
  columns: readonly string[],
  where: string,
  parameters: readonly (string | number)[],
): void {
  const rows = source.db.prepare(`SELECT ${columns.join(",")} FROM ${table} WHERE ${where}`).all(...parameters) as unknown as readonly Row[];
  if (rows.length === 0) return;
  const statement = recordStatement(target, `INSERT OR REPLACE INTO ${table}(${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`);
  for (const row of rows) statement.run(...columns.map((column) => row[column] as never));
}

function publishedAttemptIds(connection: RecordDatabase, runId: string, currentAttemptId?: string): readonly string[] {
  const rows = recordStatement(connection, "SELECT attempt_id FROM attempt_publications WHERE origin_run_id=? ORDER BY attempt_id")
    .all(runId) as unknown as readonly Row[];
  return Object.freeze([...rows.map((row) => text(row, "attempt_id")), ...(currentAttemptId === undefined ? [] : [currentAttemptId])]);
}

function copyStagedRunClosure(
  target: RecordDatabase,
  stagingDatabasePath: string,
  runId: string,
  attemptIds: readonly string[],
  final: boolean,
): void {
  const source = openRecordReader(stagingDatabasePath);
  try {
    const record = source.db.prepare("SELECT record_payload,record_digest FROM record_metadata WHERE singleton=1").get() as Row | undefined;
    if (record === undefined || !(record.record_payload instanceof Uint8Array) || typeof record.record_digest !== "string") {
      throw invalid("Staging Record Core is missing");
    }
    const stagedPayload = record.record_payload;
    const stagedDigest = record.record_digest;
    const canonicalRecord = recordStatement(target, "SELECT record_payload,record_digest FROM record_metadata WHERE singleton=1").get() as Row | undefined;
    if (canonicalRecord === undefined) throw invalid("Canonical Record identity is missing");
    if (canonicalRecord.record_payload === null && canonicalRecord.record_digest === null) {
      const initialized = recordStatement(target, `UPDATE record_metadata SET record_payload=?,record_digest=?
        WHERE singleton=1 AND record_payload IS NULL AND record_digest IS NULL`).run(stagedPayload, stagedDigest);
      if (Number(initialized.changes) !== 1) throw invalid("Canonical Record Core changed before initialization");
    } else {
      const canonicalPayload = canonicalRecord.record_payload;
      if (!(canonicalPayload instanceof Uint8Array) || canonicalRecord.record_digest !== stagedDigest ||
        canonicalPayload.byteLength !== stagedPayload.byteLength ||
        canonicalPayload.some((value, index) => value !== stagedPayload[index])) {
        throw invalid("Staging Record Core does not match the canonical Record Core");
      }
    }
    const run = source.db.prepare(`SELECT run_id,status,writer_generation,started_at,core_payload,core_digest,mutation_sequence,
      candidate_seal_identity,candidate_seal_entry_count,candidate_seal_staged_count,logical_seal_identity FROM runs WHERE run_id=?`)
      .get(runId) as Row | undefined;
    if (run === undefined) throw invalid(`Staging Run ${runId} is missing`);
    recordStatement(target, `INSERT INTO runs(run_id,status,writer_generation,started_at,core_payload,core_digest,mutation_sequence,
      candidate_seal_identity,candidate_seal_entry_count,candidate_seal_staged_count,logical_seal_identity)
      VALUES (?,'open',?,?,?,?,?,NULL,NULL,0,NULL)
      ON CONFLICT(run_id) DO UPDATE SET writer_generation=excluded.writer_generation,started_at=excluded.started_at,
      core_payload=excluded.core_payload,core_digest=excluded.core_digest,mutation_sequence=excluded.mutation_sequence`)
      .run(runId, text(run, "writer_generation"), text(run, "started_at"), run.core_payload as never, run.core_digest as never, integer(run, "mutation_sequence"));
    copyRows(target, source, "slots", ["run_id", "slot_id", "ordinal", "core_payload", "core_digest"], "run_id=?", [runId]);
    for (const attemptId of attemptIds) {
      copyRows(target, source, "attempts", ["origin_run_id", "attempt_id", "attempt_locator", "core_payload", "core_digest"],
        "origin_run_id=? AND attempt_id=? AND core_payload IS NOT NULL", [runId, attemptId]);
    }
    const allowed = new Set(attemptIds);
    const members = source.db.prepare(`SELECT target_run_id,slot_id,origin_run_id,attempt_id,action,core_payload,core_digest
      FROM members WHERE target_run_id=? ORDER BY slot_id`).all(runId) as unknown as readonly Row[];
    const memberInsert = recordStatement(target, `INSERT OR REPLACE INTO members(target_run_id,slot_id,origin_run_id,attempt_id,action,core_payload,core_digest)
      VALUES (?,?,?,?,?,?,?)`);
    for (const member of members) {
      const originAttemptId = optionalText(member, "attempt_id");
      if (originAttemptId !== undefined && optionalText(member, "origin_run_id") === runId && !allowed.has(originAttemptId)) continue;
      memberInsert.run(...["target_run_id", "slot_id", "origin_run_id", "attempt_id", "action", "core_payload", "core_digest"].map((key) => member[key] as never));
    }
    const attachments = source.db.prepare(`SELECT attachment_id,owner_kind,owner_run_id,owner_attempt_id,family,family_revision,
      logical_identity,canonical_payload,canonical_digest,logical_inventory,inventory_digest FROM attachments WHERE owner_run_id=? ORDER BY attachment_id`)
      .all(runId) as unknown as readonly Row[];
    const attachmentColumns = ["attachment_id", "owner_kind", "owner_run_id", "owner_attempt_id", "family", "family_revision", "logical_identity", "canonical_payload", "canonical_digest", "logical_inventory", "inventory_digest"] as const;
    const attachmentInsert = recordStatement(target, `INSERT OR REPLACE INTO attachments(${attachmentColumns.join(",")}) VALUES (${attachmentColumns.map(() => "?").join(",")})`);
    const copiedAttachments: string[] = [];
    for (const attachment of attachments) {
      const ownerAttemptId = optionalText(attachment, "owner_attempt_id");
      if (ownerAttemptId !== undefined && !allowed.has(ownerAttemptId)) continue;
      if (ownerAttemptId === undefined && !final) continue;
      attachmentInsert.run(...attachmentColumns.map((key) => attachment[key] as never));
      copiedAttachments.push(text(attachment, "attachment_id"));
    }
    for (const attachmentId of copiedAttachments) {
      copyRows(target, source, "attachment_references", ["attachment_id", "ordinal", "target_owner_kind", "target_family", "canonical_payload", "reference_digest"], "attachment_id=?", [attachmentId]);
      copyRows(target, source, "collection_items", ["attachment_id", "ordinal", "logical_identity", "canonical_payload", "canonical_digest"], "attachment_id=?", [attachmentId]);
      const contents = source.db.prepare("SELECT content_id FROM contents WHERE attachment_id=? ORDER BY content_id").all(attachmentId) as unknown as readonly Row[];
      copyRows(target, source, "contents", ["content_id", "attachment_id", "logical_handle", "byte_length", "overall_digest", "chunk_count"], "attachment_id=?", [attachmentId]);
      for (const content of contents) copyRows(target, source, "content_chunks", ["content_id", "ordinal", "bytes", "chunk_digest"], "content_id=?", [text(content, "content_id")]);
    }
    if (final) {
      recordStatement(target, "UPDATE runs SET status='sealing',candidate_seal_identity=?,candidate_seal_entry_count=?,candidate_seal_staged_count=? WHERE run_id=?")
        .run(run.candidate_seal_identity as never, run.candidate_seal_entry_count as never, run.candidate_seal_staged_count as never, runId);
      copyRows(target, source, "run_seal_entries", ["run_id", "ordinal", "entry_kind", "logical_identity", "digest"], "run_id=?", [runId]);
      recordStatement(target, `UPDATE runs SET status='sealed',writer_generation=?,started_at=?,core_payload=?,core_digest=?,mutation_sequence=?,
        candidate_seal_identity=?,candidate_seal_entry_count=?,candidate_seal_staged_count=?,logical_seal_identity=? WHERE run_id=?`)
        .run(text(run, "writer_generation"), text(run, "started_at"), run.core_payload as never, run.core_digest as never,
          integer(run, "mutation_sequence"), run.candidate_seal_identity as never, run.candidate_seal_entry_count as never,
          run.candidate_seal_staged_count as never, run.logical_seal_identity as never, runId);
    }
  } finally {
    closeRecordDatabase(source);
  }
}

function metadataGeneration(connection: RecordDatabase): string {
  const row = recordStatement(connection, "SELECT storage_generation FROM record_metadata WHERE singleton=1").get() as
    | Row
    | undefined;
  if (row === undefined) throw invalid("ProjectDatabase storage generation is missing");
  return text(row, "storage_generation");
}

function currentRevision(connection: RecordDatabase): number {
  const row = recordStatement(connection, "SELECT revision FROM run_publication_clock WHERE singleton=1").get() as
    | Row
    | undefined;
  if (row === undefined) throw invalid("Run publication clock is missing");
  return integer(row, "revision");
}

function cutoffAt(connection: RecordDatabase, revision: number): PublicationCutoff {
  return Object.freeze({ storeGeneration: metadataGeneration(connection), revision });
}

function nextRevision(connection: RecordDatabase): number {
  const changed = recordStatement(connection, "UPDATE run_publication_clock SET revision=revision+1 WHERE singleton=1").run();
  if (Number(changed.changes) !== 1) throw invalid("Run publication clock could not advance");
  return currentRevision(connection);
}

function requireCutoff(connection: RecordDatabase, requested?: PublicationCutoff): PublicationCutoff {
  const latest = cutoffAt(connection, currentRevision(connection));
  if (requested === undefined) return latest;
  if (requested.storeGeneration !== latest.storeGeneration || requested.revision < 0 ||
    !Number.isSafeInteger(requested.revision) || requested.revision > latest.revision) {
    throw new RunStorageError(
      "publication-cutoff-restart-required",
      "PublicationCutoff cannot be continued in the current store generation",
    );
  }
  return Object.freeze({ ...requested });
}

interface RunHeader {
  readonly runId: string;
  readonly writerGeneration: string;
  readonly terminalState?: RunTerminalState;
  readonly createdRevision: number;
  readonly closeRevision?: number;
}

function runHeader(connection: RecordDatabase, runId: string): RunHeader | undefined {
  const row = recordStatement(connection, `SELECT run_id,current_writer_generation,terminal_state,created_revision,close_revision
    FROM run_resources WHERE run_id=?`).get(runId) as Row | undefined;
  if (row === undefined) return undefined;
  const terminalState = optionalText(row, "terminal_state");
  if (terminalState !== undefined) requireTerminalState(terminalState);
  return Object.freeze({
    runId: text(row, "run_id"),
    writerGeneration: text(row, "current_writer_generation"),
    ...(terminalState === undefined ? {} : { terminalState }),
    createdRevision: integer(row, "created_revision"),
    ...(row.close_revision === null ? {} : { closeRevision: integer(row, "close_revision") }),
  });
}

function requireActiveWriter(connection: RecordDatabase, runId: string, writerGeneration: string): RunHeader {
  const run = runHeader(connection, runId);
  if (run === undefined) throw new RunStorageError("run-not-found", `Run ${runId} does not exist`);
  if (run.terminalState !== undefined) throw new RunStorageError("run-not-active", `Run ${runId} is already ${run.terminalState}`);
  if (run.writerGeneration !== writerGeneration) {
    throw new RunStorageError("writer-generation-mismatch", `Run ${runId} writer generation is fenced`);
  }
  return run;
}

function slotExists(connection: RecordDatabase, runId: string, slotId: string): boolean {
  return recordStatement(connection, "SELECT 1 AS present FROM run_expected_slots WHERE run_id=? AND slot_id=?")
    .get(runId, slotId) !== undefined;
}

function slotBound(connection: RecordDatabase, runId: string, slotId: string): boolean {
  return recordStatement(connection, "SELECT 1 AS present FROM run_slot_bindings WHERE target_run_id=? AND slot_id=?")
    .get(runId, slotId) !== undefined;
}

function sourceDeleted(connection: RecordDatabase, runId: string): boolean {
  return recordStatement(connection, "SELECT 1 AS present FROM run_deletion_tombstones WHERE run_id=?").get(runId) !== undefined;
}

function validateExpectedSlots(slots: readonly ExpectedRunSlot[]): void {
  if (slots.length > RECORD_SQLITE_MAX_ROW_BYTES / 256) {
    throw invalid("Run expected slot plan exceeds its bounded publication inventory");
  }
  const ids = new Set<string>();
  slots.forEach((slot) => {
    requireIdentity(slot.slotId, "expectedSlots.slotId");
    requireIdentity(slot.evalId, "expectedSlots.evalId");
    if (!Number.isSafeInteger(slot.attemptOrdinal) || slot.attemptOrdinal < 0) {
      throw invalid("expectedSlots.attemptOrdinal is not a non-negative safe integer");
    }
    requireDigest(slot.executionIdentityDigest, "expectedSlots.executionIdentityDigest");
    if (ids.has(slot.slotId)) throw invalid(`expected slot ${slot.slotId} is duplicated`);
    ids.add(slot.slotId);
  });
}

export function currentPublicationCutoffOnConnection(connection: RecordDatabase): PublicationCutoff {
  return requireCutoff(connection);
}

export function createRunResourceOnConnection(
  connection: RecordDatabase,
  input: CreateRunResourceInput,
): RunMutationReceipt {
  requireIdentity(input.runId, "runId");
  requireIdentity(input.invocationId, "invocationId");
  requireIdentity(input.experimentId, "experimentId");
  requireIdentity(input.writerGeneration, "writerGeneration");
  requireIsoInstant(input.startedAt, "startedAt");
  validateExpectedSlots(input.expectedSlots);
  return withImmediateTransaction(connection, input.deadlineEpochMs, "create-run-resource", () => {
    if (runHeader(connection, input.runId) !== undefined) {
      throw new RunStorageError("run-storage-invalid", `Run ${input.runId} already exists`);
    }
    const revision = nextRevision(connection);
    recordStatement(connection, `INSERT INTO run_resources(run_id,invocation_id,experiment_id,started_at,
      initial_writer_generation,current_writer_generation,terminal_state,completed_at,created_revision,close_revision)
      VALUES (?,?,?,?,?,?,NULL,NULL,?,NULL)`).run(
      input.runId,
      input.invocationId,
      input.experimentId,
      input.startedAt,
      input.writerGeneration,
      input.writerGeneration,
      revision,
    );
    const insertSlot = recordStatement(connection, `INSERT INTO run_expected_slots(run_id,slot_id,ordinal,eval_id,
      attempt_ordinal,execution_identity_digest) VALUES (?,?,?,?,?,?)`);
    input.expectedSlots.forEach((slot, ordinal) => insertSlot.run(
      input.runId,
      slot.slotId,
      ordinal,
      slot.evalId,
      slot.attemptOrdinal,
      slot.executionIdentityDigest,
    ));
    return Object.freeze({ runId: input.runId, cutoff: cutoffAt(connection, revision) });
  });
}

export function publishOriginAttemptOnConnection(
  connection: RecordDatabase,
  input: PublishOriginAttemptInput,
): AttemptPublicationReceipt {
  requireIdentity(input.runId, "runId");
  requireIdentity(input.writerGeneration, "writerGeneration");
  requireIdentity(input.slotId, "slotId");
  requireIdentity(input.attemptId, "attemptId");
  if (!decodeAttemptLocator(input.attemptLocator).valid) throw invalid("attemptLocator is malformed");
  requireClosure(input.closureBytes, input.closureDigest);
  return withImmediateTransaction(connection, input.deadlineEpochMs, "publish-origin-attempt", () => {
    requireActiveWriter(connection, input.runId, input.writerGeneration);
    if (!slotExists(connection, input.runId, input.slotId)) {
      throw new RunStorageError("slot-not-found", `Run ${input.runId} does not expect slot ${input.slotId}`);
    }
    if (slotBound(connection, input.runId, input.slotId)) {
      throw new RunStorageError("slot-already-bound", `Run ${input.runId} slot ${input.slotId} is already bound`);
    }
    if (recordStatement(connection, "SELECT 1 AS present FROM attempt_publications WHERE attempt_id=?").get(input.attemptId) !== undefined) {
      throw new RunStorageError("attempt-already-published", `Attempt ${input.attemptId} is already published`);
    }
    copyStagedRunClosure(connection, input.stagingDatabasePath, input.runId, publishedAttemptIds(connection, input.runId, input.attemptId), false);
    const revision = nextRevision(connection);
    recordStatement(connection, `INSERT INTO attempt_publications(attempt_id,attempt_locator,origin_run_id,origin_slot_id,
      closure_payload,closure_digest,published_revision) VALUES (?,?,?,?,?,?,?)`).run(
      input.attemptId,
      input.attemptLocator,
      input.runId,
      input.slotId,
      input.closureBytes,
      input.closureDigest,
      revision,
    );
    recordStatement(connection, `INSERT INTO run_slot_bindings(target_run_id,slot_id,attempt_id,origin_run_id,
      origin_slot_id,attempt_publication_revision,action,binding_revision) VALUES (?,?,?,?,?,?,'executed',?)`).run(
      input.runId,
      input.slotId,
      input.attemptId,
      input.runId,
      input.slotId,
      revision,
      revision,
    );
    const publicationIdentity = Object.freeze({ originRunId: input.runId, attemptId: input.attemptId, revision });
    return Object.freeze({
      runId: input.runId,
      slotId: input.slotId,
      publicationIdentity,
      cutoff: cutoffAt(connection, revision),
    });
  });
}

export function bindAttemptReferenceOnConnection(
  connection: RecordDatabase,
  input: BindAttemptReferenceInput,
): ReferenceBindingReceipt {
  requireIdentity(input.runId, "runId");
  requireIdentity(input.writerGeneration, "writerGeneration");
  requireIdentity(input.slotId, "slotId");
  requireIdentity(input.publicationIdentity.originRunId, "publicationIdentity.originRunId");
  requireIdentity(input.publicationIdentity.attemptId, "publicationIdentity.attemptId");
  if (!Number.isSafeInteger(input.publicationIdentity.revision) || input.publicationIdentity.revision <= 0) {
    throw invalid("publicationIdentity.revision is invalid");
  }
  return withImmediateTransaction(connection, input.deadlineEpochMs, "bind-attempt-reference", () => {
    requireActiveWriter(connection, input.runId, input.writerGeneration);
    if (!slotExists(connection, input.runId, input.slotId)) {
      throw new RunStorageError("slot-not-found", `Run ${input.runId} does not expect slot ${input.slotId}`);
    }
    if (slotBound(connection, input.runId, input.slotId)) {
      throw new RunStorageError("slot-already-bound", `Run ${input.runId} slot ${input.slotId} is already bound`);
    }
    const source = recordStatement(connection, `SELECT origin_run_id,origin_slot_id,published_revision FROM attempt_publications
      WHERE attempt_id=?`).get(input.publicationIdentity.attemptId) as Row | undefined;
    if (source === undefined || text(source, "origin_run_id") !== input.publicationIdentity.originRunId ||
      integer(source, "published_revision") !== input.publicationIdentity.revision) {
      throw new RunStorageError("attempt-not-published", `Attempt ${input.publicationIdentity.attemptId} is not published at the supplied identity`);
    }
    if (sourceDeleted(connection, input.publicationIdentity.originRunId)) {
      throw new RunStorageError("source-run-deleted", `Origin Run ${input.publicationIdentity.originRunId} is deleted`);
    }
    const revision = nextRevision(connection);
    recordStatement(connection, `INSERT INTO run_slot_bindings(target_run_id,slot_id,attempt_id,origin_run_id,
      origin_slot_id,attempt_publication_revision,action,binding_revision) VALUES (?,?,?,?,?,?,?,?)`).run(
      input.runId,
      input.slotId,
      input.publicationIdentity.attemptId,
      input.publicationIdentity.originRunId,
      text(source, "origin_slot_id"),
      input.publicationIdentity.revision,
      input.action,
      revision,
    );
    return Object.freeze({
      runId: input.runId,
      slotId: input.slotId,
      publicationIdentity: Object.freeze({ ...input.publicationIdentity }),
      cutoff: cutoffAt(connection, revision),
    });
  });
}

function pendingSlotIds(connection: RecordDatabase, runId: string): readonly string[] {
  const rows = recordStatement(connection, `SELECT s.slot_id FROM run_expected_slots s
    LEFT JOIN run_slot_bindings b ON b.target_run_id=s.run_id AND b.slot_id=s.slot_id
    WHERE s.run_id=? AND b.slot_id IS NULL ORDER BY s.ordinal`).all(runId) as readonly Row[];
  return Object.freeze(rows.map((row) => text(row, "slot_id")));
}

function validateAbsenceClosure(
  connection: RecordDatabase,
  runId: string,
  absences: CloseRunResourceInput["absences"],
): void {
  const expected = pendingSlotIds(connection, runId);
  const supplied = new Map<string, RunAbsenceReason>();
  for (const absence of absences) {
    requireIdentity(absence.slotId, "absences.slotId");
    requireAbsenceReason(absence.reason);
    if (supplied.has(absence.slotId)) {
      throw new RunStorageError("absence-coverage-invalid", `Run ${runId} absence repeats slot ${absence.slotId}`);
    }
    supplied.set(absence.slotId, absence.reason);
  }
  if (expected.length !== supplied.size || expected.some((slotId) => !supplied.has(slotId))) {
    throw new RunStorageError("absence-coverage-invalid", `Run ${runId} absence closure does not exactly cover pending slots`);
  }
}

function insertAbsences(
  connection: RecordDatabase,
  runId: string,
  revision: number,
  absences: CloseRunResourceInput["absences"],
): void {
  const insert = recordStatement(connection, `INSERT INTO run_slot_absences(run_id,slot_id,reason,absence_revision)
    VALUES (?,?,?,?)`);
  for (const absence of absences) insert.run(runId, absence.slotId, absence.reason, revision);
}

export function closeRunResourceOnConnection(
  connection: RecordDatabase,
  input: CloseRunResourceInput,
): RunMutationReceipt {
  requireTerminalState(input.state);
  requireIsoInstant(input.completedAt, "completedAt");
  return withImmediateTransaction(connection, input.deadlineEpochMs, "close-run-resource", () => {
    requireActiveWriter(connection, input.runId, input.writerGeneration);
    validateAbsenceClosure(connection, input.runId, input.absences);
    if (input.stagingDatabasePath !== undefined) {
      copyStagedRunClosure(
        connection,
        input.stagingDatabasePath,
        input.runId,
        publishedAttemptIds(connection, input.runId),
        true,
      );
    }
    const revision = nextRevision(connection);
    insertAbsences(connection, input.runId, revision, input.absences);
    const changed = recordStatement(connection, `UPDATE run_resources SET terminal_state=?,completed_at=?,close_revision=?
      WHERE run_id=? AND terminal_state IS NULL AND current_writer_generation=?`).run(
      input.state,
      input.completedAt,
      revision,
      input.runId,
      input.writerGeneration,
    );
    if (Number(changed.changes) !== 1) throw new RunStorageError("run-not-active", `Run ${input.runId} changed before close`);
    return Object.freeze({ runId: input.runId, cutoff: cutoffAt(connection, revision) });
  });
}

export function recoverRunResourceOnConnection(
  connection: RecordDatabase,
  input: RecoverRunResourceInput,
): RecoverRunReceipt {
  requireIdentity(input.runId, "runId");
  requireIdentity(input.expectedWriterGeneration, "expectedWriterGeneration");
  requireIdentity(input.recoveryWriterGeneration, "recoveryWriterGeneration");
  requireIsoInstant(input.completedAt, "completedAt");
  requireIdentity(input.evidence.kind, "evidence.kind");
  requireIdentity(input.evidence.identity, "evidence.identity");
  requireIsoInstant(input.evidence.observedAt, "evidence.observedAt");
  if (input.expectedWriterGeneration === input.recoveryWriterGeneration) {
    throw new RunStorageError("recovery-evidence-required", "Recovery must advance to a distinct writer generation");
  }
  return withImmediateTransaction(connection, input.deadlineEpochMs, "recover-run-resource", () => {
    requireActiveWriter(connection, input.runId, input.expectedWriterGeneration);
    const absences = pendingSlotIds(connection, input.runId).map((slotId) => Object.freeze({
      slotId,
      reason: "interrupted-before-publication" as const,
    }));
    const revision = nextRevision(connection);
    insertAbsences(connection, input.runId, revision, absences);
    const changed = recordStatement(connection, `UPDATE run_resources SET current_writer_generation=?,terminal_state='interrupted',
      completed_at=?,close_revision=? WHERE run_id=? AND terminal_state IS NULL AND current_writer_generation=?`).run(
      input.recoveryWriterGeneration,
      input.completedAt,
      revision,
      input.runId,
      input.expectedWriterGeneration,
    );
    if (Number(changed.changes) !== 1) {
      throw new RunStorageError("writer-generation-mismatch", `Run ${input.runId} changed before recovery fence`);
    }
    recordStatement(connection, `INSERT INTO run_recoveries(run_id,previous_writer_generation,recovery_writer_generation,
      evidence_kind,evidence_identity,evidence_observed_at,recovery_revision) VALUES (?,?,?,?,?,?,?)`).run(
      input.runId,
      input.expectedWriterGeneration,
      input.recoveryWriterGeneration,
      input.evidence.kind,
      input.evidence.identity,
      input.evidence.observedAt,
      revision,
    );
    return Object.freeze({
      runId: input.runId,
      previousWriterGeneration: input.expectedWriterGeneration,
      writerGeneration: input.recoveryWriterGeneration,
      state: "interrupted",
      cutoff: cutoffAt(connection, revision),
    });
  });
}

function incomingReferences(connection: RecordDatabase, originRunId: string): readonly RunReferenceDependency[] {
  const rows = recordStatement(connection, `SELECT b.target_run_id,b.slot_id,b.attempt_id,a.attempt_locator
    FROM run_slot_bindings b JOIN attempt_publications a ON a.attempt_id=b.attempt_id
    LEFT JOIN run_deletion_tombstones d ON d.run_id=b.target_run_id
    WHERE b.origin_run_id=? AND b.target_run_id<>? AND d.run_id IS NULL
    ORDER BY b.target_run_id,b.slot_id,b.attempt_id LIMIT ?`).all(
      originRunId,
      originRunId,
      Math.trunc(RECORD_SQLITE_MAX_ROW_BYTES / 256) + 1,
    ) as readonly Row[];
  if (rows.length > RECORD_SQLITE_MAX_ROW_BYTES / 256) {
    throw invalid(`Run ${originRunId} incoming reference inventory exceeds its bounded delete receipt`);
  }
  return Object.freeze(rows.map((row) => Object.freeze({
    dependentRunId: text(row, "target_run_id"),
    dependentSlotId: text(row, "slot_id"),
    attemptId: text(row, "attempt_id"),
    attemptLocator: text(row, "attempt_locator"),
  })));
}

export function deleteRunResourceOnConnection(
  connection: RecordDatabase,
  input: DeleteRunResourceInput,
): DeleteRunReceipt {
  requireIdentity(input.runId, "runId");
  requireTerminalState(input.expectedState);
  requireIsoInstant(input.deletedAt, "deletedAt");
  return withImmediateTransaction(connection, input.deadlineEpochMs, "delete-run-resource", () => {
    const run = runHeader(connection, input.runId);
    if (run === undefined) throw new RunStorageError("run-not-found", `Run ${input.runId} does not exist`);
    if (run.terminalState !== input.expectedState) {
      throw new RunStorageError("run-state-mismatch", `Run ${input.runId} is ${run.terminalState ?? "active"}, not ${input.expectedState}`);
    }
    const tombstone = recordStatement(connection, "SELECT deletion_revision FROM run_deletion_tombstones WHERE run_id=?")
      .get(input.runId) as Row | undefined;
    if (tombstone !== undefined) {
      const revision = integer(tombstone, "deletion_revision");
      return Object.freeze({ runId: input.runId, state: input.expectedState, cutoff: cutoffAt(connection, revision) });
    }
    const dependencies = incomingReferences(connection, input.runId);
    if (dependencies.length > 0) {
      throw new RunStorageError(
        "run-delete-reference-conflict",
        `Run ${input.runId} has incoming Attempt references`,
        dependencies,
      );
    }
    const revision = nextRevision(connection);
    recordStatement(connection, `INSERT INTO run_deletion_tombstones(run_id,terminal_state,deleted_at,deletion_revision)
      VALUES (?,?,?,?)`).run(input.runId, input.expectedState, input.deletedAt, revision);
    return Object.freeze({ runId: input.runId, state: input.expectedState, cutoff: cutoffAt(connection, revision) });
  });
}

function publicationIdentity(row: Row): AttemptPublicationIdentity {
  return Object.freeze({
    originRunId: text(row, "origin_run_id"),
    attemptId: text(row, "attempt_id"),
    revision: integer(row, "attempt_publication_revision"),
  });
}

function readSlotPublication(
  connection: RecordDatabase,
  runId: string,
  slotId: string,
  cutoff: PublicationCutoff,
): RunSlotPublication {
  const binding = recordStatement(connection, `SELECT b.action,b.binding_revision,b.attempt_id,b.origin_run_id,b.origin_slot_id,
    b.attempt_publication_revision,a.attempt_locator FROM run_slot_bindings b
    JOIN attempt_publications a ON a.attempt_id=b.attempt_id
    WHERE b.target_run_id=? AND b.slot_id=? AND b.binding_revision<=?`).get(runId, slotId, cutoff.revision) as Row | undefined;
  if (binding !== undefined) {
    const action = text(binding, "action");
    if (action !== "executed" && action !== "carried" && action !== "accepted") {
      throw invalid(`Run ${runId} slot ${slotId} has an invalid binding action`);
    }
    return Object.freeze({
      state: "published",
      action,
      attemptId: text(binding, "attempt_id"),
      attemptLocator: text(binding, "attempt_locator"),
      originRunId: text(binding, "origin_run_id"),
      originSlotId: text(binding, "origin_slot_id"),
      publicationIdentity: publicationIdentity(binding),
      bindingRevision: integer(binding, "binding_revision"),
    });
  }
  const absence = recordStatement(connection, `SELECT reason,absence_revision FROM run_slot_absences
    WHERE run_id=? AND slot_id=? AND absence_revision<=?`).get(runId, slotId, cutoff.revision) as Row | undefined;
  if (absence !== undefined) {
    const reason = text(absence, "reason");
    requireAbsenceReason(reason);
    return Object.freeze({ state: "absent", reason, absenceRevision: integer(absence, "absence_revision") });
  }
  return Object.freeze({ state: "pending" });
}

function readRunAtCutoff(
  connection: RecordDatabase,
  runId: string,
  cutoff: PublicationCutoff,
): ReadableRunResource | undefined {
  const row = recordStatement(connection, `SELECT r.run_id,r.invocation_id,r.experiment_id,r.started_at,r.initial_writer_generation,r.current_writer_generation,
    r.terminal_state,r.completed_at,r.created_revision,r.close_revision,d.deletion_revision
    FROM run_resources r LEFT JOIN run_deletion_tombstones d ON d.run_id=r.run_id WHERE r.run_id=?`).get(runId) as Row | undefined;
  if (row === undefined || integer(row, "created_revision") > cutoff.revision ||
    row.deletion_revision !== null && row.deletion_revision !== undefined && integer(row, "deletion_revision") <= cutoff.revision) {
    return undefined;
  }
  const closeRevision = row.close_revision === null ? undefined : integer(row, "close_revision");
  const closeVisible = closeRevision !== undefined && closeRevision <= cutoff.revision;
  const terminalState = optionalText(row, "terminal_state");
  if (terminalState !== undefined) requireTerminalState(terminalState);
  const state: RunState = closeVisible
    ? terminalState ?? (() => { throw invalid(`Run ${runId} close revision lacks terminal state`); })()
    : "active";
  const slotRows = recordStatement(connection, `SELECT slot_id,eval_id,attempt_ordinal,execution_identity_digest
    FROM run_expected_slots WHERE run_id=? ORDER BY ordinal LIMIT ?`).all(
      runId,
      Math.trunc(RECORD_SQLITE_MAX_ROW_BYTES / 256) + 1,
    ) as readonly Row[];
  if (slotRows.length > RECORD_SQLITE_MAX_ROW_BYTES / 256) {
    throw invalid(`Run ${runId} expected slot inventory exceeds its bounded read`);
  }
  const slots = slotRows.map((slot): ReadableRunResource["slots"][number] => Object.freeze({
    slotId: text(slot, "slot_id"),
    evalId: text(slot, "eval_id"),
    attemptOrdinal: integer(slot, "attempt_ordinal"),
    executionIdentityDigest: text(slot, "execution_identity_digest"),
    publication: readSlotPublication(connection, runId, text(slot, "slot_id"), cutoff),
  }));
  const published = slots.filter((slot) => slot.publication.state === "published").length;
  return Object.freeze({
    runId: text(row, "run_id"),
    invocationId: text(row, "invocation_id"),
    experimentId: text(row, "experiment_id"),
    startedAt: text(row, "started_at"),
    ...(closeVisible ? { completedAt: text(row, "completed_at") } : {}),
    state,
    writerGeneration: text(row, closeVisible ? "current_writer_generation" : "initial_writer_generation"),
    createdRevision: integer(row, "created_revision"),
    ...(closeVisible && closeRevision !== undefined ? { closeRevision } : {}),
    expected: slots.length,
    published,
    missing: slots.length - published,
    slots: Object.freeze(slots),
  });
}

export function readRunResourceOnConnection(
  connection: RecordDatabase,
  runId: string,
  requestedCutoff?: PublicationCutoff,
): ReadableRunResource | undefined {
  requireIdentity(runId, "runId");
  return readRunAtCutoff(connection, runId, requireCutoff(connection, requestedCutoff));
}

export function listRunResourcesOnConnection(
  connection: RecordDatabase,
  input: {
    readonly cutoff?: PublicationCutoff;
    readonly invocationId?: string;
    readonly afterRunId?: string;
    readonly pageSize?: number;
  } = {},
): RunResourcePage {
  const cutoff = requireCutoff(connection, input.cutoff);
  const afterRunId = input.afterRunId ?? "";
  const pageSize = input.pageSize ?? 100;
  if (input.invocationId !== undefined) requireIdentity(input.invocationId, "invocationId");
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 256) throw invalid("Run page size must be between 1 and 256");
  const rows = (input.invocationId === undefined
    ? recordStatement(connection, `SELECT r.run_id FROM run_resources r
        LEFT JOIN run_deletion_tombstones d ON d.run_id=r.run_id
        WHERE r.created_revision<=? AND (d.deletion_revision IS NULL OR d.deletion_revision>?) AND r.run_id>?
        ORDER BY r.run_id LIMIT ?`).all(cutoff.revision, cutoff.revision, afterRunId, pageSize + 1)
    : recordStatement(connection, `SELECT r.run_id FROM run_resources r
        LEFT JOIN run_deletion_tombstones d ON d.run_id=r.run_id
        WHERE r.created_revision<=? AND (d.deletion_revision IS NULL OR d.deletion_revision>?) AND r.invocation_id=? AND r.run_id>?
        ORDER BY r.run_id LIMIT ?`).all(cutoff.revision, cutoff.revision, input.invocationId, afterRunId, pageSize + 1)) as readonly Row[];
  const selected = rows.slice(0, pageSize);
  const runs = selected.map((row) => readRunAtCutoff(connection, text(row, "run_id"), cutoff)).filter(
    (run): run is ReadableRunResource => run !== undefined,
  );
  return Object.freeze({
    cutoff,
    runs: Object.freeze(runs),
    nextAfterRunId: rows.length > pageSize && selected.length > 0 ? text(selected.at(-1)!, "run_id") : null,
  });
}

export function readPublishedAttemptOnConnection(
  connection: RecordDatabase,
  attemptId: string,
  requestedCutoff?: PublicationCutoff,
): PublishedAttempt | undefined {
  requireIdentity(attemptId, "attemptId");
  const cutoff = requireCutoff(connection, requestedCutoff);
  const row = recordStatement(connection, `SELECT a.attempt_id,a.attempt_locator,a.origin_run_id,a.origin_slot_id,a.closure_payload,
    a.closure_digest,a.published_revision,d.deletion_revision FROM attempt_publications a
    LEFT JOIN run_deletion_tombstones d ON d.run_id=a.origin_run_id WHERE a.attempt_id=?`).get(attemptId) as Row | undefined;
  if (row === undefined || integer(row, "published_revision") > cutoff.revision ||
    row.deletion_revision !== null && row.deletion_revision !== undefined && integer(row, "deletion_revision") <= cutoff.revision) {
    return undefined;
  }
  const revision = integer(row, "published_revision");
  const originRunId = text(row, "origin_run_id");
  return Object.freeze({
    attemptId: text(row, "attempt_id"),
    attemptLocator: text(row, "attempt_locator"),
    originRunId,
    originSlotId: text(row, "origin_slot_id"),
    publicationIdentity: Object.freeze({ originRunId, attemptId: text(row, "attempt_id"), revision }),
    closureBytes: bytes(row, "closure_payload"),
    closureDigest: text(row, "closure_digest"),
  });
}

function withWriter<A>(recordStorageRoot: string, use: (connection: RecordDatabase) => A): A {
  const connection = openRecordWriter(recordSqlitePath(recordStorageRoot));
  try {
    return use(connection);
  } finally {
    closeRecordDatabase(connection);
  }
}

function withReader<A>(recordStorageRoot: string, use: (connection: RecordDatabase) => A): A {
  const connection = openRecordReader(recordSqlitePath(recordStorageRoot));
  try {
    connection.db.exec("BEGIN");
    return use(connection);
  } finally {
    if (connection.db.isTransaction) connection.db.exec("ROLLBACK");
    closeRecordDatabase(connection);
  }
}

export function currentPublicationCutoff(recordStorageRoot: string): PublicationCutoff {
  return withReader(recordStorageRoot, currentPublicationCutoffOnConnection);
}

export function createRunResource(recordStorageRoot: string, input: CreateRunResourceInput): RunMutationReceipt {
  return withWriter(recordStorageRoot, (connection) => createRunResourceOnConnection(connection, input));
}

export function publishOriginAttempt(recordStorageRoot: string, input: PublishOriginAttemptInput): AttemptPublicationReceipt {
  return withWriter(recordStorageRoot, (connection) => publishOriginAttemptOnConnection(connection, input));
}

export function bindAttemptReference(recordStorageRoot: string, input: BindAttemptReferenceInput): ReferenceBindingReceipt {
  return withWriter(recordStorageRoot, (connection) => bindAttemptReferenceOnConnection(connection, input));
}

export function closeRunResource(recordStorageRoot: string, input: CloseRunResourceInput): RunMutationReceipt {
  const receipt = withWriter(recordStorageRoot, (connection) => closeRunResourceOnConnection(connection, input));
  withWriter(recordStorageRoot, (connection) => checkpointRecordDatabase(connection));
  if (input.stagingDatabasePath !== undefined) {
    for (const path of [input.stagingDatabasePath, `${input.stagingDatabasePath}-wal`, `${input.stagingDatabasePath}-shm`]) {
      try {
        unlinkSync(path);
      } catch (cause) {
        if (typeof cause !== "object" || cause === null || Reflect.get(cause, "code") !== "ENOENT") throw cause;
      }
    }
  }
  return receipt;
}

export function recoverRunResource(recordStorageRoot: string, input: RecoverRunResourceInput): RecoverRunReceipt {
  return withWriter(recordStorageRoot, (connection) => recoverRunResourceOnConnection(connection, input));
}

export function deleteRunResource(recordStorageRoot: string, input: DeleteRunResourceInput): DeleteRunReceipt {
  return withWriter(recordStorageRoot, (connection) => deleteRunResourceOnConnection(connection, input));
}

export function readRunResource(
  recordStorageRoot: string,
  runId: string,
  cutoff?: PublicationCutoff,
): ReadableRunResource | undefined {
  return withReader(recordStorageRoot, (connection) => readRunResourceOnConnection(connection, runId, cutoff));
}

export function listRunResources(
  recordStorageRoot: string,
  input?: Parameters<typeof listRunResourcesOnConnection>[1],
): RunResourcePage {
  return withReader(recordStorageRoot, (connection) => listRunResourcesOnConnection(connection, input));
}

export function readPublishedAttempt(
  recordStorageRoot: string,
  attemptId: string,
  cutoff?: PublicationCutoff,
): PublishedAttempt | undefined {
  return withReader(recordStorageRoot, (connection) => readPublishedAttemptOnConnection(connection, attemptId, cutoff));
}

/** Convert unexpected SQLite constraint failures into the internal storage vocabulary. */
export function asRunStorageError(cause: unknown): RunStorageError {
  if (cause instanceof RunStorageError) return cause;
  if (cause instanceof Error) return invalid(cause.message);
  throw sqliteError("record-sqlite-error", "run-storage", "Run storage failed with a non-Error defect", cause);
}
