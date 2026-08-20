import { createHash } from "node:crypto";

import { Schema } from "effect";
import {
  ArtifactIdSchema,
  Sha256DigestSchema,
} from "../codec/identifiers.ts";
import {
  RecordBlobRefSchema,
  type RecordBlobRef,
} from "../attachment/blob-ref.ts";
import { recordAttachmentIssue, type RecordAttachmentIssue } from "../attachment/errors.ts";
import { defineRecordAttachment } from "../definition/index.ts";
import {
  CollectionStateSchema,
  FixedAttachmentValueLimits,
  MediaTypeSchema,
  NonNegativeSafeIntegerSchema,
  SafeTextSchema,
  isCanonicalIdentitySequence,
} from "./common.ts";

export const ArtifactSchema = Schema.Struct({
  artifactId: ArtifactIdSchema,
  mediaType: MediaTypeSchema,
  label: SafeTextSchema,
  byteLength: NonNegativeSafeIntegerSchema,
  sha256: Sha256DigestSchema,
  content: RecordBlobRefSchema,
});

export type Artifact = Schema.Schema.Type<typeof ArtifactSchema>;

/** One owner-local, typed file collection. Owner may be an origin Run or Attempt. */
export const ArtifactsAttachmentSchema = Schema.Struct({
  collection: Schema.propertySignature(CollectionStateSchema).pipe(
    Schema.fromKey("collection-data"),
  ),
  artifacts: Schema.propertySignature(Schema.Array(ArtifactSchema)).pipe(
    Schema.fromKey("artifacts-data"),
  ),
}).pipe(
  Schema.filter(
    (payload) =>
      isCanonicalIdentitySequence(payload.artifacts.map((artifact) => artifact.artifactId)),
    {
      identifier: "ArtifactsAttachment",
      description: "canonical artifact identities with no duplicates",
    },
  ),
);

export type ArtifactsAttachment = Schema.Schema.Type<
  typeof ArtifactsAttachmentSchema
>;

export function artifactBlobRefs(
  payload: ArtifactsAttachment,
): readonly RecordBlobRef[] {
  return Object.freeze(payload.artifacts.map((artifact) => artifact.content));
}

/** Binds every Artifact byte claim to the materialized fixed-family closure. */
export function artifactsAttachmentIntegrityIssues(
  payload: ArtifactsAttachment,
  blobs: readonly { readonly ref: RecordBlobRef; readonly bytes: Uint8Array }[],
): readonly RecordAttachmentIssue[] {
  const bytesByRef = new Map<RecordBlobRef, Uint8Array>(
    blobs.map((blob) => [blob.ref, blob.bytes] as const),
  );
  const issues: RecordAttachmentIssue[] = [];
  for (const [index, artifact] of payload.artifacts.entries()) {
    const bytes = bytesByRef.get(artifact.content);
    if (bytes === undefined) {
      issues.push(recordAttachmentIssue("record-attachment-materialized-invalid", ["artifacts", String(index), "content"]));
      continue;
    }
    if (bytes.byteLength !== artifact.byteLength) {
      issues.push(recordAttachmentIssue("record-attachment-materialized-invalid", ["artifacts", String(index), "byteLength"]));
    }
    if (createHash("sha256").update(bytes).digest("hex") !== artifact.sha256) {
      issues.push(recordAttachmentIssue("record-attachment-materialized-invalid", ["artifacts", String(index), "sha256"]));
    }
  }
  return Object.freeze(issues);
}

const ArtifactsBlobBudget = Object.freeze({
  maximumBlobs: 4_000,
  maximumBlobBytes: 64 * 1024 * 1024,
  maximumTotalBytes: 128 * 1024 * 1024,
});

/** One family declaration owns both Attempt- and Run-owned artifacts. */
export const artifactsRecordAttachment = defineRecordAttachment({
  family: "niceeval.artifacts",
  current: {
    schemaVersion: 1,
    owners: {
      attempt: {
        schema: ArtifactsAttachmentSchema,
        limits: FixedAttachmentValueLimits,
        blobs: {
          refs: artifactBlobRefs,
          budget: ArtifactsBlobBudget,
          verify: artifactsAttachmentIntegrityIssues,
        },
      },
      run: {
        schema: ArtifactsAttachmentSchema,
        limits: FixedAttachmentValueLimits,
        blobs: {
          refs: artifactBlobRefs,
          budget: ArtifactsBlobBudget,
          verify: artifactsAttachmentIntegrityIssues,
        },
      },
    },
  },
});
