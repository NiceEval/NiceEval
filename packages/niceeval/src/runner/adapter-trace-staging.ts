import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { setImmediate } from "node:timers/promises";
import type {
  ExecutionTraceEventRecord,
  ExecutionTraceHeaderRecord,
  ExecutionTraceScopeRecord,
} from "../record/family/execution-traces/schema.ts";
import { isSqliteBusy } from "../record/sqlite/errors.ts";

type TraceItem = ExecutionTraceEventRecord | ExecutionTraceScopeRecord;
const INLINE_BYTES = 64 * 1024;
const CONTENT_CHUNK_BYTES = 64 * 1024;

export interface VerifiedEvidenceTarget {
  readonly artifactSha256: string;
  readonly targetSha256: string;
  readonly targetByteLength: number;
}

export interface TraceEvidenceCache {
  get(key: string): VerifiedEvidenceTarget | undefined;
  set(key: string, value: VerifiedEvidenceTarget): void;
}

export interface StagedTraceItem {
  readonly sequence: number;
  readonly record: TraceItem;
  readonly canonical: string;
  readonly encoded: string;
}

function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error("Invalid execution trace staging count.");
  }
  return value;
}

export class InvalidStagedTrace extends Error {}

/** Each reservation has a private, disk-backed database, automatically removed on close or process exit. */
export class AdapterTraceStaging {
  private readonly db = new DatabaseSync("");
  private readonly insert;
  private readonly lookup;
  private readonly insertId;
  private readonly insertReference;
  private readonly resolveReferences;
  private readonly insertClock;
  private readonly clock;
  private readonly batch;
  private readonly insertBatch;
  private readonly insertChunk;
  private readonly contentChunks;
  private readonly verifiedEvidence;
  private readonly insertVerifiedEvidence;
  requiresArtifactVerification = false;

  constructor() {
    try {
      this.db.exec(
        "PRAGMA cache_size=-2048; PRAGMA busy_timeout=500; " +
          "CREATE TABLE item (sequence INTEGER PRIMARY KEY, kind TEXT NOT NULL, key TEXT NOT NULL, " +
          "canonical TEXT, encoded TEXT, evidence INTEGER NOT NULL, UNIQUE(kind,key)); " +
          "CREATE TABLE content (sequence INTEGER NOT NULL, field TEXT NOT NULL, ordinal INTEGER NOT NULL, " +
          "bytes BLOB NOT NULL, PRIMARY KEY(sequence,field,ordinal)) WITHOUT ROWID; " +
          "CREATE TABLE reference (source INTEGER NOT NULL, kind TEXT NOT NULL, key TEXT NOT NULL, " +
          "target INTEGER, cause INTEGER NOT NULL); " +
          "CREATE INDEX reference_pending ON reference(kind,key) WHERE target IS NULL; " +
          "CREATE INDEX reference_source ON reference(source); " +
          "CREATE INDEX reference_target ON reference(target,source); " +
          "CREATE INDEX cause_source ON reference(source,target) WHERE cause=1; " +
          "CREATE INDEX cause_target ON reference(target,source) WHERE cause=1; " +
          "CREATE TABLE id (value TEXT PRIMARY KEY, source INTEGER NOT NULL) WITHOUT ROWID; " +
          "CREATE INDEX id_source ON id(source); " +
          "CREATE TABLE clock (id TEXT PRIMARY KEY, unit TEXT NOT NULL) WITHOUT ROWID; " +
          "CREATE TABLE batch (first INTEGER PRIMARY KEY, length INTEGER NOT NULL, digest TEXT NOT NULL); " +
          "CREATE TABLE snapshot (singleton INTEGER PRIMARY KEY CHECK(singleton=1), " +
          "prefix INTEGER NOT NULL, header TEXT NOT NULL, digest TEXT NOT NULL); " +
          "CREATE TABLE verified (phase TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, " +
          "PRIMARY KEY(phase,key)) WITHOUT ROWID; " +
          "CREATE TABLE degree (sequence INTEGER PRIMARY KEY, pending INTEGER NOT NULL); " +
          "CREATE INDEX ready ON degree(sequence) WHERE pending=0",
      );
      this.insert = this.db.prepare("INSERT OR IGNORE INTO item VALUES (?,?,?,?,?,?)");
      this.lookup = this.db.prepare("SELECT sequence FROM item WHERE kind=? AND key=?");
      this.insertId = this.db.prepare("INSERT INTO id VALUES (?,?)");
      this.insertReference = this.db.prepare("INSERT INTO reference VALUES (?,?,?,?,?)");
      this.resolveReferences = this.db.prepare(
        "UPDATE reference SET target=? WHERE target IS NULL AND kind=? AND key=?",
      );
      this.insertClock = this.db.prepare("INSERT OR IGNORE INTO clock VALUES (?,?)");
      this.clock = this.db.prepare("SELECT unit FROM clock WHERE id=?");
      this.batch = this.db.prepare("SELECT digest,length FROM batch WHERE first=?");
      this.insertBatch = this.db.prepare("INSERT INTO batch VALUES (?,?,?)");
      this.insertChunk = this.db.prepare("INSERT INTO content VALUES (?,?,?,?)");
      this.contentChunks = this.db.prepare("SELECT bytes FROM content WHERE sequence=? AND field=? ORDER BY ordinal");
      this.verifiedEvidence = this.db.prepare("SELECT value FROM verified WHERE phase=? AND key=?");
      this.insertVerifiedEvidence = this.db.prepare("INSERT OR IGNORE INTO verified VALUES (?,?,?)");
    } catch (cause) {
      this.db.close();
      throw cause;
    }
  }

