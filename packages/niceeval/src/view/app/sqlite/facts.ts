import type { Database, SqlValue } from "@sqlite.org/sqlite-wasm";
import { Result } from "effect";

import { InspectionSha256 } from "../../../inspection/bytes.ts";
import type { InspectionFactSource } from "../../../inspection/source.ts";
import { decodeAttemptPublicationClosure } from "../../../record/codec/core.ts";
import {
  RECORD_SQLITE_MAX_PAGE_BYTES,
  RECORD_SQLITE_MAX_PAGE_ROWS,
  type AttemptLocatorCandidates,
  type CollectionItemPage,
  type ContentChunkPage,
  type PersistedCollectionItem,
  type PersistedContentChunk,
  type RecordOwnerKind,
  type SealedAttachmentMetadata,
  type SealedRunCore,
  type SealedRunSummary,
  type SealedRunSummaryPage,
} from "../../../record/sqlite/types.ts";

type Row = Record<string, SqlValue>;
type BindValue = SqlValue | boolean;

/**
 * Browser-side fixed reader for the already validated, immutable generation.
 * It deliberately implements only the low-level Inspection facts contract;
 * all business selection and projection remains owned by Inspection.
 */
export function browserInspectionFacts(db: Database): InspectionFactSource {
  const cutoff = readCutoff(db);
  return Object.freeze({
    kind: "external-record" as const,
    cutoff: () => cutoff,
    readSealedRunSummaryPage: (afterRunId = "", pageSize = 100, expectedCutoffIdentity?: string) => {
      if (expectedCutoffIdentity !== undefined && expectedCutoffIdentity !== cutoff.identity) {
        throw new Error("The Record cutoff changed; restart pagination.");
      }
      return readSummaryPage(db, cutoff, afterRunId, pageSize);
    },
    findAttemptLocatorCandidates: (locator: string, maximumCandidateRuns: number) =>
      findAttemptLocatorCandidates(db, locator, maximumCandidateRuns),
    readSealedRunCore: (runId: string) => readSealedRunCore(db, runId),
    readContentPage: (contentId: string, afterOrdinal: number, pageSize: number) =>
      readContentPage(db, contentId, afterOrdinal, pageSize),
    readCollectionPage: (attachmentId: string, afterOrdinal: number, pageSize: number) =>
      readCollectionPage(db, attachmentId, afterOrdinal, pageSize),
  });
}

function readCutoff(db: Database): { readonly identity: string; readonly runCount: number } {
  const record = one(db, "SELECT record_digest FROM record_metadata WHERE singleton=1");
  const inventory = query(db, `SELECT run_id FROM runs r WHERE status='sealed' OR EXISTS
    (SELECT 1 FROM attempt_publications p WHERE p.origin_run_id=r.run_id) ORDER BY run_id`);
  // The imported generation cannot mutate after open. Its verified Record digest is
  // therefore sufficient as the fixed-reader pagination fence in this Worker.
  return Object.freeze({
    identity: text(requiredRow(record, "Record metadata").record_digest, "record_metadata.record_digest"),
    runCount: inventory.length,
  });
}

function readSummaryPage(
  db: Database,
  cutoff: { readonly identity: string; readonly runCount: number },
  afterRunId: string,
  pageSize: number,
): SealedRunSummaryPage {
  requirePageSize(pageSize, 256);
  const pageRows = query(db, `SELECT run_id FROM runs r
    WHERE run_id>? AND (status='sealed' OR EXISTS
      (SELECT 1 FROM attempt_publications p WHERE p.origin_run_id=r.run_id))
    ORDER BY run_id LIMIT ?`, [afterRunId, pageSize + 1]);
  const selected = pageRows.slice(0, pageSize);
  const summaries = selected.map((row) => readRunSummary(db, text(row.run_id, "runs.run_id")));
  return Object.freeze({
    cutoff,
    afterRunId,
    summaries: Object.freeze(summaries),
    nextAfterRunId: pageRows.length > pageSize && summaries.length > 0
      ? summaries.at(-1)!.runId
      : null,
  });
}

