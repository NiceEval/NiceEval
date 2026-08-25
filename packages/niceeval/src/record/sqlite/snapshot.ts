import { backup } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { access, link, mkdir, mkdtemp, open, rm, stat, statfs, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Worker } from "node:worker_threads";
import {
  type RecordDatabase,
} from "./database.ts";
import { sqliteError } from "./errors.ts";
import type { SnapshotResult } from "./types.ts";

const SNAPSHOT_SPACE_RESERVE_BYTES = 64 * 1024 * 1024;

function checkDeadline(deadlineEpochMs: number, phase: string): void {
  if (!Number.isSafeInteger(deadlineEpochMs) || Date.now() >= deadlineEpochMs) {
    throw sqliteError("record-snapshot-busy", "snapshot", `snapshot ${phase} exceeded its deadline`);
  }
}

async function preflight(source: RecordDatabase, destination: string, deadlineEpochMs: number): Promise<void> {
  checkDeadline(deadlineEpochMs, "preflight");
  const sourceMetadata = await stat(source.path);
  const walBytes = await stat(`${source.path}-wal`).then((metadata) => metadata.size).catch((cause: unknown) => {
    if (typeof cause === "object" && cause !== null && Reflect.get(cause, "code") === "ENOENT") return 0;
    throw cause;
  });
  const destinationFileSystem = await statfs(dirname(destination));
  const freeBytes = Number(destinationFileSystem.bavail) * Number(destinationFileSystem.bsize);
  // backup.sqlite and VACUUM output may each approach the live main+WAL
  // generation, so reserve both private copies before taking the barrier.
  const liveGenerationBytes = sourceMetadata.size + walBytes;
  const requiredBytes = liveGenerationBytes * 2 + SNAPSHOT_SPACE_RESERVE_BYTES;
  if (!sourceMetadata.isFile() || !Number.isSafeInteger(sourceMetadata.size) || !Number.isSafeInteger(walBytes) ||
    !Number.isSafeInteger(liveGenerationBytes) || !Number.isSafeInteger(requiredBytes) || !Number.isFinite(freeBytes) || freeBytes < requiredBytes) {
    throw sqliteError("record-snapshot-busy", "snapshot", `snapshot preflight requires ${requiredBytes} free bytes for a ${liveGenerationBytes} byte live generation`);
  }
  checkDeadline(deadlineEpochMs, "preflight");
}

function runMaintenanceUnit(input: {
  readonly backupPath: string;
  readonly vacuumPath: string;
  readonly snapshotIdentity: string;
  readonly sourceStorageGeneration: string;
  readonly createdAt: string;
  readonly deadlineEpochMs: number;
}): Promise<number> {
  const extension = import.meta.url.endsWith(".ts") ? "ts" : "js";
  return new Promise<number>((resolve, reject) => {
    const worker = new Worker(new URL(`./snapshot-maintenance-worker.${extension}`, import.meta.url), {
      workerData: input,
      execArgv: process.execArgv.filter((argument) => !argument.startsWith("--input-type") && argument !== "--expose-gc"),
    });
    let settled = false;
    const finish = (result: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      result();
    };
    const remaining = Math.max(1, input.deadlineEpochMs - Date.now());
    const timer = setTimeout(() => {
      void worker.terminate().finally(() => finish(() => reject(sqliteError("record-snapshot-busy", "snapshot", "snapshot maintenance unit exceeded its deadline"))));
    }, remaining);
    worker.once("message", (value: unknown) => {
      if (typeof value === "object" && value !== null && Reflect.get(value, "state") === "success" && Number.isSafeInteger(Reflect.get(value, "sealedRunCount"))) {
        finish(() => resolve(Number(Reflect.get(value, "sealedRunCount"))));
      } else {
        const message = typeof value === "object" && value !== null && typeof Reflect.get(value, "message") === "string"
          ? String(Reflect.get(value, "message"))
          : "snapshot maintenance unit returned an invalid response";
        finish(() => reject(sqliteError("record-snapshot-busy", "snapshot", message)));
      }
    });
    worker.once("error", (cause) => finish(() => reject(sqliteError("record-snapshot-busy", "snapshot", "snapshot maintenance worker failed", cause))));
    worker.once("exit", (code) => {
      if (code !== 0) finish(() => reject(sqliteError("record-snapshot-busy", "snapshot", `snapshot maintenance worker exited with code ${code}`)));
    });
  });
}

