/** Every durable Record JSON document uses this writer-enforced UTF-8 limit. */
export const RECORD_JSON_MAXIMUM_BYTES = 4 * 1024 * 1024;

const utf8 = new TextEncoder();

/** Encodes exactly as the Record writer does before applying its byte limit. */
export function encodeRecordJsonUtf8(value: unknown): Uint8Array {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) {
    throw new Error("Record durable JSON encoder received a non-JSON value");
  }
  return utf8.encode(encoded);
}
