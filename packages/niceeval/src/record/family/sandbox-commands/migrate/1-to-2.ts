import { createHash } from "node:crypto";

import { Effect, Either, Schema } from "effect";

import {
  defineRecordMigration,
  recordAttachmentIssue,
  type RecordAttachmentIssue,
  type RecordMigrationContent,
  type RecordMigrationDocument,
  type RecordMigrationImpact,
} from "../../../attachment/index.ts";
import { isRecordMigrationContent } from "../../../attachment/protocol.ts";
import { RecordExactParseOptions } from "../../../codec/core.ts";
import {
  CanonicalProjectRelativePathSchema,
  Sha256DigestSchema,
} from "../../../codec/identifiers.ts";
import {
  EmptyArraySchema,
  NonNegativeSafeIntegerSchema,
  PositiveSafeIntegerSchema,
  SafeIdentifierSchema,
  SafeTextSchema,
} from "../../common.ts";
import { TurnIdSchema } from "../../source-receipt/codec.ts";
import {
  MAX_COMMAND_INLINE_STREAM_BYTES,
  MAX_COMMAND_STREAM_BYTES,
} from "../../source-receipt/limits.ts";
import {
  SourceReceiptStageSchema,
  SourceSegmentIdSchema,
  hasCanonicalSourceSegments,
  type SourceReceiptCollection,
} from "../../source-receipt/index.ts";

/**
 * Revision 1 alone knows both the retired payload/blob retention words and
 * the inline/blob stream placement. Core replaces old BlobRefs with verified,
 * storage-neutral migration content tokens before this parser runs.
 */
const HistoricalContentSchema: Schema.Schema<RecordMigrationContent> = Schema.declare(
  isRecordMigrationContent,
);

const HistoricalRetentionTargetSchema = Schema.Literal(
  "turn",
  "turn-item",
  "usage-observation",
  "turn-context",
  "command",
  "stdout",
  "stderr",
  "activity",
  "diagnostic",
  "diagnostic-cause",
  "payload-byte",
  "blob-byte",
);

const HistoricalLimitationSchema = Schema.Union(
  Schema.Struct({
    code: Schema.Literal("capture-failed", "capture-interrupted"),
    stage: SourceReceiptStageSchema,
    target: HistoricalRetentionTargetSchema,
  }),
  Schema.Struct({
    code: Schema.Literal("collection-cap-reached", "unsupported-input"),
    target: HistoricalRetentionTargetSchema,
    omittedAtLeast: PositiveSafeIntegerSchema,
  }),
  Schema.Struct({
    code: Schema.Literal(
      "text-truncated",
      "redacted",
      "invalid-utf8-replaced",
      "unsafe-control-stripped",
    ),
    target: HistoricalRetentionTargetSchema,
    replacementOrOmittedCount: PositiveSafeIntegerSchema,
  }),
);

type HistoricalLimitation = typeof HistoricalLimitationSchema.Type;

function canonicalHistoricalLimitations(values: readonly HistoricalLimitation[]): boolean {
  let previous: string | undefined;
  const seen = new Set<string>();
  for (const value of values) {
    const key = JSON.stringify(value);
    if (seen.has(key) || (previous !== undefined && previous >= key)) return false;
    seen.add(key);
    previous = key;
  }
  return true;
}

const HistoricalCollectionSchema = Schema.Union(
  Schema.Struct({
    state: Schema.Literal("complete"),
    limitations: EmptyArraySchema,
  }),
  Schema.Struct({
    state: Schema.Literal("partial"),
    limitations: Schema.NonEmptyArray(HistoricalLimitationSchema).pipe(
      Schema.filter(canonicalHistoricalLimitations),
    ),
  }),
);

const HistoricalStreamSchema = Schema.Struct({
  storage: Schema.Union(
    Schema.Struct({ kind: Schema.Literal("inline"), text: SafeTextSchema }),
    Schema.Struct({ kind: Schema.Literal("blob"), ref: HistoricalContentSchema }),
  ),
  retainedBytes: NonNegativeSafeIntegerSchema,
  totalSafeUtf8Bytes: NonNegativeSafeIntegerSchema,
  sha256: Sha256DigestSchema,
});

const HistoricalReceiptSchema = Schema.Struct({
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
  stdout: HistoricalStreamSchema,
  stderr: HistoricalStreamSchema,
});

const SandboxCommandsRevision1Schema = Schema.Struct({
  collection: Schema.propertySignature(HistoricalCollectionSchema).pipe(
    Schema.fromKey("collection-data"),
  ),
  segments: Schema.propertySignature(Schema.Array(HistoricalReceiptSchema)).pipe(
    Schema.fromKey("segments-data"),
  ),
});

type HistoricalSandboxCommandsRevision1 = typeof SandboxCommandsRevision1Schema.Type;
type HistoricalStream = typeof HistoricalStreamSchema.Type;
type ParsedStream = Omit<HistoricalStream, "storage"> & { readonly text: string };
type SandboxCommandsRevision1 = {
  readonly collection: HistoricalSandboxCommandsRevision1["collection"];
  readonly segments: readonly (Omit<HistoricalSandboxCommandsRevision1["segments"][number], "stdout" | "stderr"> & {
    readonly stdout: ParsedStream;
    readonly stderr: ParsedStream;
  })[];
};

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const unsafeControl = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;

function invalid(path: readonly string[]): RecordAttachmentIssue {
  return recordAttachmentIssue("record-attachment-schema-invalid", path);
}

