import { Result } from "effect";

import {
  closeInspectionJson,
  isInspectionCodecError,
  type InspectionCodecError,
  type InspectionJson,
} from "./codec.ts";
import { decodeInspectionDocument, type InspectionDocument } from "./protocol.ts";

export function canonicalInspectionJson(
  value: InspectionDocument,
): Result.Result<string, InspectionCodecError> {
  const decoded = decodeInspectionDocument(value);
  if (!decoded.success) return Result.fail({ code: "inspection-result-invalid", reason: decoded.reason });
  const closed = closeInspectionJson(decoded.value);
  if (isInspectionCodecError(closed)) return Result.fail(closed);
  return Result.succeed(`${encode(closed)}\n`);
}

export function canonicalJsonValue(
  value: unknown,
): Result.Result<string, InspectionCodecError> {
  const closed = closeInspectionJson(value);
  if (isInspectionCodecError(closed)) {
    return Result.fail(closed);
  }
  return Result.succeed(`${encode(closed)}\n`);
}

function encode(value: InspectionJson): string {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(encode).join(",")}]`;
  const record = value as { readonly [key: string]: InspectionJson };
  return `{${Object.keys(record).sort(compareCodeUnits).map((key) =>
    `${JSON.stringify(key)}:${encode(record[key]!)}`
  ).join(",")}}`;
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
