import { createHash } from "node:crypto";
import type { SQLOutputValue } from "node:sqlite";
import { encodeAttemptLocator, parseAttemptLocator } from "../../attempt-locator.ts";
import type { AttemptId } from "../model/identifiers.ts";
import { recordStatement, type RecordDatabase } from "./database.ts";
import { sqliteError } from "./errors.ts";
import {
  assertCanonicalIdentity,
  attachmentSealEntry,
  attemptSealEntry,
  collectionItemSealEntry,
  contentChunkSealEntry,
  contentSealEntry,
  exactLogicalSealIdentity,
  exactLogicalSealIdentityFromOrdered,
  hashCanonicalTuple,
  memberSealEntry,
  orderSealEntries,
  recordSealEntry,
  referenceSealEntry,
  runSealEntry,
  slotSealEntry,
} from "./seal.ts";
import { withImmediateTransaction } from "./transaction.ts";
import { RECORD_SQLITE_PREPARED_SEAL_TEMP_SQL } from "./schema.ts";
import {
  RECORD_SQLITE_CHUNK_BYTES,
  RECORD_SQLITE_MAX_PAGE_BYTES,
  RECORD_SQLITE_MAX_PAGE_ROWS,
  RECORD_SQLITE_MAX_PUBLISH_BYTES,
  RECORD_SQLITE_MAX_PUBLISH_ROWS,
  RECORD_SQLITE_MAX_ROW_BYTES,
  RECORD_SQLITE_MAX_VALIDATION_ROWS,
  RECORD_SQLITE_MAX_VALIDATION_RUNS,
  RECORD_SQLITE_VALIDATION_DEADLINE_MS,
  type AdmitAttachmentInput,
  type AdmitAttemptInput,
  type AdmitContentInput,
  type AttemptLocatorCandidates,
  type AppendContentChunksInput,
  type BeginRunInput,
  type ContentChunkPage,
  type CollectionItemPage,
  type FenceRunFinalizationInput,
  type PersistedCollectionItem,
  type PersistSealedRunInput,
  type PrepareRunFinalizationInput,
  type PreparedRunFinalization,
  type RunFinalization,
  type SealEntry,
  type SealEntryKind,
  type SealedAttachmentDocument,
  type SealedAttachmentMetadata,
  type SealedRunCore,
  type SealedRunDocument,
  type SealedRunSummary,
  type SealedRunSummaryPage,
  type SealRunInput,
  type StageAttachmentInput,
  type StageAttachmentReferencesInput,
  type StageCollectionItemsInput,
  type StageSealEntriesInput,
  type StageSealEntriesResult,
  type StageRunCoreInput,
} from "./types.ts";

type Row = Record<string, SQLOutputValue>;
const DIGEST = /^[0-9a-f]{64}$/u;
interface CachedSealEntries {
  readonly identity: string;
  readonly count: number;
  readonly mutationSequence?: number;
}
const sealEntryCaches = new WeakMap<RecordDatabase, Map<string, CachedSealEntries>>();

function ensurePreparedSealTables(connection: RecordDatabase): void {
  if (connection.mode !== "reader") connection.db.exec(RECORD_SQLITE_PREPARED_SEAL_TEMP_SQL);
}

function spillPreparedSealEntries(connection: RecordDatabase, runId: string, visitClosure: (visit: (entry: SealEntry) => void) => void): {
  readonly identity: string;
  readonly count: number;
} {
  ensurePreparedSealTables(connection);
  connection.db.exec("SAVEPOINT niceeval_prepare_seal");
  try {
    recordStatement(connection, "DELETE FROM temp.niceeval_prepared_seal_raw WHERE run_id=?").run(runId);
    recordStatement(connection, "DELETE FROM temp.niceeval_prepared_seal_ordered WHERE run_id=?").run(runId);
    const insertRaw = recordStatement(connection, `INSERT INTO temp.niceeval_prepared_seal_raw
      (run_id,entry_kind,logical_identity,digest) VALUES (?,?,?,?)`);
    let count = 0;
    visitClosure((entry) => {
      insertRaw.run(runId, entry.kind, entry.logicalIdentity, entry.digest);
      count += 1;
    });
    const insertOrdered = recordStatement(connection, `INSERT INTO temp.niceeval_prepared_seal_ordered
      (run_id,ordinal,entry_kind,logical_identity,digest) VALUES (?,?,?,?,?)`);
    const orderedRows = recordStatement(connection, `SELECT entry_kind,logical_identity,digest
      FROM temp.niceeval_prepared_seal_raw WHERE run_id=? ORDER BY entry_kind,logical_identity,digest`).iterate(runId) as unknown as Iterable<Row>;
    function* ordered(): Iterable<SealEntry> {
      let ordinal = 0;
      for (const row of orderedRows) {
        const entry = Object.freeze({ kind: sealEntryKind(row, "entry_kind"), logicalIdentity: text(row, "logical_identity"), digest: text(row, "digest") });
        insertOrdered.run(runId, ordinal, entry.kind, entry.logicalIdentity, entry.digest);
        ordinal += 1;
        yield entry;
      }
    }
    const identity = exactLogicalSealIdentityFromOrdered(ordered(), count);
    recordStatement(connection, "DELETE FROM temp.niceeval_prepared_seal_raw WHERE run_id=?").run(runId);
    connection.db.exec("RELEASE niceeval_prepare_seal");
    return Object.freeze({ identity, count });
  } catch (cause) {
    connection.db.exec("ROLLBACK TO niceeval_prepare_seal; RELEASE niceeval_prepare_seal");
    throw cause;
  }
}

function sealEntryCache(connection: RecordDatabase): Map<string, CachedSealEntries> {
  let cache = sealEntryCaches.get(connection);
  if (cache === undefined) {
    cache = new Map();
    sealEntryCaches.set(connection, cache);
  }
  return cache;
}

function text(row: Row, field: string): string {
  const value = row[field];
  if (typeof value !== "string") throw sqliteError("record-database-invalid", "decode-row", `${field} is not text`);
  return value;
}

function integer(row: Row, field: string): number {
  const value = row[field];
  const numeric = typeof value === "bigint" ? Number(value) : value;
  if (typeof numeric !== "number" || !Number.isSafeInteger(numeric)) {
    throw sqliteError("record-database-invalid", "decode-row", `${field} is not a safe integer`);
  }
  return numeric;
}

function optionalText(row: Row, field: string): string | undefined {
  const value = row[field];
  if (value === null) return undefined;
  if (typeof value !== "string") throw sqliteError("record-database-invalid", "decode-row", `${field} is not nullable text`);
  return value;
}

function optionalInteger(row: Row, field: string): number | undefined {
  if (row[field] === null) return undefined;
  return integer(row, field);
}

function ownerKind(row: Row, field: string): "run" | "attempt" {
  const value = text(row, field);
  if (value !== "run" && value !== "attempt") throw sqliteError("record-database-invalid", "decode-row", `${field} is not an owner kind`);
  return value;
}

function memberAction(row: Row, field: string): "executed" | "carried" | "accepted" | "not-dispatched" | "interrupted" {
  const value = text(row, field);
  if (value !== "executed" && value !== "carried" && value !== "accepted" && value !== "not-dispatched" && value !== "interrupted") {
    throw sqliteError("record-database-invalid", "decode-row", `${field} is not a Member action`);
  }
  return value;
}

function sealEntryKind(row: Row, field: string): SealEntryKind {
  const value = text(row, field);
  if (
    value !== "record" && value !== "run" && value !== "slot" && value !== "member" && value !== "attempt" &&
    value !== "attachment" && value !== "attachment-reference" && value !== "collection-item" &&
    value !== "content" && value !== "content-chunk"
  ) throw sqliteError("record-database-invalid", "decode-row", `${field} is not a Seal entry kind`);
  return value;
}

function bytes(row: Row, field: string): Uint8Array {
  const value = row[field];
  if (!(value instanceof Uint8Array)) throw sqliteError("record-database-invalid", "decode-row", `${field} is not bytes`);
  return value;
}

function digestBytes(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) if (left[index] !== right[index]) return false;
  return true;
}

function transferableBytes(value: Uint8Array): Uint8Array {
  return value.buffer instanceof ArrayBuffer && value.byteOffset === 0 && value.byteLength === value.buffer.byteLength
    ? value
    : Uint8Array.from(value);
}

function requireDigest(value: string, field: string): void {
  if (!DIGEST.test(value)) throw sqliteError("record-content-invalid", "persist-sealed-run", `${field} is not a lowercase sha256 digest`);
}

function requireBytesDigest(value: Uint8Array, digest: string, field: string): void {
  requireDigest(digest, `${field}.digest`);
  if (digestBytes(value) !== digest) throw sqliteError("record-content-invalid", "persist-sealed-run", `${field} bytes do not match their digest`);
}

function requireNonEmpty(value: string, field: string): void {
  if (value.length === 0) throw sqliteError("record-content-invalid", "persist-sealed-run", `${field} is empty`);
}

function requireIdentity(value: string, field: string): void {
  try {
    assertCanonicalIdentity(value, field);
  } catch (cause) {
    throw sqliteError("record-content-invalid", "persist-sealed-run", cause instanceof Error ? cause.message : `${field} is invalid`);
  }
}

function requireAttemptLocator(attemptId: string, locator: string, operation = "persist-sealed-run"): void {
  const parsed = parseAttemptLocator(locator);
  if (!parsed.valid || encodeAttemptLocator(attemptId as AttemptId) !== locator) {
    throw sqliteError("record-content-invalid", operation, `Attempt ${attemptId} locator is not its canonical projection`);
  }
}

function requireOrdinal(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw sqliteError("record-content-invalid", "persist-sealed-run", `${field} is not a non-negative safe integer`);
}

function assertContiguous(values: readonly { readonly ordinal: number }[], field: string): void {
  values.forEach((value, index) => {
    requireOrdinal(value.ordinal, `${field}[${index}].ordinal`);
    if (value.ordinal !== index) throw sqliteError("record-content-invalid", "persist-sealed-run", `${field} ordinals are not contiguous`);
  });
}

function orderEntries(entries: readonly SealEntry[]): readonly SealEntry[] {
  return orderSealEntries(entries);
}

export function logicalSealIdentity(entries: readonly SealEntry[]): string {
  return exactLogicalSealIdentity(entries);
}

function validateInput(input: PersistSealedRunInput): readonly SealEntry[] {
  for (const [field, value] of [
    ["runId", input.runId],
    ["writerGeneration", input.writerGeneration],
    ["startedAt", input.startedAt],
  ] as const) requireIdentity(value, field);
  requireBytesDigest(input.recordCoreBytes, input.recordCoreDigest, "record core");
  requireBytesDigest(input.runCoreBytes, input.runCoreDigest, "run core");
  if (!Number.isFinite(input.deadlineEpochMs)) throw sqliteError("record-content-invalid", "persist-sealed-run", "deadline is invalid");
  assertContiguous(input.slots, "slots");
  const entries: SealEntry[] = [
    recordSealEntry(input.recordCoreDigest),
    runSealEntry({ runId: input.runId, writerGeneration: input.writerGeneration, startedAt: input.startedAt, coreDigest: input.runCoreDigest }),
  ];
  const unique = new Set<string>();
  const add = (entry: SealEntry): void => {
    requireIdentity(entry.logicalIdentity, `${entry.kind}.identity`);
    requireDigest(entry.digest, `${entry.kind}.digest`);
    const key = `${entry.kind}:${entry.logicalIdentity}`;
    if (unique.has(key)) throw sqliteError("record-command-conflict", "persist-sealed-run", `duplicate ${entry.kind} identity ${entry.logicalIdentity}`);
    unique.add(key);
    entries.push(entry);
  };
  let byteCount = input.runCoreBytes.byteLength;
  for (const slot of input.slots) {
    requireIdentity(slot.slotId, "slot.slotId");
    requireBytesDigest(slot.coreBytes, slot.coreDigest, `slot ${slot.slotId}`);
    byteCount += slot.coreBytes.byteLength;
    add(slotSealEntry(input.runId, slot));
  }
  for (const attempt of input.attempts) {
    requireIdentity(attempt.attemptId, "attempt.attemptId");
    requireAttemptLocator(attempt.attemptId, attempt.attemptLocator);
    requireBytesDigest(attempt.coreBytes, attempt.coreDigest, `attempt ${attempt.attemptId}`);
    byteCount += attempt.coreBytes.byteLength;
    add(attemptSealEntry(input.runId, attempt.attemptId, attempt.attemptLocator, attempt.coreDigest));
  }
  const slotIds = new Set(input.slots.map((slot) => slot.slotId));
  const memberSlots = new Set<string>();
  for (const member of input.members) {
    if (!slotIds.has(member.slotId) || memberSlots.has(member.slotId)) {
      throw sqliteError("record-seal-incomplete", "persist-sealed-run", `member coverage conflicts at slot ${member.slotId}`);
    }
    memberSlots.add(member.slotId);
    const hasAttempt = member.originRunId !== undefined && member.attemptId !== undefined;
    const terminal = member.action === "not-dispatched" || member.action === "interrupted";
    if (terminal === hasAttempt || ((member.originRunId === undefined) !== (member.attemptId === undefined))) {
      throw sqliteError("record-content-invalid", "persist-sealed-run", `member ${member.slotId} action and attempt locator disagree`);
    }
    if (member.action === "executed" && member.originRunId !== input.runId) {
      throw sqliteError("record-command-conflict", "persist-sealed-run", `executed member ${member.slotId} points outside its origin run`);
    }
    requireBytesDigest(member.coreBytes, member.coreDigest, `member ${member.slotId}`);
    byteCount += member.coreBytes.byteLength;
    add(memberSealEntry(input.runId, member));
  }
  if (memberSlots.size !== slotIds.size) throw sqliteError("record-seal-incomplete", "persist-sealed-run", "sealed run does not have exactly one member per slot");

  let rowCount = 1 + input.slots.length + input.attempts.length + input.members.length;
  for (const attachment of input.attachments) {
    requireIdentity(attachment.attachmentId, "attachment.attachmentId");
    requireIdentity(attachment.family, "attachment.family");
    requireIdentity(attachment.logicalIdentity, "attachment.logicalIdentity");
    if (attachment.ownerRunId !== input.runId) throw sqliteError("record-command-conflict", "persist-sealed-run", `attachment ${attachment.attachmentId} has a different owner run`);
    if ((attachment.ownerKind === "attempt") !== (attachment.ownerAttemptId !== undefined)) {
      throw sqliteError("record-content-invalid", "persist-sealed-run", `attachment ${attachment.attachmentId} owner shape is invalid`);
    }
    requireBytesDigest(attachment.canonicalBytes, attachment.canonicalDigest, `attachment ${attachment.attachmentId}`);
    requireBytesDigest(attachment.logicalInventoryBytes, attachment.inventoryDigest, `attachment ${attachment.attachmentId} inventory`);
    add(attachmentSealEntry(attachment));
    byteCount += attachment.canonicalBytes.byteLength + attachment.logicalInventoryBytes.byteLength;
    rowCount += 1;
    assertContiguous(attachment.references, `attachment ${attachment.attachmentId} references`);
    for (const reference of attachment.references) {
      requireBytesDigest(reference.canonicalBytes, reference.referenceDigest, `reference ${attachment.attachmentId}/${reference.ordinal}`);
      byteCount += reference.canonicalBytes.byteLength;
      requireIdentity(reference.family, "reference.family");
      add(referenceSealEntry(attachment.attachmentId, reference));
      rowCount += 1;
    }
    assertContiguous(attachment.collectionItems, `attachment ${attachment.attachmentId} items`);
    for (const item of attachment.collectionItems) {
      requireBytesDigest(item.canonicalBytes, item.canonicalDigest, `item ${attachment.attachmentId}/${item.ordinal}`);
      requireIdentity(item.logicalIdentity, "collectionItem.logicalIdentity");
      add(collectionItemSealEntry(attachment.attachmentId, item));
      byteCount += item.canonicalBytes.byteLength;
      rowCount += 1;
    }
    for (const content of attachment.contents) {
      requireIdentity(content.contentId, "content.contentId");
      requireIdentity(content.logicalHandle, "content.logicalHandle");
      requireOrdinal(content.byteLength, `content ${content.contentId}.byteLength`);
      requireDigest(content.digest, `content ${content.contentId}.digest`);
      assertContiguous(content.chunks, `content ${content.contentId} chunks`);
      const hash = createHash("sha256");
      let observedBytes = 0;
      for (const chunk of content.chunks) {
        if (chunk.bytes.byteLength > RECORD_SQLITE_CHUNK_BYTES) {
          throw sqliteError("record-resource-limit-exceeded", "persist-sealed-run", `content chunk ${content.contentId}/${chunk.ordinal} exceeds ${RECORD_SQLITE_CHUNK_BYTES} bytes`);
        }
        requireBytesDigest(chunk.bytes, chunk.chunkDigest, `content chunk ${content.contentId}/${chunk.ordinal}`);
        hash.update(chunk.bytes);
        observedBytes += chunk.bytes.byteLength;
        byteCount += chunk.bytes.byteLength;
        rowCount += 1;
        add(contentChunkSealEntry(content.contentId, chunk.ordinal, chunk.chunkDigest));
      }
      if (observedBytes !== content.byteLength || hash.digest("hex") !== content.digest) {
        throw sqliteError("record-content-invalid", "persist-sealed-run", `content ${content.contentId} whole length or digest is invalid`);
      }
      add(contentSealEntry(attachment.attachmentId, { contentId: content.contentId, logicalHandle: content.logicalHandle,
        byteLength: content.byteLength, digest: content.digest, chunkCount: content.chunks.length }));
      rowCount += 1;
    }
  }
  return orderEntries(entries);
}

