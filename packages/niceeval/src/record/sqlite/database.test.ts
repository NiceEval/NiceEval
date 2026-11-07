// cases: docs/engineering/testing/architecture/unit/record.md
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import {
  closeRecordDatabase,
  inspectProjectRecordDatabase,
  makeProjectDatabasePortable,
  openRecordReader,
  openRecordWriter,
  reopenProjectDatabase,
} from "./database.ts";
import { beginRun, findSourceBarrierCandidate } from "./storage.ts";
import { createRunResourceOnConnection, currentPublicationCutoffOnConnection, readRunResourceOnConnection } from "../../run/storage/sqlite.ts";
import { currentProcessOwnerIdentity } from "../../coordination/platform/node-process-identity.ts";

const roots: string[] = [];

async function databasePath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "niceeval-project-database-"));
  roots.push(root);
  return join(root, "record.sqlite");
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("ProjectDatabase bootstrap baseline", () => {
  it("classifies the sole 0.17 metadata namespace as unsupported and rejects mixed namespaces", async () => {
    const path = await databasePath();
    await copyFile(resolve("e2e/record/fixtures/record-migration/predecessors/0.17/record.sqlite"), path);
    expect(inspectProjectRecordDatabase(path)).toEqual({
      state: "unsupported",
      format: "niceeval.project-database/0.17",
    });

    const db = new DatabaseSync(path);
    db.exec("CREATE TABLE record_metadata(singleton INTEGER PRIMARY KEY)");
    db.close();
    expect(inspectProjectRecordDatabase(path)).toEqual({ state: "foreign" });
  });

  it.each([
    ["existing empty SQLite", (db: DatabaseSync) => undefined],
    ["partial schema", (db: DatabaseSync) => db.exec("CREATE TABLE record_metadata(singleton INTEGER PRIMARY KEY)")],
  ])("rejects %s without repairing it", async (_label, arrange) => {
    const path = await databasePath();
    const db = new DatabaseSync(path);
    arrange(db);
    db.close();
    const before = readFileSync(path);

    expect(() => openRecordWriter(path)).toThrow();
    expect(readFileSync(path).equals(before), "rejected database bytes stay unchanged").toBe(true);
  });

  it.each([
    ["unknown object", (db: DatabaseSync) => db.exec("CREATE TABLE injected(value TEXT)")],
    ["old revision", (db: DatabaseSync) => db.exec("UPDATE ne19_record_metadata SET storage_revision=99")],
    ["forged fingerprint", (db: DatabaseSync) => db.exec(`UPDATE ne19_record_metadata SET schema_fingerprint='${"0".repeat(64)}'`)],
  ])("fails closed for %s", async (_label, corrupt) => {
    const path = await databasePath();
    closeRecordDatabase(openRecordWriter(path));
    const db = new DatabaseSync(path);
    corrupt(db);
    db.close();
    const before = readFileSync(path);

    expect(() => openRecordReader(path)).toThrow();
    // Compare bytes natively: deep equality enumerates every Buffer index and
    // can exhaust the test deadline under default parallel suite load.
    expect(readFileSync(path).equals(before), "rejected database bytes stay unchanged").toBe(true);
  });
});

