import { Schema } from "effect";

import {
  RecordBytesContentSchema,
  recordContent,
} from "../../attachment/index.ts";
import type { AssertionMaterial } from "../../../assertions/record/model.ts";
import { NonNegativeSafeIntegerSchema } from "../common.ts";

/** Assertions material is always an Attachment-private sealed content value. */
export const AssertionsMaterialContentSchema = RecordBytesContentSchema.pipe(
  recordContent.maximumBytes(16 * 1024 * 1024),
);

export type AssertionsMaterialContent = typeof AssertionsMaterialContentSchema.Type;

const AssertionMaterialPreviewSchema = Schema.String.pipe(
  Schema.check(Schema.makeFilter((value) => new TextEncoder().encode(value).byteLength <= 8 * 1024)),
);

/** Current material has one storage-neutral content branch. */
export const AssertionMaterialSchema: Schema.Codec<
  AssertionMaterial<AssertionsMaterialContent>
> = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("unavailable"),
    reason: Schema.Literal("not-recorded"),
  }),
  Schema.Struct({
    kind: Schema.Literal("content"),
    content: AssertionsMaterialContentSchema,
    encoding: Schema.Literals(["json", "utf-8", "binary"]),
    byteLength: NonNegativeSafeIntegerSchema,
    preview: Schema.NullOr(AssertionMaterialPreviewSchema),
  }),
]);