function rows(connection: RecordDatabase, sql: string, ...parameters: (string | number)[]): readonly Row[] {
  return recordStatement(connection, sql).all(...parameters) as unknown as readonly Row[];
}

function visitRunSealEntries(
  connection: RecordDatabase,
  runId: string,
  visit: (entry: SealEntry) => void,
  verifyPayloadBytes = true,
  verifyContentChunkBytes = verifyPayloadBytes,
): void {
  const verified = (row: Row, digestField: string, payloadField: string): string => {
    const value = text(row, digestField);
    requireDigest(value, digestField);
    if (verifyPayloadBytes && digestBytes(bytes(row, payloadField)) !== value) {
      throw sqliteError("record-seal-incomplete", "verify-seal", `${payloadField} does not match ${digestField}`);
    }
    return value;
  };
  const record = recordStatement(connection, "SELECT record_payload,record_digest FROM record_metadata WHERE singleton=1").get() as unknown as Row;
  visit(recordSealEntry(verified(record, "record_digest", "record_payload")));
  const run = recordStatement(connection, `SELECT run_id,writer_generation,started_at,core_payload,core_digest FROM runs WHERE run_id=?`).get(runId) as unknown as Row | undefined;
  if (run === undefined) throw sqliteError("record-seal-incomplete", "verify-seal", `Run ${runId} is missing`);
  visit(runSealEntry({ runId: text(run, "run_id"), writerGeneration: text(run, "writer_generation"), startedAt: text(run, "started_at"), coreDigest: verified(run, "core_digest", "core_payload") }));
  for (const row of recordStatement(connection, "SELECT slot_id,ordinal,core_payload,core_digest FROM slots WHERE run_id=?").iterate(runId) as unknown as Iterable<Row>) {
    visit(slotSealEntry(runId, { slotId: text(row, "slot_id"), ordinal: integer(row, "ordinal"), coreDigest: verified(row, "core_digest", "core_payload") }));
  }
  for (const row of recordStatement(connection, "SELECT attempt_id,attempt_locator,core_payload,core_digest FROM attempts WHERE origin_run_id=?").iterate(runId) as unknown as Iterable<Row>) {
    visit(attemptSealEntry(runId, text(row, "attempt_id"), text(row, "attempt_locator"), verified(row, "core_digest", "core_payload")));
  }
  for (const row of recordStatement(connection, `SELECT slot_id,origin_run_id,attempt_id,action,core_payload,core_digest FROM members WHERE target_run_id=?`).iterate(runId) as unknown as Iterable<Row>) {
    visit(memberSealEntry(runId, { slotId: text(row, "slot_id"), originRunId: optionalText(row, "origin_run_id"),
      attemptId: optionalText(row, "attempt_id"), action: memberAction(row, "action"), coreDigest: verified(row, "core_digest", "core_payload") }));
  }
  for (const row of recordStatement(connection, `SELECT attachment_id,owner_kind,owner_run_id,owner_attempt_id,family,family_revision,logical_identity,
    canonical_payload,canonical_digest,logical_inventory,inventory_digest FROM attachments WHERE owner_run_id=?`).iterate(runId) as unknown as Iterable<Row>) {
    const canonicalDigest = verified(row, "canonical_digest", "canonical_payload");
    const inventoryDigest = verified(row, "inventory_digest", "logical_inventory");
    visit(attachmentSealEntry({ attachmentId: text(row, "attachment_id"), ownerKind: ownerKind(row, "owner_kind"),
      ownerRunId: text(row, "owner_run_id"), ownerAttemptId: optionalText(row, "owner_attempt_id"), family: text(row, "family"),
      familyRevision: integer(row, "family_revision"), logicalIdentity: text(row, "logical_identity"), canonicalDigest, inventoryDigest }));
  }
  for (const row of recordStatement(connection, `SELECT r.attachment_id,r.ordinal,r.target_owner_kind,r.target_family,r.canonical_payload,r.reference_digest
    FROM attachment_references r JOIN attachments a ON a.attachment_id=r.attachment_id WHERE a.owner_run_id=?`).iterate(runId) as unknown as Iterable<Row>) {
    visit(referenceSealEntry(text(row, "attachment_id"), { ordinal: integer(row, "ordinal"), owner: ownerKind(row, "target_owner_kind"),
      family: text(row, "target_family"), referenceDigest: verified(row, "reference_digest", "canonical_payload") }));
  }
  for (const row of recordStatement(connection, `SELECT i.attachment_id,i.ordinal,i.logical_identity,i.canonical_payload,i.canonical_digest
    FROM collection_items i JOIN attachments a ON a.attachment_id=i.attachment_id WHERE a.owner_run_id=?`).iterate(runId) as unknown as Iterable<Row>) {
    visit(collectionItemSealEntry(text(row, "attachment_id"), { ordinal: integer(row, "ordinal"), logicalIdentity: text(row, "logical_identity"),
      canonicalDigest: verified(row, "canonical_digest", "canonical_payload") }));
  }
  for (const row of recordStatement(connection, `SELECT c.content_id,c.attachment_id,c.logical_handle,c.byte_length,c.overall_digest,c.chunk_count
    FROM contents c JOIN attachments a ON a.attachment_id=c.attachment_id WHERE a.owner_run_id=?`).iterate(runId) as unknown as Iterable<Row>) {
    visit(contentSealEntry(text(row, "attachment_id"), { contentId: text(row, "content_id"), logicalHandle: text(row, "logical_handle"),
      byteLength: integer(row, "byte_length"), digest: text(row, "overall_digest"), chunkCount: integer(row, "chunk_count") }));
  }
  const chunkSql = verifyContentChunkBytes
    ? `SELECT c.content_id,c.ordinal,c.bytes,c.chunk_digest FROM content_chunks c
      JOIN contents n ON n.content_id=c.content_id JOIN attachments a ON a.attachment_id=n.attachment_id WHERE a.owner_run_id=?`
    : `SELECT c.content_id,c.ordinal,c.chunk_digest FROM content_chunks c
      JOIN contents n ON n.content_id=c.content_id JOIN attachments a ON a.attachment_id=n.attachment_id WHERE a.owner_run_id=?`;
  for (const row of recordStatement(connection, chunkSql).iterate(runId) as unknown as Iterable<Row>) {
    const chunkDigest = text(row, "chunk_digest");
    requireDigest(chunkDigest, "chunk_digest");
    if (verifyContentChunkBytes && digestBytes(bytes(row, "bytes")) !== chunkDigest) {
      throw sqliteError("record-seal-incomplete", "verify-seal", "bytes does not match chunk_digest");
    }
    visit(contentChunkSealEntry(text(row, "content_id"), integer(row, "ordinal"), chunkDigest));
  }
}

export function collectRunSealEntries(connection: RecordDatabase, runId: string): readonly SealEntry[] {
  const entries: SealEntry[] = [];
  visitRunSealEntries(connection, runId, (entry) => entries.push(entry));
  return orderEntries(entries);
}

function runRow(connection: RecordDatabase, runId: string): Row | undefined {
  return recordStatement(connection, `SELECT run_id,status,writer_generation,started_at,core_payload,core_digest,mutation_sequence,
    candidate_seal_identity,candidate_seal_entry_count,candidate_seal_staged_count,logical_seal_identity FROM runs WHERE run_id=?`)
    .get(runId) as unknown as Row | undefined;
}

function assertBoundedBatch(operation: string, rowCount: number, byteCount: number): void {
  if (!Number.isSafeInteger(rowCount) || rowCount < 0 || !Number.isSafeInteger(byteCount) || byteCount < 0 ||
    rowCount > RECORD_SQLITE_MAX_PUBLISH_ROWS || byteCount > RECORD_SQLITE_MAX_PUBLISH_BYTES) {
    throw sqliteError("record-resource-limit-exceeded", operation, `staging batch exceeds its bound (${rowCount} rows, ${byteCount} bytes)`);
  }
}

function assertBoundedRow(operation: string, field: string, value: Uint8Array): void {
  if (value.byteLength > RECORD_SQLITE_MAX_ROW_BYTES) {
    throw sqliteError("record-resource-limit-exceeded", operation, `${field} exceeds the ${RECORD_SQLITE_MAX_ROW_BYTES} byte row ceiling`);
  }
}

function assertRunFence(
  connection: RecordDatabase,
  runId: string,
  writerGeneration: string,
  operation: string,
  expectedStatus: "open" | "sealing" = "open",
): Row {
  const row = runRow(connection, runId);
  if (row === undefined || text(row, "writer_generation") !== writerGeneration || text(row, "status") !== expectedStatus) {
    throw sqliteError("record-command-conflict", operation, `Run ${runId} admission fence is missing or changed`);
  }
  return row;
}

function bumpMutationSequence(connection: RecordDatabase, runId: string): void {
  recordStatement(connection, "UPDATE runs SET mutation_sequence=mutation_sequence+1 WHERE run_id=? AND status='open'").run(runId);
}

function assertAttachmentFence(connection: RecordDatabase, runId: string, attachmentId: string, operation: string): void {
  const row = recordStatement(connection, "SELECT owner_run_id FROM attachments WHERE attachment_id=?").get(attachmentId) as unknown as Row | undefined;
  if (row === undefined || text(row, "owner_run_id") !== runId) {
    throw sqliteError("record-command-conflict", operation, `Attachment ${attachmentId} does not belong to Run ${runId}`);
  }
}

export function beginRun(connection: RecordDatabase, input: BeginRunInput): void {
  requireIdentity(input.runId, "runId");
  requireIdentity(input.writerGeneration, "writerGeneration");
  requireIdentity(input.startedAt, "startedAt");
  withImmediateTransaction(connection, input.deadlineEpochMs, "begin-run", () => {
    recordStatement(connection, `INSERT OR IGNORE INTO runs(run_id,status,writer_generation,started_at,core_payload,core_digest,
      mutation_sequence,candidate_seal_identity,candidate_seal_entry_count,candidate_seal_staged_count,logical_seal_identity)
      VALUES (?,'open',?,?,NULL,NULL,0,NULL,NULL,0,NULL)`).run(input.runId, input.writerGeneration, input.startedAt);
    const stored = runRow(connection, input.runId);
    if (stored === undefined || text(stored, "writer_generation") !== input.writerGeneration ||
      text(stored, "started_at") !== input.startedAt) {
      throw sqliteError("record-command-conflict", "begin-run", `Run ${input.runId} conflicts with its durable admission`);
    }
    if (text(stored, "status") !== "open" && text(stored, "status") !== "sealing" && text(stored, "status") !== "sealed") {
      throw sqliteError("record-database-invalid", "begin-run", `Run ${input.runId} has an invalid status`);
    }
  });
}

export function admitAttempt(connection: RecordDatabase, input: AdmitAttemptInput): void {
  requireIdentity(input.attemptId, "attemptId");
  requireAttemptLocator(input.attemptId, input.attemptLocator, "admit-attempt");
  withImmediateTransaction(connection, input.deadlineEpochMs, "admit-attempt", () => {
    assertRunFence(connection, input.runId, input.writerGeneration, "admit-attempt");
    const inserted = recordStatement(connection, `INSERT OR IGNORE INTO attempts(origin_run_id,attempt_id,attempt_locator,core_payload,core_digest)
      VALUES (?,?,?,NULL,NULL)`).run(input.runId, input.attemptId, input.attemptLocator);
    const stored = recordStatement(connection, "SELECT origin_run_id,attempt_locator FROM attempts WHERE origin_run_id=? AND attempt_id=?")
      .get(input.runId, input.attemptId) as unknown as Row | undefined;
    if (stored === undefined || text(stored, "origin_run_id") !== input.runId || text(stored, "attempt_locator") !== input.attemptLocator) {
      throw sqliteError("record-command-conflict", "admit-attempt", `Attempt ${input.attemptId} conflicts with its durable admission`);
    }
    if (Number(inserted.changes) > 0) bumpMutationSequence(connection, input.runId);
  });
}

export function admitAttachment(connection: RecordDatabase, input: AdmitAttachmentInput): void {
  if (input.ownerRunId !== input.runId || (input.ownerKind === "attempt") !== (input.ownerAttemptId !== undefined)) {
    throw sqliteError("record-content-invalid", "admit-attachment", "attachment owner does not match its Run admission");
  }
  requireIdentity(input.attachmentId, "attachmentId");
  requireIdentity(input.family, "family");
  requireIdentity(input.ownerRunId, "ownerRunId");
  if (input.ownerAttemptId !== undefined) requireIdentity(input.ownerAttemptId, "ownerAttemptId");
  withImmediateTransaction(connection, input.deadlineEpochMs, "admit-attachment", () => {
    assertRunFence(connection, input.runId, input.writerGeneration, "admit-attachment");
    if (input.ownerKind === "attempt") {
      const admitted = recordStatement(connection, "SELECT 1 AS admitted FROM attempts WHERE origin_run_id=? AND attempt_id=?")
        .get(input.runId, input.ownerAttemptId!) as unknown as Row | undefined;
      if (admitted === undefined) throw sqliteError("record-command-conflict", "admit-attachment", "attempt owner is not admitted");
    }
    const inserted = recordStatement(connection, `INSERT OR IGNORE INTO attachments(attachment_id,owner_kind,owner_run_id,owner_attempt_id,
      family,family_revision,logical_identity,canonical_payload,canonical_digest,logical_inventory,inventory_digest)
      VALUES (?,?,?,?,?,?,NULL,NULL,NULL,NULL,NULL)`).run(
      input.attachmentId, input.ownerKind, input.ownerRunId, input.ownerAttemptId ?? null, input.family, input.familyRevision,
    );
    const stored = recordStatement(connection, `SELECT owner_kind,owner_run_id,owner_attempt_id,family,family_revision FROM attachments
      WHERE attachment_id=?`).get(input.attachmentId) as unknown as Row | undefined;
    if (stored === undefined || text(stored, "owner_kind") !== input.ownerKind || text(stored, "owner_run_id") !== input.ownerRunId ||
      optionalText(stored, "owner_attempt_id") !== input.ownerAttemptId || text(stored, "family") !== input.family ||
      integer(stored, "family_revision") !== input.familyRevision) {
      throw sqliteError("record-command-conflict", "admit-attachment", `Attachment ${input.attachmentId} conflicts with its durable admission`);
    }
    if (Number(inserted.changes) > 0) bumpMutationSequence(connection, input.runId);
  });
}