describe("ProjectDatabase source barriers", () => {
  it("orders resource-less history by canonical Run bytes without hiding malformed expected membership", async () => {
    const writer = openRecordWriter(await databasePath());
    try {
      const seedLegacy = (runId: string, expected: Uint8Array) => {
        writer.db.prepare(`INSERT INTO ne19_runs(run_id,experiment_id,status,writer_generation,started_at,core_payload,core_digest,
          mutation_sequence,candidate_seal_identity,candidate_seal_entry_count,candidate_seal_staged_count,logical_seal_identity)
          VALUES (?,'legacy','open','legacy-writer','2026-01-01T00:00:00.000Z',NULL,NULL,0,NULL,NULL,0,NULL)`)
          .run(runId);
        writer.db.prepare("INSERT INTO ne19_slots(run_id,slot_id,ordinal,core_payload,core_digest) VALUES (?,'slot',0,?,?)")
          .run(runId, expected, "c".repeat(64));
        writer.db.prepare(`UPDATE ne19_runs SET status='sealed',core_payload=?,core_digest=?,candidate_seal_identity=?,
          candidate_seal_entry_count=0,logical_seal_identity=? WHERE run_id=?`)
          .run(Buffer.from("{}"), "a".repeat(64), "b".repeat(64), "b".repeat(64), runId);
      };
      const expected = Buffer.from(JSON.stringify({ slotId: "slot", evalId: "eval", attemptOrdinal: 0, executionIdentityDigest: "a".repeat(64) }));
      seedLegacy("legacy-a", expected);
      seedLegacy("legacy-z", expected);
      expect(findSourceBarrierCandidate(writer, { experimentId: "legacy", evalId: "eval", attemptOrdinal: 0 }, 0))
        .toEqual({ runId: "legacy-z", createdRevision: 0 });
      seedLegacy("legacy-zz", Buffer.from("{"));
      expect(findSourceBarrierCandidate(writer, { experimentId: "legacy", evalId: "eval", attemptOrdinal: 0 }, 0)?.runId).toBe("legacy-zz");
      expect(findSourceBarrierCandidate(writer, { experimentId: "legacy", evalId: "other", attemptOrdinal: 1 }, 0)?.runId).toBe("legacy-zz");
    } finally {
      closeRecordDatabase(writer);
    }
  });

  it("keeps empty active barriers at their publication cutoff and selects ordinals independently", async () => {
    const path = await databasePath();
    const writer = openRecordWriter(path);
    try {
      createRunResourceOnConnection(writer, {
        runId: "run-z", experimentId: "experiment", invocationId: "invocation-old", writerGeneration: "writer-z",
        startedAt: "2030-01-01T00:00:00.000Z",
        expectedSlots: [0, 1].map((attemptOrdinal) => ({ slotId: `old-${attemptOrdinal}`, evalId: "eval", attemptOrdinal, executionIdentityDigest: "a".repeat(64) })),
        deadlineEpochMs: Date.now() + 5_000,
      });
      const before = currentPublicationCutoffOnConnection(writer);
      createRunResourceOnConnection(writer, {
        runId: "run-a", experimentId: "experiment", invocationId: "invocation-new", writerGeneration: "writer-a",
        startedAt: "2020-01-01T00:00:00.000Z",
        expectedSlots: [{ slotId: "new-0", evalId: "eval", attemptOrdinal: 0, executionIdentityDigest: "a".repeat(64) }],
        deadlineEpochMs: Date.now() + 5_000,
      });
      createRunResourceOnConnection(writer, {
        runId: "run-unrelated", experimentId: "unrelated", invocationId: "invocation-other", writerGeneration: "writer-other",
        startedAt: "2040-01-01T00:00:00.000Z",
        expectedSlots: [{ slotId: "other-0", evalId: "eval", attemptOrdinal: 0, executionIdentityDigest: "a".repeat(64) }],
        deadlineEpochMs: Date.now() + 5_000,
      });
      const now = currentPublicationCutoffOnConnection(writer);
      expect(readRunResourceOnConnection(writer, "run-a", now)).toMatchObject({ state: "active", published: 0 });
      expect(findSourceBarrierCandidate(writer, { experimentId: "experiment", evalId: "eval", attemptOrdinal: 0 }, before.revision)?.runId).toBe("run-z");
      expect(findSourceBarrierCandidate(writer, { experimentId: "experiment", evalId: "eval", attemptOrdinal: 0 }, now.revision)?.runId).toBe("run-a");
      expect(findSourceBarrierCandidate(writer, { experimentId: "experiment", evalId: "eval", attemptOrdinal: 1 }, now.revision)?.runId).toBe("run-z");
      expect(findSourceBarrierCandidate(writer, { experimentId: "experiment", evalId: "eval", attemptOrdinal: 0, excludeRunId: "run-a" }, now.revision)?.runId).toBe("run-z");
      expect(findSourceBarrierCandidate(writer, { experimentId: "experiment", evalId: "missing", attemptOrdinal: 0 }, now.revision)).toBeUndefined();
    } finally {
      closeRecordDatabase(writer);
    }
  });
});

