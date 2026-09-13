import { createHash } from "node:crypto";
import { constants, lstatSync, type BigIntStats, watch } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { basename, dirname } from "node:path";
import type { SQLOutputValue } from "node:sqlite";
import { sqliteError } from "./errors.ts";
import type { RecordDatabase } from "./database.ts";
import { verifyAllSealedRuns } from "./storage.ts";

const CAPTURE_CHUNK_BYTES = 256 * 1024;
const MAX_PORTABLE_RECORD_BYTES = 8 * 1024 * 1024 * 1024;
const SIDECAR_SUFFIXES = ["-wal", "-shm", "-journal"] as const;

export type ProjectRecordReadMode = "capture" | "operational";

function fail(message: string, cause?: unknown): never {
  throw sqliteError("record-database-invalid", "capture-record", message, cause);
}

function resourceLimit(message: string): never {
  throw sqliteError("record-resource-limit-exceeded", "capture-record", message);
}

function checkDeadline(deadlineEpochMs: number, phase: string): void {
  if (!Number.isSafeInteger(deadlineEpochMs) || Date.now() >= deadlineEpochMs) {
    resourceLimit(`Record ${phase} exceeded its deadline`);
  }
}

function sameIdentity(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size &&
    left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}

async function sidecarStat(path: string): Promise<BigIntStats | undefined> {
  try {
    const metadata = await lstat(path, { bigint: true });
    if (!metadata.isFile() || metadata.isSymbolicLink()) fail(`Record sidecar is not a regular file: ${path}`);
    return metadata;
  } catch (cause) {
    if (typeof cause === "object" && cause !== null && Reflect.get(cause, "code") === "ENOENT") return undefined;
    if (cause instanceof Error && Reflect.get(cause, "operation") === "capture-record") throw cause;
    return fail(`Record sidecar could not be inspected safely: ${path}`, cause);
  }
}

async function inspectPortableSidecars(sourcePath: string, rejectAny: boolean): Promise<void> {
  for (const suffix of SIDECAR_SUFFIXES) {
    const sidecarPath = `${sourcePath}${suffix}`;
    const metadata = await sidecarStat(sidecarPath);
    if (metadata === undefined) continue;
    if (rejectAny || (suffix !== "-shm" && metadata.size !== 0n)) {
      fail(`Record is not a single-file portable input because sidecar ${sidecarPath} is present`);
    }
  }
}

/**
 * Root-level project source routing. It never opens SQLite or tries to infer a
 * historical format: any regular SQLite sidecar selects the operational path.
 */
export function projectRecordReadMode(sourcePath: string): ProjectRecordReadMode {
  if (sourcePath.length === 0) fail("Project Record path is empty");
  for (const suffix of SIDECAR_SUFFIXES) {
    const sidecarPath = `${sourcePath}${suffix}`;
    try {
      const metadata = lstatSync(sidecarPath, { bigint: true });
      if (!metadata.isFile() || metadata.isSymbolicLink()) fail(`Record sidecar is not a regular file: ${sidecarPath}`);
      return "operational";
    } catch (cause) {
      if (typeof cause === "object" && cause !== null && Reflect.get(cause, "code") === "ENOENT") continue;
      if (cause instanceof Error && Reflect.get(cause, "operation") === "capture-record") throw cause;
      return fail(`Record sidecar could not be inspected safely: ${sidecarPath}`, cause);
    }
  }
  return "capture";
}

async function pathIdentity(sourcePath: string, descriptor: BigIntStats): Promise<BigIntStats> {
  let pathMetadata: BigIntStats;
  try {
    pathMetadata = await lstat(sourcePath, { bigint: true });
  } catch (cause) {
    return fail("Record source path could not be inspected safely", cause);
  }
  if (!pathMetadata.isFile() || pathMetadata.isSymbolicLink() || !sameIdentity(pathMetadata, descriptor)) {
    fail("Record source path does not identify the opened regular file");
  }
  return pathMetadata;
}

/**
 * Captures a delivered single-file Record without ever asking SQLite to open
 * the source. Both bounded passes use the same no-follow descriptor; the first
 * writes the private generation and the second proves identical source bytes.
 */
