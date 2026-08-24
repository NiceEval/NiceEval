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
const HistoricalContentSchema: Schema.Schema<RecordMigrationContent> = Schema.declare(
  isRecordMigrationContent,
);

const HistoricalArtifactSchema = Schema.Struct({
  artifactId: ArtifactIdSchema,
  mediaType: MediaTypeSchema,
  label: SafeTextSchema,
  byteLength: NonNegativeSafeIntegerSchema,
  sha256: Sha256DigestSchema,
  content: HistoricalContentSchema,
});

const ArtifactsRevision1Schema = Schema.Struct({
  collection: Schema.propertySignature(CollectionStateSchema).pipe(
    Schema.fromKey("collection-data"),
  ),
  artifacts: Schema.propertySignature(Schema.Array(HistoricalArtifactSchema)).pipe(
    Schema.fromKey("artifacts-data"),
  ),
});

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
): Either.Either<Uint8Array, RecordAttachmentIssue> {
  const bytes = document.content.bytes(artifact.content);
  if (Either.isLeft(bytes)) return Either.left(invalid([...path, "content"]));
  if (bytes.right.byteLength !== artifact.byteLength) {
    return Either.left(invalid([...path, "byteLength"]));
  }
  if (createHash("sha256").update(bytes.right).digest("hex") !== artifact.sha256) {
    return Either.left(invalid([...path, "sha256"]));
  }
  return Either.right(bytes.right);
}

function parseArtifactsRevision1(
  document: RecordMigrationDocument,
): Either.Either<ArtifactsRevision1, RecordAttachmentIssue> {
  const decoded = Schema.decodeUnknownEither(
    ArtifactsRevision1Schema,
    RecordExactParseOptions,
  )(document.value);
  if (Either.isLeft(decoded)) return Either.left(invalid([]));
  if (
    decoded.right.artifacts.length > ArtifactsLimits.maximumArtifacts ||
    !isCanonicalIdentitySequence(decoded.right.artifacts.map((artifact) => artifact.artifactId))
  ) {
    return Either.left(invalid(["artifacts"]));
  }

  let totalBytes = 0;
  const artifacts: ArtifactsRevision1["artifacts"][number][] = [];
  for (const [index, artifact] of decoded.right.artifacts.entries()) {
    totalBytes += artifact.byteLength;
    if (
      artifact.byteLength > ArtifactsLimits.maximumContentBytes ||
      totalBytes > maximumTotalContentBytes
    ) {
      return Either.left(invalid(["artifacts", String(index), "byteLength"]));
    }
    const bytes = verifiedBytes(document, artifact, ["artifacts", String(index)]);
    if (Either.isLeft(bytes)) return Either.left(bytes.left);
    artifacts.push(Object.freeze({
      artifactId: artifact.artifactId,
      mediaType: artifact.mediaType,
      label: artifact.label,
      byteLength: artifact.byteLength,
      sha256: artifact.sha256,
      bytes: bytes.right,
    }));
  }
  return Either.right(Object.freeze({
    collection: decoded.right.collection,
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
