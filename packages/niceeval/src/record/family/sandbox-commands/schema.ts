import { Schema } from "effect";

import {
  RecordTextContentSchema,
  recordAttachmentIssue,
  recordContent,
  type RecordAttachmentIssue,
} from "../../attachment/index.ts";
import {
  CanonicalProjectRelativePathSchema,
  Sha256DigestSchema,
} from "../../codec/identifiers.ts";
import { TurnIdSchema } from "../source-receipt/codec.ts";
import { MAX_COMMAND_STREAM_BYTES } from "../source-receipt/limits.ts";
import {
  NonNegativeSafeIntegerSchema,
  PositiveSafeIntegerSchema,
  SafeIdentifierSchema,
  SafeTextSchema,
} from "../common.ts";
import {
  SourceReceiptCollectionSchema,
  SourceSegmentIdSchema,
  hasCanonicalSourceSegments,
} from "../source-receipt/index.ts";

/**
 * Command text is a logical handle; inline/object placement belongs to Record
 * Core. sha256 identifies the sanitized stream fact, not physical placement.
 */
export const SandboxCommandStreamSchema = Schema.Struct({
  content: RecordTextContentSchema.pipe(
    recordContent.maximumBytes(MAX_COMMAND_STREAM_BYTES),
  ),
  retainedBytes: NonNegativeSafeIntegerSchema,
  totalSafeUtf8Bytes: NonNegativeSafeIntegerSchema,
  sha256: Sha256DigestSchema,
});

export const SandboxCommandReceiptSchema = Schema.Struct({
  segmentId: SourceSegmentIdSchema,
  commandId: SafeIdentifierSchema,
  sequence: PositiveSafeIntegerSchema,
  turnId: Schema.NullOr(TurnIdSchema),
  phase: Schema.Literals(["attempt.setup", "sandbox.prepare", "agent.ensure", "eval.run", "sandbox.command", "attempt.teardown"]),
  invocation: Schema.Union([
    Schema.Struct({ kind: Schema.Literal("argv"), executable: SafeTextSchema, arguments: Schema.Array(SafeTextSchema) }),
    Schema.Struct({ kind: Schema.Literal("shell"), command: SafeTextSchema }),
  ]),
  workingDirectory: Schema.Union([
    Schema.Struct({ kind: Schema.Literal("sandbox-default") }),
    Schema.Struct({ kind: Schema.Literal("project-relative"), path: CanonicalProjectRelativePathSchema }),
    Schema.Struct({ kind: Schema.Literal("redacted") }),
  ]),
  outcome: Schema.Union([
    Schema.Struct({ kind: Schema.Literal("exited"), exitCode: Schema.Number.pipe(Schema.check(Schema.makeFilter((value) => Number.isSafeInteger(value) && value >= -2_147_483_648 && value <= 2_147_483_647))) }),
    Schema.Struct({ kind: Schema.Literal("terminated"), reason: Schema.Literals(["timeout", "cancelled", "transport-lost"]) }),
    Schema.Struct({ kind: Schema.Literal("not-started"), reason: Schema.Literals(["spawn-failed", "cancelled-before-start"]) }),
  ]),
  stdout: SandboxCommandStreamSchema,
  stderr: SandboxCommandStreamSchema,
});

export const SandboxCommandsAttachmentSchema = Schema.Struct({
  collection: SourceReceiptCollectionSchema,
  segments: Schema.Array(SandboxCommandReceiptSchema),
}).pipe(Schema.encodeKeys({ collection: "collection-data", segments: "segments-data" }));

export type SandboxCommandsAttachment = Schema.Schema.Type<
  typeof SandboxCommandsAttachmentSchema
>;

function invalid(path: readonly string[]): RecordAttachmentIssue {
  return recordAttachmentIssue("record-attachment-schema-invalid", path);
}

/**
 * Owner-local business invariants, deliberately independent of content
 * storage. Core enforces the content declaration limit and owns physical read
 * integrity. This validator cannot open sealed handles; producers must derive
 * retainedBytes and sha256 from the same sanitized stream they seal.
 */
export function validateSandboxCommandsAttachment(
  value: SandboxCommandsAttachment,
): readonly RecordAttachmentIssue[] {
  const issues: RecordAttachmentIssue[] = [];
  if (!hasCanonicalSourceSegments(value.segments)) {
    issues.push(invalid(["segments"]));
  }
  if (new Set(value.segments.map((segment) => segment.commandId)).size !== value.segments.length) {
    issues.push(invalid(["segments", "commandId"]));
  }
  for (const [index, segment] of value.segments.entries()) {
    for (const [name, stream] of [["stdout", segment.stdout], ["stderr", segment.stderr]] as const) {
      if (
        stream.retainedBytes > MAX_COMMAND_STREAM_BYTES ||
        stream.totalSafeUtf8Bytes < stream.retainedBytes
      ) {
        issues.push(invalid(["segments", String(index), name]));
      }
    }
  }
  if (!value.collection.limitations.every((limitation) =>
    (limitation.code !== "capture-failed" && limitation.code !== "capture-interrupted" ||
      limitation.stage === "sandbox-wrapper" || limitation.stage === "attempt-finalizer") &&
    ["command", "stdout", "stderr", "value-byte", "content-byte"].includes(limitation.target)
  )) {
    issues.push(invalid(["collection", "limitations"]));
  }
  return Object.freeze(issues);
}
