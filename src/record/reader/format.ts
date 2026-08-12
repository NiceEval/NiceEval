import { Effect, Either } from "effect";
import { decodeRecordDocumentV1 } from "../codec/core.ts";
import type { RecordDocumentV1 } from "../model/core.ts";
import {
  isRecordFormatId,
  RECORD_FORMAT_V1,
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

const RECORD_FORMAT_MAJOR_PATTERN = /^niceeval\.record\/v([1-9][0-9]*)$/;

export interface CurrentRecordFormatRead {
  readonly document: RecordDocumentV1;
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

function formatMajor(format: string): number | undefined {
  if (!isRecordFormatId(format)) {
    return undefined;
  }
  const match = RECORD_FORMAT_MAJOR_PATTERN.exec(format);
  const major = match === null ? undefined : Number(match[1]);
  return major !== undefined && Number.isSafeInteger(major) ? major : undefined;
}

const CURRENT_RECORD_MAJOR = (() => {
  const major = formatMajor(RECORD_FORMAT_V1);
  if (major === undefined) {
    throw new Error("The current Record format must have a positive safe major");
  }
  return major;
})();

function classifyRecordDocument(
  value: unknown,
): Either.Either<
  CurrentRecordFormatRead,
  RecordBootstrapInvalid | RecordMigrationRequired | RecordFormatUnsupported
> {
  const format = formatOf(value);
  if (format === undefined) {
    return Either.left(bootstrapInvalid("record-document-invalid"));
  }

  if (format === RECORD_FORMAT_V1) {
    const decoded = decodeRecordDocumentV1(value);
    return Either.isLeft(decoded)
      ? Either.left(bootstrapInvalid("record-document-invalid"))
      : Either.right(Object.freeze({ document: decoded.right }));
  }

  const major = formatMajor(format);
  if (major !== undefined && major < CURRENT_RECORD_MAJOR) {
    return Either.left(
      new RecordMigrationRequired({
        code: "record-migration-required",
        source: format,
        target: RECORD_FORMAT_V1,
        command: "niceeval migrate",
      }),
    );
  }

  return Either.left(
    new RecordFormatUnsupported({ code: "record-format-unsupported", format }),
  );
}

/**
 * Reads only the bounded root document and accepts exactly the current major.
 * Older known majors take the explicit migration path; a corrupt current root
 * is never treated as a foreign format or as an empty Record.
 */
export function readCurrentRecordFormat(
  fileSystem: RecordFileSystemService,
  root: RecordRoot,
): Effect.Effect<
  CurrentRecordFormatRead,
  | RecordFileSystemError
  | RecordBootstrapInvalid
  | RecordMigrationRequired
  | RecordFormatUnsupported
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
    if (bytes === undefined) {
      return Effect.fail(bootstrapInvalid("record-document-invalid"));
    }
    const parsed = parseRecordJson(bytes);
    if (Either.isLeft(parsed)) {
      return Effect.fail(parsed.left);
    }
    const classified = classifyRecordDocument(parsed.right);
    return Either.isLeft(classified)
      ? Effect.fail(classified.left)
      : Effect.succeed(classified.right);
  });
}
