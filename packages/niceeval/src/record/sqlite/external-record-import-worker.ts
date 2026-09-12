import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { backup } from "node:sqlite";
import { isMainThread, parentPort, workerData } from "node:worker_threads";
import { closeRecordDatabase, openRecordReader, validateExactSchema, type RecordDatabase } from "./database.ts";
import { sqliteError } from "./errors.ts";
import { capturedRecordSchemaKind, migrateHostOwnedProjectDatabase } from "./migration.ts";
import {
  captureSingleFileRecord,
  projectRecordReadMode,
  validatePortableRecordDatabase,
} from "./portable-capture.ts";
import { verifyAllSealedRuns } from "./storage.ts";
import type { RecordImportSourceKind } from "./external-record-import.ts";

interface ExternalRecordImportInput {
  readonly sourcePath: string;
  readonly generationPath: string;
  readonly deadlineEpochMs: number;
  readonly sourceKind: RecordImportSourceKind;
}

function decodeInput(value: unknown): ExternalRecordImportInput {
  if (typeof value !== "object" || value === null ||
    typeof Reflect.get(value, "sourcePath") !== "string" || Reflect.get(value, "sourcePath") === "" ||
    typeof Reflect.get(value, "generationPath") !== "string" || Reflect.get(value, "generationPath") === "" ||
    !Number.isSafeInteger(Reflect.get(value, "deadlineEpochMs")) ||
    (Reflect.get(value, "sourceKind") !== "external-record" &&
      Reflect.get(value, "sourceKind") !== "project-record" &&
      Reflect.get(value, "sourceKind") !== "captured-project-record")) {
    throw sqliteError("record-database-invalid", "import-record", "Record import worker input is invalid");
  }
  return Object.freeze({
    sourcePath: String(Reflect.get(value, "sourcePath")),
    generationPath: String(Reflect.get(value, "generationPath")),
    deadlineEpochMs: Number(Reflect.get(value, "deadlineEpochMs")),
    sourceKind: Reflect.get(value, "sourceKind") as RecordImportSourceKind,
  });
}

function deadline(input: ExternalRecordImportInput, phase: string): void {
  if (Date.now() >= input.deadlineEpochMs) {
    throw sqliteError("record-resource-limit-exceeded", "import-record", `Record import ${phase} exceeded its deadline`);
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

async function createPrivateGeneration(path: string): Promise<void> {
  const descriptor = await open(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await descriptor.chmod(0o600);
  } finally {
    await descriptor.close();
  }
}

async function importOperationalProjectRecord(input: ExternalRecordImportInput): Promise<number> {
  await createPrivateGeneration(input.generationPath);
  let hostile: RecordDatabase | undefined;
  try {
    // This is the only branch allowed to ask SQLite to interpret the source.
    // It is project-only, current-format-only, and retains SQLite's established
    // live WAL snapshot semantics without checkpointing or repairing the source.
    hostile = openRecordReader(input.sourcePath);
    hostile.db.exec("BEGIN");
    await backup(hostile.db, input.generationPath, {
      rate: 128,
      progress: () => deadline(input, "backup"),
    });
    deadline(input, "backup");
  } finally {
    close(hostile);
  }
  return validateGeneration(input, false);
}

async function importCapturedRecord(input: ExternalRecordImportInput, rejectAnySidecar: boolean): Promise<number> {
  await captureSingleFileRecord(input.sourcePath, input.generationPath, input.deadlineEpochMs, rejectAnySidecar);
  deadline(input, "capture");
  const kind = capturedRecordSchemaKind(input.generationPath);
  if (kind === "legacy") {
    await migrateHostOwnedProjectDatabase(input.generationPath, 0, "private-portable", input.deadlineEpochMs);
  }
  deadline(input, "migration");
  // A current project capture preserves operational read semantics. Only
  // external input promises portable state; historical migration already
  // proves it before and after converting the private copy.
  return validateGeneration(input, input.sourceKind === "external-record");
}

function validateGeneration(input: ExternalRecordImportInput, requirePortable: boolean): number {
  deadline(input, "private generation");
  let generation: RecordDatabase | undefined;
  try {
    generation = openRecordReader(input.generationPath);
    generation.db.exec("BEGIN");
    validateExactSchema(generation);
    const sealedRunCount = requirePortable
      ? validatePortableRecordDatabase(generation, input.deadlineEpochMs)
      : verifyAllSealedRuns(generation, false, input.deadlineEpochMs);
    deadline(input, "validation");
    return sealedRunCount;
  } finally {
    close(generation);
  }
}

async function importRecord(input: ExternalRecordImportInput): Promise<number> {
  deadline(input, "startup");
  if (input.sourceKind === "external-record") return importCapturedRecord(input, false);
  if (input.sourceKind === "captured-project-record") return importCapturedRecord(input, true);
  return projectRecordReadMode(input.sourcePath) === "operational"
    ? importOperationalProjectRecord(input)
    : importCapturedRecord(input, true);
}

if (!isMainThread && parentPort !== null) {
  const port = parentPort;
  void importRecord(decodeInput(workerData)).then(
    (sealedRunCount) => port.postMessage(Object.freeze({ state: "success", sealedRunCount })),
    (cause: unknown) => {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      port.postMessage(Object.freeze({
        state: "failure",
        error: Object.freeze({
          code: typeof Reflect.get(error, "code") === "string" ? String(Reflect.get(error, "code")) : "record-sqlite-error",
          operation: typeof Reflect.get(error, "operation") === "string" ? String(Reflect.get(error, "operation")) : "import-record",
          message: error.message,
        }),
      }));
    },
  );
}
