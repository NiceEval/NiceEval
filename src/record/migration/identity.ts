import type { RecordFormatId } from "../model/identifiers.ts";
import { isRecordFormatId } from "../model/identifiers.ts";

const RECORD_FORMAT_MAJOR_PATTERN = /^niceeval\.record\/v([1-9][0-9]*)$/;

function parsePositiveSafeInteger(value: string): number | undefined {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/** Returns a durable Core major only for a valid NiceEval Record format id. */
export function recordFormatMajor(
  format: RecordFormatId | string,
): number | undefined {
  if (!isRecordFormatId(format)) {
    return undefined;
  }
  const match = RECORD_FORMAT_MAJOR_PATTERN.exec(format);
  return match === null ? undefined : parsePositiveSafeInteger(match[1]);
}

/** Core converters may advance exactly one major; skipping remains invalid. */
export function areAdjacentRecordFormats(
  from: RecordFormatId,
  to: RecordFormatId,
): boolean {
  const fromMajor = recordFormatMajor(from);
  const toMajor = recordFormatMajor(to);
  return (
    fromMajor !== undefined &&
    toMajor !== undefined &&
    toMajor === fromMajor + 1
  );
}
