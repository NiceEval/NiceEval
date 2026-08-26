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
  SourceItemIdSchema,
} from "../../codec/identifiers.ts";
import {
  NonNegativeSafeIntegerSchema,
  isCanonicalIdentitySequence,
} from "../common.ts";

export const SourcesLimits = Object.freeze({
  maximumItems: 20_000,
  maximumContentBytes: 16 * 1024 * 1024,
});

/**
 * One immutable source snapshot item in an origin Run-owned closure. sha256
 * identifies the source content fact; it is never a physical object key.
 */
export const SourceItemSchema = Schema.Struct({
  sourceItemId: SourceItemIdSchema,
  path: CanonicalProjectRelativePathSchema,
  byteLength: NonNegativeSafeIntegerSchema,
  sha256: Sha256DigestSchema,
  content: RecordTextContentSchema.pipe(
    recordContent.maximumBytes(SourcesLimits.maximumContentBytes),
  ),
});

export type SourceItem = Schema.Schema.Type<typeof SourceItemSchema>;

/**
 * Sources are deliberately a flat manifest. `sourceItemId` is opaque and is
 * neither a path, content identity, array index, nor storage-key derivation.
 */
export const SourcesAttachmentSchema = Schema.Struct({
  items: Schema.propertySignature(Schema.Array(SourceItemSchema)).pipe(
    Schema.fromKey("items-data"),
  ),
});

export type SourcesAttachment = Schema.Schema.Type<
  typeof SourcesAttachmentSchema
>;

function invalid(path: readonly string[]): RecordAttachmentIssue {
  return recordAttachmentIssue("record-attachment-schema-invalid", path);
}

/**
 * Core enforces the content declaration limit and owns physical read
 * integrity. This logical validator cannot open a sealed content handle;
 * producers must derive byteLength and sha256 from the same source they seal.
 */
export function validateSourcesAttachment(
  value: SourcesAttachment,
): readonly RecordAttachmentIssue[] {
  const issues: RecordAttachmentIssue[] = [];
  if (value.items.length > SourcesLimits.maximumItems) {
    issues.push(invalid(["items"]));
  }
  if (!isCanonicalIdentitySequence(value.items.map((item) => item.sourceItemId))) {
    issues.push(invalid(["items", "sourceItemId"]));
  }
  if (new Set(value.items.map((item) => item.path)).size !== value.items.length) {
    issues.push(invalid(["items", "path"]));
  }
  for (const [index, item] of value.items.entries()) {
    if (item.byteLength > SourcesLimits.maximumContentBytes) {
      issues.push(invalid(["items", String(index), "byteLength"]));
    }
  }
  return Object.freeze(issues);
}