function verifiedStream(
  document: RecordMigrationDocument,
  stream: HistoricalStream,
  path: readonly string[],
): Either.Either<ParsedStream, RecordAttachmentIssue> {
  if (
    stream.retainedBytes > MAX_COMMAND_STREAM_BYTES ||
    stream.totalSafeUtf8Bytes < stream.retainedBytes
  ) {
    return Either.left(invalid(path));
  }

  let bytes: Uint8Array;
  let text: string;
  if (stream.storage.kind === "inline") {
    text = stream.storage.text;
    bytes = encoder.encode(text);
    if (stream.retainedBytes > MAX_COMMAND_INLINE_STREAM_BYTES) {
      return Either.left(invalid([...path, "storage"]));
    }
  } else {
    const resolved = document.content.bytes(stream.storage.ref);
    if (Either.isLeft(resolved)) return Either.left(invalid([...path, "storage"]));
    bytes = resolved.right;
    try {
      text = decoder.decode(bytes);
    } catch {
      return Either.left(invalid([...path, "storage"]));
    }
    if (unsafeControl.test(text)) return Either.left(invalid([...path, "storage"]));
  }

  if (bytes.byteLength !== stream.retainedBytes) {
    return Either.left(invalid([...path, "retainedBytes"]));
  }
  if (createHash("sha256").update(bytes).digest("hex") !== stream.sha256) {
    return Either.left(invalid([...path, "sha256"]));
  }
  return Either.right(Object.freeze({
    text,
    retainedBytes: stream.retainedBytes,
    totalSafeUtf8Bytes: stream.totalSafeUtf8Bytes,
    sha256: stream.sha256,
  }));
}

function parseSandboxCommandsRevision1(
  document: RecordMigrationDocument,
): Either.Either<SandboxCommandsRevision1, RecordAttachmentIssue> {
  const decoded = Schema.decodeUnknownEither(
    SandboxCommandsRevision1Schema,
    RecordExactParseOptions,
  )(document.value);
  if (Either.isLeft(decoded)) return Either.left(invalid([]));
  if (
    !hasCanonicalSourceSegments(decoded.right.segments) ||
    new Set(decoded.right.segments.map((segment) => segment.commandId)).size !== decoded.right.segments.length
  ) {
    return Either.left(invalid(["segments"]));
  }
  if (!decoded.right.collection.limitations.every((limitation) =>
    (limitation.code !== "capture-failed" && limitation.code !== "capture-interrupted" ||
      limitation.stage === "sandbox-wrapper" || limitation.stage === "attempt-finalizer") &&
    ["command", "stdout", "stderr", "payload-byte", "blob-byte"].includes(limitation.target)
  )) {
    return Either.left(invalid(["collection", "limitations"]));
  }

  const segments: SandboxCommandsRevision1["segments"][number][] = [];
  for (const [index, segment] of decoded.right.segments.entries()) {
    const stdout = verifiedStream(document, segment.stdout, ["segments", String(index), "stdout"]);
    if (Either.isLeft(stdout)) return Either.left(stdout.left);
    const stderr = verifiedStream(document, segment.stderr, ["segments", String(index), "stderr"]);
    if (Either.isLeft(stderr)) return Either.left(stderr.left);
    segments.push(Object.freeze({
      segmentId: segment.segmentId,
      commandId: segment.commandId,
      sequence: segment.sequence,
      turnId: segment.turnId,
      phase: segment.phase,
      invocation: segment.invocation,
      workingDirectory: segment.workingDirectory,
      outcome: segment.outcome,
      stdout: stdout.right,
      stderr: stderr.right,
    }));
  }
  return Either.right(Object.freeze({
    collection: decoded.right.collection,
    segments: Object.freeze(segments),
  }));
}

function migrateCollection(
  collection: SandboxCommandsRevision1["collection"],
): SourceReceiptCollection {
  if (collection.state === "complete") return collection;
  const limitations = collection.limitations.map((limitation) => Object.freeze({
    ...limitation,
    target: limitation.target === "payload-byte"
      ? "value-byte" as const
      : limitation.target === "blob-byte"
        ? "content-byte" as const
        : limitation.target,
  })).sort((left, right) => {
    const leftKey = JSON.stringify(left);
    const rightKey = JSON.stringify(right);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  return Object.freeze({
    state: "partial" as const,
    limitations: Object.freeze(limitations) as unknown as Extract<
      SourceReceiptCollection,
      { readonly state: "partial" }
    >["limitations"],
  });
}

export const sandboxCommandsV1ToV2 = defineRecordMigration({
  from: 1,
  to: 2,
  parse: parseSandboxCommandsRevision1,
  migrate: ({ value: previous, build }) => {
    const impact: RecordMigrationImpact[] = [];
    const segments = previous.segments.map((segment, index) => {
      const stream = (name: "stdout" | "stderr", value: ParsedStream) => {
        impact.push(Object.freeze({
          code: "migration-content-retained" as const,
          path: Object.freeze(["segments", String(index), name, "content"]),
          count: 1,
          recommendation: "none" as const,
        }));
        return Object.freeze({
          content: build.content.text(value.text),
          retainedBytes: value.retainedBytes,
          totalSafeUtf8Bytes: value.totalSafeUtf8Bytes,
          sha256: value.sha256,
        });
      };
      return Object.freeze({
        segmentId: segment.segmentId,
        commandId: segment.commandId,
        sequence: segment.sequence,
        turnId: segment.turnId,
        phase: segment.phase,
        invocation: segment.invocation,
        workingDirectory: segment.workingDirectory,
        outcome: segment.outcome,
        stdout: stream("stdout", segment.stdout),
        stderr: stream("stderr", segment.stderr),
      });
    });
    return Effect.succeed(Object.freeze({
      value: Object.freeze({
        collection: migrateCollection(previous.collection),
        segments: Object.freeze(segments),
      }),
      references: Object.freeze([]),
      impact: Object.freeze(impact),
    }));
  },
});
