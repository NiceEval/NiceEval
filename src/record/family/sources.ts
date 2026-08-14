import { createHash } from "node:crypto";

import { Schema } from "effect";
import {
  CanonicalProjectRelativePathSchema,
  Sha256DigestSchema,
  SourceItemIdSchema,
} from "../codec/identifiers.ts";
import type { RecordBlobRef } from "../attachment/types.ts";
import { recordAttachmentIssue, type RecordAttachmentIssue } from "../attachment/errors.ts";
import {
  NonNegativeSafeIntegerSchema,
  RecordBlobRefPositionSchema,
  isCanonicalIdentitySequence,
} from "./common.ts";

/** One immutable source snapshot item in an origin Run-owned closure. */
export const SourceItemSchema = Schema.Struct({
  sourceItemId: SourceItemIdSchema,
  path: CanonicalProjectRelativePathSchema,
  byteLength: NonNegativeSafeIntegerSchema,
  sha256: Sha256DigestSchema,
  content: RecordBlobRefPositionSchema,
});

export type SourceItem = Schema.Schema.Type<typeof SourceItemSchema>;

/**
 * Sources are deliberately a flat manifest. `sourceItemId` is opaque and is
 * neither a path, digest, array index, nor blob-key derivation.
 */
export const SourcesAttachmentSchema = Schema.Struct({
  items: Schema.Array(SourceItemSchema),
}).pipe(
  Schema.filter(
    (document) =>
      isCanonicalIdentitySequence(document.items.map((item) => item.sourceItemId)) &&
      new Set(document.items.map((item) => item.path)).size === document.items.length,
    {
      identifier: "SourcesAttachment",
      description: "a canonical Sources manifest with unique item identities and paths",
    },
  ),
);

export type SourcesAttachment = Schema.Schema.Type<
  typeof SourcesAttachmentSchema
>;

/** Complete closure projection for `niceeval.sources`. */
export function sourcesBlobRefs(
  payload: SourcesAttachment,
): readonly RecordBlobRef[] {
  return Object.freeze(payload.items.map((item) => item.content));
}

/**
 * Checks the Sources-specific claim over each already materialized own blob.
 * Closure membership is checked by the shared attachment reader; this fixed
 * family check binds the resulting exact bytes to its manifest metadata.
 */
export function sourcesAttachmentIntegrityIssues(
  payload: SourcesAttachment,
  blobs: readonly { readonly ref: RecordBlobRef; readonly bytes: Uint8Array }[],
): readonly RecordAttachmentIssue[] {
  const bytesByRef = new Map<RecordBlobRef, Uint8Array>(
    blobs.map((blob) => [blob.ref, blob.bytes] as const),
  );
  const issues: RecordAttachmentIssue[] = [];
  for (const [index, item] of payload.items.entries()) {
    const bytes = bytesByRef.get(item.content);
    if (bytes === undefined) {
      issues.push(recordAttachmentIssue("record-attachment-materialized-invalid", ["items", String(index), "content"]));
      continue;
    }
    if (bytes.byteLength !== item.byteLength) {
      issues.push(recordAttachmentIssue("record-attachment-materialized-invalid", ["items", String(index), "byteLength"]));
    }
    if (createHash("sha256").update(bytes).digest("hex") !== item.sha256) {
      issues.push(recordAttachmentIssue("record-attachment-materialized-invalid", ["items", String(index), "sha256"]));
    }
  }
  return Object.freeze(issues);
}