export async function captureSingleFileRecord(
  sourcePath: string,
  generationPath: string,
  deadlineEpochMs: number,
  rejectAnySidecar: boolean,
): Promise<void> {
  checkDeadline(deadlineEpochMs, "capture startup");
  const sourceName = basename(sourcePath);
  const watchedNames = new Set(SIDECAR_SUFFIXES.map((suffix) => `${sourceName}${suffix}`));
  let sidecarChanged = false;
  let watchFailure: unknown;
  const watcher = watch(dirname(sourcePath), { persistent: false }, (_event, filename) => {
    if (filename !== null && watchedNames.has(filename.toString())) sidecarChanged = true;
  });
  watcher.on("error", (cause) => { watchFailure = cause; });

  let source: Awaited<ReturnType<typeof open>> | undefined;
  let generation: Awaited<ReturnType<typeof open>> | undefined;
  try {
    await inspectPortableSidecars(sourcePath, rejectAnySidecar);
    source = await open(sourcePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = await source.stat({ bigint: true });
    if (!before.isFile() || before.isSymbolicLink()) fail("Record source is not a regular file");
    if (before.size <= 0n || before.size > BigInt(MAX_PORTABLE_RECORD_BYTES)) {
      resourceLimit(`Record source size must be between 1 and ${MAX_PORTABLE_RECORD_BYTES} bytes`);
    }
    await pathIdentity(sourcePath, before);

    generation = await open(
      generationPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    await generation.chmod(0o600);
    const buffer = Buffer.allocUnsafe(CAPTURE_CHUNK_BYTES);
    const firstHash = createHash("sha256");
    let offset = 0;
    while (BigInt(offset) < before.size) {
      checkDeadline(deadlineEpochMs, "capture first pass");
      const remaining = Number(before.size - BigInt(offset));
      const length = Math.min(buffer.byteLength, remaining);
      const read = await source.read(buffer, 0, length, offset);
      if (read.bytesRead !== length) fail("Record source ended during the first capture pass");
      firstHash.update(buffer.subarray(0, read.bytesRead));
      let written = 0;
      while (written < read.bytesRead) {
        const result = await generation.write(buffer, written, read.bytesRead - written, offset + written);
        if (result.bytesWritten <= 0) fail("Private Record generation stopped accepting bytes");
        written += result.bytesWritten;
      }
      offset += read.bytesRead;
    }
    await generation.sync();

    const secondHash = createHash("sha256");
    offset = 0;
    while (BigInt(offset) < before.size) {
      checkDeadline(deadlineEpochMs, "capture second pass");
      const remaining = Number(before.size - BigInt(offset));
      const length = Math.min(buffer.byteLength, remaining);
      const read = await source.read(buffer, 0, length, offset);
      if (read.bytesRead !== length) fail("Record source ended during the second capture pass");
      secondHash.update(buffer.subarray(0, read.bytesRead));
      offset += read.bytesRead;
    }
    const after = await source.stat({ bigint: true });
    await pathIdentity(sourcePath, after);
    await inspectPortableSidecars(sourcePath, rejectAnySidecar);
    if (watchFailure !== undefined) fail("Record source directory watch failed during capture", watchFailure);
    if (sidecarChanged) fail("Record sidecar changed during single-file capture");
    if (!sameIdentity(before, after) || firstHash.digest("hex") !== secondHash.digest("hex")) {
      fail("Record source changed during its bounded two-pass capture");
    }
    checkDeadline(deadlineEpochMs, "capture completion");
  } catch (cause) {
    throw cause;
  } finally {
    watcher.close();
    await generation?.close().catch(() => undefined);
    await source?.close().catch(() => undefined);
  }
}

function integer(value: SQLOutputValue | undefined, field: string): number {
  const decoded = typeof value === "bigint" ? Number(value) : value;
  if (typeof decoded !== "number" || !Number.isSafeInteger(decoded)) fail(`${field} is not a safe integer`);
  return decoded;
}

function text(value: SQLOutputValue | undefined, field: string): string {
  if (typeof value !== "string") fail(`${field} is not text`);
  return value;
}

/** Exact portable/idle admission applied only to the private current copy. */
export function validatePortableRecordDatabase(connection: RecordDatabase, deadlineEpochMs: number): number {
  checkDeadline(deadlineEpochMs, "portable validation");
  const state = connection.db.prepare(`SELECT barrier_state,portable_generation,portable_revision,storage_generation
    FROM ne18_record_metadata WHERE singleton=1`).get() as Record<string, SQLOutputValue> | undefined;
  const active = connection.db.prepare(`SELECT
    (SELECT count(*) FROM ne18_run_resources WHERE terminal_state IS NULL)+
    (SELECT count(*) FROM ne18_runs WHERE status!='sealed')+
    (SELECT count(*) FROM ne18_attempts WHERE publication_state!='published')+
    (SELECT count(*) FROM ne18_coordination_tickets) AS count`).get() as Record<string, SQLOutputValue>;
  const invocationWork = connection.db.prepare(`SELECT
    (SELECT count(*) FROM ne18_invocation_sessions WHERE state IN ('active','recovering'))+
    (SELECT count(*) FROM ne18_invocation_session_queued_attempts)+
    (SELECT count(*) FROM ne18_case_locks) AS count`).get() as Record<string, SQLOutputValue>;
  const registryWork = connection.db.prepare(`SELECT
    (SELECT count(*) FROM ne18_teardown_obligations)+
    (SELECT count(*) FROM ne18_shared_state_generations s WHERE state_kind!='free' AND generation=(SELECT max(generation) FROM ne18_shared_state_generations WHERE state_key=s.state_key))+
    (SELECT count(*) FROM ne18_kept_sandbox_operation_leases) AS count`).get() as Record<string, SQLOutputValue>;
  const coordination = connection.db.prepare("SELECT writer_ticket_id,barrier_id FROM ne18_coordination_state WHERE singleton=1")
    .get() as Record<string, SQLOutputValue> | undefined;
  const clock = connection.db.prepare("SELECT revision FROM ne18_run_publication_clock WHERE singleton=1")
    .get() as Record<string, SQLOutputValue> | undefined;
  if (state === undefined || text(state.barrier_state, "barrier_state") !== "portable" ||
    text(state.portable_generation, "portable_generation") !== text(state.storage_generation, "storage_generation") ||
    clock === undefined || integer(state.portable_revision, "portable_revision") !== integer(clock.revision, "publication_revision") ||
    integer(active.count, "portable_work") !== 0 || integer(invocationWork.count, "portable_invocation_work") !== 0 ||
    integer(registryWork.count, "portable_registry_work") !== 0 || coordination === undefined ||
    coordination.writer_ticket_id !== null || coordination.barrier_id !== null) {
    fail("Private generation does not prove a portable idle ProjectDatabase");
  }
  return verifyAllSealedRuns(connection, true, deadlineEpochMs);
}