function readRunSummary(db: Database, runId: string): SealedRunSummary {
  const core = readSealedRunCore(db, runId);
  if (core === undefined) throw new Error(`Published Run ${runId} is unavailable.`);
  const contentCount = core.attachments.reduce((count, attachment) => count + attachment.contents.length, 0);
  const contentByteLength = core.attachments.reduce((count, attachment) =>
    count + attachment.contents.reduce((subtotal, content) => subtotal + content.byteLength, 0), 0);
  const seal = requiredRow(one(db, "SELECT count(*) seal_count FROM run_seal_entries WHERE run_id=?", [runId]), `Run ${runId} seal`);
  return Object.freeze({
    runId: core.runId,
    writerGeneration: core.writerGeneration,
    startedAt: core.startedAt,
    logicalSealIdentity: core.logicalSealIdentity,
    slotCount: core.slots.length,
    memberCount: core.members.length,
    attemptCount: core.attempts.length,
    attachmentCount: core.attachments.length,
    contentCount,
    contentByteLength,
    sealEntryCount: integer(seal.seal_count, "seal_count"),
  });
}

function findAttemptLocatorCandidates(
  db: Database,
  locator: string,
  maximumCandidateRuns: number,
): AttemptLocatorCandidates {
  requirePageSize(maximumCandidateRuns, 256);
  const matching = query(db, `SELECT a.origin_run_id,a.attempt_id FROM attempts a
    JOIN attempt_publications p ON p.origin_run_id=a.origin_run_id AND p.attempt_id=a.attempt_id
    WHERE a.attempt_locator=? ORDER BY a.origin_run_id,a.attempt_id LIMIT ?`,
  [locator, maximumCandidateRuns + 1]);
  const identities = new Set<string>();
  const candidates: AttemptLocatorCandidates["candidates"][number][] = [];
  const add = (candidate: AttemptLocatorCandidates["candidates"][number]): void => {
    if (candidates.length >= maximumCandidateRuns) {
      throw new Error(`Attempt locator exceeds the fixed ${maximumCandidateRuns}-Run candidate limit.`);
    }
    candidates.push(Object.freeze(candidate));
  };
  for (const row of matching) {
    const originRunId = text(row.origin_run_id, "attempts.origin_run_id");
    const attemptId = text(row.attempt_id, "attempts.attempt_id");
    identities.add(`${originRunId}\u0000${attemptId}`);
    add({ locator, originRunId, attemptId, relation: "origin", runId: originRunId });
    const targets = query(db, `SELECT DISTINCT b.target_run_id FROM run_slot_bindings b
      WHERE b.origin_run_id=? AND b.attempt_id=? ORDER BY b.target_run_id LIMIT ?`,
    [originRunId, attemptId, maximumCandidateRuns - candidates.length + 1]);
    for (const target of targets) {
      add({
        locator,
        originRunId,
        attemptId,
        relation: "target",
        runId: text(target.target_run_id, "run_slot_bindings.target_run_id"),
      });
    }
  }
  return Object.freeze({ locator, ambiguous: identities.size > 1, candidates: Object.freeze(candidates) });
}

