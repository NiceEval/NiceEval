import { Effect, Either, Schema } from "effect";
import { decodeRecordDocument } from "../codec/core.ts";
import { RecordIdSchema } from "../codec/identifiers.ts";
import type { RecordDocument } from "../model/core.ts";
import {
  LEGACY_RECORD_FORMAT,
  RECORD_FORMAT,
  type RecordId,
} from "../model/identifiers.ts";
import type { RecordFileSystemError } from "../platform/errors.ts";
import {
  recordPortablePath,
  type RecordFileSystemService,
} from "../platform/services.ts";
import type { RecordRoot } from "../platform/root.ts";
import {
  RecordBootstrapInvalid,
  RecordFormatUnsupported,
  RecordMigrationRequired,
} from "./errors.ts";

/** `record.json` contains only root identity, so its read has a hard small cap. */
export const RECORD_FORMAT_DOCUMENT_MAXIMUM_BYTES = 64 * 1024;

export interface CurrentRecordFormatRead {
  readonly document: RecordDocument;
}

export interface MaintenanceRecordFormatRead extends CurrentRecordFormatRead {
  readonly sourceFormat: typeof RECORD_FORMAT | typeof LEGACY_RECORD_FORMAT;
  /** Exact stale-plan precondition; apply replaces this file only as the final cutover. */
  readonly sourceBytes: Uint8Array;
}

function bootstrapInvalid(
  reason: "record-document-invalid" | "record-format-document-limit-exceeded",
): RecordBootstrapInvalid {
  return new RecordBootstrapInvalid({ code: "record-bootstrap-invalid", reason });
}

function parseRecordJson(bytes: Uint8Array): Either.Either<unknown, RecordBootstrapInvalid> {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return Either.right(JSON.parse(text) as unknown);
  } catch {
    return Either.left(bootstrapInvalid("record-document-invalid"));
  }
}

function formatOf(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, "format");
  return descriptor !== undefined && "value" in descriptor && typeof descriptor.value === "string"
    ? descriptor.value
    : undefined;
}

function classifyRecordDocument(
  value: unknown,
): Either.Either<
  CurrentRecordFormatRead,
  RecordBootstrapInvalid | RecordFormatUnsupported | RecordMigrationRequired
> {
  const format = formatOf(value);
  if (format === undefined) return Either.left(bootstrapInvalid("record-document-invalid"));
  if (format === LEGACY_RECORD_FORMAT) {
    return Either.left(new RecordMigrationRequired({
      code: "record-migration-required",
      source: LEGACY_RECORD_FORMAT,
      target: RECORD_FORMAT,
      command: "niceeval migrate",
    }));
  }
  if (format !== RECORD_FORMAT) {
    return Either.left(new RecordFormatUnsupported({ code: "record-format-unsupported", format }));
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return Either.left(bootstrapInvalid("record-document-invalid"));
  }
  const record = value as Record<string, unknown>;
  const projected: Record<string, unknown> = {};
  for (const key of Object.keys(record)) {
    if (key !== "schemaVersion") projected[key] = record[key];
  }
  const decoded = decodeRecordDocument(projected);
  return Either.isLeft(decoded)
    ? Either.left(bootstrapInvalid("record-document-invalid"))
    : Either.right(Object.freeze({ document: decoded.right }));
}

function classifyMaintenanceRecordDocument(
  value: unknown,
): Either.Either<
  { readonly document: RecordDocument; readonly sourceFormat: typeof RECORD_FORMAT | typeof LEGACY_RECORD_FORMAT },
  RecordBootstrapInvalid | RecordFormatUnsupported
> {
  const format = formatOf(value);
  if (format !== RECORD_FORMAT && format !== LEGACY_RECORD_FORMAT) {
    return format === undefined
      ? Either.left(bootstrapInvalid("record-document-invalid"))
      : Either.left(new RecordFormatUnsupported({ code: "record-format-unsupported", format }));
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return Either.left(bootstrapInvalid("record-document-invalid"));
  }
  const source = value as Record<string, unknown>;
  const keys = Object.keys(source).filter((key) => key !== "schemaVersion");
  if (keys.length !== 2 || !keys.includes("format") || !keys.includes("recordId")) {
    return Either.left(bootstrapInvalid("record-document-invalid"));
  }
  const decodedId = Schema.decodeUnknownEither(RecordIdSchema)(source.recordId);
  if (Either.isLeft(decodedId)) return Either.left(bootstrapInvalid("record-document-invalid"));
  return Either.right(Object.freeze({
    document: Object.freeze({
      format: RECORD_FORMAT as RecordDocument["format"],
      recordId: decodedId.right as RecordId,
    }),
    sourceFormat: format,
  }));
}

function readFormatBytes(fileSystem: RecordFileSystemService, root: RecordRoot) {
  return fileSystem.readFile({
    file: recordPortablePath(root, "record.json"),
    maximumBytes: RECORD_FORMAT_DOCUMENT_MAXIMUM_BYTES,
  }).pipe(
    Effect.catchTag("RecordResourceLimitExceeded", () =>
      Effect.fail(bootstrapInvalid("record-format-document-limit-exceeded")),
    ),
  );
}

/** Reads the bounded versionless root after dropping the reserved boundary-noise key. */
export function readCurrentRecordFormat(
  fileSystem: RecordFileSystemService,
  root: RecordRoot,
): Effect.Effect<
  CurrentRecordFormatRead,
  RecordFileSystemError | RecordBootstrapInvalid | RecordFormatUnsupported | RecordMigrationRequired
> {
  return Effect.gen(function* () {
    const bytes = yield* readFormatBytes(fileSystem, root);
    if (bytes === undefined) return yield* Effect.fail(bootstrapInvalid("record-document-invalid"));
    const parsed = parseRecordJson(bytes);
    if (Either.isLeft(parsed)) return yield* Effect.fail(parsed.left);
    const classified = classifyRecordDocument(parsed.right);
    if (Either.isLeft(classified)) return yield* Effect.fail(classified.left);
    return classified.right;
  });
}

/** Maintenance alone recognizes the supported predecessor for explicit cutover. */
export function readRecordFormatForMaintenance(
  fileSystem: RecordFileSystemService,
  root: RecordRoot,
): Effect.Effect<
  MaintenanceRecordFormatRead,
  RecordFileSystemError | RecordBootstrapInvalid | RecordFormatUnsupported
> {
  return Effect.gen(function* () {
    const bytes = yield* readFormatBytes(fileSystem, root);
    if (bytes === undefined) return yield* Effect.fail(bootstrapInvalid("record-document-invalid"));
    const parsed = parseRecordJson(bytes);
    if (Either.isLeft(parsed)) return yield* Effect.fail(parsed.left);
    const classified = classifyMaintenanceRecordDocument(parsed.right);
    if (Either.isLeft(classified)) return yield* Effect.fail(classified.left);
    return Object.freeze({ ...classified.right, sourceBytes: bytes });
  });
}