async function requireAbsent(path: string): Promise<void> {
  try {
    await access(path);
    throw sqliteError("record-command-conflict", "snapshot", `snapshot destination already exists: ${path}`);
  } catch (cause) {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") return;
    throw cause;
  }
}

async function publishAbsent(source: string, destination: string): Promise<void> {
  try {
    // The private file lives below destination's parent, so hard-linking is an
    // atomic same-filesystem create that cannot replace a concurrent winner.
    await link(source, destination);
  } catch (cause) {
    if (cause instanceof Error && "code" in cause && cause.code === "EEXIST") {
      throw sqliteError("record-command-conflict", "snapshot", `snapshot destination already exists: ${destination}`);
    }
    throw cause;
  }
}

async function fsyncFileAndParent(path: string): Promise<void> {
  const file = await open(path, "r");
  try {
    await file.sync();
  } finally {
    await file.close();
  }
  const parent = await open(dirname(path), "r");
  try {
    await parent.sync();
  } finally {
    await parent.close();
  }
}

/**
 * Must be called while the Record coordination snapshot barrier is held.
 * The barrier may be released as soon as `backup()` finishes; all later work is
 * performed on the private target generation.
 */
export async function createSealedSnapshot(
  source: RecordDatabase,
  destination: string,
  deadlineEpochMs: number,
  afterBackup?: () => Promise<void>,
): Promise<SnapshotResult> {
  checkDeadline(deadlineEpochMs, "startup");
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  await requireAbsent(destination);
  await preflight(source, destination, deadlineEpochMs);
  const temporaryRoot = await mkdtemp(join(dirname(destination), ".niceeval-snapshot-"));
  const backupPath = join(temporaryRoot, "backup.sqlite");
  const vacuumPath = join(temporaryRoot, "sealed.sqlite");
  const snapshotIdentity = randomUUID();
  const createdAt = new Date().toISOString();
  let sourceStorageGeneration: string | undefined;
  try {
    const sourceRow = source.db.prepare("SELECT storage_generation FROM record_metadata WHERE singleton=1").get() as
      | { readonly storage_generation?: unknown }
      | undefined;
    if (typeof sourceRow?.storage_generation !== "string") {
      throw sqliteError("record-database-invalid", "snapshot", "snapshot source generation is invalid");
    }
    sourceStorageGeneration = sourceRow.storage_generation;
    await backup(source.db, backupPath, {
      rate: 128,
      progress: () => {
        if (Date.now() >= deadlineEpochMs) throw sqliteError("record-snapshot-busy", "snapshot", "snapshot backup exceeded its deadline");
      },
    });
    checkDeadline(deadlineEpochMs, "backup");
    // No source-database reads occur below this line. The coordination Host
    // can release its snapshot barrier before private prune/verify/VACUUM.
    await afterBackup?.();
    checkDeadline(deadlineEpochMs, "barrier release");
    const sealedRunCount = await runMaintenanceUnit({ backupPath, vacuumPath, snapshotIdentity, sourceStorageGeneration, createdAt, deadlineEpochMs });
    checkDeadline(deadlineEpochMs, "verification");
    await fsyncFileAndParent(vacuumPath);
    checkDeadline(deadlineEpochMs, "private fsync");
    await publishAbsent(vacuumPath, destination);
    if (Date.now() >= deadlineEpochMs) {
      await unlink(destination).catch(() => undefined);
      throw sqliteError("record-snapshot-busy", "snapshot", "snapshot publication exceeded its deadline");
    }
    await fsyncFileAndParent(destination);
    if (Date.now() >= deadlineEpochMs) {
      await unlink(destination).catch(() => undefined);
      throw sqliteError("record-snapshot-busy", "snapshot", "snapshot durable publication exceeded its deadline");
    }
    if (sourceStorageGeneration === undefined) throw sqliteError("record-database-invalid", "snapshot", "snapshot provenance was not established");
    return Object.freeze({ path: destination, sealedRunCount, snapshotIdentity, sourceStorageGeneration, createdAt });
  } catch (cause) {
    if (cause instanceof Error && cause.name === "SqliteRecordError") throw cause;
    throw sqliteError("record-snapshot-busy", "snapshot", "sealed snapshot could not be completed", cause);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}
