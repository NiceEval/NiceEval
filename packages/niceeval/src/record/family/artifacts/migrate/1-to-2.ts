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
  ArtifactIdSchema,
  Sha256DigestSchema,
} from "../../../codec/identifiers.ts";
import {
  CollectionStateSchema,
  MediaTypeSchema,
  NonNegativeSafeIntegerSchema,
  SafeTextSchema,
  isCanonicalIdentitySequence,
} from "../../common.ts";
import { ArtifactsLimits } from "../schema.ts";

/** Revision-1 BlobRefs arrive as verified, storage-neutral Core tokens. */
const HistoricalContentSchema: Schema.Codec<RecordMigrationContent> = Schema.declare(
  isRecordMigrationContent,
);

const HistoricalArtifactSchema = Schema.Struct({
  artifactId: ArtifactIdSchema,
  mediaType: Schema.toType(MediaTypeSchema),
  label: Schema.toType(SafeTextSchema),
  byteLength: NonNegativeSafeIntegerSchema,
  sha256: Sha256DigestSchema,
  content: HistoricalContentSchema,
});

const ArtifactsRevision1Schema = Schema.Struct({
  collection: Schema.toType(CollectionStateSchema),
  artifacts: Schema.Array(HistoricalArtifactSchema),
}).pipe(Schema.encodeKeys({ collection: "collection-data", artifacts: "artifacts-data" }));

type HistoricalArtifactsRevision1 = typeof ArtifactsRevision1Schema.Type;
type ArtifactsRevision1 = {
  readonly collection: HistoricalArtifactsRevision1["collection"];
  readonly artifacts: readonly (Omit<HistoricalArtifactsRevision1["artifacts"][number], "content"> & {
    readonly bytes: Uint8Array;
  })[];
};

const maximumTotalContentBytes = 128 * 1024 * 1024;

function invalid(path: readonly string[]): RecordAttachmentIssue {
  return recordAttachmentIssue("record-attachment-schema-invalid", path);
}

function verifiedBytes(
  document: RecordMigrationDocument,
  artifact: HistoricalArtifactsRevision1["artifacts"][number],
  path: readonly string[],
): Result.Result<Uint8Array, RecordAttachmentIssue> {
  const bytes = document.content.bytes(artifact.content);
  if (Result.isFailure(bytes)) return Result.fail(invalid([...path, "content"]));
  if (bytes.success.byteLength !== artifact.byteLength) {
    return Result.fail(invalid([...path, "byteLength"]));
  }
  if (createHash("sha256").update(bytes.success).digest("hex") !== artifact.sha256) {
    return Result.fail(invalid([...path, "sha256"]));
  }
  return Result.succeed(bytes.success);
}

function parseArtifactsRevision1(
  document: RecordMigrationDocument,
): Result.Result<ArtifactsRevision1, RecordAttachmentIssue> {
  const decoded = Schema.decodeUnknownResult(
    ArtifactsRevision1Schema,
    RecordExactParseOptions,
  )(document.value);
  if (Result.isFailure(decoded)) return Result.fail(invalid([]));
  if (
    decoded.success.artifacts.length > ArtifactsLimits.maximumArtifacts ||
    !isCanonicalIdentitySequence(decoded.success.artifacts.map((artifact) => artifact.artifactId))
  ) {
    return Result.fail(invalid(["artifacts"]));
  }

  let totalBytes = 0;
  const artifacts: ArtifactsRevision1["artifacts"][number][] = [];
  for (const [index, artifact] of decoded.success.artifacts.entries()) {
    totalBytes += artifact.byteLength;
    if (
      artifact.byteLength > ArtifactsLimits.maximumContentBytes ||
      totalBytes > maximumTotalContentBytes
    ) {
      return Result.fail(invalid(["artifacts", String(index), "byteLength"]));
    }
    const bytes = verifiedBytes(document, artifact, ["artifacts", String(index)]);
    if (Result.isFailure(bytes)) return Result.fail(bytes.failure);
    artifacts.push(Object.freeze({
      artifactId: artifact.artifactId,
      mediaType: artifact.mediaType,
      label: artifact.label,
      byteLength: artifact.byteLength,
      sha256: artifact.sha256,
      bytes: bytes.success,
    }));
  }
  return Result.succeed(Object.freeze({
    collection: decoded.success.collection,
    artifacts: Object.freeze(artifacts),
  }));
}

/** Attempt and Run Artifacts have the same revision-1 identity and payload. */
export const artifactsV1ToV2 = defineRecordMigration({
  from: 1,
  to: 2,
  parse: parseArtifactsRevision1,
  migrate: ({ value: previous, build }) => {
    const impact: RecordMigrationImpact[] = [];
    const artifacts = previous.artifacts.map((artifact, index) => {
      impact.push(Object.freeze({
        code: "migration-content-retained" as const,
        path: Object.freeze(["artifacts", String(index), "content"]),
        count: 1,
        recommendation: "none" as const,
      }));
      return Object.freeze({
        artifactId: artifact.artifactId,
        mediaType: artifact.mediaType,
        label: artifact.label,
        byteLength: artifact.byteLength,
        sha256: artifact.sha256,
        content: build.content.bytes(artifact.bytes),
      });
    });
    return Effect.succeed(Object.freeze({
      value: Object.freeze({
        collection: previous.collection,
        artifacts: Object.freeze(artifacts),
      }),
      references: Object.freeze([]),
      impact: Object.freeze(impact),
    }));
  },
});
