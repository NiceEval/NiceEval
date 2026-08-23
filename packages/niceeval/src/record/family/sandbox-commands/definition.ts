import { createHash } from "node:crypto";

import { Schema } from "effect";

import {
  CanonicalProjectRelativePathSchema,
  Sha256DigestSchema,
} from "../../codec/identifiers.ts";
import {
  type RecordBlobRef,
} from "../../attachment/blob-ref.ts";
import { RecordBlobRefSchema } from "../../attachment/blob-ref.ts";
import {
  recordAttachmentIssue,
  type RecordAttachmentIssue,
} from "../../attachment/errors.ts";
import { defineRecordAttachment } from "../../definition/index.ts";
import { TurnIdSchema } from "../../../o11y/record/codec.ts";
import {
  MAX_COMMAND_INLINE_STREAM_BYTES,
  MAX_COMMAND_STREAM_BYTES,
} from "../../../o11y/record/limits.ts";
import {
  FixedAttachmentValueLimits,
  NonNegativeSafeIntegerSchema,
  PositiveSafeIntegerSchema,
  SafeIdentifierSchema,
  SafeTextSchema,
} from "../common.ts";
import {
  SourceReceiptCollectionSchema,
  SourceSegmentIdSchema,
  hasCanonicalSourceSegments,
} from "../source-receipt.ts";

export const SandboxCommandStreamSchema = Schema.Struct({
  storage: Schema.Union(
    Schema.Struct({ kind: Schema.Literal("inline"), text: SafeTextSchema }),
    Schema.Struct({ kind: Schema.Literal("blob"), ref: RecordBlobRefSchema }),
  ),
  retainedBytes: NonNegativeSafeIntegerSchema,
  totalSafeUtf8Bytes: NonNegativeSafeIntegerSchema,
  sha256: Sha256DigestSchema,
}).pipe(Schema.filter((value) =>
  value.totalSafeUtf8Bytes >= value.retainedBytes &&
  value.retainedBytes <= MAX_COMMAND_STREAM_BYTES &&
  (value.storage.kind !== "inline" || (
    value.retainedBytes <= MAX_COMMAND_INLINE_STREAM_BYTES &&
    new TextEncoder().encode(value.storage.text).byteLength === value.retainedBytes
  ))
));

export const SandboxCommandReceiptSchema = Schema.Struct({
  segmentId: SourceSegmentIdSchema,
  commandId: SafeIdentifierSchema,
  sequence: PositiveSafeIntegerSchema,
  turnId: Schema.NullOr(TurnIdSchema),
  phase: Schema.Literal("attempt.setup", "sandbox.prepare", "agent.ensure", "eval.run", "sandbox.command", "attempt.teardown"),
  invocation: Schema.Union(
    Schema.Struct({ kind: Schema.Literal("argv"), executable: SafeTextSchema, arguments: Schema.Array(SafeTextSchema) }),
    Schema.Struct({ kind: Schema.Literal("shell"), command: SafeTextSchema }),
  ),
  workingDirectory: Schema.Union(
    Schema.Struct({ kind: Schema.Literal("sandbox-default") }),
    Schema.Struct({ kind: Schema.Literal("project-relative"), path: CanonicalProjectRelativePathSchema }),
    Schema.Struct({ kind: Schema.Literal("redacted") }),
  ),
  outcome: Schema.Union(
    Schema.Struct({ kind: Schema.Literal("exited"), exitCode: Schema.JsonNumber.pipe(Schema.filter((value) => Number.isSafeInteger(value) && value >= -2_147_483_648 && value <= 2_147_483_647)) }),
    Schema.Struct({ kind: Schema.Literal("terminated"), reason: Schema.Literal("timeout", "cancelled", "transport-lost") }),
    Schema.Struct({ kind: Schema.Literal("not-started"), reason: Schema.Literal("spawn-failed", "cancelled-before-start") }),
  ),
  stdout: SandboxCommandStreamSchema,
  stderr: SandboxCommandStreamSchema,
});

