import { createHash } from "node:crypto";

import { Effect, Result, Schema } from "effect";

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
  type SourceReceiptLimitation,
} from "../../source-receipt/index.ts";

/**
 * Revision 1 alone knows both the retired payload/blob retention words and
 * the inline/blob stream placement. Core replaces old BlobRefs with verified,
 * storage-neutral migration content tokens before this parser runs.
 */
const HistoricalContentSchema: Schema.Codec<RecordMigrationContent> = Schema.declare(
  isRecordMigrationContent,
);

const HistoricalRetentionTargetSchema = Schema.Literals([
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
]);

const HistoricalLimitationSchema = Schema.Union([
  Schema.Struct({
    code: Schema.Literals(["capture-failed", "capture-interrupted"]),
    stage: SourceReceiptStageSchema,
    target: HistoricalRetentionTargetSchema,
  }),
  Schema.Struct({
    code: Schema.Literals(["collection-cap-reached", "unsupported-input"]),
    target: HistoricalRetentionTargetSchema,
    omittedAtLeast: PositiveSafeIntegerSchema,
  }),
  Schema.Struct({
    code: Schema.Literals([
      "text-truncated",
      "redacted",
      "invalid-utf8-replaced",
      "unsafe-control-stripped",
    ]),
    target: HistoricalRetentionTargetSchema,
    replacementOrOmittedCount: PositiveSafeIntegerSchema,
  }),
]);

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

const HistoricalCollectionSchema = Schema.Union([
  Schema.Struct({
    state: Schema.Literal("complete"),
    limitations: EmptyArraySchema,
  }),
  Schema.Struct({
    state: Schema.Literal("partial"),
    limitations: Schema.NonEmptyArray(HistoricalLimitationSchema).pipe(
      Schema.check(Schema.makeFilter(canonicalHistoricalLimitations)),
    ),
  }),
]);

const HistoricalStreamSchema = Schema.Struct({
  storage: Schema.Union([
    Schema.Struct({ kind: Schema.Literal("inline"), text: SafeTextSchema }),
    Schema.Struct({ kind: Schema.Literal("blob"), ref: HistoricalContentSchema }),
  ]),
  retainedBytes: NonNegativeSafeIntegerSchema,
  totalSafeUtf8Bytes: NonNegativeSafeIntegerSchema,
  sha256: Sha256DigestSchema,
});

const HistoricalReceiptSchema = Schema.Struct({
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
  stdout: HistoricalStreamSchema,
  stderr: HistoricalStreamSchema,
});

const SandboxCommandsRevision1Schema = Schema.Struct({
  collection: HistoricalCollectionSchema,
  segments: Schema.Array(HistoricalReceiptSchema),
}).pipe(Schema.encodeKeys({ collection: "collection-data", segments: "segments-data" }));

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
): Result.Result<ParsedStream, RecordAttachmentIssue> {
  if (
    stream.retainedBytes > MAX_COMMAND_STREAM_BYTES ||
    stream.totalSafeUtf8Bytes < stream.retainedBytes
  ) {
    return Result.fail(invalid(path));
  }

  let bytes: Uint8Array;
  let text: string;
  if (stream.storage.kind === "inline") {
    text = stream.storage.text;
    bytes = encoder.encode(text);
    if (stream.retainedBytes > MAX_COMMAND_INLINE_STREAM_BYTES) {
      return Result.fail(invalid([...path, "storage"]));
    }
  } else {
    const resolved = document.content.bytes(stream.storage.ref);
    if (Result.isFailure(resolved)) return Result.fail(invalid([...path, "storage"]));
    bytes = resolved.success;
    try {
      text = decoder.decode(bytes);
    } catch {
      return Result.fail(invalid([...path, "storage"]));
    }
    if (unsafeControl.test(text)) return Result.fail(invalid([...path, "storage"]));
  }

  if (bytes.byteLength !== stream.retainedBytes) {
    return Result.fail(invalid([...path, "retainedBytes"]));
  }
  if (createHash("sha256").update(bytes).digest("hex") !== stream.sha256) {
    return Result.fail(invalid([...path, "sha256"]));
  }
  return Result.succeed(Object.freeze({
    text,
    retainedBytes: stream.retainedBytes,
    totalSafeUtf8Bytes: stream.totalSafeUtf8Bytes,
    sha256: stream.sha256,
  }));
}

