export { RecordSha256 as InspectionSha256 } from "../record/definition/digest.ts";

/** Browser- and Node-neutral UTF-8 byte length used by pure Inspection selectors. */
export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

/** Small opaque-token codec shared by Node and browser Inspection hosts. */
export function encodeBase64UrlUtf8(value: string): string {
  const binary = [...new TextEncoder().encode(value)]
    .map((byte) => String.fromCharCode(byte))
    .join("");
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function decodeBase64UrlUtf8(value: string): string {
  if (!/^[A-Za-z0-9_-]*$/u.test(value) || value.length % 4 === 1) {
    throw new Error("Invalid base64url value");
  }
  const padded = value.replaceAll("-", "+").replaceAll("_", "/")
    .padEnd(value.length + (4 - value.length % 4) % 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

/** Browser- and Node-neutral base64 for bounded binary Inspection results. */
export function encodeBase64Bytes(bytes: Uint8Array): string {
  let binary = "";
  const blockSize = 0x8000;
  for (let offset = 0; offset < bytes.byteLength; offset += blockSize) {
    binary += Array.from(
      bytes.subarray(offset, Math.min(bytes.byteLength, offset + blockSize)),
      (byte) => String.fromCharCode(byte),
    ).join("");
  }
  return btoa(binary);
}

export function decodeBase64Bytes(value: string): Uint8Array {
  if (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(value)) {
    throw new Error("Invalid base64 value");
  }
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