describe("ProjectDatabase portable gate", () => {
  function seedDrainingOwner(path: string, owner: { host: string; pid: number; bootId: string; processStart: string }): void {
    const writer = openRecordWriter(path);
    writer.db.prepare("UPDATE ne19_record_metadata SET barrier_state='draining',portable_gate_id='abandoned-gate' WHERE singleton=1").run();
    writer.db.prepare(`UPDATE ne19_coordination_state SET barrier_id='abandoned-gate',barrier_nonce='abandoned-nonce',
      barrier_host=?,barrier_pid=?,barrier_boot_id=?,barrier_process_start=?,barrier_deadline=1,
      barrier_requested_at=1,barrier_lease_expires_at=1,barrier_status='active',barrier_active_at=1
      WHERE singleton=1`).run(owner.host, owner.pid, owner.bootId, owner.processStart);
    closeRecordDatabase(writer);
  }

  it("recovers an abandoned draining gate only from exact local death proof", async () => {
    const path = await databasePath();
    const local = currentProcessOwnerIdentity();
    closeRecordDatabase(openRecordWriter(path));
    seedDrainingOwner(path, { ...local, pid: 2_147_483_647, processStart: "1" });

    expect(makeProjectDatabasePortable(path)).toBe(true);
    const reader = openRecordReader(path);
    expect(reader.db.prepare("SELECT barrier_state FROM ne19_record_metadata WHERE singleton=1").get())
      .toMatchObject({ barrier_state: "portable" });
    closeRecordDatabase(reader);
  });

  it("fails closed for an expired draining gate whose owner is remote unknown", async () => {
    const path = await databasePath();
    closeRecordDatabase(openRecordWriter(path));
    seedDrainingOwner(path, { host: "remote.example", pid: 42, bootId: "remote-boot", processStart: "1" });

    expect(() => makeProjectDatabasePortable(path)).toThrow(/not proven dead/u);
    const reader = openRecordReader(path);
    expect(reader.db.prepare("SELECT barrier_state,portable_gate_id FROM ne19_record_metadata WHERE singleton=1").get())
      .toMatchObject({ barrier_state: "draining", portable_gate_id: "abandoned-gate" });
    closeRecordDatabase(reader);
  });

  it("allows the same exact process to fence and retry its timed-out draining gate", async () => {
    const path = await databasePath();
    const local = currentProcessOwnerIdentity();
    closeRecordDatabase(openRecordWriter(path));
    seedDrainingOwner(path, local);

    expect(makeProjectDatabasePortable(path)).toBe(true);
  });

  it("fences the old generation and only a new Run reopens a portable database", async () => {
    const path = await databasePath();
    const writer = openRecordWriter(path);
    beginRun(writer, { experimentId: "test",
      runId: "run-old",
      writerGeneration: "generation-old",
      startedAt: "2026-01-01T00:00:00.000Z",
      deadlineEpochMs: Date.now() + 5_000,
    });
    writer.db.exec("DELETE FROM ne19_runs WHERE run_id='run-old'");
    closeRecordDatabase(writer);

    expect(makeProjectDatabasePortable(path)).toBe(true);
    const portable = openRecordReader(path);
    expect(portable.db.prepare("SELECT barrier_state FROM ne19_record_metadata WHERE singleton=1").get())
      .toMatchObject({ barrier_state: "portable" });
    closeRecordDatabase(portable);

    reopenProjectDatabase(path);
    const reopened = openRecordWriter(path);
    expect(() => beginRun(reopened, { experimentId: "test",
      runId: "run-new",
      writerGeneration: "generation-new",
      startedAt: "2026-01-02T00:00:00.000Z",
      deadlineEpochMs: Date.now() + 5_000,
    })).not.toThrow();
    expect(() => beginRun(reopened, { experimentId: "test",
      runId: "run-new",
      writerGeneration: "generation-old",
      startedAt: "2026-01-02T00:00:00.000Z",
      deadlineEpochMs: Date.now() + 5_000,
    })).toThrow();
    closeRecordDatabase(reopened);
  });

  it("securely scrubs unpublished bytes and truncates SQLite side files", async () => {
    const path = await databasePath();
    closeRecordDatabase(openRecordWriter(path));
    const pinnedReader = openRecordReader(path);
    pinnedReader.db.exec("BEGIN");
    pinnedReader.db.prepare("SELECT count(*) FROM ne19_runs").get();
    const rowCanary = `row-canary-${crypto.randomUUID()}`;
    const blobMarker = Buffer.from(`blob-canary-${crypto.randomUUID()}`);
    const canary = Buffer.alloc(2 * 1024 * 1024);
    for (let offset = 0; offset < canary.byteLength; offset += blobMarker.byteLength) {
      blobMarker.copy(canary, offset);
    }
    const writer = openRecordWriter(path);
    writer.db.prepare(`INSERT INTO ne19_runs(run_id,experiment_id,status,writer_generation,started_at,core_payload,core_digest,
      mutation_sequence,candidate_seal_identity,candidate_seal_entry_count,candidate_seal_staged_count,logical_seal_identity)
      VALUES (?,'test','open','scrub-generation','2026-01-01T00:00:00.000Z',NULL,NULL,0,NULL,NULL,0,NULL)`).run(rowCanary);
    writer.db.prepare(`INSERT INTO ne19_attachments(attachment_id,owner_kind,owner_run_id,owner_attempt_id,family,family_revision,
      logical_identity,canonical_payload,canonical_digest,logical_inventory,inventory_digest)
      VALUES ('scrub-attachment','run',?,NULL,'canary',1,'canary',?,?,?,?)`).run(
      rowCanary,
      canary,
      "a".repeat(64),
      Buffer.from("{}"),
      "b".repeat(64),
    );
    closeRecordDatabase(writer);
    expect(existsSync(`${path}-wal`)).toBe(true);
    pinnedReader.db.exec("ROLLBACK");
    closeRecordDatabase(pinnedReader);

    expect(makeProjectDatabasePortable(path)).toBe(true);
    for (const name of readdirSync(join(path, ".."))) {
      const bytes = readFileSync(join(path, "..", name));
      expect(bytes.indexOf(Buffer.from(rowCanary)), `${name}: row canary`).toBe(-1);
      expect(bytes.indexOf(blobMarker), `${name}: blob canary`).toBe(-1);
    }
  });
});
