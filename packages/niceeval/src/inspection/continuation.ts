// @concord-file
// @concord-implements docs/feature/inspection/cli.md
import * as Schema from "effect/Schema";
import { decodeBase64UrlUtf8, encodeBase64UrlUtf8 } from "./bytes.ts";
const ByteContinuationSchema = Schema.Struct({ cutoff: Schema.String, source: Schema.String, locator: Schema.String, id: Schema.String, offset: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)) });
export function inspectionByteContinuation(binding: Omit<Schema.Schema.Type<typeof ByteContinuationSchema>, "offset">, offset: number): string {
  return encodeBase64UrlUtf8(JSON.stringify({ ...binding, offset }));
}
export function inspectionByteOffset(token: string, binding: Omit<Schema.Schema.Type<typeof ByteContinuationSchema>, "offset">): number {
  const decoded = Schema.decodeUnknownSync(ByteContinuationSchema, { onExcessProperty: "error" })(JSON.parse(decodeBase64UrlUtf8(token)));
  if (decoded.cutoff !== binding.cutoff || decoded.source !== binding.source || decoded.locator !== binding.locator || decoded.id !== binding.id) throw new Error("Byte continuation binding changed; restart from the first page.");
  return decoded.offset;
}
