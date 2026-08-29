import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { isSqliteRecordErrorCode, SqliteRecordError, sqliteError } from "./errors.ts";

interface SnapshotImportSuccess {
  readonly state: "success";
  readonly sealedRunCount: number;
}

interface SnapshotImportFailure {
  readonly state: "failure";
  readonly error: {
    readonly code: string;
    readonly operation: string;
    readonly message: string;
  };
}

type SnapshotImportResponse = SnapshotImportSuccess | SnapshotImportFailure;

export interface ImportedSnapshotGeneration {
  readonly path: string;
  readonly sealedRunCount: number;
}

/**
 * The handle owns both the killable importer and its private generation.
 * Closing it is idempotent and removes every SQLite sidecar below the private
 * directory after the worker has stopped.
 */
export interface SnapshotImportHandle {
  readonly result: Promise<ImportedSnapshotGeneration>;
  readonly close: () => Promise<void>;
}

function workerExecArgv(): string[] {
  return process.execArgv.filter((argument) =>
    !argument.startsWith("--input-type") && argument !== "--expose-gc" &&
    !argument.startsWith("--max-old-space-size") && !argument.startsWith("--max_old_space_size") &&
    !argument.startsWith("--max-semi-space-size") && !argument.startsWith("--max_semi_space_size"));
}

function isResponse(value: unknown): value is SnapshotImportResponse {
  if (typeof value !== "object" || value === null) return false;
  const state = Reflect.get(value, "state");
  if (state === "success") return Number.isSafeInteger(Reflect.get(value, "sealedRunCount"));
  if (state !== "failure") return false;
  const error = Reflect.get(value, "error");
  return typeof error === "object" && error !== null &&
    typeof Reflect.get(error, "code") === "string" &&
    typeof Reflect.get(error, "operation") === "string" &&
    typeof Reflect.get(error, "message") === "string";
}

function workerFailure(response: SnapshotImportFailure): SqliteRecordError {
  return new SqliteRecordError(
    isSqliteRecordErrorCode(response.error.code) ? response.error.code : "record-sqlite-error",
    response.error.operation,
    response.error.message,
  );
}

/**
 * Starts the only boundary allowed to open an external RecordSnapshot.
 * Synchronous node:sqlite validation remains killable because it runs inside
 * this resource-limited Worker rather than the Inspection process thread.
 */
export function startSnapshotImport(
  sourcePath: string,
  deadlineEpochMs: number,
): SnapshotImportHandle {
  if (sourcePath.length === 0 || !Number.isSafeInteger(deadlineEpochMs) || deadlineEpochMs <= Date.now()) {
    throw sqliteError("record-resource-limit-exceeded", "import-snapshot", "snapshot import requires a non-empty path and future deadline");
  }
  const temporaryRoot = mkdtempSync(join(tmpdir(), "niceeval-record-import-"));
  chmodSync(temporaryRoot, 0o700);
  const generationPath = join(temporaryRoot, "generation.sqlite");
  const extension = import.meta.url.endsWith(".ts") ? "ts" : "js";
  let worker: Worker;
  try {
    worker = new Worker(new URL(`./snapshot-import-worker.${extension}`, import.meta.url), {
      workerData: { sourcePath, generationPath, deadlineEpochMs },
      execArgv: workerExecArgv(),
    });
  } catch (cause) {
    rmSync(temporaryRoot, { recursive: true, force: true });
    throw cause;
  }

  let closePromise: Promise<void> | undefined;
  let settled = false;
  let timer: ReturnType<typeof setTimeout>;
  let detach: () => void = () => undefined;
  const result = new Promise<ImportedSnapshotGeneration>((resolve, reject) => {
    const finish = (complete: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      detach();
      complete();
    };
    const stopAndReject = (cause: unknown): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      detach();
      void worker.terminate().then(
        () => reject(cause),
        () => reject(cause),
      );
    };
    const onMessage = (value: unknown): void => {
      if (!isResponse(value)) {
        stopAndReject(sqliteError("record-database-invalid", "import-snapshot", "snapshot import worker returned an invalid response"));
        return;
      }
      if (value.state === "failure") {
        stopAndReject(workerFailure(value));
        return;
      }
      finish(() => resolve(Object.freeze({ path: generationPath, sealedRunCount: value.sealedRunCount })));
    };
    const onError = (cause: unknown): void => stopAndReject(sqliteError(
      "record-database-invalid",
      "import-snapshot",
      "snapshot import worker failed",
      cause,
    ));
    const onExit = (code: number): void => finish(() => reject(sqliteError(
      "record-database-invalid",
      "import-snapshot",
      `snapshot import worker exited before producing a generation (code ${code})`,
    )));
    detach = (): void => {
      worker.off("message", onMessage);
      worker.off("error", onError);
      worker.off("exit", onExit);
    };
    worker.on("message", onMessage);
    worker.once("error", onError);
    worker.once("exit", onExit);
    const remaining = Math.max(1, deadlineEpochMs - Date.now());
    timer = setTimeout(() => stopAndReject(sqliteError(
      "record-resource-limit-exceeded",
      "import-snapshot",
      "snapshot import maintenance worker exceeded its hard deadline",
    )), remaining);
  });

  return Object.freeze({
    result,
    close: () => {
      if (closePromise !== undefined) return closePromise;
      clearTimeout(timer);
      closePromise = worker.terminate()
        .then(() => undefined, () => undefined)
        .then(() => rm(temporaryRoot, { recursive: true, force: true }));
      return closePromise;
    },
  });
}