export function admitContent(connection: RecordDatabase, input: AdmitContentInput): void {
  requireIdentity(input.contentId, "contentId");
  requireIdentity(input.logicalHandle, "logicalHandle");
  withImmediateTransaction(connection, input.deadlineEpochMs, "admit-content", () => {
    assertRunFence(connection, input.runId, input.writerGeneration, "admit-content");
    const attachment = recordStatement(connection, "SELECT owner_run_id FROM attachments WHERE attachment_id=?")
      .get(input.attachmentId) as unknown as Row | undefined;
    if (attachment === undefined || text(attachment, "owner_run_id") !== input.runId) {
      throw sqliteError("record-command-conflict", "admit-content", "attachment admission is missing");
    }
    const inserted = recordStatement(connection, `INSERT OR IGNORE INTO contents(content_id,attachment_id,logical_handle,byte_length,overall_digest,chunk_count)
      VALUES (?,?,?,NULL,NULL,NULL)`).run(input.contentId, input.attachmentId, input.logicalHandle);
    const stored = recordStatement(connection, "SELECT attachment_id,logical_handle FROM contents WHERE content_id=?")
      .get(input.contentId) as unknown as Row | undefined;
    if (stored === undefined || text(stored, "attachment_id") !== input.attachmentId || text(stored, "logical_handle") !== input.logicalHandle) {
      throw sqliteError("record-command-conflict", "admit-content", `Content ${input.contentId} conflicts with its durable admission`);
    }
    if (Number(inserted.changes) > 0) bumpMutationSequence(connection, input.runId);
  });
}

