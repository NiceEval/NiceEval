import { Result, Schema } from "effect";

import { mintRecordContentHandle } from "../record/attachment/content.ts";
import { hydrateRecordAttachmentCurrent } from "../record/attachment/protocol.ts";
import { RecordExactParseOptions } from "../record/codec/core.ts";
import { attemptArtifactsRecordAttachment } from "../record/family/artifacts/definition.ts";
import { attemptArtifactsRecordAttachmentPersistence } from "../record/family/artifacts/persistence.ts";
import { ArtifactSchema } from "../record/family/artifacts/schema.ts";
import { CollectionStateSchema, NonNegativeSafeIntegerSchema } from "../record/family/common.ts";
import type { PersistedContentMetadata } from "../record/sqlite/types.ts";
import type { DecodedInspectionAttachment } from "./facts.ts";

const { content: _content, ...metadataFields } = ArtifactSchema.fields;

export const InspectionArtifactsPageLimitSchema = NonNegativeSafeIntegerSchema.pipe(Schema.check(Schema.makeFilter(
  (value) => value > 0 && value <= 128,
)));

/** Public directory entries contain metadata; bytes are read through attempt.artifact. */
export const InspectionArtifactMetadataSchema = Schema.Struct(metadataFields);
export const InspectionArtifactsValueSchema = Schema.Struct({
  collection: Schema.toType(CollectionStateSchema),
  artifacts: Schema.Array(InspectionArtifactMetadataSchema),
});
export type InspectionArtifactsValue = Schema.Schema.Type<typeof InspectionArtifactsValueSchema>;

const decodeMarker = Schema.decodeUnknownResult(
  Schema.Struct({ "$niceeval.record.content": Schema.String }), RecordExactParseOptions,
);

/** Decode the current durable fact before projecting its serializable public metadata. */
export function projectArtifactsListing(
  attachment: DecodedInspectionAttachment,
): Result.Result<InspectionArtifactsValue, { readonly reason: string }> {
  if (attachment.physical.ownerKind !== "attempt" ||
    attachment.physical.family !== attemptArtifactsRecordAttachment.family ||
    attachment.physical.familyRevision !== attemptArtifactsRecordAttachmentPersistence.revision ||
    attachment.physical.references.length !== 0) {
    return Result.fail({ reason: "Artifact attachment ownership or revision is invalid." });
  }
  const contents = new Map(attachment.physical.contents.map((entry) => [entry.logicalHandle, entry]));
  const bound = new WeakMap<object, PersistedContentMetadata>();
  const used = new Set<string>();
  if (contents.size !== attachment.physical.contents.length) return Result.fail({ reason: "Duplicate artifact content handle." });
  const hydrated = hydrateRecordAttachmentCurrent(attemptArtifactsRecordAttachment, attachment.value, {
    content: (token, declaration) => {
      const marker = decodeMarker(token);
      if (Result.isFailure(marker)) return Result.succeed(undefined);
      const logicalHandle = marker.success["$niceeval.record.content"];
      const metadata = contents.get(logicalHandle);
      if (metadata === undefined || used.has(logicalHandle) || declaration.kind !== "bytes" ||
        declaration.maximumBytes !== undefined && metadata.byteLength > declaration.maximumBytes) {
        return Result.fail({ code: "current-content-bind-failed" as const });
      }
      const handle = mintRecordContentHandle("bytes");
      bound.set(handle, metadata);
      used.add(logicalHandle);
      return Result.succeed(handle);
    },
    reference: () => Result.succeed(undefined),
  });
  if (Result.isFailure(hydrated) || used.size !== attachment.physical.contents.length) {
    return Result.fail({ reason: "Artifact content closure is invalid." });
  }
  for (const artifact of hydrated.success.artifacts) {
    const metadata = bound.get(artifact.content);
    if (metadata === undefined || metadata.byteLength !== artifact.byteLength || metadata.digest !== artifact.sha256) {
      return Result.fail({ reason: "Artifact descriptor does not match sealed content metadata." });
    }
  }
  return Result.succeed(Object.freeze({
    collection: hydrated.success.collection,
    artifacts: Object.freeze(hydrated.success.artifacts.map(({ artifactId, label, mediaType, byteLength, sha256 }) =>
      Object.freeze({ artifactId, label, mediaType, byteLength, sha256 }))),
  }));
}
