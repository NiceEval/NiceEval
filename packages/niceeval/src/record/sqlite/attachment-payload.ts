import { createHash } from "node:crypto";
import { Result, Schema } from "effect";
import { sqliteError } from "./errors.ts";
import type { ContentChunkPage, PersistedContentMetadata, SealedAttachmentMetadata } from "./types.ts";

/** Host-owned transport content, distinct from family-declared Content handles. */
export const ATTACHMENT_PAYLOAD_HANDLE = "attachment-payload";
export const ATTACHMENT_INVENTORY_HANDLE = "attachment-inventory";
export const ATTACHMENT_INLINE_BYTES = 64 * 1024;
export const COLLECTION_ITEM_CONTENT_PREFIX = "collection-item-";
const PayloadPointer = Schema.Struct({
  "$niceeval.record.payload": Schema.Literal(ATTACHMENT_PAYLOAD_HANDLE),
});
export const attachmentPayloadPointerBytes = new TextEncoder().encode(
  JSON.stringify({ "$niceeval.record.payload": ATTACHMENT_PAYLOAD_HANDLE }),
);

export function attachmentInventoryPointerBytes({
  byteLength,
  digest,
}: Pick<PersistedContentMetadata, "byteLength" | "digest">): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({ "$niceeval.record.inventory": { byteLength, digest } }));
}

export function collectionItemContentHandle(ordinal: number): string {
  return `${COLLECTION_ITEM_CONTENT_PREFIX}${ordinal}`;
}

export function collectionItemPointerBytes({
  byteLength,
  digest,
}: Pick<PersistedContentMetadata, "byteLength" | "digest">): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({ "$niceeval.record.collection-item": { byteLength, digest } }));
}

export function attachmentValueContents(attachment: SealedAttachmentMetadata) {
  return attachment.contents.filter(
    ({ logicalHandle }) => logicalHandle !== ATTACHMENT_PAYLOAD_HANDLE && logicalHandle !== ATTACHMENT_INVENTORY_HANDLE,
  );
}

type ReadContentPage = (contentId: string, after: number, maximumRows: number) => ContentChunkPage;

/** Loads a cold payload only when a caller explicitly reads the family value. */
export function readAttachmentPayload(attachment: SealedAttachmentMetadata, readPage: ReadContentPage): Uint8Array {
  const content = attachment.contents.filter(({ logicalHandle }) => logicalHandle === ATTACHMENT_PAYLOAD_HANDLE);
  if (content.length === 0) return attachment.canonicalBytes;
  const invalid = () =>
    sqliteError("record-content-invalid", "read-attachment-payload", "Attachment payload Content closure is invalid");
  if (content.length !== 1) throw invalid();
  let pointer: unknown;
  try {
    pointer = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(attachment.canonicalBytes));
  } catch {
    throw invalid();
  }
  if (Result.isFailure(Schema.decodeUnknownResult(PayloadPointer, { onExcessProperty: "error" })(pointer)))
    throw invalid();
  return readChunkedValue(content[0]!, readPage, invalid);
}

export function readAttachmentInventory(metadata: PersistedContentMetadata, readPage: ReadContentPage): Uint8Array {
  return readChunkedValue(metadata, readPage, () =>
    sqliteError(
      "record-content-invalid",
      "read-attachment-inventory",
      "Attachment inventory Content closure is invalid",
    ),
  );
}

export function readCollectionItemPayload(metadata: PersistedContentMetadata, readPage: ReadContentPage): Uint8Array {
  return readChunkedValue(metadata, readPage, () =>
    sqliteError("record-content-invalid", "read-collection-item", "Collection item Content closure is invalid"),
  );
}

function readChunkedValue(
  metadata: PersistedContentMetadata,
  readPage: ReadContentPage,
  invalid: () => Error,
): Uint8Array {
  if (!Number.isSafeInteger(metadata.byteLength) || metadata.byteLength < 0) throw invalid();
  const output = new Uint8Array(metadata.byteLength);
  const hash = createHash("sha256");
  let ordinal = 0;
  let offset = 0;
  for (;;) {
    const page = readPage(metadata.contentId, ordinal - 1, 4);
    if (page.contentId !== metadata.contentId || page.afterOrdinal !== ordinal - 1) throw invalid();
    for (const chunk of page.chunks) {
      if (
        chunk.ordinal !== ordinal ||
        ordinal >= metadata.chunkCount ||
        offset + chunk.bytes.byteLength > output.byteLength ||
        createHash("sha256").update(chunk.bytes).digest("hex") !== chunk.chunkDigest
      )
        throw invalid();
      output.set(chunk.bytes, offset);
      hash.update(chunk.bytes);
      offset += chunk.bytes.byteLength;
      ordinal += 1;
    }
    if (page.nextOrdinal === null) break;
    if (page.chunks.length === 0 || page.nextOrdinal !== ordinal - 1) throw invalid();
  }
  if (ordinal !== metadata.chunkCount || offset !== metadata.byteLength || hash.digest("hex") !== metadata.digest)
    throw invalid();
  return output;
}