export const SandboxCommandsAttachmentSchema = Schema.Struct({
  collection: Schema.propertySignature(SourceReceiptCollectionSchema).pipe(
    Schema.fromKey("collection-data"),
  ),
  segments: Schema.propertySignature(Schema.Array(SandboxCommandReceiptSchema)).pipe(
    Schema.fromKey("segments-data"),
  ),
}).pipe(
  Schema.filter((value) =>
    hasCanonicalSourceSegments(value.segments) &&
    new Set(value.segments.map((segment) => segment.commandId)).size === value.segments.length &&
    value.collection.limitations.every((limitation) =>
      (limitation.code !== "capture-failed" && limitation.code !== "capture-interrupted" ||
        limitation.stage === "sandbox-wrapper" || limitation.stage === "attempt-finalizer") &&
      ["command", "stdout", "stderr", "payload-byte", "blob-byte"].includes(limitation.target)
    ), {
    identifier: "SandboxCommandsAttachment",
    description: "canonical command receipts owned by the Sandbox wrapper",
  }),
);

export type SandboxCommandsAttachment = Schema.Schema.Type<
  typeof SandboxCommandsAttachmentSchema
>;

function streamRefs(
  stream: SandboxCommandsAttachment["segments"][number]["stdout"],
): readonly RecordBlobRef[] {
  return stream.storage.kind === "blob" ? [stream.storage.ref] : [];
}

export function sandboxCommandBlobRefs(
  payload: SandboxCommandsAttachment,
): readonly RecordBlobRef[] {
  return Object.freeze(payload.segments.flatMap((segment) => [
    ...streamRefs(segment.stdout),
    ...streamRefs(segment.stderr),
  ]));
}

function streamIntegrityIssues(
  stream: SandboxCommandsAttachment["segments"][number]["stdout"],
  blobs: ReadonlyMap<RecordBlobRef, Uint8Array>,
  path: readonly string[],
): readonly RecordAttachmentIssue[] {
  const bytes = stream.storage.kind === "inline"
    ? new TextEncoder().encode(stream.storage.text)
    : blobs.get(stream.storage.ref);
  if (
    bytes === undefined ||
    bytes.byteLength !== stream.retainedBytes ||
    stream.totalSafeUtf8Bytes < bytes.byteLength
  ) {
    return Object.freeze([
      recordAttachmentIssue("record-attachment-materialized-invalid", path),
    ]);
  }
  if (stream.storage.kind === "blob") {
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text)) {
        return Object.freeze([
          recordAttachmentIssue("record-attachment-materialized-invalid", path),
        ]);
      }
    } catch {
      return Object.freeze([
        recordAttachmentIssue("record-attachment-materialized-invalid", path),
      ]);
    }
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return "sha256" in stream && stream.sha256 !== sha256
    ? Object.freeze([recordAttachmentIssue("record-attachment-materialized-invalid", path)])
    : Object.freeze([]);
}

export function sandboxCommandsIntegrityIssues(
  payload: SandboxCommandsAttachment,
  blobs: readonly { readonly ref: RecordBlobRef; readonly bytes: Uint8Array }[],
): readonly RecordAttachmentIssue[] {
  const byRef = new Map(blobs.map((blob) => [blob.ref, blob.bytes] as const));
  return Object.freeze(payload.segments.flatMap((segment, index) => [
    ...streamIntegrityIssues(
      segment.stdout,
      byRef,
      ["segments", String(index), "stdout"],
    ),
    ...streamIntegrityIssues(
      segment.stderr,
      byRef,
      ["segments", String(index), "stderr"],
    ),
  ]));
}

const SandboxCommandsBlobBudget = Object.freeze({
  maximumBlobs: 4_000,
  maximumBlobBytes: 16 * 1024 * 1024,
  maximumTotalBytes: 64 * 1024 * 1024,
});

export const sandboxCommandsRecordAttachment = defineRecordAttachment({
  family: "niceeval.sandbox-commands",
  current: {
    schemaVersion: 1,
    owners: {
      attempt: {
        schema: SandboxCommandsAttachmentSchema,
        limits: FixedAttachmentValueLimits,
        blobs: {
          refs: sandboxCommandBlobRefs,
          budget: SandboxCommandsBlobBudget,
          verify: sandboxCommandsIntegrityIssues,
        },
      },
    },
  },
});