function readSealedRunCore(db: Database, runId: string): SealedRunCore | undefined {
  const run = one(db, `SELECT r.run_id,r.writer_generation,r.started_at,r.status,
    coalesce(r.logical_seal_identity,'published:' || (SELECT max(p.published_revision) FROM attempt_publications p
      WHERE p.origin_run_id=r.run_id)) logical_seal_identity,r.core_payload,r.core_digest,
    (SELECT p.closure_payload FROM attempt_publications p WHERE p.origin_run_id=r.run_id
      ORDER BY p.published_revision DESC LIMIT 1) publication_closure
    FROM runs r WHERE r.run_id=? AND (r.status='sealed' OR EXISTS
      (SELECT 1 FROM attempt_publications p WHERE p.origin_run_id=r.run_id))`, [runId]);
  if (run === undefined) return undefined;
  let runCoreBytes: Uint8Array;
  let runCoreDigest: string;
  if (text(run.status, "runs.status") === "sealed") {
    runCoreBytes = bytes(run.core_payload, "runs.core_payload");
    runCoreDigest = text(run.core_digest, "runs.core_digest");
  } else {
    let closure: unknown;
    try {
      closure = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(
        bytes(run.publication_closure, "attempt_publications.closure_payload"),
      )) as unknown;
    } catch {
      throw new Error(`Run ${runId} publication closure is invalid.`);
    }
    const decoded = decodeAttemptPublicationClosure(closure);
    if (Result.isFailure(decoded)) throw new Error(`Run ${runId} publication closure is unsupported.`);
    runCoreBytes = new TextEncoder().encode(JSON.stringify(decoded.success.originRun));
    runCoreDigest = new InspectionSha256().update(runCoreBytes).digestHex();
  }
  const record = requiredRow(one(db,
    "SELECT record_payload,record_digest FROM record_metadata WHERE singleton=1"), "Record metadata");
  const publicationManaged = one(db, "SELECT 1 present FROM run_resources WHERE run_id=?", [runId]) !== undefined;
  const slots = query(db,
    "SELECT slot_id,ordinal,core_payload,core_digest FROM slots WHERE run_id=? ORDER BY ordinal", [runId])
    .map((row) => Object.freeze({
      slotId: text(row.slot_id, "slots.slot_id"),
      ordinal: integer(row.ordinal, "slots.ordinal"),
      coreBytes: bytes(row.core_payload, "slots.core_payload"),
      coreDigest: text(row.core_digest, "slots.core_digest"),
    }));
  const attempts = query(db, publicationManaged
    ? `SELECT a.attempt_id,a.attempt_locator,a.core_payload,a.core_digest,p.published_revision FROM attempts a
      JOIN attempt_publications p ON p.origin_run_id=a.origin_run_id AND p.attempt_id=a.attempt_id
      WHERE a.origin_run_id=? ORDER BY a.attempt_id`
    : "SELECT attempt_id,attempt_locator,core_payload,core_digest FROM attempts WHERE origin_run_id=? ORDER BY attempt_id",
    [runId]).map((row) => {
      const attemptId = text(row.attempt_id, "attempts.attempt_id");
      return Object.freeze({
      attemptId,
      attemptLocator: text(row.attempt_locator, "attempts.attempt_locator"),
      coreBytes: bytes(row.core_payload, "attempts.core_payload"),
      coreDigest: text(row.core_digest, "attempts.core_digest"),
      ...(publicationManaged ? { publicationIdentity: Object.freeze({
        originRunId: runId,
        attemptId,
        revision: integer(row.published_revision, "attempt_publications.published_revision"),
      }) } : {}),
    });
    });
  const memberRows = publicationManaged
    ? [
      ...query(db, `SELECT b.slot_id,b.origin_run_id,b.attempt_id,b.action,b.attempt_publication_revision,
          p.published_revision,m.core_payload,m.core_digest
        FROM run_slot_bindings b JOIN members m
          ON m.target_run_id=b.target_run_id AND m.slot_id=b.slot_id
        JOIN attempt_publications p ON p.origin_run_id=b.origin_run_id AND p.attempt_id=b.attempt_id
          AND p.published_revision=b.attempt_publication_revision
        WHERE b.target_run_id=?`, [runId]),
      ...query(db, `SELECT a.slot_id,NULL origin_run_id,NULL attempt_id,m.action,m.core_payload,m.core_digest
        FROM run_slot_absences a JOIN members m ON m.target_run_id=a.run_id AND m.slot_id=a.slot_id
        WHERE a.run_id=?`, [runId]),
    ].sort((left, right) => text(left.slot_id, "members.slot_id").localeCompare(text(right.slot_id, "members.slot_id")))
    : query(db, `SELECT slot_id,origin_run_id,attempt_id,action,core_payload,core_digest
      FROM members WHERE target_run_id=? ORDER BY slot_id`, [runId]);
  const members = memberRows.map((row) => {
    const originRunId = optionalText(row.origin_run_id, "members.origin_run_id");
    const attemptId = optionalText(row.attempt_id, "members.attempt_id");
    const action = memberAction(row.action);
    return Object.freeze({
      slotId: text(row.slot_id, "members.slot_id"),
      ...(originRunId === undefined ? {} : { originRunId }),
      ...(attemptId === undefined ? {} : { attemptId }),
      action,
      coreBytes: bytes(row.core_payload, "members.core_payload"),
      coreDigest: text(row.core_digest, "members.core_digest"),
      ...(publicationManaged && originRunId !== undefined && attemptId !== undefined ? {
        publicationIdentity: Object.freeze({
          originRunId,
          attemptId,
          revision: integer(row.published_revision, "attempt_publications.published_revision"),
        }),
      } : {}),
    });
  });
  const attachments = query(db, `SELECT attachment_id,owner_kind,owner_run_id,owner_attempt_id,
    family,family_revision,logical_identity,canonical_payload,canonical_digest,logical_inventory,inventory_digest,
    (SELECT count(*) FROM collection_items i WHERE i.attachment_id=a.attachment_id) item_count,
    (SELECT coalesce(sum(length(i.canonical_payload)),0) FROM collection_items i
      WHERE i.attachment_id=a.attachment_id) item_bytes
    FROM attachments a WHERE owner_run_id=?${publicationManaged ? ` AND canonical_payload IS NOT NULL AND
      (owner_kind='run' OR EXISTS (SELECT 1 FROM attempt_publications p
        WHERE p.origin_run_id=a.owner_run_id AND p.attempt_id=a.owner_attempt_id))` : ""}
    ORDER BY attachment_id`, [runId])
    .map((row): SealedAttachmentMetadata => readAttachmentMetadata(db, row));
  return Object.freeze({
    runId: text(run.run_id, "runs.run_id"),
    writerGeneration: text(run.writer_generation, "runs.writer_generation"),
    startedAt: text(run.started_at, "runs.started_at"),
    logicalSealIdentity: text(run.logical_seal_identity, "runs.logical_seal_identity"),
    ...(publicationManaged ? { publicationManaged: true } : {}),
    recordCoreBytes: bytes(record.record_payload, "record_metadata.record_payload"),
    recordCoreDigest: text(record.record_digest, "record_metadata.record_digest"),
    runCoreBytes,
    runCoreDigest,
    slots: Object.freeze(slots),
    attempts: Object.freeze(attempts),
    members: Object.freeze(members),
    attachments: Object.freeze(attachments),
  });
}

