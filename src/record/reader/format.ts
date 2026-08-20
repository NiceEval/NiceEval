import { Effect, Either, Schema } from "effect";
import { decodeRecordDocument, RecordExactParseOptions } from "../codec/core.ts";
import { RecordIdSchema } from "../codec/identifiers.ts";
import type { RecordDocument } from "../model/core.ts";
import { RECORD_FORMAT, RECORD_SCHEMA_VERSION } from "../model/identifiers.ts";
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
  readonly sourceSchemaVersion: 1 | typeof RECORD_SCHEMA_VERSION;
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

function schemaVersionOf(value: unknown): number | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, "schemaVersion");
  return descriptor !== undefined && "value" in descriptor &&
      Number.isSafeInteger(descriptor.value) && descriptor.value > 0
    ? descriptor.value
    : undefined;
}

function classifyRecordDocument(
  value: unknown,
): Either.Either<CurrentRecordFormatRead, RecordBootstrapInvalid | RecordFormatUnsupported | RecordMigrationRequired> {
  const format = formatOf(value);
  if (format === undefined) return Either.left(bootstrapInvalid("record-document-invalid"));
  if (format !== RECORD_FORMAT) {
    return Either.left(new RecordFormatUnsupported({ code: "record-format-unsupported", format }));
  }
  const schemaVersion = schemaVersionOf(value);
  if (schemaVersion === 1) {
    return Either.left(new RecordMigrationRequired({
      code: "record-migration-required",
      source: `${RECORD_FORMAT}@1`,
      target: `${RECORD_FORMAT}@${RECORD_SCHEMA_VERSION}`,
      command: "niceeval migrate",
    }));
  }
  if (schemaVersion !== RECORD_SCHEMA_VERSION) {
    return Either.left(new RecordFormatUnsupported({ code: "record-format-unsupported", format }));
  }
  const decoded = decodeRecordDocument(value);
  return Either.isLeft(decoded)
    ? Either.left(bootstrapInvalid("record-document-invalid"))
    : Either.right(Object.freeze({ document: decoded.right }));
}

function legacyRecordDocument(value: unknown): RecordDocument | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== 3 ||
    record.format !== RECORD_FORMAT ||
    record.schemaVersion !== 1
  ) return undefined;
  const recordId = Schema.decodeUnknownEither(RecordIdSchema, RecordExactParseOptions)(record.recordId);
  return Either.isLeft(recordId) ? undefined : Object.freeze({
    format: RECORD_FORMAT as RecordDocument["format"],
    schemaVersion: RECORD_SCHEMA_VERSION,
    recordId: recordId.right,
  });
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

/**
 * Reads only the bounded exact-current root header. The one published
 * predecessor is reported as migration-required but is never decoded as current.
 */
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

/** Maintenance-only exact recognition of the one published root predecessor. */
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
    const version = schemaVersionOf(parsed.right);
    if (version === RECORD_SCHEMA_VERSION) {
      const decoded = decodeRecordDocument(parsed.right);
      if (Either.isLeft(decoded)) return yield* Effect.fail(bootstrapInvalid("record-document-invalid"));
      return Object.freeze({
        document: decoded.right,
        sourceSchemaVersion: RECORD_SCHEMA_VERSION,
        sourceBytes: bytes,
      });
    }
    if (version === 1) {
      const document = legacyRecordDocument(parsed.right);
      if (document === undefined) return yield* Effect.fail(bootstrapInvalid("record-document-invalid"));
      return Object.freeze({ document, sourceSchemaVersion: 1 as const, sourceBytes: bytes });
    }
    const format = formatOf(parsed.right);
    return yield* Effect.fail(new RecordFormatUnsupported({
      code: "record-format-unsupported",
      format: format ?? "unknown",
    }));
  });
}
