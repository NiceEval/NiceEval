import * as Schema from "effect/Schema";
import type { JsonValue } from "../../../types.ts";
import { EvalIdSchema, CanonicalProjectRelativePathSchema, Sha256DigestSchema } from "../../codec/identifiers.ts";
import { recordAttachmentIssue, type RecordAttachmentIssue } from "../../attachment/index.ts";
import { isCanonicalIdentitySequence } from "../common.ts";

export const IdentityManifestsLimits = Object.freeze({
  maximumEntries: 20_000,
  maximumPathsPerEntry: 10_000,
  maximumJsonBytes: 1024 * 1024,
});
export const IdentityJsonSchema: Schema.Codec<JsonValue> = Schema.suspend(() =>
  Schema.Union([
    Schema.Null,
    Schema.Boolean,
    Schema.Finite,
    Schema.String,
    Schema.mutable(Schema.Array(IdentityJsonSchema)),
    Schema.Record(Schema.String, IdentityJsonSchema),
  ]),
);
export const IdentityManifestEntrySchema = Schema.Struct({
  evalId: EvalIdSchema,
  niceeval: Schema.Record(Schema.String, IdentityJsonSchema),
  config: Schema.Record(Schema.String, IdentityJsonSchema),
  plan: Schema.optionalKey(IdentityJsonSchema),
  plugins: Schema.optionalKey(Schema.Record(Schema.String, IdentityJsonSchema)),
  source: Schema.Record(Schema.String, Sha256DigestSchema),
  data: Schema.Record(Schema.String, Sha256DigestSchema),
});
export type IdentityManifestEntry = Schema.Schema.Type<typeof IdentityManifestEntrySchema>;
export const IdentityManifestsAttachmentSchema = Schema.Struct({ entries: Schema.Array(IdentityManifestEntrySchema) });
export type IdentityManifestsAttachment = Schema.Schema.Type<typeof IdentityManifestsAttachmentSchema>;
export function validateIdentityManifestsAttachment(
  value: IdentityManifestsAttachment,
): readonly RecordAttachmentIssue[] {
  const issues: RecordAttachmentIssue[] = [];
  if (
    value.entries.length > IdentityManifestsLimits.maximumEntries ||
    !isCanonicalIdentitySequence(value.entries.map((entry) => entry.evalId))
  ) {
    issues.push(recordAttachmentIssue("record-attachment-schema-invalid", ["entries"]));
  }
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > IdentityManifestsLimits.maximumJsonBytes) {
    issues.push(recordAttachmentIssue("record-attachment-schema-invalid", ["entries", "bytes"]));
  }
  for (const [index, entry] of value.entries.entries()) {
    for (const face of ["source", "data"] as const)
      for (const path of Object.keys(entry[face])) {
        if (Schema.decodeUnknownResult(CanonicalProjectRelativePathSchema)(path)._tag === "Failure")
          issues.push(
            recordAttachmentIssue("record-attachment-schema-invalid", ["entries", String(index), face, path]),
          );
      }
    for (const face of ["niceeval", "config", "plugins", "source", "data"] as const) {
      if (Object.keys(entry[face] ?? {}).length > IdentityManifestsLimits.maximumPathsPerEntry) {
        issues.push(recordAttachmentIssue("record-attachment-schema-invalid", ["entries", String(index), face]));
      }
    }
  }
  return Object.freeze(issues);
}
