import { Either } from "effect";
import {
  recordAttachmentIssue,
  recordAttachmentPayloadInvalid,
  type RecordAttachmentPayloadInvalid,
} from "../attachment/errors.ts";
import type { RecordAttachmentJson } from "../attachment/types.ts";
import { RECORD_DURABLE_BLOB_REF_KEY } from "../reader/runtime.ts";

/** Durable JSON has no native bytes or live blob capability objects. */
export type RecordAttachmentDiskJson =
  | null
  | boolean
  | number
  | string
  | readonly RecordAttachmentDiskJson[]
  | { readonly [key: string]: RecordAttachmentDiskJson };

function asDiskJson(
  value: RecordAttachmentJson,
  blobKeys: ReadonlyMap<object, string>,
): Either.Either<RecordAttachmentDiskJson, RecordAttachmentPayloadInvalid> {
  if (value === null || typeof value !== "object") {
    return Either.right(value);
  }

  const blobKey = blobKeys.get(value);
  if (blobKey !== undefined) {
    return Either.right(
      Object.freeze({ [RECORD_DURABLE_BLOB_REF_KEY]: blobKey }),
    );
  }

  if (Array.isArray(value)) {
    const items: RecordAttachmentDiskJson[] = [];
    for (const item of value) {
      const encoded = asDiskJson(item, blobKeys);
      if (Either.isLeft(encoded)) {
        return encoded;
      }
      items.push(encoded.right);
    }
    return Either.right(Object.freeze(items));
  }

  const source = value as { readonly [key: string]: RecordAttachmentJson };
  const sourceKeys = Object.keys(source);
  if (
    sourceKeys.length === 1 &&
    sourceKeys[0] === RECORD_DURABLE_BLOB_REF_KEY
  ) {
    return Either.left(
      recordAttachmentPayloadInvalid([
        recordAttachmentIssue("record-attachment-json-invalid", []),
      ]),
    );
  }
  const object: Record<string, RecordAttachmentDiskJson> = {};
  for (const [key, child] of Object.entries(source)) {
    const encoded = asDiskJson(child, blobKeys);
    if (Either.isLeft(encoded)) {
      return encoded;
    }
    object[key] = encoded.right;
  }
  return Either.right(Object.freeze(object));
}

/**
 * Replaces package-minted in-memory refs with the writer's owner-local opaque
 * keys. The caller has already run the Attachment closure validator, so every
 * ref in the payload is guaranteed to be in `blobKeys`.
 */
export function encodeAttachmentPayloadForStorage(input: {
  readonly payload: RecordAttachmentJson;
  readonly blobKeys: ReadonlyMap<object, string>;
}): Either.Either<RecordAttachmentDiskJson, RecordAttachmentPayloadInvalid> {
  return asDiskJson(input.payload, input.blobKeys);
}

function collectStrings(value: RecordAttachmentJson, destination: Set<string>): void {
  if (typeof value === "string") {
    destination.add(value);
    return;
  }
  if (value === null || typeof value !== "object") {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectStrings(item, destination);
    }
    return;
  }
  for (const child of Object.values(value)) {
    collectStrings(child, destination);
  }
}

/** Collects normal payload strings so newly minted opaque keys cannot collide. */
export function attachmentPayloadStrings(
  payload: RecordAttachmentJson,
): ReadonlySet<string> {
  const strings = new Set<string>();
  collectStrings(payload, strings);
  return strings;
}

export function encodeRecordAttachmentJsonBytes(
  value: RecordAttachmentDiskJson,
): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}
