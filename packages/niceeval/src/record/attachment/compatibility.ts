import type {
  RecordAttachmentMaterializedBlob,
  RecordAttachmentMaterializedRefine,
} from "./blob-policy.ts";
import {
  isRecordAttachmentVersion,
  type AnyRecordAttachmentVersion,
  type RecordAttachmentVersionValue,
} from "./version.ts";

type AnyMaterializedRefine = (
  value: unknown,
  blobs: readonly RecordAttachmentMaterializedBlob[],
) => readonly import("./errors.ts").RecordAttachmentIssue[];

const materializedRefines = new WeakMap<object, AnyMaterializedRefine>();

/**
 * @internal Temporary bridge for the existing Host materializer. The generic
 * SPI never exposes materialized bytes to third-party definitions.
 */
export function withRecordAttachmentMaterializedRefine<
  const Version extends AnyRecordAttachmentVersion,
>(
  version: Version,
  refine: RecordAttachmentMaterializedRefine<RecordAttachmentVersionValue<Version>>,
): Version {
  if (!isRecordAttachmentVersion(version) || typeof refine !== "function") {
    throw new TypeError("Record Attachment materialized refine requires a branded version");
  }
  materializedRefines.set(version, refine as AnyMaterializedRefine);
  return version;
}

/** @internal Read only while deriving the current Host compatibility descriptor. */
export function getRecordAttachmentMaterializedRefine(
  version: AnyRecordAttachmentVersion,
): AnyMaterializedRefine | undefined {
  return materializedRefines.get(version);
}
