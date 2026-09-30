import { crc32 } from "node:zlib";

// A valid one-pixel PNG with a large ancillary text chunk. Its original bytes
// exceed the fixed Inspection document budget without needing a paid model.
export function screenshotBytes(): Uint8Array {
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=", "base64");
  const data = Buffer.from(`Comment\0${"screenshot-original-".repeat(32_000)}`, "utf8");
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write("tEXt", 4, "ascii");
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4);
  return new Uint8Array(Buffer.concat([png.subarray(0, -12), chunk, png.subarray(-12)]));
}
