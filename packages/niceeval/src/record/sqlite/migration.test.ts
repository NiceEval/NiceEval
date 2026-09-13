// cases: docs/engineering/testing/unit/record.md
import { createHash } from "node:crypto";
import { copyFile, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { canonicalRecordJsonText, type RecordJsonObject } from "../definition/index.ts";
import { migrateLegacyRunBytes } from "../codec/legacy-run-context.ts";
import { migrateHostOwnedProjectDatabase, projectDatabaseMigrationBackupPath } from "./migration.ts";
import { closeRecordDatabase, openRecordReader } from "./database.ts";
import { exactLogicalSealIdentity, runSealEntry } from "./seal.ts";
import type { SealEntry } from "./types.ts";

type HistoricalFixture = "0.15" | "0.16" | "0.17" | "0.15-hooks" | "0.17-nohooks";

async function withHistoricalDatabase(version: HistoricalFixture, body: (path: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "niceeval-migration-fence-"));
  const path = join(root, "record.sqlite");
  try {
    await copyFile(resolve("e2e/record/fixtures/record-migration/predecessors", version, "record.sqlite"), path);
    await body(path);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function installInvalid017RunCore(db: DatabaseSync): void {
  const row = db.prepare(`SELECT run_id,writer_generation,started_at,core_payload
    FROM ne_runs LIMIT 1`).get();
  if (typeof row?.run_id !== "string" || typeof row.writer_generation !== "string" ||
    typeof row.started_at !== "string" || !(row.core_payload instanceof Uint8Array)) {
    throw new Error("0.17 fixture lacks a sealed Run Core");
  }
  const core = JSON.parse(Buffer.from(row.core_payload).toString("utf8")) as RecordJsonObject;
  const execution = (core.context as RecordJsonObject).execution as unknown as Record<string, unknown>;
  execution.experimentHooks = { version: 2, setup: "absent", teardown: "absent" };
  const bytes = Buffer.from(canonicalRecordJsonText(core));
  const coreDigest = createHash("sha256").update(bytes).digest("hex");
  const runEntry = runSealEntry({
    runId: row.run_id,
    writerGeneration: row.writer_generation,
    startedAt: row.started_at,
    coreDigest,
  });
  const entries = db.prepare(`SELECT entry_kind,logical_identity,digest FROM ne_run_seal_entries
    WHERE run_id=? ORDER BY ordinal`).all(row.run_id) as unknown as readonly {
      readonly entry_kind: SealEntry["kind"];
      readonly logical_identity: string;
      readonly digest: string;
    }[];
  const identity = exactLogicalSealIdentity(entries.map((entry) => entry.entry_kind === "run"
    ? runEntry
    : { kind: entry.entry_kind, logicalIdentity: entry.logical_identity, digest: entry.digest }));
  const runTrigger = db.prepare("SELECT sql FROM sqlite_schema WHERE type='trigger' AND name='ne_runs_sealed_update'").get()?.sql;
  const sealTrigger = db.prepare("SELECT sql FROM sqlite_schema WHERE type='trigger' AND name='ne_seal_entries_sealed_update'").get()?.sql;
  if (typeof runTrigger !== "string" || typeof sealTrigger !== "string") throw new Error("0.17 fixture lost immutable triggers");
  db.exec("BEGIN; DROP TRIGGER ne_runs_sealed_update; DROP TRIGGER ne_seal_entries_sealed_update");
  db.prepare("UPDATE ne_runs SET core_payload=?,core_digest=?,candidate_seal_identity=?,logical_seal_identity=? WHERE run_id=?")
    .run(bytes, coreDigest, identity, identity, row.run_id);
  db.prepare("UPDATE ne_run_seal_entries SET digest=? WHERE run_id=? AND entry_kind='run'")
    .run(runEntry.digest, row.run_id);
  db.exec(runTrigger);
  db.exec(sealTrigger);
  db.exec("COMMIT");
}

function installUnknown017ClosureField(db: DatabaseSync): void {
  const row = db.prepare("SELECT attempt_id,closure_payload FROM ne_attempt_publications LIMIT 1").get();
  if (typeof row?.attempt_id !== "string" || !(row.closure_payload instanceof Uint8Array)) {
    throw new Error("0.17 fixture lacks an Attempt closure");
  }
  const closure = JSON.parse(Buffer.from(row.closure_payload).toString("utf8")) as RecordJsonObject;
  (closure as unknown as Record<string, unknown>).unknownHistoricalField = true;
  const bytes = Buffer.from(canonicalRecordJsonText(closure));
  const digest = createHash("sha256").update(bytes).digest("hex");
  db.prepare("UPDATE ne_attempt_publications SET closure_payload=?,closure_digest=? WHERE attempt_id=?")
    .run(bytes, digest, row.attempt_id);
}

it.each(["0.15", "0.16", "0.17"] as const)("fences a %s idle connection without replacing the database inode", async (version) => {
  await withHistoricalDatabase(version, async (path) => {
    const inode = (await stat(path)).ino;
    const old = new DatabaseSync(path);
    const prefix = version === "0.17" ? "ne_" : "";
    try {
      const statement = old.prepare(`UPDATE ${prefix}record_metadata SET created_at='stale-writer' WHERE singleton=1`);
      await expect(migrateHostOwnedProjectDatabase(path, 0)).resolves.toBe("migrated");
      expect((await stat(path)).ino).toBe(inode);
      expect(() => statement.run()).toThrow();
      expect(() => old.prepare(`UPDATE ${prefix}coordination_state SET revision=revision+1 WHERE singleton=1`).run()).toThrow();
      expect(() => old.prepare(`INSERT INTO ${prefix}coordination_tickets(ticket_id) VALUES ('stale')`).run()).toThrow();
      const current = openRecordReader(path);
      try {
        expect(current.db.prepare("SELECT created_at FROM ne18_record_metadata WHERE singleton=1").get()?.created_at)
          .not.toBe("stale-writer");
      } finally {
        closeRecordDatabase(current);
      }
      await expect(migrateHostOwnedProjectDatabase(path, 0)).resolves.toBe("current");
    } finally {
      old.close();
    }
  });
});

it.each(["0.16", "0.17"] as const)("preserves a committed migration from %s under a pinned old snapshot and completes after the reader releases it", async (version) => {
  await withHistoricalDatabase(version, async (path) => {
    const old = new DatabaseSync(path);
    const prefix = version === "0.17" ? "ne_" : "";
    let closed = false;
    try {
      old.exec("PRAGMA journal_mode=WAL; BEGIN");
      expect(old.prepare(`SELECT format FROM ${prefix}record_metadata WHERE singleton=1`).get()?.format)
        .toBe(`niceeval.project-database/${version}`);
      const staleWrite = old.prepare(`UPDATE ${prefix}record_metadata SET created_at='stale-snapshot' WHERE singleton=1`);
      await expect(migrateHostOwnedProjectDatabase(path, 0)).rejects.toThrow();

      const committed = new DatabaseSync(path, { readOnly: true });
      try {
        expect(committed.prepare("SELECT format FROM ne18_record_metadata WHERE singleton=1").get()?.format)
          .toBe("niceeval.project-database/0.18");
        expect(committed.prepare("SELECT state FROM ne18_migration_state WHERE singleton=1").get()?.state)
          .toBe("committed");
      } finally {
        committed.close();
      }
      expect(() => openRecordReader(path)).toThrow();
      expect(() => staleWrite.run()).toThrow();
      old.exec("ROLLBACK");
      old.close();
      closed = true;

      await expect(migrateHostOwnedProjectDatabase(path, 0)).resolves.toBe("current");
      const current = openRecordReader(path);
      try {
        expect(current.db.prepare("SELECT state FROM ne18_migration_state WHERE singleton=1").get()?.state)
          .toBe("ready");
        expect(current.db.prepare("SELECT created_at FROM ne18_record_metadata WHERE singleton=1").get()?.created_at)
          .not.toBe("stale-snapshot");
      } finally {
        closeRecordDatabase(current);
      }
      const backup = projectDatabaseMigrationBackupPath(path, `niceeval.project-database/${version}`);
      expect((await stat(backup)).isFile()).toBe(true);
      expect((await stat(backup)).mode & 0o777).toBe(0o600);
      expect((await readdir(join(path, ".."))).filter((name) => name.endsWith(".backup"))).toHaveLength(1);
    } finally {
      if (!closed) {
        if (old.isTransaction) old.exec("ROLLBACK");
        old.close();
      }
    }
  });
});

it("rejects a corrupted but valid historical Run payload and rolls back schema conversion", async () => {
  await withHistoricalDatabase("0.15", async (path) => {
    const corrupt = new DatabaseSync(path);
    try {
      const trigger = corrupt.prepare("SELECT sql FROM sqlite_schema WHERE type='trigger' AND name='runs_sealed_update'").get()?.sql;
      if (typeof trigger !== "string") throw new Error("historical fixture lost its update protection");
      const run = corrupt.prepare("SELECT run_id,core_payload FROM runs LIMIT 1").get();
      if (typeof run?.run_id !== "string" || !(run.core_payload instanceof Uint8Array)) throw new Error("historical fixture lacks a Run");
      const source = Buffer.from(run.core_payload).toString("utf8");
      const changed = source.replace("user-flag-application", "corrupt-flag-application");
      expect(changed).not.toBe(source);
      corrupt.exec("BEGIN; DROP TRIGGER runs_sealed_update");
      corrupt.prepare("UPDATE runs SET core_payload=? WHERE run_id=?").run(Buffer.from(changed), run.run_id);
      corrupt.exec(trigger);
      corrupt.exec("COMMIT");
    } finally {
      corrupt.close();
    }
    const before = await readFile(path);
    await expect(migrateHostOwnedProjectDatabase(path, 0)).rejects.toThrow();
    expect(await readFile(path)).toEqual(before);
    const preserved = new DatabaseSync(path, { readOnly: true });
    try {
      expect(preserved.prepare("SELECT format FROM record_metadata WHERE singleton=1").get()?.format)
        .toBe("niceeval.project-database/0.15");
      expect(preserved.prepare("SELECT name FROM sqlite_schema WHERE name='ne18_record_metadata'").get()).toBeUndefined();
    } finally {
      preserved.close();
    }
  });
});

it("preserves an old project while a remote lock owner cannot be proven inactive", async () => {
  await withHistoricalDatabase("0.16", async (path) => {
    const old = new DatabaseSync(path);
    try {
      old.prepare(`INSERT INTO case_locks(case_id,owner_id,owner_generation,owner_host,owner_pid,
        owner_boot_id,owner_process_start,acquired_at,heartbeat_at) VALUES (?,?,?,?,?,?,?,?,?)`)
        .run("locked-case", "remote-owner", 1, "remote.example", 42, "remote-boot", "1",
          "2000-01-01T00:00:00.000Z", "2000-01-01T00:00:00.000Z");
    } finally {
      old.close();
    }
    const before = await readFile(path);
    await expect(migrateHostOwnedProjectDatabase(path, 0)).rejects.toThrow(/active or unknown owner/u);
    expect(await readFile(path)).toEqual(before);
  });
});

it("preserves an unknown ProjectDatabase version instead of guessing an upgrade", async () => {
  await withHistoricalDatabase("0.16", async (path) => {
    const old = new DatabaseSync(path);
    try {
      old.exec("UPDATE record_metadata SET format='niceeval.project-database/99.0' WHERE singleton=1");
    } finally {
      old.close();
    }
    const before = await readFile(path);
    await expect(migrateHostOwnedProjectDatabase(path, 0)).rejects.toThrow();
    expect(await readFile(path)).toEqual(before);
  });
});

it("refuses to replace an unrelated existing backup and leaves the project unchanged", async () => {
  await withHistoricalDatabase("0.15", async (path) => {
    const backup = projectDatabaseMigrationBackupPath(path, "niceeval.project-database/0.15");
    const unrelated = Buffer.from("an existing file owned by the user");
    await writeFile(backup, unrelated, { flag: "wx" });
    const before = await readFile(path);
    await expect(migrateHostOwnedProjectDatabase(path, 0)).rejects.toThrow();
    expect(await readFile(path)).toEqual(before);
    expect(await readFile(backup)).toEqual(unrelated);
  });
});

it("preserves exact 0.17 Core, closure, digest, and Seal bytes while replacing every writable object", async () => {
  await withHistoricalDatabase("0.17", async (path) => {
    const historical = new DatabaseSync(path, { readOnly: true });
    const run = historical.prepare("SELECT run_id,core_payload,core_digest,logical_seal_identity FROM ne_runs").get();
    const closure = historical.prepare("SELECT * FROM ne_attempt_publications").get();
    const bindings = historical.prepare("SELECT * FROM ne_run_slot_bindings ORDER BY target_run_id,slot_id").all();
    const references = historical.prepare("SELECT * FROM ne_attachment_references ORDER BY attachment_id,ordinal").all();
    const seal = historical.prepare("SELECT ordinal,entry_kind,logical_identity,digest FROM ne_run_seal_entries ORDER BY ordinal").all();
    historical.close();

    await expect(migrateHostOwnedProjectDatabase(path, 0)).resolves.toBe("migrated");

    const current = new DatabaseSync(path, { readOnly: true });
    try {
      expect(current.prepare("SELECT run_id,core_payload,core_digest,logical_seal_identity FROM ne18_runs").get()).toEqual(run);
      expect(current.prepare("SELECT * FROM ne18_attempt_publications").get()).toEqual(closure);
      expect(current.prepare("SELECT * FROM ne18_run_slot_bindings ORDER BY target_run_id,slot_id").all()).toEqual(bindings);
      expect(current.prepare("SELECT * FROM ne18_attachment_references ORDER BY attachment_id,ordinal").all()).toEqual(references);
      expect(current.prepare("SELECT ordinal,entry_kind,logical_identity,digest FROM ne18_run_seal_entries ORDER BY ordinal").all()).toEqual(seal);
      expect(current.prepare("SELECT name FROM sqlite_schema WHERE name GLOB 'ne_*'").all()).toEqual([]);
    } finally {
      current.close();
    }
  });
});

it.each([
  ["invalid hooks through Host-owned migration", "host-owned", installInvalid017RunCore],
  ["unknown closure fields through private-portable admission", "private-portable", installUnknown017ClosureField],
] as const)("rejects 0.17 %s with the frozen codec and leaves the source unchanged", async (_label, sourceKind, corrupt) => {
  await withHistoricalDatabase("0.17", async (path) => {
    const db = new DatabaseSync(path);
    try {
      corrupt(db);
    } finally {
      db.close();
    }
    const before = await readFile(path);
    await expect(migrateHostOwnedProjectDatabase(path, 0, sourceKind)).rejects.toThrow(/exact niceeval\.project-database\/0\.17 codec/u);
    expect(await readFile(path)).toEqual(before);
    const preserved = new DatabaseSync(path, { readOnly: true });
    try {
      expect(preserved.prepare("SELECT format FROM ne_record_metadata WHERE singleton=1").get()?.format)
        .toBe("niceeval.project-database/0.17");
      expect(preserved.prepare("SELECT name FROM sqlite_schema WHERE name='ne18_record_metadata'").get()).toBeUndefined();
    } finally {
      preserved.close();
    }
  });
});

it("rejects a non-ready 0.17 migration in place with original-version recovery guidance", async () => {
  await withHistoricalDatabase("0.17", async (path) => {
    const db = new DatabaseSync(path);
    try {
      db.prepare(`UPDATE ne_migration_state SET state='committed',source_format=?,source_digest=? WHERE singleton=1`)
        .run("niceeval.project-database/0.16", "0".repeat(64));
    } finally {
      db.close();
    }
    const before = await readFile(path);
    await expect(migrateHostOwnedProjectDatabase(path, 0)).rejects.toThrow(/original NiceEval version.*finish recovery/u);
    expect(await readFile(path)).toEqual(before);
  });
});

it("keeps legal opaque hooks in 0.15/0.16 migration and exactly rejects invalid historical hook shapes", async () => {
  for (const version of ["0.15", "0.16"] as const) {
    await withHistoricalDatabase(version === "0.15" ? "0.15-hooks" : version, async (path) => {
      const source = new DatabaseSync(path, { readOnly: true });
      const row = source.prepare("SELECT core_payload FROM runs LIMIT 1").get();
      source.close();
      if (!(row?.core_payload instanceof Uint8Array)) throw new Error("historical hooks fixture lacks Run Core bytes");
      const original = JSON.parse(Buffer.from(row.core_payload).toString("utf8")) as RecordJsonObject;

      const opaque = structuredClone(original);
      const opaqueExecution = (opaque.context as RecordJsonObject).execution as unknown as Record<string, unknown>;
      opaqueExecution.experimentHooks = { version: 1, setup: "opaque", teardown: "opaque" };
      const format = `niceeval.project-database/${version}` as const;
      const migrated = migrateLegacyRunBytes(format, Buffer.from(canonicalRecordJsonText(opaque)));
      const migratedJson = JSON.parse(Buffer.from(migrated.bytes).toString("utf8")) as RecordJsonObject;
      expect(((migratedJson.context as RecordJsonObject).execution as RecordJsonObject).experimentHooks)
        .toEqual({ version: 1, setup: "opaque", teardown: "opaque" });

      const invalidHookCases: readonly RecordJsonObject[] = [
        { version: 2, setup: "absent", teardown: "absent" },
        { version: 1, setup: "invalid", teardown: "absent" },
        { version: 1, setup: "absent", teardown: "absent", extra: true },
      ];
      for (const invalidHooks of invalidHookCases) {
        const invalid = structuredClone(original);
        const invalidExecution = (invalid.context as RecordJsonObject).execution as unknown as Record<string, unknown>;
        invalidExecution.experimentHooks = invalidHooks;
        expect(() => migrateLegacyRunBytes(format, Buffer.from(canonicalRecordJsonText(invalid))))
          .toThrow(new RegExp(`exact niceeval\\.project-database\\/${version.replace(".", "\\.")} codec`, "u"));
      }
    });
  }
});