  append(items: readonly StagedTraceItem[]): void {
    const first = items[0];
    if (first === undefined) return;
    const hash = createHash("sha256");
    for (const { canonical, encoded } of items) hash.update(canonical).update("\n").update(encoded).update("\n");
    const digest = hash.digest("hex");
    for (let retries = 0; ; retries += 1) {
      try {
        this.commitBatch(items, first.sequence, digest);
        return;
      } catch (cause) {
        if (retries >= 2 || !isSqliteBusy(cause)) throw cause;
      }
    }
  }

  private commitBatch(items: readonly StagedTraceItem[], first: number, digest: string): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const previous = this.batch.get(first);
      if (previous === undefined) {
        for (const item of items) this.appendItem(item);
        this.insertBatch.run(first, items.length, digest);
      } else if (previous.digest !== digest || previous.length !== items.length) {
        throw new Error("Execution trace batch retry changed its frozen content.");
      }
      this.db.exec("COMMIT");
    } catch (cause) {
      if (this.db.isTransaction) this.db.exec("ROLLBACK");
      throw cause;
    }
  }

  private appendItem({ sequence, record, canonical, encoded }: StagedTraceItem): void {
    const key = record.kind === "scope" ? record.scope.scopeId : record.key;
    const evidence = record.kind === "event" ? record.evidence.length : 0;
    const inlineCanonical = Buffer.byteLength(canonical) <= INLINE_BYTES ? canonical : null;
    const inlineEncoded = Buffer.byteLength(encoded) <= INLINE_BYTES ? encoded : null;
    if (this.insert.run(sequence, record.kind, key, inlineCanonical, inlineEncoded, evidence).changes === 0) {
      throw new InvalidStagedTrace("Execution trace contains a duplicate event key or scopeId.");
    }
    if (inlineCanonical === null) this.storeContent(sequence, "canonical", canonical);
    if (inlineEncoded === null) this.storeContent(sequence, "encoded", encoded);
    this.resolveReferences.run(sequence, record.kind, key);
    if (record.kind === "scope") return;
    this.requiresArtifactVerification ||=
      evidence !== 0 || record.display?.some(({ kind }) => kind === "image") === true;
    this.insertId.run(record.eventId, sequence);
    for (const item of record.evidence) this.insertId.run(item.evidenceId, sequence);
    if (record.time !== undefined) {
      const { clockId, unit } = record.time;
      if (this.insertClock.run(clockId, unit).changes === 0 && this.clock.get(clockId)?.unit !== unit) {
        throw new InvalidStagedTrace("A trace clockId must use one unit.");
      }
    }
    for (const link of record.links) {
      if ("targetKey" in link) this.reference(sequence, "event", link.targetKey, link.relation === "causes");
    }
    for (const membership of record.scopeMemberships) this.reference(sequence, "scope", membership.scopeId, false);
  }

  private storeContent(sequence: number, field: string, text: string): void {
    const raw = Buffer.from(text, "utf8");
    let ordinal = 0;
    for (let offset = 0; offset < raw.byteLength; offset += CONTENT_CHUNK_BYTES) {
      this.insertChunk.run(sequence, field, ordinal++, raw.subarray(offset, offset + CONTENT_CHUNK_BYTES));
    }
  }

  private readContent(sequence: number, field: string): string {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let value = "";
    for (const { bytes } of this.contentChunks.iterate(sequence, field)) {
      if (!(bytes instanceof Uint8Array)) throw new Error("Execution trace staging content is invalid.");
      value += decoder.decode(bytes, { stream: true });
    }
    return value + decoder.decode();
  }

  evidenceCache(phase: "capture" | "publication"): TraceEvidenceCache {
    return {
      get: (key) => {
        const row = this.verifiedEvidence.get(phase, key);
        return row === undefined ? undefined : (JSON.parse(String(row.value)) as VerifiedEvidenceTarget);
      },
      set: (key, value) => {
        this.insertVerifiedEvidence.run(phase, key, JSON.stringify(value));
      },
    };
  }

  private reference(source: number, kind: TraceItem["kind"], key: string, cause: boolean): void {
    const target = this.lookup.get(kind, key)?.sequence ?? null;
    this.insertReference.run(source, kind, key, target, Number(cause));
  }

  async prefix(total: number, declared: boolean): Promise<number> {
    const missing = this.db.prepare("SELECT min(source) AS first FROM reference WHERE target IS NULL").get()?.first;
    if (missing === null) return total;
    if (declared) throw new InvalidStagedTrace("Execution trace references a missing event or scope.");
    const inbound = this.db.prepare(
      "SELECT min(source) AS first FROM reference WHERE target>=? AND target<? AND source<?",
    );
    let end = count(missing);
    let upper = total;
    let iterations = 0;
    for (;;) {
      const earlier = inbound.get(end, upper, end)?.first;
      if (earlier === null) return end;
      upper = end;
      end = count(earlier);
      if (++iterations % 64 === 0) await setImmediate();
    }
  }

  async verifyCauses(end: number): Promise<void> {
    if (this.db.prepare("SELECT 1 FROM reference WHERE cause=1 AND source<? LIMIT 1").get(end) === undefined) return;
    this.db.exec("BEGIN");
    try {
      this.db
        .prepare(
          "INSERT INTO degree SELECT sequence, (SELECT count(*) FROM reference " +
            "WHERE cause=1 AND target=sequence AND source<?) FROM item WHERE kind='event' AND sequence<?",
        )
        .run(end, end);
      this.db.exec("COMMIT");
    } catch (cause) {
      this.db.exec("ROLLBACK");
      throw cause;
    }
    const ready = this.db.prepare("SELECT sequence FROM degree WHERE pending=0 ORDER BY sequence LIMIT 64");
    const decrement = this.db.prepare(
      "UPDATE degree SET pending=pending-(SELECT count(*) FROM reference WHERE cause=1 AND source=? AND target=sequence) " +
        "WHERE sequence IN (SELECT target FROM reference WHERE cause=1 AND source=?)",
    );
    const remove = this.db.prepare("DELETE FROM degree WHERE sequence=?");
    for (;;) {
      const batch = ready.all();
      if (batch.length === 0) break;
      this.db.exec("BEGIN");
      try {
        for (const { sequence } of batch) {
          const ordinal = count(sequence);
          decrement.run(ordinal, ordinal);
          remove.run(ordinal);
        }
        this.db.exec("COMMIT");
      } catch (cause) {
        this.db.exec("ROLLBACK");
        throw cause;
      }
      await setImmediate();
    }
    if (this.db.prepare("SELECT 1 FROM degree LIMIT 1").get() !== undefined) {
      throw new InvalidStagedTrace("Execution trace causes links must be acyclic.");
    }
  }

  counts(end: number): { readonly scopeCount: number; readonly eventCount: number; readonly evidenceCount: number } {
    const result = this.db
      .prepare(
        "SELECT count(*) AS total,coalesce(sum(kind='event'),0) AS events,coalesce(sum(evidence),0) AS evidence " +
          "FROM item WHERE sequence<?",
      )
      .get(end);
    const eventCount = count(result?.events);
    return { scopeCount: count(result?.total) - eventCount, eventCount, evidenceCount: count(result?.evidence) };
  }

  *canonical(kind: TraceItem["kind"], end: number): Generator<string> {
    for (const row of this.db
      .prepare("SELECT sequence,canonical FROM item WHERE sequence<? AND kind=? ORDER BY sequence")
      .iterate(end, kind)) {
      yield typeof row.canonical === "string" ? row.canonical : this.readContent(count(row.sequence), "canonical");
    }
  }

  async accept(end: number, total: number, header: string, digest: string): Promise<void> {
    if (end < total) {
      const deleteItems = this.db.prepare("DELETE FROM item WHERE sequence>=? AND sequence<?");
      const deleteContent = this.db.prepare("DELETE FROM content WHERE sequence>=? AND sequence<?");
      const deleteReferences = this.db.prepare("DELETE FROM reference WHERE source>=? AND source<?");
      const deleteIds = this.db.prepare("DELETE FROM id WHERE source>=? AND source<?");
      for (let start = end; start < total; start += 64) {
        this.db.exec("BEGIN");
        try {
          const stop = start + 64;
          deleteItems.run(start, stop);
          deleteContent.run(start, stop);
          deleteReferences.run(start, stop);
          deleteIds.run(start, stop);
          this.db.exec("COMMIT");
        } catch (cause) {
          if (this.db.isTransaction) this.db.exec("ROLLBACK");
          throw cause;
        }
        if (start + 64 < total) await setImmediate();
      }
    }
    this.db.prepare("INSERT INTO snapshot VALUES (1,?,?,?)").run(end, header, digest);
  }

  *records(): Generator<ExecutionTraceHeaderRecord | TraceItem> {
    const snapshot = this.db.prepare("SELECT prefix,header FROM snapshot").get();
    if (snapshot === undefined) throw new Error("Execution trace staging has not been accepted.");
    yield JSON.parse(String(snapshot.header)) as ExecutionTraceHeaderRecord;
    for (const row of this.db
      .prepare("SELECT sequence,encoded FROM item WHERE sequence<? ORDER BY sequence")
      .iterate(count(snapshot.prefix))) {
      const value = typeof row.encoded === "string" ? row.encoded : this.readContent(count(row.sequence), "encoded");
      yield JSON.parse(value) as TraceItem;
    }
  }

  close(): void {
    if (this.db.isOpen) this.db.close();
  }
}
