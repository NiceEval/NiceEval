import { Schema } from "effect";

import {
  RecordBytesContentSchema,
  recordAttachmentIssue,
  recordContent,
  type RecordAttachmentIssue,
} from "../../attachment/index.ts";
import {
  ArtifactIdSchema,
  Sha256DigestSchema,
} from "../../codec/identifiers.ts";
import {
  CollectionStateSchema,
  MediaTypeSchema,
  NonNegativeSafeIntegerSchema,
  SafeTextSchema,
  isCanonicalIdentitySequence,
} from "../common.ts";

export const ArtifactsLimits = Object.freeze({
  maximumArtifacts: 4_000,
  maximumContentBytes: 64 * 1024 * 1024,
});

/** sha256 identifies the Artifact bytes fact, never its physical placement. */
export const ArtifactSchema = Schema.Struct({
  artifactId: ArtifactIdSchema,
  mediaType: Schema.toType(MediaTypeSchema),
  label: Schema.toType(SafeTextSchema),
  byteLength: NonNegativeSafeIntegerSchema,
  sha256: Sha256DigestSchema,
  content: RecordBytesContentSchema.pipe(
    recordContent.maximumBytes(ArtifactsLimits.maximumContentBytes),
  ),
});

export type Artifact = Schema.Schema.Type<typeof ArtifactSchema>;

/** One owner-local, typed file collection. Owner may be an origin Run or Attempt. */
export const ArtifactsAttachmentSchema = Schema.Struct({
  collection: Schema.toType(CollectionStateSchema),
  artifacts: Schema.Array(ArtifactSchema),
}).pipe(Schema.encodeKeys({ collection: "collection-data", artifacts: "artifacts-data" }));

export type ArtifactsAttachment = Schema.Schema.Type<
  typeof ArtifactsAttachmentSchema
>;

function invalid(path: readonly string[]): RecordAttachmentIssue {
  return recordAttachmentIssue("record-attachment-schema-invalid", path);
}

/**
 * Core enforces the content declaration limit and owns physical read
 * integrity. This logical validator cannot open a sealed content handle;
 * producers must derive byteLength and sha256 from the same source they seal.
 */
export function validateArtifactsAttachment(
  value: ArtifactsAttachment,
): readonly RecordAttachmentIssue[] {
  const issues: RecordAttachmentIssue[] = [];
  if (value.artifacts.length > ArtifactsLimits.maximumArtifacts) {
    issues.push(invalid(["artifacts"]));
  }
  if (!isCanonicalIdentitySequence(value.artifacts.map((artifact) => artifact.artifactId))) {
    issues.push(invalid(["artifacts", "artifactId"]));
  }
  for (const [index, artifact] of value.artifacts.entries()) {
    if (artifact.byteLength > ArtifactsLimits.maximumContentBytes) {
      issues.push(invalid(["artifacts", String(index), "byteLength"]));
    }
  }
  return Object.freeze(issues);
}
