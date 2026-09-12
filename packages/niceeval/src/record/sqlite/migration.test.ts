// cases: docs/engineering/testing/unit/record.md
import { copyFile, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { migrateHostOwnedProjectDatabase, projectDatabaseMigrationBackupPath } from "./migration.ts";
import { closeRecordDatabase, openRecordReader } from "./database.ts";

async function withHistoricalDatabase(version: "0.15" | "0.16", body: (path: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "niceeval-migration-fence-"));
  const path = join(root, "record.sqlite");
  try {
    await copyFile(resolve("e2e/record/fixtures/record-migration/predecessors", version, "record.sqlite"), path);
    await body(path);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

it.each(["0.15", "0.16"] as const)("fences a %s idle connection without replacing the database inode", async (version) => {
  await withHistoricalDatabase(version, async (path) => {
    const inode = (await stat(path)).ino;
    const old = new DatabaseSync(path);
    try {
      const statement = old.prepare("UPDATE record_metadata SET created_at='stale-writer' WHERE singleton=1");
      await expect(migrateHostOwnedProjectDatabase(path, 0)).resolves.toBe("migrated");
      expect((await stat(path)).ino).toBe(inode);
      expect(() => statement.run()).toThrow();
      expect(() => old.prepare("UPDATE coordination_state SET revision=revision+1 WHERE singleton=1").run()).toThrow();
      expect(() => old.prepare("INSERT INTO coordination_tickets(ticket_id) VALUES ('stale')").run()).toThrow();
      const current = openRecordReader(path);
      try {
        expect(current.db.prepare("SELECT created_at FROM ne_record_metadata WHERE singleton=1").get()?.created_at)
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

it("preserves a committed migration under a pinned old snapshot and completes after the reader releases it", async () => {
  await withHistoricalDatabase("0.16", async (path) => {
    const old = new DatabaseSync(path);
    let closed = false;
    try {
      old.exec("PRAGMA journal_mode=WAL; BEGIN");
      expect(old.prepare("SELECT format FROM record_metadata WHERE singleton=1").get()?.format)
        .toBe("niceeval.project-database/0.16");
      const staleWrite = old.prepare("UPDATE record_metadata SET created_at='stale-snapshot' WHERE singleton=1");
      await expect(migrateHostOwnedProjectDatabase(path, 0)).rejects.toThrow();

      const committed = new DatabaseSync(path, { readOnly: true });
      try {
        expect(committed.prepare("SELECT format FROM ne_record_metadata WHERE singleton=1").get()?.format)
          .toBe("niceeval.project-database/0.17");
        expect(committed.prepare("SELECT state FROM ne_migration_state WHERE singleton=1").get()?.state)
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
        expect(current.db.prepare("SELECT state FROM ne_migration_state WHERE singleton=1").get()?.state)
          .toBe("ready");
        expect(current.db.prepare("SELECT created_at FROM ne_record_metadata WHERE singleton=1").get()?.created_at)
          .not.toBe("stale-snapshot");
      } finally {
        closeRecordDatabase(current);
      }
      const backup = projectDatabaseMigrationBackupPath(path, "niceeval.project-database/0.16");
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
      expect(preserved.prepare("SELECT name FROM sqlite_schema WHERE name='ne_record_metadata'").get()).toBeUndefined();
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