function readAttachmentMetadata(db: Database, row: Row): SealedAttachmentMetadata {
  const attachmentId = text(row.attachment_id, "attachments.attachment_id");
  const references = query(db, `SELECT ordinal,target_owner_kind,target_family,canonical_payload,reference_digest
    FROM attachment_references WHERE attachment_id=? ORDER BY ordinal`, [attachmentId]).map((reference) => Object.freeze({
    ordinal: integer(reference.ordinal, "attachment_references.ordinal"),
    owner: ownerKind(reference.target_owner_kind, "attachment_references.target_owner_kind"),
    family: text(reference.target_family, "attachment_references.target_family"),
    canonicalBytes: bytes(reference.canonical_payload, "attachment_references.canonical_payload"),
    referenceDigest: text(reference.reference_digest, "attachment_references.reference_digest"),
  }));
  const contents = query(db, `SELECT content_id,logical_handle,byte_length,overall_digest,chunk_count
    FROM contents WHERE attachment_id=? ORDER BY content_id`, [attachmentId]).map((content) => Object.freeze({
    contentId: text(content.content_id, "contents.content_id"),
    logicalHandle: text(content.logical_handle, "contents.logical_handle"),
    byteLength: integer(content.byte_length, "contents.byte_length"),
    digest: text(content.overall_digest, "contents.overall_digest"),
    chunkCount: integer(content.chunk_count, "contents.chunk_count"),
  }));
  const ownerAttemptId = optionalText(row.owner_attempt_id, "attachments.owner_attempt_id");
  return Object.freeze({
    attachmentId,
    ownerKind: ownerKind(row.owner_kind, "attachments.owner_kind"),
    ownerRunId: text(row.owner_run_id, "attachments.owner_run_id"),
    ...(ownerAttemptId === undefined ? {} : { ownerAttemptId }),
    family: text(row.family, "attachments.family"),
    familyRevision: integer(row.family_revision, "attachments.family_revision"),
    logicalIdentity: text(row.logical_identity, "attachments.logical_identity"),
    canonicalBytes: bytes(row.canonical_payload, "attachments.canonical_payload"),
    canonicalDigest: text(row.canonical_digest, "attachments.canonical_digest"),
    logicalInventoryBytes: bytes(row.logical_inventory, "attachments.logical_inventory"),
    inventoryDigest: text(row.inventory_digest, "attachments.inventory_digest"),
    references: Object.freeze(references),
    collectionItemCount: integer(row.item_count, "attachments.item_count"),
    collectionItemByteLength: integer(row.item_bytes, "attachments.item_bytes"),
    contents: Object.freeze(contents),
  });
}

