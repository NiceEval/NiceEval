import { Schema } from "effect";

import { AssertionEntryIdSchema } from "../../../assertions/record/codec.ts";
import { RecordAttachmentReference } from "../../attachment/index.ts";
import {
  Sha256DigestSchema,
  SourceItemIdSchema,
} from "../../codec/identifiers.ts";
import { PositiveSafeIntegerSchema } from "../common.ts";
import { sourcesRecordAttachment } from "../sources/definition.ts";

export const AssertionSourceRoleSchema = Schema.Literal(
  "declaration",
  "threshold",
  "score",
  "gate",
  "optional",
  "stop",
);

export const AssertionSourcePositionSchema = Schema.Struct({
  line: PositiveSafeIntegerSchema,
  column: PositiveSafeIntegerSchema,
});

/** Semantic anchor inside the exact origin-Run Sources Attachment. */
export const AssertionSourceAnchorSchema = Schema.Struct({
  sourceItemId: SourceItemIdSchema,
  sha256: Sha256DigestSchema,
});

export const AssertionSourceReferenceSchema = RecordAttachmentReference.to(
  sourcesRecordAttachment,
  AssertionSourceAnchorSchema,
);

/**
 * A source site owns only assertion-local placement and a typed Sources
 * relation. The digest is a durable semantic anchor, never a content pointer.
 * The row contains no family selector, path, or content key.
 */
export const AssertionSourceSiteSchema = Schema.Struct({
  entryId: AssertionEntryIdSchema,
  sourceOrder: PositiveSafeIntegerSchema,
  role: AssertionSourceRoleSchema,
  source: AssertionSourceReferenceSchema,
  start: AssertionSourcePositionSchema,
  end: AssertionSourcePositionSchema,
});

export type AssertionSourceAnchor = typeof AssertionSourceAnchorSchema.Type;
export type AssertionSourceSite = typeof AssertionSourceSiteSchema.Type;
