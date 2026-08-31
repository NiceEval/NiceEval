// cases: docs/engineering/testing/unit/record.md
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import {
  closeRecordDatabase,
  makeProjectDatabasePortable,
  openRecordReader,
  openRecordWriter,
  reopenProjectDatabase,
} from "./database.ts";
import { beginRun } from "./storage.ts";
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
    expect(readFileSync(path)).toEqual(before);
  });

  it.each([
    ["unknown object", (db: DatabaseSync) => db.exec("CREATE TABLE injected(value TEXT)")],
    ["old revision", (db: DatabaseSync) => db.exec("UPDATE record_metadata SET storage_revision=99")],
    ["forged fingerprint", (db: DatabaseSync) => db.exec(`UPDATE record_metadata SET schema_fingerprint='${"0".repeat(64)}'`)],
  ])("fails closed for %s", async (_label, corrupt) => {
    const path = await databasePath();
    closeRecordDatabase(openRecordWriter(path));
    const db = new DatabaseSync(path);
    corrupt(db);
    db.close();
    const before = readFileSync(path);

    expect(() => openRecordReader(path)).toThrow();
    expect(readFileSync(path)).toEqual(before);
  });
});

describe("ProjectDatabase portable gate", () => {
  function seedDrainingOwner(path: string, owner: { host: string; pid: number; bootId: string; processStart: string }): void {
    const writer = openRecordWriter(path);
    writer.db.prepare("UPDATE record_metadata SET barrier_state='draining',portable_gate_id='abandoned-gate' WHERE singleton=1").run();
    writer.db.prepare(`UPDATE coordination_state SET barrier_id='abandoned-gate',barrier_nonce='abandoned-nonce',
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
    expect(reader.db.prepare("SELECT barrier_state FROM record_metadata WHERE singleton=1").get())
      .toMatchObject({ barrier_state: "portable" });
    closeRecordDatabase(reader);
  });

  it("fails closed for an expired draining gate whose owner is remote unknown", async () => {
    const path = await databasePath();
    closeRecordDatabase(openRecordWriter(path));
    seedDrainingOwner(path, { host: "remote.example", pid: 42, bootId: "remote-boot", processStart: "1" });

    expect(() => makeProjectDatabasePortable(path)).toThrow(/not proven dead/u);
    const reader = openRecordReader(path);
    expect(reader.db.prepare("SELECT barrier_state,portable_gate_id FROM record_metadata WHERE singleton=1").get())
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
    beginRun(writer, {
      runId: "run-old",
      writerGeneration: "generation-old",
      startedAt: "2026-01-01T00:00:00.000Z",
      deadlineEpochMs: Date.now() + 5_000,
    });
    writer.db.exec("DELETE FROM runs WHERE run_id='run-old'");
    closeRecordDatabase(writer);

    expect(makeProjectDatabasePortable(path)).toBe(true);
    const portable = openRecordReader(path);
    expect(portable.db.prepare("SELECT barrier_state FROM record_metadata WHERE singleton=1").get())
      .toMatchObject({ barrier_state: "portable" });
    closeRecordDatabase(portable);

    reopenProjectDatabase(path);
    const reopened = openRecordWriter(path);
    expect(() => beginRun(reopened, {
      runId: "run-new",
      writerGeneration: "generation-new",
      startedAt: "2026-01-02T00:00:00.000Z",
      deadlineEpochMs: Date.now() + 5_000,
    })).not.toThrow();
    expect(() => beginRun(reopened, {
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
    pinnedReader.db.prepare("SELECT count(*) FROM runs").get();
    const rowCanary = `row-canary-${crypto.randomUUID()}`;
    const blobMarker = Buffer.from(`blob-canary-${crypto.randomUUID()}`);
    const canary = Buffer.alloc(2 * 1024 * 1024);
    for (let offset = 0; offset < canary.byteLength; offset += blobMarker.byteLength) {
      blobMarker.copy(canary, offset);
    }
    const writer = openRecordWriter(path);
    writer.db.prepare(`INSERT INTO runs(run_id,status,writer_generation,started_at,core_payload,core_digest,
      mutation_sequence,candidate_seal_identity,candidate_seal_entry_count,candidate_seal_staged_count,logical_seal_identity)
      VALUES (?,'open','scrub-generation','2026-01-01T00:00:00.000Z',NULL,NULL,0,NULL,NULL,0,NULL)`).run(rowCanary);
    writer.db.prepare(`INSERT INTO attachments(attachment_id,owner_kind,owner_run_id,owner_attempt_id,family,family_revision,
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