function readCollectionPage(
  db: Database,
  attachmentId: string,
  afterOrdinal: number,
  pageSize: number,
): CollectionItemPage {
  requireOrdinal(afterOrdinal);
  requirePageSize(pageSize, RECORD_SQLITE_MAX_PAGE_ROWS);
  const pending: PersistedCollectionItem[] = [];
  let cursor = afterOrdinal;
  let pageBytes = 0;
  let hasMore = false;
  for (const row of query(db, `SELECT i.ordinal,i.logical_identity,i.canonical_payload,i.canonical_digest,
    EXISTS(SELECT 1 FROM collection_items more WHERE more.attachment_id=i.attachment_id
      AND more.ordinal>i.ordinal) has_more
    FROM collection_items i JOIN attachments a ON a.attachment_id=i.attachment_id
    JOIN runs r ON r.run_id=a.owner_run_id
    WHERE i.attachment_id=? AND i.ordinal>? AND (r.status='sealed' OR
      (a.canonical_payload IS NOT NULL AND (a.owner_kind='run' OR EXISTS
        (SELECT 1 FROM attempt_publications p
          WHERE p.origin_run_id=a.owner_run_id AND p.attempt_id=a.owner_attempt_id))))
    ORDER BY i.ordinal LIMIT ?`,
  [attachmentId, afterOrdinal, pageSize])) {
    const canonicalBytes = bytes(row.canonical_payload, "collection_items.canonical_payload");
    if (pending.length > 0 && pageBytes + canonicalBytes.byteLength > RECORD_SQLITE_MAX_PAGE_BYTES) {
      hasMore = true;
      break;
    }
    cursor = integer(row.ordinal, "collection_items.ordinal");
    pageBytes += canonicalBytes.byteLength;
    pending.push(Object.freeze({
      ordinal: cursor,
      logicalIdentity: text(row.logical_identity, "collection_items.logical_identity"),
      canonicalBytes,
      canonicalDigest: text(row.canonical_digest, "collection_items.canonical_digest"),
    }));
    hasMore = integer(row.has_more, "collection_items.has_more") === 1;
  }
  return Object.freeze({
    attachmentId,
    afterOrdinal,
    items: Object.freeze(pending),
    nextOrdinal: hasMore ? cursor : null,
  });
}

