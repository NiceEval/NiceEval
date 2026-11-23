// @concord-file
// @concord-implements docs/feature/inspection/cli.md
import * as Schema from "effect/Schema";
import { decodeBase64UrlUtf8, encodeBase64UrlUtf8 } from "./bytes.ts";
const ByteContinuationSchema = Schema.Struct({
  cutoff: Schema.String,
  source: Schema.String,
  locator: Schema.String,
  id: Schema.String,
  offset: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  page: Schema.optionalKey(Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0))),
});

type ByteContinuationBinding = Omit<Schema.Schema.Type<typeof ByteContinuationSchema>, "offset" | "page">;

export function inspectionByteContinuation(binding: ByteContinuationBinding, offset: number, page?: number): string {
  return encodeBase64UrlUtf8(JSON.stringify({ ...binding, offset, page }));
}

export function readInspectionByteContinuation(token: string, binding: ByteContinuationBinding) {
  const decoded = Schema.decodeUnknownSync(ByteContinuationSchema, { onExcessProperty: "error" })(
    JSON.parse(decodeBase64UrlUtf8(token)),
  );
  if (
    decoded.cutoff !== binding.cutoff ||
    decoded.source !== binding.source ||
    decoded.locator !== binding.locator ||
    decoded.id !== binding.id
  )
    throw new Error("Byte continuation binding changed; restart from the first page.");
  return decoded;
}

export function inspectionByteOffset(token: string, binding: ByteContinuationBinding): number {
  const { offset, page } = readInspectionByteContinuation(token, binding);
  if (page !== undefined) throw new Error("Unexpected page in byte continuation.");
  return offset;
}