export function stageAttachmentMetadata(connection: RecordDatabase, input: StageAttachmentInput): void {
  const { attachment } = input;
  if (attachment.ownerRunId !== input.runId) throw sqliteError("record-command-conflict", "stage-attachment", "attachment owner run differs from staging run");
  requireBytesDigest(attachment.canonicalBytes, attachment.canonicalDigest, `attachment ${attachment.attachmentId}`);
  requireBytesDigest(attachment.logicalInventoryBytes, attachment.inventoryDigest, `attachment ${attachment.attachmentId} inventory`);
  for (const content of attachment.contents) {
    requireOrdinal(content.byteLength, `content ${content.contentId}.byteLength`);
    requireOrdinal(content.chunkCount, `content ${content.contentId}.chunkCount`);
    requireDigest(content.digest, `content ${content.contentId}.digest`);
  }
  const byteCount = attachment.canonicalBytes.byteLength + attachment.logicalInventoryBytes.byteLength;
  assertBoundedBatch("stage-attachment", 1 + attachment.contents.length, byteCount);
  withImmediateTransaction(connection, input.deadlineEpochMs, "stage-attachment", () => {
    recordStatement(connection, `INSERT OR IGNORE INTO attachments(attachment_id,owner_kind,owner_run_id,owner_attempt_id,family,family_revision,logical_identity,canonical_payload,canonical_digest,logical_inventory,inventory_digest)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
      attachment.attachmentId, attachment.ownerKind, attachment.ownerRunId, attachment.ownerAttemptId ?? null,
      attachment.family, attachment.familyRevision, attachment.logicalIdentity, attachment.canonicalBytes,
      attachment.canonicalDigest, attachment.logicalInventoryBytes, attachment.inventoryDigest,
    );
    for (const content of attachment.contents) recordStatement(connection, `INSERT OR IGNORE INTO contents(content_id,attachment_id,logical_handle,byte_length,overall_digest,chunk_count)
      VALUES (?,?,?,?,?,?)`).run(content.contentId, attachment.attachmentId, content.logicalHandle, content.byteLength, content.digest, content.chunkCount);
    const stored = recordStatement(connection, `SELECT owner_kind,owner_run_id,owner_attempt_id,family,family_revision,logical_identity,
      canonical_payload,canonical_digest,logical_inventory,inventory_digest FROM attachments WHERE attachment_id=?`)
      .get(attachment.attachmentId) as unknown as Row | undefined;
    if (
      stored === undefined || text(stored, "owner_kind") !== attachment.ownerKind || text(stored, "owner_run_id") !== attachment.ownerRunId ||
      optionalText(stored, "owner_attempt_id") !== attachment.ownerAttemptId || text(stored, "family") !== attachment.family ||
      integer(stored, "family_revision") !== attachment.familyRevision || text(stored, "logical_identity") !== attachment.logicalIdentity ||
      text(stored, "canonical_digest") !== attachment.canonicalDigest || !bytesEqual(bytes(stored, "canonical_payload"), attachment.canonicalBytes) ||
      text(stored, "inventory_digest") !== attachment.inventoryDigest || !bytesEqual(bytes(stored, "logical_inventory"), attachment.logicalInventoryBytes)
    ) throw sqliteError("record-command-conflict", "stage-attachment", `attachment ${attachment.attachmentId} conflicts with its durable retry`);
    for (const content of attachment.contents) {
      const persisted = recordStatement(connection, `SELECT attachment_id,logical_handle,byte_length,overall_digest,chunk_count
        FROM contents WHERE content_id=?`).get(content.contentId) as unknown as Row | undefined;
      if (
        persisted === undefined || text(persisted, "attachment_id") !== attachment.attachmentId || text(persisted, "logical_handle") !== content.logicalHandle ||
        integer(persisted, "byte_length") !== content.byteLength || text(persisted, "overall_digest") !== content.digest || integer(persisted, "chunk_count") !== content.chunkCount
      ) throw sqliteError("record-command-conflict", "stage-attachment", `content ${content.contentId} metadata conflicts with its durable retry`);
    }
  });
}

function validateFinalInput(input: StageRunCoreInput): void {
  requireBytesDigest(input.recordCoreBytes, input.recordCoreDigest, "record core");
  requireBytesDigest(input.runCoreBytes, input.runCoreDigest, "run core");
  assertBoundedRow("finalize-run", "record core", input.recordCoreBytes);
  assertBoundedRow("finalize-run", "run core", input.runCoreBytes);
  assertContiguous(input.slots, "slots");
  let byteCount = input.recordCoreBytes.byteLength + input.runCoreBytes.byteLength;
  for (const slot of input.slots) {
    requireBytesDigest(slot.coreBytes, slot.coreDigest, `slot ${slot.slotId}`);
    assertBoundedRow("finalize-run", `slot ${slot.slotId}`, slot.coreBytes);
    byteCount += slot.coreBytes.byteLength;
  }
  for (const attempt of input.attempts) {
    requireAttemptLocator(attempt.attemptId, attempt.attemptLocator, "finalize-run");
    requireBytesDigest(attempt.coreBytes, attempt.coreDigest, `attempt ${attempt.attemptId}`);
    assertBoundedRow("finalize-run", `attempt ${attempt.attemptId}`, attempt.coreBytes);
    byteCount += attempt.coreBytes.byteLength;
  }
  for (const member of input.members) {
    requireBytesDigest(member.coreBytes, member.coreDigest, `member ${member.slotId}`);
    assertBoundedRow("finalize-run", `member ${member.slotId}`, member.coreBytes);
    byteCount += member.coreBytes.byteLength;
    const hasAttempt = member.originRunId !== undefined && member.attemptId !== undefined;
    const terminal = member.action === "not-dispatched" || member.action === "interrupted";
    if (terminal === hasAttempt || ((member.originRunId === undefined) !== (member.attemptId === undefined))) {
      throw sqliteError("record-content-invalid", "finalize-run", `Member ${member.slotId} action and locator disagree`);
    }
    if (member.action === "executed" && member.originRunId !== input.runId) {
      throw sqliteError("record-command-conflict", "finalize-run", `Executed Member ${member.slotId} has a different origin Run`);
    }
  }
  const finalSlotIds = new Set(input.slots.map((slot) => slot.slotId));
  const finalMemberSlots = new Set(input.members.map((member) => member.slotId));
  if (finalSlotIds.size !== input.slots.length || finalMemberSlots.size !== input.members.length ||
    finalSlotIds.size !== finalMemberSlots.size || [...finalSlotIds].some((slotId) => !finalMemberSlots.has(slotId))) {
    throw sqliteError("record-seal-incomplete", "finalize-run", "final Run does not have exactly one Member per Slot");
  }
  let contentCount = 0;
  for (const attachment of input.attachments) {
    requireIdentity(attachment.attachmentId, "attachment.attachmentId");
    requireIdentity(attachment.ownerRunId, "attachment.ownerRunId");
    if (attachment.ownerAttemptId !== undefined) requireIdentity(attachment.ownerAttemptId, "attachment.ownerAttemptId");
    requireIdentity(attachment.family, "attachment.family");
    requireIdentity(attachment.logicalIdentity, "attachment.logicalIdentity");
    if (attachment.ownerRunId !== input.runId || (attachment.ownerKind === "attempt") !== (attachment.ownerAttemptId !== undefined)) {
      throw sqliteError("record-content-invalid", "finalize-run", `Attachment ${attachment.attachmentId} owner closure is invalid`);
    }
    requireBytesDigest(attachment.canonicalBytes, attachment.canonicalDigest, `attachment ${attachment.attachmentId}`);
    requireBytesDigest(attachment.logicalInventoryBytes, attachment.inventoryDigest, `attachment ${attachment.attachmentId} inventory`);
    assertBoundedRow("finalize-run", `attachment ${attachment.attachmentId}`, attachment.canonicalBytes);
    assertBoundedRow("finalize-run", `attachment ${attachment.attachmentId} inventory`, attachment.logicalInventoryBytes);
    byteCount += attachment.canonicalBytes.byteLength + attachment.logicalInventoryBytes.byteLength;
    contentCount += attachment.contents.length;
    for (const content of attachment.contents) {
      requireOrdinal(content.byteLength, `content ${content.contentId}.byteLength`);
      requireOrdinal(content.chunkCount, `content ${content.contentId}.chunkCount`);
      requireDigest(content.digest, `content ${content.contentId}.digest`);
    }
  }
  assertBoundedBatch("finalize-run", 2 + input.slots.length + input.attempts.length + input.members.length + input.attachments.length + contentCount, byteCount);
}

function assertFinalInputStored(connection: RecordDatabase, input: StageRunCoreInput): void {
  const header = runRow(connection, input.runId);
  if (header === undefined || text(header, "writer_generation") !== input.writerGeneration || text(header, "started_at") !== input.startedAt ||
    text(header, "core_digest") !== input.runCoreDigest || !bytesEqual(bytes(header, "core_payload"), input.runCoreBytes)) {
    throw sqliteError("record-command-conflict", "finalize-run", `Run ${input.runId} conflicts with committed finalization`);
  }
  const record = recordStatement(connection, "SELECT record_payload,record_digest FROM record_metadata WHERE singleton=1").get() as unknown as Row;
  if (text(record, "record_digest") !== input.recordCoreDigest || !bytesEqual(bytes(record, "record_payload"), input.recordCoreBytes)) {
    throw sqliteError("record-command-conflict", "finalize-run", "Project RecordDocument conflicts with committed finalization");
  }
  const counts = recordStatement(connection, `SELECT (SELECT count(*) FROM slots WHERE run_id=?) slots,
    (SELECT count(*) FROM attempts WHERE origin_run_id=?) attempts,(SELECT count(*) FROM members WHERE target_run_id=?) members,
    (SELECT count(*) FROM attachments WHERE owner_run_id=?) attachments`).get(input.runId, input.runId, input.runId, input.runId) as unknown as Row;
  if (integer(counts, "slots") !== input.slots.length || integer(counts, "attempts") !== input.attempts.length ||
    integer(counts, "members") !== input.members.length || integer(counts, "attachments") !== input.attachments.length) {
    throw sqliteError("record-command-conflict", "finalize-run", "committed inventory differs from retry input");
  }
  for (const slot of input.slots) {
    const stored = recordStatement(connection, "SELECT ordinal,core_payload,core_digest FROM slots WHERE run_id=? AND slot_id=?").get(input.runId, slot.slotId) as unknown as Row | undefined;
    if (stored === undefined || integer(stored, "ordinal") !== slot.ordinal || text(stored, "core_digest") !== slot.coreDigest || !bytesEqual(bytes(stored, "core_payload"), slot.coreBytes)) {
      throw sqliteError("record-command-conflict", "finalize-run", `Slot ${slot.slotId} conflicts with committed finalization`);
    }
  }
  for (const attempt of input.attempts) {
    const stored = recordStatement(connection, "SELECT attempt_locator,core_payload,core_digest FROM attempts WHERE origin_run_id=? AND attempt_id=?").get(input.runId, attempt.attemptId) as unknown as Row | undefined;
    if (stored === undefined || text(stored, "attempt_locator") !== attempt.attemptLocator || text(stored, "core_digest") !== attempt.coreDigest || !bytesEqual(bytes(stored, "core_payload"), attempt.coreBytes)) {
      throw sqliteError("record-command-conflict", "finalize-run", `Attempt ${attempt.attemptId} conflicts with committed finalization`);
    }
  }
  for (const member of input.members) {
    const stored = recordStatement(connection, "SELECT origin_run_id,attempt_id,action,core_payload,core_digest FROM members WHERE target_run_id=? AND slot_id=?").get(input.runId, member.slotId) as unknown as Row | undefined;
    if (stored === undefined || optionalText(stored, "origin_run_id") !== member.originRunId || optionalText(stored, "attempt_id") !== member.attemptId ||
      text(stored, "action") !== member.action || text(stored, "core_digest") !== member.coreDigest || !bytesEqual(bytes(stored, "core_payload"), member.coreBytes)) {
      throw sqliteError("record-command-conflict", "finalize-run", `Member ${member.slotId} conflicts with committed finalization`);
    }
  }
  for (const attachment of input.attachments) {
    const stored = recordStatement(connection, `SELECT owner_kind,owner_run_id,owner_attempt_id,family,family_revision,logical_identity,canonical_payload,canonical_digest,logical_inventory,inventory_digest
      FROM attachments WHERE attachment_id=? AND owner_run_id=?`).get(attachment.attachmentId, input.runId) as unknown as Row | undefined;
    if (stored === undefined || text(stored, "owner_kind") !== attachment.ownerKind || text(stored, "owner_run_id") !== attachment.ownerRunId ||
      optionalText(stored, "owner_attempt_id") !== attachment.ownerAttemptId || text(stored, "family") !== attachment.family ||
      integer(stored, "family_revision") !== attachment.familyRevision ||
      text(stored, "logical_identity") !== attachment.logicalIdentity || text(stored, "canonical_digest") !== attachment.canonicalDigest ||
      !bytesEqual(bytes(stored, "canonical_payload"), attachment.canonicalBytes) || text(stored, "inventory_digest") !== attachment.inventoryDigest ||
      !bytesEqual(bytes(stored, "logical_inventory"), attachment.logicalInventoryBytes)) {
      throw sqliteError("record-command-conflict", "finalize-run", `Attachment ${attachment.attachmentId} conflicts with committed finalization`);
    }
    const count = recordStatement(connection, "SELECT count(*) AS count FROM contents WHERE attachment_id=?").get(attachment.attachmentId) as unknown as Row;
    if (integer(count, "count") !== attachment.contents.length) throw sqliteError("record-command-conflict", "finalize-run", `Attachment ${attachment.attachmentId} Content inventory differs`);
    for (const content of attachment.contents) {
      const persisted = recordStatement(connection, "SELECT logical_handle,byte_length,overall_digest,chunk_count FROM contents WHERE content_id=? AND attachment_id=?")
        .get(content.contentId, attachment.attachmentId) as unknown as Row | undefined;
      if (persisted === undefined || text(persisted, "logical_handle") !== content.logicalHandle || integer(persisted, "byte_length") !== content.byteLength ||
        text(persisted, "overall_digest") !== content.digest || integer(persisted, "chunk_count") !== content.chunkCount) {
        throw sqliteError("record-command-conflict", "finalize-run", `Content ${content.contentId} conflicts with committed finalization`);
      }
    }
  }
}

function preparedSealBatch(
  connection: RecordDatabase,
  runId: string,
  expectedIdentity: string,
  expectedCount: number,
  startOrdinal: number,
  maximumRows: number,
): readonly SealEntry[] {
  const cached = sealEntryCache(connection).get(runId);
  if (cached === undefined || cached.count !== expectedCount || cached.identity !== expectedIdentity) {
    throw sqliteError("record-command-conflict", "prepare-seal", "bounded Seal staging requires a prepared closure capability");
  }
  const result: SealEntry[] = [];
  let expectedOrdinal = startOrdinal;
  for (const row of recordStatement(connection, `SELECT ordinal,entry_kind,logical_identity,digest
    FROM temp.niceeval_prepared_seal_ordered WHERE run_id=? AND ordinal>=? ORDER BY ordinal LIMIT ?`)
    .iterate(runId, startOrdinal, maximumRows) as unknown as Iterable<Row>) {
    if (integer(row, "ordinal") !== expectedOrdinal) {
      throw sqliteError("record-command-conflict", "prepare-seal", "prepared Seal closure is not a contiguous ordered prefix");
    }
    result.push(Object.freeze({
      kind: sealEntryKind(row, "entry_kind"),
      logicalIdentity: text(row, "logical_identity"),
      digest: text(row, "digest"),
    }));
    expectedOrdinal += 1;
  }
  if (startOrdinal < expectedCount && result.length === 0) {
    throw sqliteError("record-command-conflict", "prepare-seal", "prepared Seal closure ended before its declared count");
  }
  return Object.freeze(result);
}

export function stageSealEntries(
  connection: RecordDatabase,
  input: StageSealEntriesInput,
): StageSealEntriesResult {
  requireOrdinal(input.startOrdinal, "Seal batch startOrdinal");
  if (!Number.isSafeInteger(input.maximumRows) || input.maximumRows < 1 || input.maximumRows > 256) {
    throw sqliteError("record-resource-limit-exceeded", "prepare-seal", "Seal batch maximumRows must be between 1 and 256");
  }
  const existing = runRow(connection, input.runId);
  if (existing !== undefined && text(existing, "writer_generation") === input.writerGeneration && text(existing, "status") === "sealed") {
    const count = integer(existing, "candidate_seal_entry_count");
    if (text(existing, "logical_seal_identity") !== input.expectedLogicalSealIdentity) {
      throw sqliteError("record-command-conflict", "prepare-seal", "sealed retry carries a different logical Seal identity");
    }
    if (integer(existing, "candidate_seal_staged_count") !== count) {
      throw sqliteError("record-seal-incomplete", "prepare-seal", "sealed Run does not have its complete staged Seal inventory");
    }
    return Object.freeze({ nextOrdinal: null, stagedCount: 0 });
  }
  const header = assertRunFence(connection, input.runId, input.writerGeneration, "prepare-seal", "sealing");
  const expectedCount = integer(header, "candidate_seal_entry_count");
  const stagedBefore = integer(header, "candidate_seal_staged_count");
  if (text(header, "candidate_seal_identity") !== input.expectedLogicalSealIdentity || input.startOrdinal > expectedCount || input.startOrdinal > stagedBefore) {
    throw sqliteError("record-command-conflict", "prepare-seal", "Seal batch does not match the finalization fence");
  }
  const batch = preparedSealBatch(connection, input.runId, input.expectedLogicalSealIdentity, expectedCount, input.startOrdinal, input.maximumRows);
  withImmediateTransaction(connection, input.deadlineEpochMs, "prepare-seal", () => {
    const current = assertRunFence(connection, input.runId, input.writerGeneration, "prepare-seal", "sealing");
    if (integer(current, "candidate_seal_staged_count") !== stagedBefore) {
      throw sqliteError("record-command-conflict", "prepare-seal", "Seal staged prefix changed before batch transaction");
    }
    const insert = recordStatement(connection, "INSERT OR IGNORE INTO run_seal_entries(run_id,ordinal,entry_kind,logical_identity,digest) VALUES (?,?,?,?,?)");
    const read = recordStatement(connection, "SELECT entry_kind,logical_identity,digest FROM run_seal_entries WHERE run_id=? AND ordinal=?");
    batch.forEach((entry, index) => {
      const ordinal = input.startOrdinal + index;
      insert.run(input.runId, ordinal, entry.kind, entry.logicalIdentity, entry.digest);
      const stored = read.get(input.runId, ordinal) as unknown as Row | undefined;
      if (stored === undefined || text(stored, "entry_kind") !== entry.kind || text(stored, "logical_identity") !== entry.logicalIdentity ||
        text(stored, "digest") !== entry.digest) {
        throw sqliteError("record-command-conflict", "prepare-seal", `Seal candidate ${ordinal} conflicts with its durable retry`);
      }
    });
    const next = input.startOrdinal + batch.length;
    const advanced = recordStatement(connection, `UPDATE runs SET candidate_seal_staged_count=?
      WHERE run_id=? AND status='sealing' AND candidate_seal_staged_count=?`).run(Math.max(stagedBefore, next), input.runId, stagedBefore);
    if (Number(advanced.changes) !== 1) throw sqliteError("record-command-conflict", "prepare-seal", "Seal staged prefix changed during batch transaction");
  });
  const next = input.startOrdinal + batch.length;
  return Object.freeze({ nextOrdinal: next === expectedCount ? null : next, stagedCount: batch.length });
}

/** One bounded transaction that publishes final Core/metadata but not a Seal fence. */
export function stageRunFinalMetadata(connection: RecordDatabase, input: StageRunCoreInput): void {
  validateFinalInput(input);
  const header = runRow(connection, input.runId);
  if (header === undefined || text(header, "writer_generation") !== input.writerGeneration || text(header, "started_at") !== input.startedAt) {
    throw sqliteError("record-command-conflict", "finalize-run", `Run ${input.runId} admission fence is missing or changed`);
  }
  if (text(header, "status") === "open") {
    withImmediateTransaction(connection, input.deadlineEpochMs, "stage-final-metadata", () => {
      const current = assertRunFence(connection, input.runId, input.writerGeneration, "finalize-run");
      if (text(current, "status") !== "open") throw sqliteError("record-command-conflict", "stage-final-metadata", "Run final metadata fence changed");
      recordStatement(connection, "UPDATE record_metadata SET record_payload=?,record_digest=? WHERE singleton=1 AND record_payload IS NULL").run(input.recordCoreBytes, input.recordCoreDigest);
      recordStatement(connection, "UPDATE runs SET core_payload=?,core_digest=? WHERE run_id=? AND status='open' AND core_payload IS NULL").run(input.runCoreBytes, input.runCoreDigest, input.runId);
      for (const slot of input.slots) recordStatement(connection, "INSERT OR IGNORE INTO slots(run_id,slot_id,ordinal,core_payload,core_digest) VALUES (?,?,?,?,?)").run(input.runId, slot.slotId, slot.ordinal, slot.coreBytes, slot.coreDigest);
      for (const attempt of input.attempts) recordStatement(connection, "UPDATE attempts SET core_payload=?,core_digest=? WHERE origin_run_id=? AND attempt_id=? AND core_payload IS NULL").run(attempt.coreBytes, attempt.coreDigest, input.runId, attempt.attemptId);
      for (const member of input.members) recordStatement(connection, "INSERT OR IGNORE INTO members(target_run_id,slot_id,origin_run_id,attempt_id,action,core_payload,core_digest) VALUES (?,?,?,?,?,?,?)")
        .run(input.runId, member.slotId, member.originRunId ?? null, member.attemptId ?? null, member.action, member.coreBytes, member.coreDigest);
      for (const attachment of input.attachments) {
        recordStatement(connection, `UPDATE attachments SET logical_identity=?,canonical_payload=?,canonical_digest=?,logical_inventory=?,inventory_digest=?
          WHERE attachment_id=? AND owner_run_id=? AND canonical_payload IS NULL`).run(attachment.logicalIdentity, attachment.canonicalBytes,
          attachment.canonicalDigest, attachment.logicalInventoryBytes, attachment.inventoryDigest, attachment.attachmentId, input.runId);
        for (const content of attachment.contents) recordStatement(connection, `UPDATE contents SET byte_length=?,overall_digest=?,chunk_count=?
          WHERE content_id=? AND attachment_id=? AND overall_digest IS NULL`).run(content.byteLength, content.digest, content.chunkCount, content.contentId, attachment.attachmentId);
      }
      bumpMutationSequence(connection, input.runId);
      assertFinalInputStored(connection, input);
    });
  }
  assertFinalInputStored(connection, input);
}

/** Heavy closure verification is read-only and therefore holds no FIFO writer ticket. */
export function prepareRunFinalization(
  connection: RecordDatabase,
  input: PrepareRunFinalizationInput,
): PreparedRunFinalization {
  if (Date.now() >= input.deadlineEpochMs) throw sqliteError("record-resource-limit-exceeded", "prepare-finalization", "finalization preparation exceeded its deadline");
  const header = runRow(connection, input.runId);
  if (header === undefined || text(header, "writer_generation") !== input.writerGeneration) {
    throw sqliteError("record-command-conflict", "prepare-finalization", "Run admission fence is missing or changed");
  }
  const status = text(header, "status");
  if (status !== "open" && status !== "sealing" && status !== "sealed") {
    throw sqliteError("record-command-conflict", "prepare-finalization", `Run ${input.runId} is not finalizable`);
  }
  const mutationSequence = integer(header, "mutation_sequence");
  // Every append transaction already validates the exact chunk bytes/digest
  // pair before committing. Preparation therefore validates the durable
  // logical/ordinal/length closure and streams only stored digests into a
  // disk-backed canonical sort. Exact byte re-hashing remains mandatory for
  // pinned readers and snapshot verification.
  verifyRunPayloadClosures(connection, input.runId, false);
  const prepared = spillPreparedSealEntries(connection, input.runId, (visit) => visitRunSealEntries(connection, input.runId, visit, false));
  const candidateIdentity = prepared.identity;
  if (Date.now() >= input.deadlineEpochMs) throw sqliteError("record-resource-limit-exceeded", "prepare-finalization", "finalization preparation exceeded its deadline");
  const after = runRow(connection, input.runId)!;
  if (integer(after, "mutation_sequence") !== mutationSequence || text(after, "status") !== status) {
    throw sqliteError("record-command-conflict", "prepare-finalization", "Run staging changed during closure preparation");
  }
  if (status !== "open") {
    const storedIdentity = status === "sealed" ? text(after, "logical_seal_identity") : text(after, "candidate_seal_identity");
    if (storedIdentity !== candidateIdentity || integer(after, "candidate_seal_entry_count") !== prepared.count) {
      throw sqliteError("record-seal-incomplete", "prepare-finalization", "durable finalization fence differs from its closure");
    }
  }
  sealEntryCache(connection).set(input.runId, Object.freeze({ identity: candidateIdentity, count: prepared.count, mutationSequence }));
  return Object.freeze({ runId: input.runId, writerGeneration: input.writerGeneration, logicalSealIdentity: candidateIdentity, sealEntryCount: prepared.count, mutationSequence });
}

/** One bounded transaction atomically installs the previously prepared fence. */
export function fenceRunFinalization(connection: RecordDatabase, input: FenceRunFinalizationInput): RunFinalization {
  const cached = sealEntryCache(connection).get(input.runId);
  if (cached === undefined || cached.mutationSequence !== input.mutationSequence || cached.identity !== input.expectedLogicalSealIdentity ||
    cached.count !== input.expectedSealEntryCount) {
    throw sqliteError("record-command-conflict", "fence-finalization", "prepared finalization capability is missing or changed");
  }
  const before = runRow(connection, input.runId);
  if (before === undefined || text(before, "writer_generation") !== input.writerGeneration) {
    throw sqliteError("record-command-conflict", "fence-finalization", "Run admission fence is missing or changed");
  }
  if (text(before, "status") === "open") {
    withImmediateTransaction(connection, input.deadlineEpochMs, "fence-finalization", () => {
      assertRunFence(connection, input.runId, input.writerGeneration, "fence-finalization");
      const changed = recordStatement(connection, `UPDATE runs SET status='sealing',candidate_seal_identity=?,candidate_seal_entry_count=?
        WHERE run_id=? AND status='open' AND writer_generation=? AND mutation_sequence=?`).run(
        input.expectedLogicalSealIdentity, input.expectedSealEntryCount, input.runId, input.writerGeneration, input.mutationSequence,
      );
      if (Number(changed.changes) !== 1) throw sqliteError("record-command-conflict", "fence-finalization", "Run staging changed before finalization fence");
    });
  }
  const header = runRow(connection, input.runId)!;
  const identity = text(header, "status") === "sealed" ? text(header, "logical_seal_identity") : text(header, "candidate_seal_identity");
  if (identity !== input.expectedLogicalSealIdentity || integer(header, "candidate_seal_entry_count") !== input.expectedSealEntryCount) {
    throw sqliteError("record-command-conflict", "fence-finalization", "durable finalization fence differs from prepared closure");
  }
  return Object.freeze({ runId: input.runId, writerGeneration: input.writerGeneration, logicalSealIdentity: identity, sealEntryCount: input.expectedSealEntryCount });
}

/** Compatibility composite for direct callers without a coordination ticket. */
export function finalizeRun(connection: RecordDatabase, input: StageRunCoreInput): RunFinalization {
  stageRunFinalMetadata(connection, input);
  const prepared = prepareRunFinalization(connection, { runId: input.runId, writerGeneration: input.writerGeneration, deadlineEpochMs: input.deadlineEpochMs });
  return fenceRunFinalization(connection, {
    runId: input.runId, writerGeneration: input.writerGeneration, mutationSequence: prepared.mutationSequence,
    expectedLogicalSealIdentity: prepared.logicalSealIdentity, expectedSealEntryCount: prepared.sealEntryCount,
    deadlineEpochMs: input.deadlineEpochMs,
  });
}

export const stageRunCore = stageRunFinalMetadata;

export function stageAttachmentReferences(connection: RecordDatabase, input: StageAttachmentReferencesInput): void {
  for (const reference of input.references) {
    requireBytesDigest(reference.canonicalBytes, reference.referenceDigest, `reference ${input.attachmentId}/${reference.ordinal}`);
    assertBoundedRow("stage-references", `reference ${input.attachmentId}/${reference.ordinal}`, reference.canonicalBytes);
  }
  assertBoundedBatch("stage-references", input.references.length, input.references.reduce((sum, value) => sum + value.canonicalBytes.byteLength, 0));
  withImmediateTransaction(connection, input.deadlineEpochMs, "stage-references", () => {
    assertRunFence(connection, input.runId, input.writerGeneration, "stage-references");
    assertAttachmentFence(connection, input.runId, input.attachmentId, "stage-references");
    let changed = false;
    for (const reference of input.references) {
      const stored = recordStatement(connection, `SELECT target_owner_kind,target_family,canonical_payload,reference_digest FROM attachment_references
        WHERE attachment_id=? AND ordinal=?`).get(input.attachmentId, reference.ordinal) as unknown as Row | undefined;
      if (stored === undefined) {
        const count = recordStatement(connection, "SELECT count(*) AS count FROM attachment_references WHERE attachment_id=?").get(input.attachmentId) as unknown as Row;
        if (reference.ordinal !== integer(count, "count")) throw sqliteError("record-command-conflict", "stage-references", "reference batch does not extend the committed prefix");
        recordStatement(connection, `INSERT INTO attachment_references(attachment_id,ordinal,target_owner_kind,target_family,canonical_payload,reference_digest)
          VALUES (?,?,?,?,?,?)`).run(input.attachmentId, reference.ordinal, reference.owner, reference.family, reference.canonicalBytes, reference.referenceDigest);
        changed = true;
      } else if (text(stored, "target_owner_kind") !== reference.owner || text(stored, "target_family") !== reference.family ||
        text(stored, "reference_digest") !== reference.referenceDigest || !bytesEqual(bytes(stored, "canonical_payload"), reference.canonicalBytes)
      ) throw sqliteError("record-command-conflict", "stage-references", `Reference ${input.attachmentId}/${reference.ordinal} conflicts with its committed retry`);
    }
    if (changed) bumpMutationSequence(connection, input.runId);
  });
}

export function stageCollectionItems(connection: RecordDatabase, input: StageCollectionItemsInput): void {
  for (const item of input.items) {
    requireBytesDigest(item.canonicalBytes, item.canonicalDigest, `item ${input.attachmentId}/${item.ordinal}`);
    assertBoundedRow("stage-collection-items", `item ${input.attachmentId}/${item.ordinal}`, item.canonicalBytes);
    const expectedLogicalIdentity = hashCanonicalTuple("niceeval.record.collection-item-logical-identity/v1", [item.ordinal, item.canonicalDigest]);
    if (item.logicalIdentity !== expectedLogicalIdentity) {
      throw sqliteError("record-content-invalid", "stage-collection-items", `Item ${input.attachmentId}/${item.ordinal} logical identity is invalid`);
    }
  }
  assertBoundedBatch("stage-collection-items", input.items.length, input.items.reduce((sum, value) => sum + value.canonicalBytes.byteLength, 0));
  withImmediateTransaction(connection, input.deadlineEpochMs, "stage-collection-items", () => {
    assertRunFence(connection, input.runId, input.writerGeneration, "stage-collection-items");
    assertAttachmentFence(connection, input.runId, input.attachmentId, "stage-collection-items");
    let changed = false;
    for (const item of input.items) {
      const stored = recordStatement(connection, `SELECT logical_identity,canonical_payload,canonical_digest FROM collection_items
        WHERE attachment_id=? AND ordinal=?`).get(input.attachmentId, item.ordinal) as unknown as Row | undefined;
      if (stored === undefined) {
        const count = recordStatement(connection, "SELECT count(*) AS count FROM collection_items WHERE attachment_id=?").get(input.attachmentId) as unknown as Row;
        if (item.ordinal !== integer(count, "count")) throw sqliteError("record-command-conflict", "stage-collection-items", "collection batch does not extend the committed prefix");
        recordStatement(connection, `INSERT INTO collection_items(attachment_id,ordinal,logical_identity,canonical_payload,canonical_digest)
          VALUES (?,?,?,?,?)`).run(input.attachmentId, item.ordinal, item.logicalIdentity, item.canonicalBytes, item.canonicalDigest);
        changed = true;
      } else if (text(stored, "logical_identity") !== item.logicalIdentity || text(stored, "canonical_digest") !== item.canonicalDigest ||
        !bytesEqual(bytes(stored, "canonical_payload"), item.canonicalBytes)
      ) throw sqliteError("record-command-conflict", "stage-collection-items", `Item ${input.attachmentId}/${item.ordinal} conflicts with its committed retry`);
    }
    if (changed) bumpMutationSequence(connection, input.runId);
  });
}

function batchesByBytes<T>(values: readonly T[], bytesOf: (value: T) => number, maxRows = 256): readonly (readonly T[])[] {
  const batches: T[][] = [];
  let batch: T[] = [];
  let byteCount = 0;
  for (const value of values) {
    const size = bytesOf(value);
    if (batch.length > 0 && (batch.length >= maxRows || byteCount + size > RECORD_SQLITE_MAX_PUBLISH_BYTES)) {
      batches.push(batch);
      batch = [];
      byteCount = 0;
    }
    batch.push(value);
    byteCount += size;
  }
  if (batch.length > 0) batches.push(batch);
  return batches;
}

function assertRunHeader(
  row: Row,
  input: Pick<StageRunCoreInput, "runId" | "writerGeneration" | "startedAt" | "runCoreBytes" | "runCoreDigest">,
): void {
  if (
    text(row, "writer_generation") !== input.writerGeneration ||
    text(row, "started_at") !== input.startedAt ||
    text(row, "core_digest") !== input.runCoreDigest ||
    digestBytes(bytes(row, "core_payload")) !== input.runCoreDigest
  ) throw sqliteError("record-command-conflict", "persist-sealed-run", `run ${input.runId} already exists with a different identity`);
}

function assertSealedRetryExact(connection: RecordDatabase, input: PersistSealedRunInput): void {
  assertFinalInputStored(connection, {
    runId: input.runId,
    writerGeneration: input.writerGeneration,
    startedAt: input.startedAt,
    recordCoreBytes: input.recordCoreBytes,
    recordCoreDigest: input.recordCoreDigest,
    runCoreBytes: input.runCoreBytes,
    runCoreDigest: input.runCoreDigest,
    slots: input.slots,
    attempts: input.attempts,
    members: input.members,
    attachments: input.attachments.map((attachment) => ({
      attachmentId: attachment.attachmentId,
      ownerKind: attachment.ownerKind,
      ownerRunId: attachment.ownerRunId,
      ...(attachment.ownerAttemptId === undefined ? {} : { ownerAttemptId: attachment.ownerAttemptId }),
      family: attachment.family,
      familyRevision: attachment.familyRevision,
      logicalIdentity: attachment.logicalIdentity,
      canonicalBytes: attachment.canonicalBytes,
      canonicalDigest: attachment.canonicalDigest,
      logicalInventoryBytes: attachment.logicalInventoryBytes,
      inventoryDigest: attachment.inventoryDigest,
      contents: attachment.contents.map((content) => ({ contentId: content.contentId, logicalHandle: content.logicalHandle,
        byteLength: content.byteLength, digest: content.digest, chunkCount: content.chunks.length })),
    })),
    deadlineEpochMs: input.deadlineEpochMs,
  });
  for (const attachment of input.attachments) {
    const counts = recordStatement(connection, `SELECT
      (SELECT count(*) FROM attachment_references WHERE attachment_id=?) reference_count,
      (SELECT count(*) FROM collection_items WHERE attachment_id=?) item_count`).get(attachment.attachmentId, attachment.attachmentId) as unknown as Row;
    if (integer(counts, "reference_count") !== attachment.references.length || integer(counts, "item_count") !== attachment.collectionItems.length) {
      throw sqliteError("record-command-conflict", "persist-sealed-run", `Attachment ${attachment.attachmentId} retry inventory differs`);
    }
    for (const reference of attachment.references) {
      const row = recordStatement(connection, `SELECT target_owner_kind,target_family,canonical_payload,reference_digest FROM attachment_references
        WHERE attachment_id=? AND ordinal=?`).get(attachment.attachmentId, reference.ordinal) as unknown as Row | undefined;
      if (row === undefined || ownerKind(row, "target_owner_kind") !== reference.owner || text(row, "target_family") !== reference.family ||
        text(row, "reference_digest") !== reference.referenceDigest || !bytesEqual(bytes(row, "canonical_payload"), reference.canonicalBytes)) {
        throw sqliteError("record-command-conflict", "persist-sealed-run", `Reference ${attachment.attachmentId}/${reference.ordinal} retry differs`);
      }
    }
    for (const item of attachment.collectionItems) {
      const row = recordStatement(connection, `SELECT logical_identity,canonical_payload,canonical_digest FROM collection_items
        WHERE attachment_id=? AND ordinal=?`).get(attachment.attachmentId, item.ordinal) as unknown as Row | undefined;
      if (row === undefined || text(row, "logical_identity") !== item.logicalIdentity || text(row, "canonical_digest") !== item.canonicalDigest ||
        !bytesEqual(bytes(row, "canonical_payload"), item.canonicalBytes)) {
        throw sqliteError("record-command-conflict", "persist-sealed-run", `Collection item ${attachment.attachmentId}/${item.ordinal} retry differs`);
      }
    }
    for (const content of attachment.contents) {
      const count = recordStatement(connection, "SELECT count(*) AS count FROM content_chunks WHERE content_id=?").get(content.contentId) as unknown as Row;
      if (integer(count, "count") !== content.chunks.length) throw sqliteError("record-command-conflict", "persist-sealed-run", `Content ${content.contentId} retry chunk count differs`);
      for (const chunk of content.chunks) {
        const row = recordStatement(connection, "SELECT bytes,chunk_digest FROM content_chunks WHERE content_id=? AND ordinal=?")
          .get(content.contentId, chunk.ordinal) as unknown as Row | undefined;
        if (row === undefined || text(row, "chunk_digest") !== chunk.chunkDigest || !bytesEqual(bytes(row, "bytes"), chunk.bytes)) {
          throw sqliteError("record-command-conflict", "persist-sealed-run", `Content chunk ${content.contentId}/${chunk.ordinal} retry differs`);
        }
      }
    }
  }
}

export function persistSealedRun(connection: RecordDatabase, input: PersistSealedRunInput): SealedRunSummary {
  const expectedEntries = validateInput(input);
  const expectedIdentity = logicalSealIdentity(expectedEntries);
  if (input.expectedLogicalSealIdentity !== undefined && input.expectedLogicalSealIdentity !== expectedIdentity) {
    throw sqliteError("record-command-conflict", "persist-sealed-run", "caller logical Seal identity does not match frozen closure");
  }
  const existing = runRow(connection, input.runId);
  if (existing !== undefined && text(existing, "status") === "sealed") {
    assertRunHeader(existing, input);
    assertSealedRetryExact(connection, input);
    if (text(existing, "logical_seal_identity") !== expectedIdentity) {
      throw sqliteError("record-command-conflict", "persist-sealed-run", `sealed retry for ${input.runId} has a different closure`);
    }
    verifyStoredSeal(connection, input.runId, expectedEntries, expectedIdentity);
    return readSealedRunSummary(connection, input.runId)!;
  }
  beginRun(connection, input);
  for (const attempt of input.attempts) admitAttempt(connection, {
    runId: input.runId,
    writerGeneration: input.writerGeneration,
    attemptId: attempt.attemptId,
    attemptLocator: attempt.attemptLocator,
    deadlineEpochMs: input.deadlineEpochMs,
  });
  for (const attachment of input.attachments) {
    admitAttachment(connection, {
      runId: input.runId,
      writerGeneration: input.writerGeneration,
      attachmentId: attachment.attachmentId,
      ownerKind: attachment.ownerKind,
      ownerRunId: attachment.ownerRunId,
      ...(attachment.ownerAttemptId === undefined ? {} : { ownerAttemptId: attachment.ownerAttemptId }),
      family: attachment.family,
      familyRevision: attachment.familyRevision,
      deadlineEpochMs: input.deadlineEpochMs,
    });
    for (const content of attachment.contents) admitContent(connection, {
      runId: input.runId,
      writerGeneration: input.writerGeneration,
      attachmentId: attachment.attachmentId,
      contentId: content.contentId,
      logicalHandle: content.logicalHandle,
      deadlineEpochMs: input.deadlineEpochMs,
    });
    for (const batch of batchesByBytes(attachment.references, (value) => value.canonicalBytes.byteLength)) {
      stageAttachmentReferences(connection, { runId: input.runId, writerGeneration: input.writerGeneration, attachmentId: attachment.attachmentId, references: batch, deadlineEpochMs: input.deadlineEpochMs });
    }
    for (const batch of batchesByBytes(attachment.collectionItems, (value) => value.canonicalBytes.byteLength)) {
      stageCollectionItems(connection, { runId: input.runId, writerGeneration: input.writerGeneration, attachmentId: attachment.attachmentId, items: batch, deadlineEpochMs: input.deadlineEpochMs });
    }
    for (const content of attachment.contents) {
      for (const batch of batchesByBytes(content.chunks, (value) => value.bytes.byteLength, 128)) {
        appendContentChunks(connection, { runId: input.runId, writerGeneration: input.writerGeneration, contentId: content.contentId, chunks: batch, deadlineEpochMs: input.deadlineEpochMs });
      }
    }
  }
  const finalized = finalizeRun(connection, {
    runId: input.runId,
    writerGeneration: input.writerGeneration,
    startedAt: input.startedAt,
    recordCoreBytes: input.recordCoreBytes,
    recordCoreDigest: input.recordCoreDigest,
    runCoreBytes: input.runCoreBytes,
    runCoreDigest: input.runCoreDigest,
    slots: input.slots,
    attempts: input.attempts,
    members: input.members,
    attachments: input.attachments.map((attachment) => ({
      attachmentId: attachment.attachmentId,
      ownerKind: attachment.ownerKind,
      ownerRunId: attachment.ownerRunId,
      ...(attachment.ownerAttemptId === undefined ? {} : { ownerAttemptId: attachment.ownerAttemptId }),
      family: attachment.family,
      familyRevision: attachment.familyRevision,
      logicalIdentity: attachment.logicalIdentity,
      canonicalBytes: attachment.canonicalBytes,
      canonicalDigest: attachment.canonicalDigest,
      logicalInventoryBytes: attachment.logicalInventoryBytes,
      inventoryDigest: attachment.inventoryDigest,
      contents: attachment.contents.map((content) => ({ contentId: content.contentId, logicalHandle: content.logicalHandle,
        byteLength: content.byteLength, digest: content.digest, chunkCount: content.chunks.length })),
    })),
    deadlineEpochMs: input.deadlineEpochMs,
  });
  if (finalized.logicalSealIdentity !== expectedIdentity) throw sqliteError("record-command-conflict", "persist-sealed-run", "bulk input differs from finalized closure");
  let sealOrdinal: number | null = 0;
  while (sealOrdinal !== null) {
    sealOrdinal = stageSealEntries(connection, {
      runId: input.runId,
      writerGeneration: input.writerGeneration,
      expectedLogicalSealIdentity: expectedIdentity,
      startOrdinal: sealOrdinal,
      maximumRows: 256,
      deadlineEpochMs: input.deadlineEpochMs,
    }).nextOrdinal;
  }
  return sealRun(connection, {
    runId: input.runId,
    writerGeneration: input.writerGeneration,
    expectedLogicalSealIdentity: expectedIdentity,
    deadlineEpochMs: input.deadlineEpochMs,
  });
}

export function sealRun(
  connection: RecordDatabase,
  input: SealRunInput,
): SealedRunSummary {
  publishRunSeal(connection, input);
  const header = runRow(connection, input.runId)!;
  verifyStoredSealStreaming(connection, input.runId, input.expectedLogicalSealIdentity, integer(header, "candidate_seal_entry_count"));
  return readSealedRunSummary(connection, input.runId)!;
}

/** Constant-row atomic publication; staged Seal rows become visible through the parent status. */
export function publishRunSeal(connection: RecordDatabase, input: SealRunInput): void {
  const header = runRow(connection, input.runId);
  if (header === undefined || text(header, "writer_generation") !== input.writerGeneration) {
    throw sqliteError("record-command-conflict", "seal-run", "Run publication fence changed");
  }
  if (text(header, "status") === "sealed") {
    if (text(header, "logical_seal_identity") !== input.expectedLogicalSealIdentity) {
      throw sqliteError("record-command-conflict", "seal-run", "sealed retry carries a different logical Seal identity");
    }
    if (integer(header, "candidate_seal_staged_count") !== integer(header, "candidate_seal_entry_count")) {
      throw sqliteError("record-seal-incomplete", "seal-run", "sealed Run does not have its complete staged Seal inventory");
    }
    return;
  }
  if (text(header, "status") !== "sealing" || text(header, "candidate_seal_identity") !== input.expectedLogicalSealIdentity) {
    throw sqliteError("record-command-conflict", "seal-run", "Run is not at the expected finalization fence");
  }
  if (integer(header, "candidate_seal_staged_count") !== integer(header, "candidate_seal_entry_count")) {
    throw sqliteError("record-seal-incomplete", "seal-run", "Seal candidate inventory is not completely staged");
  }
  withImmediateTransaction(connection, input.deadlineEpochMs, "seal-run", () => {
    const changed = recordStatement(connection, `UPDATE runs SET status='sealed',logical_seal_identity=?
      WHERE run_id=? AND status='sealing' AND writer_generation=? AND candidate_seal_identity=?
        AND candidate_seal_staged_count=candidate_seal_entry_count`).run(
      input.expectedLogicalSealIdentity, input.runId, input.writerGeneration, input.expectedLogicalSealIdentity,
    );
    if (Number(changed.changes) !== 1) throw sqliteError("record-command-conflict", "seal-run", "Run publication fence changed before commit");
  });
  sealEntryCache(connection).delete(input.runId);
}

function verifyStoredSealStreaming(connection: RecordDatabase, runId: string, identity: string, expectedCount: number): void {
  ensurePreparedSealTables(connection);
  try {
    // Validate every payload byte and every derived logical closure exactly
    // once. The canonical spill may then consume the just-validated Content
    // chunk digests without materializing the BLOBs a second time.
    verifyRunPayloadClosures(connection, runId, true);
    const actual = spillPreparedSealEntries(connection, runId, (visit) =>
      visitRunSealEntries(connection, runId, visit, true, false));
    if (actual.count !== expectedCount || actual.identity !== identity) {
      throw sqliteError("record-seal-incomplete", "verify-seal", `Run ${runId} exact Seal identity or count differs from its closure`);
    }
    const statement = recordStatement(connection, `SELECT entry_kind,logical_identity,digest FROM run_seal_entries
      WHERE run_id=? AND ordinal=?`);
    let ordinal = 0;
    for (const row of recordStatement(connection, `SELECT ordinal,entry_kind,logical_identity,digest
      FROM temp.niceeval_prepared_seal_ordered WHERE run_id=? ORDER BY ordinal`).iterate(runId) as unknown as Iterable<Row>) {
      if (integer(row, "ordinal") !== ordinal) {
        throw sqliteError("record-seal-incomplete", "verify-seal", `Run ${runId} prepared Seal ordinals are not contiguous`);
      }
      const entry = {
        kind: sealEntryKind(row, "entry_kind"),
        logicalIdentity: text(row, "logical_identity"),
        digest: text(row, "digest"),
      } as const;
      const stored = statement.get(runId, ordinal) as unknown as Row | undefined;
      if (stored === undefined || sealEntryKind(stored, "entry_kind") !== entry.kind ||
        text(stored, "logical_identity") !== entry.logicalIdentity || text(stored, "digest") !== entry.digest) {
        throw sqliteError("record-seal-incomplete", "verify-seal", `Run ${runId} Seal entry ${ordinal} differs from its closure`);
      }
      ordinal += 1;
    }
    const storedCount = recordStatement(connection, "SELECT count(*) AS count FROM run_seal_entries WHERE run_id=?").get(runId) as unknown as Row;
    if (ordinal !== expectedCount || integer(storedCount, "count") !== ordinal) {
      throw sqliteError("record-seal-incomplete", "verify-seal", `Run ${runId} exact Seal does not match its closure`);
    }
  } finally {
    recordStatement(connection, "DELETE FROM temp.niceeval_prepared_seal_raw WHERE run_id=?").run(runId);
    recordStatement(connection, "DELETE FROM temp.niceeval_prepared_seal_ordered WHERE run_id=?").run(runId);
  }
}

function verifyStoredSeal(connection: RecordDatabase, runId: string, actual: readonly SealEntry[], identity: string): void {
  if (logicalSealIdentity(actual) !== identity) {
    throw sqliteError("record-seal-incomplete", "verify-seal", `run ${runId} exact Seal does not match its closure`);
  }
  verifyStoredSealStreaming(connection, runId, identity, actual.length);
}

export function verifyAllSealedRuns(
  connection: RecordDatabase,
  requireSealedOnly = false,
  deadlineEpochMs = Date.now() + RECORD_SQLITE_VALIDATION_DEADLINE_MS,
): number {
  const checkDeadline = (): void => {
    if (!Number.isSafeInteger(deadlineEpochMs) || Date.now() >= deadlineEpochMs) {
      throw sqliteError("record-resource-limit-exceeded", "verify-database", "Record validation exceeded its deadline");
    }
  };
  checkDeadline();
  const admission = recordStatement(connection, `SELECT
    (SELECT count(*) FROM runs) run_count,
    (SELECT count(*) FROM runs)+(SELECT count(*) FROM slots)+(SELECT count(*) FROM attempts)+(SELECT count(*) FROM members)+
      (SELECT count(*) FROM attachments)+(SELECT count(*) FROM attachment_references)+(SELECT count(*) FROM collection_items)+
      (SELECT count(*) FROM contents)+(SELECT count(*) FROM content_chunks)+(SELECT count(*) FROM run_seal_entries) row_count`).get() as unknown as Row;
  if (integer(admission, "run_count") > RECORD_SQLITE_MAX_VALIDATION_RUNS || integer(admission, "row_count") > RECORD_SQLITE_MAX_VALIDATION_ROWS) {
    throw sqliteError("record-resource-limit-exceeded", "verify-database", "Record validation inventory exceeds its hostile-input ceiling");
  }
  const integrity = recordStatement(connection, "PRAGMA quick_check").all() as unknown as readonly Row[];
  checkDeadline();
  if (integrity.length !== 1 || text(integrity[0]!, "quick_check") !== "ok") {
    throw sqliteError("record-database-invalid", "verify-database", "SQLite quick_check failed");
  }
  const foreignKeys = recordStatement(connection, "PRAGMA foreign_key_check").all();
  if (foreignKeys.length !== 0) throw sqliteError("record-database-invalid", "verify-database", "foreign key check failed");
  const runRows = recordStatement(connection, "SELECT run_id,status,logical_seal_identity FROM runs ORDER BY run_id")
    .iterate() as unknown as Iterable<Row>;
  let sealed = 0;
  for (const row of runRows) {
    checkDeadline();
    const runId = text(row, "run_id");
    const status = text(row, "status");
    if (status !== "sealed") {
      if (requireSealedOnly) throw sqliteError("record-database-invalid", "verify-database", `snapshot contains unpublished run ${runId}`);
      continue;
    }
    sealed += 1;
    const header = runRow(connection, runId)!;
    if (integer(header, "candidate_seal_staged_count") !== integer(header, "candidate_seal_entry_count")) {
      throw sqliteError("record-seal-incomplete", "verify-database", `Run ${runId} staged Seal inventory is incomplete`);
    }
    verifyStoredSealStreaming(connection, runId, text(row, "logical_seal_identity"), integer(header, "candidate_seal_entry_count"));
  }
  checkDeadline();
  return sealed;
}

function verifyRunPayloadClosures(connection: RecordDatabase, runId: string, verifyPayloadBytes = true): void {
  const attempts = recordStatement(connection, "SELECT attempt_id,attempt_locator FROM attempts WHERE origin_run_id=?")
    .iterate(runId) as unknown as Iterable<Row>;
  for (const attempt of attempts) {
    const attemptId = text(attempt, "attempt_id");
    const locator = text(attempt, "attempt_locator");
    try {
      requireAttemptLocator(attemptId, locator, "verify-seal");
    } catch (cause) {
      throw sqliteError("record-seal-incomplete", "verify-seal", cause instanceof Error ? cause.message : `Attempt ${attemptId} locator is invalid`);
    }
  }
  const attachments = recordStatement(connection, `SELECT attachment_id,owner_kind,owner_run_id,owner_attempt_id,family,family_revision,
    logical_identity,canonical_digest,logical_inventory,inventory_digest FROM attachments WHERE owner_run_id=?`)
    .iterate(runId) as unknown as Iterable<Row>;
  for (const attachment of attachments) {
    const attachmentId = text(attachment, "attachment_id");
    if (digestBytes(bytes(attachment, "logical_inventory")) !== text(attachment, "inventory_digest")) {
      throw sqliteError("record-seal-incomplete", "verify-seal", `attachment ${attachmentId} inventory digest is invalid`);
    }
    const expectedAttachmentId = hashCanonicalTuple("niceeval.record.attachment-id/v1", [
      text(attachment, "owner_run_id"),
      ownerKind(attachment, "owner_kind"),
      optionalText(attachment, "owner_attempt_id") ?? null,
      text(attachment, "family"),
    ]);
    const expectedLogicalIdentity = hashCanonicalTuple("niceeval.record.attachment-logical-identity/v1", [
      attachmentId,
      text(attachment, "canonical_digest"),
      text(attachment, "inventory_digest"),
    ]);
    if (attachmentId !== expectedAttachmentId || text(attachment, "logical_identity") !== expectedLogicalIdentity || integer(attachment, "family_revision") < 1) {
      throw sqliteError("record-seal-incomplete", "verify-seal", `attachment ${attachmentId} logical identity is invalid`);
    }
    for (const [label, counts] of [
      ["reference", recordStatement(connection, "SELECT count(*) AS count,min(ordinal) AS minimum,max(ordinal) AS maximum FROM attachment_references WHERE attachment_id=?").get(attachmentId)],
      ["collection item", recordStatement(connection, "SELECT count(*) AS count,min(ordinal) AS minimum,max(ordinal) AS maximum FROM collection_items WHERE attachment_id=?").get(attachmentId)],
    ] as const) {
      const decoded = counts as unknown as Row;
      const count = integer(decoded, "count");
      if (count > 0 && (optionalInteger(decoded, "minimum") !== 0 || optionalInteger(decoded, "maximum") !== count - 1)) {
        throw sqliteError("record-seal-incomplete", "verify-seal", `attachment ${attachmentId} ${label} ordinals are not contiguous`);
      }
    }
  }
  const items = recordStatement(connection, `SELECT i.attachment_id,i.ordinal,i.logical_identity,i.canonical_digest FROM collection_items i
    JOIN attachments a ON a.attachment_id=i.attachment_id WHERE a.owner_run_id=?`).iterate(runId) as unknown as Iterable<Row>;
  for (const item of items) {
    const expected = hashCanonicalTuple("niceeval.record.collection-item-logical-identity/v1", [integer(item, "ordinal"), text(item, "canonical_digest")]);
    if (text(item, "logical_identity") !== expected) {
      throw sqliteError("record-seal-incomplete", "verify-seal", `collection item ${text(item, "attachment_id")}/${integer(item, "ordinal")} logical identity is invalid`);
    }
  }
  const coverage = recordStatement(connection, `SELECT
    (SELECT count(*) FROM slots WHERE run_id=?) slot_count,
    (SELECT count(*) FROM members WHERE target_run_id=?) member_count,
    (SELECT count(*) FROM slots s LEFT JOIN members m ON m.target_run_id=s.run_id AND m.slot_id=s.slot_id
      WHERE s.run_id=? AND m.slot_id IS NULL) missing_count`).get(runId, runId, runId) as unknown as Row;
  if (integer(coverage, "slot_count") !== integer(coverage, "member_count") || integer(coverage, "missing_count") !== 0) {
    throw sqliteError("record-seal-incomplete", "verify-seal", `Run ${runId} does not have exactly one Member per Slot`);
  }
  const references = recordStatement(connection, `SELECT r.attachment_id,r.ordinal,r.target_owner_kind,r.target_family,
    a.owner_kind source_owner_kind,a.owner_run_id,a.owner_attempt_id FROM attachment_references r
    JOIN attachments a ON a.attachment_id=r.attachment_id WHERE a.owner_run_id=?`).iterate(runId) as unknown as Iterable<Row>;
  for (const reference of references) {
    const targetOwner = text(reference, "target_owner_kind");
    const sourceOwner = text(reference, "source_owner_kind");
    if (targetOwner === "attempt" && sourceOwner !== "attempt") {
      throw sqliteError("record-seal-incomplete", "verify-seal", `run-owned attachment ${text(reference, "attachment_id")} cannot resolve an attempt reference`);
    }
    const target = targetOwner === "run"
      ? recordStatement(connection, `SELECT count(*) AS count FROM attachments WHERE owner_kind='run' AND owner_run_id=? AND family=?`)
        .get(text(reference, "owner_run_id"), text(reference, "target_family")) as unknown as Row
      : recordStatement(connection, `SELECT count(*) AS count FROM attachments WHERE owner_kind='attempt' AND owner_run_id=? AND owner_attempt_id=? AND family=?`)
        .get(text(reference, "owner_run_id"), text(reference, "owner_attempt_id"), text(reference, "target_family")) as unknown as Row;
    if (integer(target, "count") !== 1) {
      throw sqliteError("record-seal-incomplete", "verify-seal", `reference ${text(reference, "attachment_id")}/${integer(reference, "ordinal")} target family is missing`);
    }
  }
  const contents = recordStatement(connection, `SELECT c.content_id,c.attachment_id,c.logical_handle,c.byte_length,c.overall_digest,c.chunk_count FROM contents c
    JOIN attachments a ON a.attachment_id=c.attachment_id WHERE a.owner_run_id=?`).iterate(runId) as unknown as Iterable<Row>;
  for (const content of contents) {
    const contentId = text(content, "content_id");
    const expectedContentId = hashCanonicalTuple("niceeval.record.content-id/v1", [text(content, "attachment_id"), text(content, "logical_handle")]);
    if (contentId !== expectedContentId) throw sqliteError("record-seal-incomplete", "verify-seal", `content ${contentId} logical handle is invalid`);
    if (verifyPayloadBytes) {
      const hash = createHash("sha256");
      let byteLength = 0;
      let ordinal = 0;
      const chunks = recordStatement(connection, "SELECT ordinal,bytes,chunk_digest FROM content_chunks WHERE content_id=? ORDER BY ordinal")
        .iterate(contentId) as unknown as Iterable<Row>;
      for (const chunk of chunks) {
        if (integer(chunk, "ordinal") !== ordinal) throw sqliteError("record-seal-incomplete", "verify-seal", `content ${contentId} chunk ordinals are invalid`);
        const value = bytes(chunk, "bytes");
        if (digestBytes(value) !== text(chunk, "chunk_digest")) throw sqliteError("record-seal-incomplete", "verify-seal", `content ${contentId}/${ordinal} digest is invalid`);
        hash.update(value);
        byteLength += value.byteLength;
        ordinal += 1;
      }
      if (ordinal !== integer(content, "chunk_count") || byteLength !== integer(content, "byte_length") || hash.digest("hex") !== text(content, "overall_digest")) {
        throw sqliteError("record-seal-incomplete", "verify-seal", `content ${contentId} whole digest is invalid`);
      }
    } else {
      const aggregate = recordStatement(connection, `SELECT count(*) AS count,min(ordinal) AS minimum,max(ordinal) AS maximum,
        coalesce(sum(length(bytes)),0) AS byte_length FROM content_chunks WHERE content_id=?`).get(contentId) as unknown as Row;
      const chunkCount = integer(content, "chunk_count");
      if (integer(aggregate, "count") !== chunkCount || integer(aggregate, "byte_length") !== integer(content, "byte_length") ||
        (chunkCount > 0 && (optionalInteger(aggregate, "minimum") !== 0 || optionalInteger(aggregate, "maximum") !== chunkCount - 1))) {
        throw sqliteError("record-seal-incomplete", "verify-seal", `content ${contentId} durable chunk closure is invalid`);
      }
      for (const chunk of recordStatement(connection, "SELECT chunk_digest FROM content_chunks WHERE content_id=?").iterate(contentId) as unknown as Iterable<Row>) {
        requireDigest(text(chunk, "chunk_digest"), `content ${contentId} chunk digest`);
      }
    }
  }
}

export function readSealedRunSummary(connection: RecordDatabase, runId: string): SealedRunSummary | undefined {
  const row = recordStatement(connection, `SELECT r.run_id,r.writer_generation,r.started_at,r.logical_seal_identity,
    (SELECT count(*) FROM slots s WHERE s.run_id=r.run_id) slot_count,
    (SELECT count(*) FROM members m WHERE m.target_run_id=r.run_id) member_count,
    (SELECT count(*) FROM attempts a WHERE a.origin_run_id=r.run_id) attempt_count,
    (SELECT count(*) FROM attachments a WHERE a.owner_run_id=r.run_id) attachment_count,
    (SELECT count(*) FROM contents c JOIN attachments a ON a.attachment_id=c.attachment_id WHERE a.owner_run_id=r.run_id) content_count,
    (SELECT coalesce(sum(c.byte_length),0) FROM contents c JOIN attachments a ON a.attachment_id=c.attachment_id WHERE a.owner_run_id=r.run_id) content_bytes,
    (SELECT count(*) FROM run_seal_entries e WHERE e.run_id=r.run_id) seal_count
    FROM runs r WHERE r.run_id=? AND r.status='sealed'`).get(runId) as unknown as Row | undefined;
  if (row === undefined) return undefined;
  return Object.freeze({
    runId: text(row, "run_id"),
    writerGeneration: text(row, "writer_generation"),
    startedAt: text(row, "started_at"),
    logicalSealIdentity: text(row, "logical_seal_identity"),
    slotCount: integer(row, "slot_count"),
    memberCount: integer(row, "member_count"),
    attemptCount: integer(row, "attempt_count"),
    attachmentCount: integer(row, "attachment_count"),
    contentCount: integer(row, "content_count"),
    contentByteLength: integer(row, "content_bytes"),
    sealEntryCount: integer(row, "seal_count"),
  });
}

export function listSealedRunSummaries(
  connection: RecordDatabase,
  afterRunId = "",
  pageSize = 100,
): readonly SealedRunSummary[] {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 256) {
    throw sqliteError("record-resource-limit-exceeded", "list-sealed-runs", "page size must be between 1 and 256");
  }
  const runIds = rows(connection, `SELECT run_id FROM runs WHERE status='sealed' AND run_id>? ORDER BY run_id LIMIT ?`, afterRunId, pageSize);
  return Object.freeze(runIds.map((row) => {
    const summary = readSealedRunSummary(connection, text(row, "run_id"));
    if (summary === undefined) throw sqliteError("record-database-invalid", "list-sealed-runs", "sealed Run disappeared during a short read");
    return summary;
  }));
}

/**
 * Computes the stable sealed cutoff without retaining the inventory, then
 * returns one bounded page from the same caller-owned read transaction.
 */
export function readSealedRunSummaryPage(
  connection: RecordDatabase,
  afterRunId = "",
  pageSize = 100,
  expectedCutoffIdentity?: string,
  deadlineEpochMs = Date.now() + RECORD_SQLITE_VALIDATION_DEADLINE_MS,
): SealedRunSummaryPage {
  requireIdentity(afterRunId === "" ? "start" : afterRunId, "afterRunId");
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 256) {
    throw sqliteError("record-resource-limit-exceeded", "page-sealed-runs", "page size must be between 1 and 256");
  }
  const cutoffHash = createHash("sha256");
  cutoffHash.update("[");
  let runCount = 0;
  const inventory = recordStatement(connection, `SELECT run_id,logical_seal_identity FROM runs
    WHERE status='sealed' ORDER BY run_id`).iterate() as unknown as Iterable<Row>;
  for (const row of inventory) {
    if (runCount >= RECORD_SQLITE_MAX_VALIDATION_RUNS) {
      throw sqliteError("record-resource-limit-exceeded", "page-sealed-runs", "sealed cutoff exceeds its Run ceiling");
    }
    if ((runCount & 255) === 0 && Date.now() >= deadlineEpochMs) {
      throw sqliteError("record-resource-limit-exceeded", "page-sealed-runs", "sealed cutoff exceeded its deadline");
    }
    if (runCount > 0) cutoffHash.update(",");
    cutoffHash.update(JSON.stringify({ runId: text(row, "run_id"), logicalSealIdentity: text(row, "logical_seal_identity") }));
    runCount += 1;
  }
  cutoffHash.update("]");
  const identity = cutoffHash.digest("hex");
  if (expectedCutoffIdentity !== undefined && expectedCutoffIdentity !== identity) {
    throw sqliteError("record-command-conflict", "page-sealed-runs", "sealed cutoff changed; restart pagination");
  }
  const pageRows = rows(connection, `SELECT run_id FROM runs WHERE status='sealed' AND run_id>? ORDER BY run_id LIMIT ?`, afterRunId, pageSize + 1);
  const selected = pageRows.slice(0, pageSize);
  const summaries = selected.map((row) => {
    const summary = readSealedRunSummary(connection, text(row, "run_id"));
    if (summary === undefined) throw sqliteError("record-database-invalid", "page-sealed-runs", "sealed Run disappeared inside pinned read generation");
    return summary;
  });
  const nextAfterRunId = pageRows.length > pageSize && summaries.length > 0 ? summaries.at(-1)!.runId : null;
  return Object.freeze({
    cutoff: Object.freeze({ identity, runCount }),
    afterRunId,
    summaries: Object.freeze(summaries),
    nextAfterRunId,
  });
}

/** Indexed, bounded locator projection. No Core or attachment payload is selected. */
export function findAttemptLocatorCandidates(
  connection: RecordDatabase,
  locator: string,
  maximumCandidateRuns: number,
): AttemptLocatorCandidates {
  if (!parseAttemptLocator(locator).valid) {
    throw sqliteError("record-content-invalid", "find-attempt-locator", "Attempt locator is malformed");
  }
  if (!Number.isSafeInteger(maximumCandidateRuns) || maximumCandidateRuns < 1 || maximumCandidateRuns > 256) {
    throw sqliteError("record-resource-limit-exceeded", "find-attempt-locator", "candidate Run limit must be between 1 and 256");
  }
  const matching = rows(connection, `SELECT a.origin_run_id,a.attempt_id FROM attempts a
    JOIN runs origin ON origin.run_id=a.origin_run_id AND origin.status='sealed'
    WHERE a.attempt_locator=? ORDER BY a.origin_run_id,a.attempt_id LIMIT ?`, locator, maximumCandidateRuns + 1);
  const identities = new Set<string>();
  const candidates: AttemptLocatorCandidates["candidates"][number][] = [];
  const add = (candidate: AttemptLocatorCandidates["candidates"][number]): void => {
    if (candidates.length >= maximumCandidateRuns) {
      throw sqliteError("record-resource-limit-exceeded", "find-attempt-locator", `Attempt locator exceeds the fixed ${maximumCandidateRuns}-Run candidate limit`);
    }
    candidates.push(Object.freeze(candidate));
  };
  for (const row of matching) {
    const originRunId = text(row, "origin_run_id");
    const attemptId = text(row, "attempt_id");
    identities.add(hashCanonicalTuple("niceeval.record.attempt-candidate/v1", [originRunId, attemptId]));
    add({ locator, originRunId, attemptId, relation: "origin", runId: originRunId });
    const targets = rows(connection, `SELECT DISTINCT m.target_run_id FROM members m
      JOIN runs target ON target.run_id=m.target_run_id AND target.status='sealed'
      WHERE m.origin_run_id=? AND m.attempt_id=? ORDER BY m.target_run_id LIMIT ?`,
    originRunId, attemptId, maximumCandidateRuns - candidates.length + 1);
    for (const target of targets) add({ locator, originRunId, attemptId, relation: "target", runId: text(target, "target_run_id") });
  }
  return Object.freeze({ locator, ambiguous: identities.size > 1, candidates: Object.freeze(candidates) });
}

export function readCollectionItemPage(
  connection: RecordDatabase,
  attachmentId: string,
  afterOrdinal: number,
  pageSize: number,
): CollectionItemPage {
  if (!Number.isSafeInteger(afterOrdinal) || afterOrdinal < -1) throw sqliteError("record-content-invalid", "read-collection-page", "afterOrdinal must be -1 or greater");
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > RECORD_SQLITE_MAX_PAGE_ROWS) throw sqliteError("record-resource-limit-exceeded", "read-collection-page", `page size must be between 1 and ${RECORD_SQLITE_MAX_PAGE_ROWS}`);
  const pending: {
    readonly ordinal: number;
    readonly logicalIdentity: string;
    readonly payload: Uint8Array;
    readonly canonicalDigest: string;
  }[] = [];
  let cursor = afterOrdinal;
  let pageBytes = 0;
  let hasMore = false;
  const pageRows = recordStatement(connection, `SELECT i.ordinal,i.logical_identity,i.canonical_payload,i.canonical_digest,
      EXISTS(SELECT 1 FROM collection_items more WHERE more.attachment_id=i.attachment_id AND more.ordinal>i.ordinal) AS has_more
      FROM collection_items i
      JOIN attachments a ON a.attachment_id=i.attachment_id JOIN runs r ON r.run_id=a.owner_run_id
      WHERE i.attachment_id=? AND i.ordinal>? AND r.status='sealed' ORDER BY i.ordinal LIMIT ?`)
    .iterate(attachmentId, afterOrdinal, pageSize) as unknown as Iterable<Row>;
  for (const row of pageRows) {
    const payload = bytes(row, "canonical_payload");
    if (pending.length > 0 && pageBytes + payload.byteLength > RECORD_SQLITE_MAX_PAGE_BYTES) { hasMore = true; break; }
    cursor = integer(row, "ordinal");
    pageBytes += payload.byteLength;
    pending.push(Object.freeze({
      ordinal: cursor,
      logicalIdentity: text(row, "logical_identity"),
      payload,
      canonicalDigest: text(row, "canonical_digest"),
    }));
    hasMore = integer(row, "has_more") === 1;
  }
  // One page owns one transferable backing store. Transferring a separate
  // ArrayBuffer for every small row makes long streams retain allocator and
  // structured-clone overhead in proportion to row count.
  const packed = new Uint8Array(pageBytes);
  let packedOffset = 0;
  const items = pending.map((item): PersistedCollectionItem => {
    packed.set(item.payload, packedOffset);
    const canonicalBytes = packed.subarray(packedOffset, packedOffset + item.payload.byteLength);
    packedOffset += item.payload.byteLength;
    return Object.freeze({
      ordinal: item.ordinal,
      logicalIdentity: item.logicalIdentity,
      canonicalBytes,
      canonicalDigest: item.canonicalDigest,
    });
  });
  const nextOrdinal = hasMore ? cursor : null;
  return Object.freeze({ attachmentId, afterOrdinal, items: Object.freeze(items), nextOrdinal });
}

/** Bounded sealed Core projection. Collection item bytes and Content chunk bytes are never selected. */
export function readSealedRunCore(connection: RecordDatabase, runId: string): SealedRunCore | undefined {
  const run = recordStatement(connection, `SELECT run_id,writer_generation,started_at,logical_seal_identity,core_payload,core_digest
    FROM runs WHERE run_id=? AND status='sealed'`).get(runId) as unknown as Row | undefined;
  if (run === undefined) return undefined;
  const admission = recordStatement(connection, `SELECT
    1+(SELECT count(*) FROM slots WHERE run_id=?)+(SELECT count(*) FROM attempts WHERE origin_run_id=?)+
      (SELECT count(*) FROM members WHERE target_run_id=?)+(SELECT count(*) FROM attachments WHERE owner_run_id=?)+
      (SELECT count(*) FROM attachment_references rr JOIN attachments aa ON aa.attachment_id=rr.attachment_id WHERE aa.owner_run_id=?)+
      (SELECT count(*) FROM contents cc JOIN attachments aa ON aa.attachment_id=cc.attachment_id WHERE aa.owner_run_id=?) row_count,
    length(r.core_payload)+(SELECT coalesce(sum(length(core_payload)),0) FROM slots WHERE run_id=?)+
      (SELECT coalesce(sum(length(core_payload)),0) FROM attempts WHERE origin_run_id=?)+
      (SELECT coalesce(sum(length(core_payload)),0) FROM members WHERE target_run_id=?)+
      (SELECT coalesce(sum(length(canonical_payload)+length(logical_inventory)),0) FROM attachments WHERE owner_run_id=?)+
      (SELECT coalesce(sum(length(rr.canonical_payload)),0) FROM attachment_references rr JOIN attachments aa ON aa.attachment_id=rr.attachment_id WHERE aa.owner_run_id=?) byte_count
    FROM runs r WHERE r.run_id=? AND r.status='sealed'`).get(
    runId, runId, runId, runId, runId, runId, runId, runId, runId, runId, runId, runId,
  ) as unknown as Row;
  assertBoundedBatch("read-sealed-run-core", integer(admission, "row_count"), integer(admission, "byte_count"));
  const record = recordStatement(connection, "SELECT record_payload,record_digest FROM record_metadata WHERE singleton=1").get() as unknown as Row;
  const slots = rows(connection, "SELECT slot_id,ordinal,core_payload,core_digest FROM slots WHERE run_id=? ORDER BY ordinal", runId)
    .map((row) => Object.freeze({ slotId: text(row, "slot_id"), ordinal: integer(row, "ordinal"), coreBytes: transferableBytes(bytes(row, "core_payload")), coreDigest: text(row, "core_digest") }));
  const attempts = rows(connection, "SELECT attempt_id,attempt_locator,core_payload,core_digest FROM attempts WHERE origin_run_id=? ORDER BY attempt_id", runId)
    .map((row) => Object.freeze({ attemptId: text(row, "attempt_id"), attemptLocator: text(row, "attempt_locator"), coreBytes: transferableBytes(bytes(row, "core_payload")), coreDigest: text(row, "core_digest") }));
  const members = rows(connection, `SELECT slot_id,origin_run_id,attempt_id,action,core_payload,core_digest FROM members WHERE target_run_id=? ORDER BY slot_id`, runId)
    .map((row) => Object.freeze({ slotId: text(row, "slot_id"), ...(optionalText(row, "origin_run_id") === undefined ? {} : { originRunId: optionalText(row, "origin_run_id") }),
      ...(optionalText(row, "attempt_id") === undefined ? {} : { attemptId: optionalText(row, "attempt_id") }), action: memberAction(row, "action"),
      coreBytes: transferableBytes(bytes(row, "core_payload")), coreDigest: text(row, "core_digest") }));
  const attachmentRows = rows(connection, `SELECT attachment_id,owner_kind,owner_run_id,owner_attempt_id,family,family_revision,
    logical_identity,canonical_payload,canonical_digest,logical_inventory,inventory_digest,
    (SELECT count(*) FROM collection_items i WHERE i.attachment_id=a.attachment_id) item_count,
    (SELECT coalesce(sum(length(i.canonical_payload)),0) FROM collection_items i WHERE i.attachment_id=a.attachment_id) item_bytes
    FROM attachments a WHERE owner_run_id=? ORDER BY attachment_id`, runId);
  const attachments: SealedAttachmentMetadata[] = attachmentRows.map((row) => {
    const attachmentId = text(row, "attachment_id");
    const references = rows(connection, `SELECT ordinal,target_owner_kind,target_family,canonical_payload,reference_digest
      FROM attachment_references WHERE attachment_id=? ORDER BY ordinal`, attachmentId).map((reference) => Object.freeze({
      ordinal: integer(reference, "ordinal"), owner: ownerKind(reference, "target_owner_kind"), family: text(reference, "target_family"),
      canonicalBytes: transferableBytes(bytes(reference, "canonical_payload")), referenceDigest: text(reference, "reference_digest"),
    }));
    const contents = rows(connection, `SELECT content_id,logical_handle,byte_length,overall_digest,chunk_count
      FROM contents WHERE attachment_id=? ORDER BY content_id`, attachmentId).map((content) => Object.freeze({
      contentId: text(content, "content_id"), logicalHandle: text(content, "logical_handle"), byteLength: integer(content, "byte_length"),
      digest: text(content, "overall_digest"), chunkCount: integer(content, "chunk_count"),
    }));
    return Object.freeze({ attachmentId, ownerKind: ownerKind(row, "owner_kind"), ownerRunId: text(row, "owner_run_id"),
      ...(optionalText(row, "owner_attempt_id") === undefined ? {} : { ownerAttemptId: optionalText(row, "owner_attempt_id") }),
      family: text(row, "family"), familyRevision: integer(row, "family_revision"), logicalIdentity: text(row, "logical_identity"),
      canonicalBytes: transferableBytes(bytes(row, "canonical_payload")), canonicalDigest: text(row, "canonical_digest"),
      logicalInventoryBytes: transferableBytes(bytes(row, "logical_inventory")), inventoryDigest: text(row, "inventory_digest"),
      references: Object.freeze(references), collectionItemCount: integer(row, "item_count"), collectionItemByteLength: integer(row, "item_bytes"),
      contents: Object.freeze(contents) });
  });
  return Object.freeze({ runId: text(run, "run_id"), writerGeneration: text(run, "writer_generation"), startedAt: text(run, "started_at"),
    logicalSealIdentity: text(run, "logical_seal_identity"), recordCoreBytes: transferableBytes(bytes(record, "record_payload")),
    recordCoreDigest: text(record, "record_digest"), runCoreBytes: transferableBytes(bytes(run, "core_payload")), runCoreDigest: text(run, "core_digest"),
    slots: Object.freeze(slots), attempts: Object.freeze(attempts), members: Object.freeze(members), attachments: Object.freeze(attachments) });
}

/** Fixed, decoded projection sufficient to rebuild sealed Core and attachment metadata. */
export function readSealedRunDocument(connection: RecordDatabase, runId: string): SealedRunDocument | undefined {
  const run = recordStatement(connection, `SELECT run_id,writer_generation,started_at,logical_seal_identity,core_payload,core_digest
    FROM runs WHERE run_id=? AND status='sealed'`).get(runId) as unknown as Row | undefined;
  if (run === undefined) return undefined;
  const whole = recordStatement(connection, `SELECT count(*) row_count,coalesce(sum(length(i.canonical_payload)),0) byte_count
    FROM collection_items i JOIN attachments a ON a.attachment_id=i.attachment_id WHERE a.owner_run_id=?`).get(runId) as unknown as Row;
  assertBoundedBatch("read-sealed-run-document", integer(whole, "row_count"), integer(whole, "byte_count"));
  const record = recordStatement(connection, "SELECT record_payload,record_digest FROM record_metadata WHERE singleton=1")
    .get() as unknown as Row;
  const slots = rows(connection, "SELECT slot_id,ordinal,core_payload,core_digest FROM slots WHERE run_id=? ORDER BY ordinal", runId)
    .map((row) => Object.freeze({ slotId: text(row, "slot_id"), ordinal: integer(row, "ordinal"), coreBytes: transferableBytes(bytes(row, "core_payload")), coreDigest: text(row, "core_digest") }));
  const attempts = rows(connection, "SELECT attempt_id,attempt_locator,core_payload,core_digest FROM attempts WHERE origin_run_id=? ORDER BY attempt_id", runId)
    .map((row) => Object.freeze({ attemptId: text(row, "attempt_id"), attemptLocator: text(row, "attempt_locator"), coreBytes: transferableBytes(bytes(row, "core_payload")), coreDigest: text(row, "core_digest") }));
  const members = rows(connection, `SELECT slot_id,origin_run_id,attempt_id,action,core_payload,core_digest FROM members
    WHERE target_run_id=? ORDER BY slot_id`, runId).map((row) => Object.freeze({
    slotId: text(row, "slot_id"),
    ...(optionalText(row, "origin_run_id") === undefined ? {} : { originRunId: optionalText(row, "origin_run_id") }),
    ...(optionalText(row, "attempt_id") === undefined ? {} : { attemptId: optionalText(row, "attempt_id") }),
    action: memberAction(row, "action"),
    coreBytes: transferableBytes(bytes(row, "core_payload")),
    coreDigest: text(row, "core_digest"),
  }));
  const attachmentRows = rows(connection, `SELECT attachment_id,owner_kind,owner_run_id,owner_attempt_id,family,family_revision,
    logical_identity,canonical_payload,canonical_digest,logical_inventory,inventory_digest FROM attachments
    WHERE owner_run_id=? ORDER BY attachment_id`, runId);
  const attachments: SealedAttachmentDocument[] = attachmentRows.map((row) => {
    const attachmentId = text(row, "attachment_id");
    const references = rows(connection, `SELECT ordinal,target_owner_kind,target_family,
      canonical_payload,reference_digest FROM attachment_references WHERE attachment_id=? ORDER BY ordinal`, attachmentId)
      .map((reference) => Object.freeze({
        ordinal: integer(reference, "ordinal"),
        owner: ownerKind(reference, "target_owner_kind"),
        family: text(reference, "target_family"),
        canonicalBytes: transferableBytes(bytes(reference, "canonical_payload")),
        referenceDigest: text(reference, "reference_digest"),
      }));
    const collectionItems = rows(connection, `SELECT ordinal,logical_identity,canonical_payload,canonical_digest
      FROM collection_items WHERE attachment_id=? ORDER BY ordinal`, attachmentId).map((item) => Object.freeze({
      ordinal: integer(item, "ordinal"),
      logicalIdentity: text(item, "logical_identity"),
      canonicalBytes: transferableBytes(bytes(item, "canonical_payload")),
      canonicalDigest: text(item, "canonical_digest"),
    }));
    const contents = rows(connection, `SELECT content_id,logical_handle,byte_length,overall_digest,chunk_count
      FROM contents WHERE attachment_id=? ORDER BY content_id`, attachmentId).map((content) => Object.freeze({
      contentId: text(content, "content_id"),
      logicalHandle: text(content, "logical_handle"),
      byteLength: integer(content, "byte_length"),
      digest: text(content, "overall_digest"),
      chunkCount: integer(content, "chunk_count"),
    }));
    const decodedOwnerKind = ownerKind(row, "owner_kind");
    return Object.freeze({
      attachmentId,
      ownerKind: decodedOwnerKind,
      ownerRunId: text(row, "owner_run_id"),
      ...(optionalText(row, "owner_attempt_id") === undefined ? {} : { ownerAttemptId: optionalText(row, "owner_attempt_id") }),
      family: text(row, "family"),
      familyRevision: integer(row, "family_revision"),
      logicalIdentity: text(row, "logical_identity"),
      canonicalBytes: transferableBytes(bytes(row, "canonical_payload")),
      canonicalDigest: text(row, "canonical_digest"),
      logicalInventoryBytes: transferableBytes(bytes(row, "logical_inventory")),
      inventoryDigest: text(row, "inventory_digest"),
      references: Object.freeze(references),
      collectionItems: Object.freeze(collectionItems),
      contents: Object.freeze(contents),
    });
  });
  return Object.freeze({
    runId: text(run, "run_id"),
    writerGeneration: text(run, "writer_generation"),
    startedAt: text(run, "started_at"),
    logicalSealIdentity: text(run, "logical_seal_identity"),
    recordCoreBytes: transferableBytes(bytes(record, "record_payload")),
    recordCoreDigest: text(record, "record_digest"),
    runCoreBytes: transferableBytes(bytes(run, "core_payload")),
    runCoreDigest: text(run, "core_digest"),
    slots: Object.freeze(slots),
    attempts: Object.freeze(attempts),
    members: Object.freeze(members),
    attachments: Object.freeze(attachments),
  });
}

export function appendContentChunks(connection: RecordDatabase, input: AppendContentChunksInput): void {
  assertBoundedBatch("append-content-chunks", input.chunks.length, input.chunks.reduce((sum, value) => sum + value.bytes.byteLength, 0));
  let previousOrdinal: number | undefined;
  for (const chunk of input.chunks) {
    requireOrdinal(chunk.ordinal, `content ${input.contentId} chunk ordinal`);
    if (previousOrdinal !== undefined && chunk.ordinal !== previousOrdinal + 1) {
      throw sqliteError("record-content-invalid", "append-content-chunks", "content chunk batch is not sequential");
    }
    previousOrdinal = chunk.ordinal;
    if (chunk.bytes.byteLength > RECORD_SQLITE_CHUNK_BYTES) throw sqliteError("record-resource-limit-exceeded", "append-content-chunks", "content chunk exceeds durable row ceiling");
    requireBytesDigest(chunk.bytes, chunk.chunkDigest, `content chunk ${input.contentId}/${chunk.ordinal}`);
  }
  withImmediateTransaction(connection, input.deadlineEpochMs, "append-content-chunks", () => {
    assertRunFence(connection, input.runId, input.writerGeneration, "append-content-chunks");
    const metadata = recordStatement(connection, `SELECT a.owner_run_id,r.status FROM contents c JOIN attachments a ON a.attachment_id=c.attachment_id
      JOIN runs r ON r.run_id=a.owner_run_id WHERE c.content_id=?`).get(input.contentId) as unknown as Row | undefined;
    if (metadata === undefined || text(metadata, "owner_run_id") !== input.runId || text(metadata, "status") !== "open") {
      throw sqliteError("record-command-conflict", "append-content-chunks", "Content admission is missing or no longer open");
    }
    let changed = false;
    for (const chunk of input.chunks) {
      const stored = recordStatement(connection, "SELECT bytes,chunk_digest FROM content_chunks WHERE content_id=? AND ordinal=?")
        .get(input.contentId, chunk.ordinal) as unknown as Row | undefined;
      if (stored === undefined) {
        const count = recordStatement(connection, "SELECT count(*) AS count FROM content_chunks WHERE content_id=?").get(input.contentId) as unknown as Row;
        if (chunk.ordinal !== integer(count, "count")) throw sqliteError("record-command-conflict", "append-content-chunks", "Content batch does not extend the committed prefix");
        recordStatement(connection, "INSERT INTO content_chunks(content_id,ordinal,bytes,chunk_digest) VALUES (?,?,?,?)")
          .run(input.contentId, chunk.ordinal, chunk.bytes, chunk.chunkDigest);
        changed = true;
      } else if (text(stored, "chunk_digest") !== chunk.chunkDigest || !bytesEqual(bytes(stored, "bytes"), chunk.bytes)) {
        throw sqliteError("record-command-conflict", "append-content-chunks", `Chunk ${input.contentId}/${chunk.ordinal} conflicts with its committed retry`);
      }
    }
    if (changed) bumpMutationSequence(connection, input.runId);
  });
}

export function readContentChunkPage(
  connection: RecordDatabase,
  contentId: string,
  afterOrdinal: number,
  pageSize: number,
): ContentChunkPage {
  if (!Number.isSafeInteger(afterOrdinal) || afterOrdinal < -1) throw sqliteError("record-content-invalid", "read-content-page", "afterOrdinal must be -1 or greater");
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > RECORD_SQLITE_MAX_PAGE_ROWS) throw sqliteError("record-resource-limit-exceeded", "read-content-page", `page size must be between 1 and ${RECORD_SQLITE_MAX_PAGE_ROWS}`);
  const page: { readonly ordinal: number; readonly bytes: Uint8Array; readonly chunkDigest: string }[] = [];
  let cursor = afterOrdinal;
  let pageBytes = 0;
  let hasMore = false;
  const pageRows = recordStatement(connection, `SELECT c.ordinal,c.bytes,c.chunk_digest,
      EXISTS(SELECT 1 FROM content_chunks more WHERE more.content_id=c.content_id AND more.ordinal>c.ordinal) AS has_more
      FROM content_chunks c
      JOIN contents n ON n.content_id=c.content_id JOIN attachments a ON a.attachment_id=n.attachment_id
      JOIN runs r ON r.run_id=a.owner_run_id WHERE c.content_id=? AND c.ordinal>? AND r.status='sealed'
      ORDER BY c.ordinal LIMIT ?`).iterate(contentId, afterOrdinal, pageSize) as unknown as Iterable<Row>;
  for (const row of pageRows) {
    const value = bytes(row, "bytes");
    if (page.length > 0 && pageBytes + value.byteLength > RECORD_SQLITE_MAX_PAGE_BYTES) { hasMore = true; break; }
    cursor = integer(row, "ordinal");
    pageBytes += value.byteLength;
    page.push(Object.freeze({ ordinal: cursor, bytes: transferableBytes(value), chunkDigest: text(row, "chunk_digest") }));
    hasMore = integer(row, "has_more") === 1;
  }
  const nextOrdinal = hasMore ? cursor : null;
  return Object.freeze({ contentId, afterOrdinal, chunks: Object.freeze(page), nextOrdinal });
}
