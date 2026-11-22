import * as Schema from "effect/Schema";

import {
  RecordBytesContentSchema,
  recordAttachmentIssue,
  type RecordAttachmentIssue,
} from "../../attachment/index.ts";
import { ArtifactIdSchema, Sha256DigestSchema } from "../../codec/identifiers.ts";
import {
  CollectionStateSchema,
  MediaTypeSchema,
  NonNegativeSafeIntegerSchema,
  SafeTextSchema,
  isCanonicalIdentitySequence,
} from "../common.ts";

/** sha256 identifies the Artifact bytes fact, never its physical placement. */
export const ArtifactSchema = Schema.Struct({
  artifactId: ArtifactIdSchema,
  mediaType: Schema.toType(MediaTypeSchema),
  label: Schema.toType(SafeTextSchema),
  byteLength: NonNegativeSafeIntegerSchema,
  sha256: Sha256DigestSchema,
  content: RecordBytesContentSchema,
});

export type Artifact = Schema.Schema.Type<typeof ArtifactSchema>;

/** One owner-local, typed file collection. Owner may be an origin Run or Attempt. */
export const ArtifactsAttachmentSchema = Schema.Struct({
  collection: Schema.toType(CollectionStateSchema),
  artifacts: Schema.Array(ArtifactSchema),
}).pipe(Schema.encodeKeys({ collection: "collection-data", artifacts: "artifacts-data" }));

export type ArtifactsAttachment = Schema.Schema.Type<typeof ArtifactsAttachmentSchema>;

function invalid(path: readonly string[]): RecordAttachmentIssue {
  return recordAttachmentIssue("record-attachment-schema-invalid", path);
}

/**
 * Core owns physical read integrity. This logical validator cannot open a sealed content handle;
 * producers must derive byteLength and sha256 from the same source they seal.
 */
export function validateArtifactsAttachment(value: ArtifactsAttachment): readonly RecordAttachmentIssue[] {
  const issues: RecordAttachmentIssue[] = [];
  if (!isCanonicalIdentitySequence(value.artifacts.map((artifact) => artifact.artifactId))) {
    issues.push(invalid(["artifacts", "artifactId"]));
  }
  return issues;
}