function readContentPage(
  db: Database,
  contentId: string,
  afterOrdinal: number,
  pageSize: number,
): ContentChunkPage {
  requireOrdinal(afterOrdinal);
  requirePageSize(pageSize, RECORD_SQLITE_MAX_PAGE_ROWS);
  const chunks: PersistedContentChunk[] = [];
  let cursor = afterOrdinal;
  let pageBytes = 0;
  let hasMore = false;
  for (const row of query(db, `SELECT c.ordinal,c.bytes,c.chunk_digest,
    EXISTS(SELECT 1 FROM content_chunks more WHERE more.content_id=c.content_id
      AND more.ordinal>c.ordinal) has_more
    FROM content_chunks c JOIN contents n ON n.content_id=c.content_id
    JOIN attachments a ON a.attachment_id=n.attachment_id JOIN runs r ON r.run_id=a.owner_run_id
    WHERE c.content_id=? AND c.ordinal>? AND (r.status='sealed' OR
      (a.canonical_payload IS NOT NULL AND (a.owner_kind='run' OR EXISTS
        (SELECT 1 FROM attempt_publications p
          WHERE p.origin_run_id=a.owner_run_id AND p.attempt_id=a.owner_attempt_id))))
    ORDER BY c.ordinal LIMIT ?`,
  [contentId, afterOrdinal, pageSize])) {
    const value = bytes(row.bytes, "content_chunks.bytes");
    if (chunks.length > 0 && pageBytes + value.byteLength > RECORD_SQLITE_MAX_PAGE_BYTES) {
      hasMore = true;
      break;
    }
    cursor = integer(row.ordinal, "content_chunks.ordinal");
    pageBytes += value.byteLength;
    chunks.push(Object.freeze({
      ordinal: cursor,
      bytes: value,
      chunkDigest: text(row.chunk_digest, "content_chunks.chunk_digest"),
    }));
    hasMore = integer(row.has_more, "content_chunks.has_more") === 1;
  }
  return Object.freeze({ contentId, afterOrdinal, chunks: Object.freeze(chunks), nextOrdinal: hasMore ? cursor : null });
}

function query(db: Database, sql: string, bind?: readonly BindValue[]): Row[] {
  return db.exec(sql, {
    ...(bind === undefined ? {} : { bind }),
    rowMode: "object",
    returnValue: "resultRows",
  }) as Row[];
}

function one(db: Database, sql: string, bind?: readonly BindValue[]): Row | undefined {
  return query(db, sql, bind)[0];
}

function requiredRow(row: Row | undefined, name: string): Row {
  if (row === undefined) throw new Error(`${name} is missing from the current Record.`);
  return row;
}

function text(value: SqlValue | undefined, field: string): string {
  if (typeof value === "string") return value;
  throw new Error(`${field} is not text in the current Record.`);
}

function optionalText(value: SqlValue | undefined, field: string): string | undefined {
  return value === null || value === undefined ? undefined : text(value, field);
}

function integer(value: SqlValue | undefined, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error(`${field} is not an integer in the current Record.`);
  }
  return value;
}

function bytes(value: SqlValue | undefined, field: string): Uint8Array {
  if (value instanceof Uint8Array) return value.slice();
  if (value instanceof Int8Array) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  throw new Error(`${field} is not a blob in the current Record.`);
}

function ownerKind(value: SqlValue | undefined, field: string): RecordOwnerKind {
  const kind = text(value, field);
  if (kind !== "run" && kind !== "attempt") throw new Error(`${field} is not a current Record owner kind.`);
  return kind;
}

function memberAction(value: SqlValue | undefined): "executed" | "carried" | "accepted" | "not-dispatched" | "interrupted" {
  const action = text(value, "members.action");
  if (action !== "executed" && action !== "carried" && action !== "accepted" &&
      action !== "not-dispatched" && action !== "interrupted") {
    throw new Error("members.action is not current in the Record.");
  }
  return action;
}

function requirePageSize(pageSize: number, maximum: number): void {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > maximum) {
    throw new Error(`Page size must be between 1 and ${maximum}.`);
  }
}

function requireOrdinal(afterOrdinal: number): void {
  if (!Number.isSafeInteger(afterOrdinal) || afterOrdinal < -1) {
    throw new Error("afterOrdinal must be -1 or greater.");
  }
}
