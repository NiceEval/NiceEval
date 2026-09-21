import { Data, Result, Schema } from "effect";

import { encodeAttemptLocator } from "../attempt-locator.ts";
import { mintRecordContentHandle } from "../record/attachment/content.ts";
import { hydrateRecordAttachmentCurrent } from "../record/attachment/protocol.ts";
import { RecordExactParseOptions } from "../record/codec/core.ts";
import { ArtifactIdSchema, Sha256DigestSchema } from "../record/codec/identifiers.ts";
import { attemptArtifactsRecordAttachment } from "../record/family/artifacts/definition.ts";
import { attemptArtifactsRecordAttachmentPersistence } from "../record/family/artifacts/persistence.ts";
import { MediaTypeSchema, NonNegativeSafeIntegerSchema, SafeTextSchema } from "../record/family/common.ts";
import type { PersistedContentMetadata } from "../record/sqlite/types.ts";
import { InspectionSha256 } from "./bytes.ts";
import type { ResolvedInspectionAttempt } from "./facts.ts";
import type { InspectionFactSource } from "./source.ts";

export const InspectionArtifactLimits = Object.freeze({ defaultBytes: 64 * 1024, maximumBytes: 256 * 1024 });
export const InspectionArtifactOffsetSchema = NonNegativeSafeIntegerSchema;
export const InspectionArtifactLimitSchema = NonNegativeSafeIntegerSchema.pipe(Schema.check(Schema.makeFilter(
  (value) => value > 0 && value <= InspectionArtifactLimits.maximumBytes,
)));
const ReadRequestSchema = Schema.Struct({
  artifactId: ArtifactIdSchema,
  offset: Schema.optional(InspectionArtifactOffsetSchema),
  limit: Schema.optional(InspectionArtifactLimitSchema),
});
export type InspectionArtifactRequest = Schema.Schema.Type<typeof ReadRequestSchema>;

export const InspectionArtifactResultSchema = Schema.Union([
  Schema.Struct({ state: Schema.Literal("not-found"), artifactId: ArtifactIdSchema }),
  Schema.Struct({
    state: Schema.Literal("available"),
    artifactId: ArtifactIdSchema,
    name: Schema.toType(SafeTextSchema),
    mediaType: Schema.toType(MediaTypeSchema),
    byteLength: NonNegativeSafeIntegerSchema,
    sha256: Sha256DigestSchema,
    offset: InspectionArtifactOffsetSchema,
    base64: Schema.String.pipe(Schema.check(Schema.makeFilter((value) =>
      value.length <= Math.ceil(InspectionArtifactLimits.maximumBytes / 3) * 4 &&
      value.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(value),
    ))),
    nextOffset: Schema.NullOr(InspectionArtifactOffsetSchema),
  }),
]);
export type InspectionArtifactResult = Schema.Schema.Type<typeof InspectionArtifactResultSchema>;

export class InspectionArtifactError extends Data.TaggedError("InspectionArtifactError")<{
  readonly code: "inspection-request-invalid" | "inspection-record-integrity-failure";
  readonly reason: string;
}> {}

const decodeRequest = Schema.decodeUnknownResult(ReadRequestSchema, RecordExactParseOptions);
const decodeMarker = Schema.decodeUnknownResult(
  Schema.Struct({ "$niceeval.record.content": Schema.String }), RecordExactParseOptions,
);

