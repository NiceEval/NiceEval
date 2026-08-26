import { chmod } from "node:fs/promises";
import { backup } from "node:sqlite";
import { isMainThread, parentPort, workerData } from "node:worker_threads";
import { closeRecordDatabase, openRecordReader, validateExactSchema, type RecordDatabase } from "./database.ts";
import { sqliteError } from "./errors.ts";
import { verifyAllSealedRuns } from "./storage.ts";

interface SnapshotImportInput {
  readonly sourcePath: string;
  readonly generationPath: string;
  readonly deadlineEpochMs: number;
}

function decodeInput(value: unknown): SnapshotImportInput {
  if (typeof value !== "object" || value === null ||
    typeof Reflect.get(value, "sourcePath") !== "string" || Reflect.get(value, "sourcePath") === "" ||
    typeof Reflect.get(value, "generationPath") !== "string" || Reflect.get(value, "generationPath") === "" ||
    !Number.isSafeInteger(Reflect.get(value, "deadlineEpochMs"))) {
    throw sqliteError("record-database-invalid", "import-snapshot", "snapshot import worker input is invalid");
  }
  return Object.freeze({
    sourcePath: String(Reflect.get(value, "sourcePath")),
    generationPath: String(Reflect.get(value, "generationPath")),
    deadlineEpochMs: Number(Reflect.get(value, "deadlineEpochMs")),
  });
}

function deadline(input: SnapshotImportInput, phase: string): void {
  if (Date.now() >= input.deadlineEpochMs) {
    throw sqliteError("record-resource-limit-exceeded", "import-snapshot", `snapshot import ${phase} exceeded its deadline`);
  }
}

function close(connection: RecordDatabase | undefined): void {
  if (connection === undefined) return;
  try {
    if (connection.db.isTransaction) connection.db.exec("ROLLBACK");
  } finally {
    closeRecordDatabase(connection);
  }
}

async function importSnapshot(input: SnapshotImportInput): Promise<number> {
  deadline(input, "startup");
  let hostile: RecordDatabase | undefined;
  try {
    // openRecordReader installs the snapshot authorizer and checks the exact
    // schema before SQLite is allowed to copy any external generation.
    hostile = openRecordReader(input.sourcePath, "snapshot");
    hostile.db.exec("BEGIN");
    await backup(hostile.db, input.generationPath, {
      rate: 128,
      progress: () => deadline(input, "backup"),
    });
    deadline(input, "backup");
  } finally {
    // The external file is closed before any accepted generation is exposed
    // to the ordinary reader or even fully validated below.
    close(hostile);
  }

  await chmod(input.generationPath, 0o600);
  deadline(input, "private generation");
  let generation: RecordDatabase | undefined;
  try {
    generation = openRecordReader(input.generationPath, "snapshot");
    generation.db.exec("BEGIN");
    validateExactSchema(generation, "snapshot");
    const sealedRunCount = verifyAllSealedRuns(generation, true, input.deadlineEpochMs);
    deadline(input, "validation");
    return sealedRunCount;
  } finally {
    close(generation);
  }
}

if (!isMainThread && parentPort !== null) {
  const port = parentPort;
  void importSnapshot(decodeInput(workerData)).then(
    (sealedRunCount) => port.postMessage(Object.freeze({ state: "success", sealedRunCount })),
    (cause: unknown) => {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      port.postMessage(Object.freeze({
        state: "failure",
        error: Object.freeze({
          code: typeof Reflect.get(error, "code") === "string" ? String(Reflect.get(error, "code")) : "record-sqlite-error",
          operation: typeof Reflect.get(error, "operation") === "string" ? String(Reflect.get(error, "operation")) : "import-snapshot",
          message: error.message,
        }),
      }));
    },
  );
}
