import { createHash } from "node:crypto";
import { Result, Schema } from "effect";
import { RECORD_JSON_MAXIMUM_BYTES } from "../writer/limits.ts";
import { sqliteError } from "./errors.ts";
import type { ContentChunkPage, SealedAttachmentMetadata } from "./types.ts";

/** Host-owned transport content, distinct from family-declared Content handles. */
export const ATTACHMENT_PAYLOAD_HANDLE = "attachment-payload";
export const ATTACHMENT_INLINE_BYTES = 64 * 1024;
const PayloadPointer = Schema.Struct({
  "$niceeval.record.payload": Schema.Literal(ATTACHMENT_PAYLOAD_HANDLE),
});
export const attachmentPayloadPointerBytes = new TextEncoder().encode(
  JSON.stringify({ "$niceeval.record.payload": ATTACHMENT_PAYLOAD_HANDLE }),
);

export function attachmentValueContents(attachment: SealedAttachmentMetadata) {
  return attachment.contents.filter(({ logicalHandle }) => logicalHandle !== ATTACHMENT_PAYLOAD_HANDLE);
}

/** Loads a cold payload only when a caller explicitly reads the family value. */
export function readAttachmentPayload(
  attachment: SealedAttachmentMetadata,
  readPage: (contentId: string, after: number, maximumRows: number) => ContentChunkPage,
): Uint8Array {
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
  const metadata = content[0]!;
  if (
    !Number.isSafeInteger(metadata.byteLength) ||
    metadata.byteLength < 0 ||
    metadata.byteLength > RECORD_JSON_MAXIMUM_BYTES
  )
    throw invalid();
  const output = new Uint8Array(metadata.byteLength);
  const hash = createHash("sha256");
  let ordinal = 0;
  let offset = 0;
  for (;;) {
    const page = readPage(metadata.contentId, ordinal - 1, 4);
    if (page.chunks.length === 0) break;
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
  }
  if (ordinal !== metadata.chunkCount || offset !== metadata.byteLength || hash.digest("hex") !== metadata.digest)
    throw invalid();
  return output;
}