function parseSandboxCommandsRevision1(
  document: RecordMigrationDocument,
): Result.Result<SandboxCommandsRevision1, RecordAttachmentIssue> {
  const decoded = Schema.decodeUnknownResult(
    SandboxCommandsRevision1Schema,
    RecordExactParseOptions,
  )(document.value);
  if (Result.isFailure(decoded)) return Result.fail(invalid([]));
  if (
    !hasCanonicalSourceSegments(decoded.success.segments) ||
    new Set(decoded.success.segments.map((segment) => segment.commandId)).size !== decoded.success.segments.length
  ) {
    return Result.fail(invalid(["segments"]));
  }
  if (!decoded.success.collection.limitations.every((limitation) =>
    (limitation.code !== "capture-failed" && limitation.code !== "capture-interrupted" ||
      limitation.stage === "sandbox-wrapper" || limitation.stage === "attempt-finalizer") &&
    ["command", "stdout", "stderr", "payload-byte", "blob-byte"].includes(limitation.target)
  )) {
    return Result.fail(invalid(["collection", "limitations"]));
  }

  const segments: SandboxCommandsRevision1["segments"][number][] = [];
  for (const [index, segment] of decoded.success.segments.entries()) {
    const stdout = verifiedStream(document, segment.stdout, ["segments", String(index), "stdout"]);
    if (Result.isFailure(stdout)) return Result.fail(stdout.failure);
    const stderr = verifiedStream(document, segment.stderr, ["segments", String(index), "stderr"]);
    if (Result.isFailure(stderr)) return Result.fail(stderr.failure);
    segments.push(Object.freeze({
      segmentId: segment.segmentId,
      commandId: segment.commandId,
      sequence: segment.sequence,
      turnId: segment.turnId,
      phase: segment.phase,
      invocation: segment.invocation,
      workingDirectory: segment.workingDirectory,
      outcome: segment.outcome,
      stdout: stdout.success,
      stderr: stderr.success,
    }));
  }
  return Result.succeed(Object.freeze({
    collection: decoded.success.collection,
    segments: Object.freeze(segments),
  }));
}

function migrateTarget(
  target: HistoricalLimitation["target"],
): SourceReceiptLimitation["target"] {
  switch (target) {
    case "payload-byte":
      return "value-byte";
    case "blob-byte":
      return "content-byte";
    default:
      return target;
  }
}

function migrateLimitation(
  limitation: HistoricalLimitation,
): SourceReceiptLimitation {
  switch (limitation.code) {
    case "capture-failed":
    case "capture-interrupted":
      return Object.freeze({
        code: limitation.code,
        stage: limitation.stage,
        target: migrateTarget(limitation.target),
      });
    case "collection-cap-reached":
    case "unsupported-input":
      return Object.freeze({
        code: limitation.code,
        target: migrateTarget(limitation.target),
        omittedAtLeast: limitation.omittedAtLeast,
      });
    case "text-truncated":
    case "redacted":
    case "invalid-utf8-replaced":
    case "unsafe-control-stripped":
      return Object.freeze({
        code: limitation.code,
        target: migrateTarget(limitation.target),
        replacementOrOmittedCount: limitation.replacementOrOmittedCount,
      });
  }
}

function migrateCollection(
  collection: SandboxCommandsRevision1["collection"],
): SourceReceiptCollection {
  if (collection.state === "complete") return collection;
  const [first, ...rest] = collection.limitations;
  const limitations = [migrateLimitation(first), ...rest.map(migrateLimitation)].sort((left, right) => {
    const leftKey = JSON.stringify(left);
    const rightKey = JSON.stringify(right);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  const [canonicalFirst, ...canonicalRest] = limitations;
  if (canonicalFirst === undefined) {
    throw new Error("non-empty historical limitations became empty");
  }
  const canonicalLimitations: readonly [
    SourceReceiptLimitation,
    ...SourceReceiptLimitation[],
  ] = [canonicalFirst, ...canonicalRest];
  return Object.freeze({
    state: "partial",
    limitations: canonicalLimitations,
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