/** Reads the exact origin's sealed bytes; only the requested range is retained in memory. */
export function projectAttemptArtifact(
  resolved: ResolvedInspectionAttempt,
  request: InspectionArtifactRequest,
): Result.Result<InspectionArtifactResult, InspectionArtifactError> {
  const decoded = decodeRequest(request);
  if (Result.isFailure(decoded)) return requestInvalid("Invalid artifact ID, offset, or limit.");
  const { artifactId, offset = 0, limit = InspectionArtifactLimits.defaultBytes } = decoded.success;
  try {
    if (encodeAttemptLocator(resolved.attempt.attemptId) !== resolved.locator ||
      resolved.attempt.originRunId !== resolved.origin.run.runId) {
      throw new Error("Artifact origin does not match the requested Attempt locator.");
    }
    const attachments = resolved.origin.attachments.filter(({ physical }) =>
      physical.ownerKind === "attempt" && physical.ownerAttemptId === resolved.attempt.attemptId &&
      physical.family === attemptArtifactsRecordAttachment.family);
    if (attachments.length === 0) return Result.succeed(Object.freeze({ state: "not-found", artifactId }));
    if (attachments.length !== 1) throw new Error("Artifact owner has duplicate attachments.");
    const attachment = attachments[0]!;
    if (attachment.physical.ownerRunId !== resolved.attempt.originRunId ||
      attachment.physical.familyRevision !== attemptArtifactsRecordAttachmentPersistence.revision ||
      attachment.physical.references.length !== 0) {
      throw new Error("Artifact attachment ownership or revision is invalid.");
    }
    const byLogicalHandle = new Map(attachment.physical.contents.map((content) => [content.logicalHandle, content]));
    const bound = new WeakMap<object, PersistedContentMetadata>();
    const used = new Set<string>();
    if (byLogicalHandle.size !== attachment.physical.contents.length) throw new Error("Duplicate artifact content handle.");
    const hydrated = hydrateRecordAttachmentCurrent(attemptArtifactsRecordAttachment, attachment.value, {
      content: (token, declaration) => {
        const marker = decodeMarker(token);
        if (Result.isFailure(marker)) return Result.succeed(undefined);
        const logicalHandle = marker.success["$niceeval.record.content"];
        const metadata = byLogicalHandle.get(logicalHandle);
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
      throw new Error("Artifact content closure is invalid.");
    }
    // Validate every descriptor, even when the requested ID is absent.
    for (const artifact of hydrated.success.artifacts) {
      const metadata = bound.get(artifact.content);
      if (metadata === undefined || metadata.byteLength !== artifact.byteLength || metadata.digest !== artifact.sha256) {
        throw new Error("Artifact descriptor does not match sealed content metadata.");
      }
    }
    const artifact = hydrated.success.artifacts.find((item) => item.artifactId === artifactId);
    if (artifact === undefined) return Result.succeed(Object.freeze({ state: "not-found", artifactId }));
    if (offset > artifact.byteLength) return requestInvalid("Artifact offset exceeds its byte length.");
    const bytes = readVerifiedRange(resolved.origin.source, bound.get(artifact.content)!, offset, limit);
    return Result.succeed(Object.freeze({
      state: "available",
      artifactId,
      name: artifact.label,
      mediaType: artifact.mediaType,
      byteLength: artifact.byteLength,
      sha256: artifact.sha256,
      offset,
      base64: btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join("")),
      nextOffset: offset + bytes.byteLength < artifact.byteLength ? offset + bytes.byteLength : null,
    }));
  } catch (cause) {
    return Result.fail(new InspectionArtifactError({
      code: "inspection-record-integrity-failure",
      reason: cause instanceof Error ? cause.message : "Artifact content validation failed.",
    }));
  }
}

function requestInvalid(reason: string): Result.Result<never, InspectionArtifactError> {
  return Result.fail(new InspectionArtifactError({ code: "inspection-request-invalid", reason }));
}

function readVerifiedRange(source: InspectionFactSource, metadata: PersistedContentMetadata, offset: number, limit: number): Uint8Array {
  const output = new Uint8Array(Math.min(limit, metadata.byteLength - offset));
  const digest = new InspectionSha256();
  let byteOffset = 0;
  let expectedOrdinal = 0;
  let afterOrdinal = -1;
  while (true) {
    // One bounded storage chunk at a time, including bytes outside the requested range.
    const page = source.readContentPage(metadata.contentId, afterOrdinal, 1);
    if (page.contentId !== metadata.contentId || page.afterOrdinal !== afterOrdinal || page.chunks.length > 1 ||
      page.chunks.length === 0 && page.nextOrdinal !== null) throw new Error("Artifact content page is invalid.");
    for (const chunk of page.chunks) {
      if (chunk.ordinal !== expectedOrdinal || expectedOrdinal >= metadata.chunkCount ||
        byteOffset + chunk.bytes.byteLength > metadata.byteLength) throw new Error("Artifact chunk sequence is invalid.");
      digest.update(chunk.bytes);
      const start = Math.max(offset, byteOffset);
      const end = Math.min(offset + output.byteLength, byteOffset + chunk.bytes.byteLength);
      if (end > start) output.set(chunk.bytes.subarray(start - byteOffset, end - byteOffset), start - offset);
      byteOffset += chunk.bytes.byteLength;
      expectedOrdinal += 1;
    }
    if (page.nextOrdinal === null) break;
    if (page.nextOrdinal !== expectedOrdinal - 1 || expectedOrdinal >= metadata.chunkCount) {
      throw new Error("Artifact content continuation is invalid.");
    }
    afterOrdinal = page.nextOrdinal;
  }
  if (byteOffset !== metadata.byteLength || expectedOrdinal !== metadata.chunkCount || digest.digestHex() !== metadata.digest) {
    throw new Error("Artifact bytes do not match their sealed digest.");
  }
  return output;
}
