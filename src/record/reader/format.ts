import { Effect, Either } from "effect";
import { decodeRecordDocument } from "../codec/core.ts";
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
} from "./errors.ts";

/** `record.json` contains only root identity, so its read has a hard small cap. */
export const RECORD_FORMAT_DOCUMENT_MAXIMUM_BYTES = 64 * 1024;

export interface CurrentRecordFormatRead {
  readonly document: RecordDocument;
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
): Either.Either<CurrentRecordFormatRead, RecordBootstrapInvalid | RecordFormatUnsupported> {
  const format = formatOf(value);
  if (format === undefined) return Either.left(bootstrapInvalid("record-document-invalid"));
  if (format !== RECORD_FORMAT) {
    return Either.left(new RecordFormatUnsupported({ code: "record-format-unsupported", format }));
  }
  // A same-format numeric header is not automatically a reverse migration.
  // This package currently declares no adjacent root chain, so both a future
  // root and a hypothetical older root are unsupported rather than a fake
  // `N -> current` migration-required result.
  const schemaVersion = schemaVersionOf(value);
  if (schemaVersion !== undefined && schemaVersion !== RECORD_SCHEMA_VERSION) {
    return Either.left(new RecordFormatUnsupported({ code: "record-format-unsupported", format }));
  }
  const decoded = decodeRecordDocument(value);
  return Either.isLeft(decoded)
    ? Either.left(bootstrapInvalid("record-document-invalid"))
    : Either.right(Object.freeze({ document: decoded.right }));
}

/**
 * Reads only the bounded current root header. Migration-required is emitted
 * only by an actually declared adjacent chain; this current root has none.
 */
export function readCurrentRecordFormat(
  fileSystem: RecordFileSystemService,
  root: RecordRoot,
): Effect.Effect<
  CurrentRecordFormatRead,
  RecordFileSystemError | RecordBootstrapInvalid | RecordFormatUnsupported
> {
  const readDocument = fileSystem.readFile({
    file: recordPortablePath(root, "record.json"),
    maximumBytes: RECORD_FORMAT_DOCUMENT_MAXIMUM_BYTES,
  }).pipe(
    Effect.catchTag("RecordResourceLimitExceeded", () =>
      Effect.fail(bootstrapInvalid("record-format-document-limit-exceeded")),
    ),
  );

  return Effect.flatMap(readDocument, (bytes) => {
    if (bytes === undefined) return Effect.fail(bootstrapInvalid("record-document-invalid"));
    const parsed = parseRecordJson(bytes);
    if (Either.isLeft(parsed)) return Effect.fail(parsed.left);
    const classified = classifyRecordDocument(parsed.right);
    return Either.isLeft(classified) ? Effect.fail(classified.left) : Effect.succeed(classified.right);
  });
}
