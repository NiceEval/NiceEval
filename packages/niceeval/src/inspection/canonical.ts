import { Either } from "effect";

import {
  closeInspectionJson,
  decodeInspectionDocument,
  type InspectionCodecError,
  type InspectionDocument,
  type InspectionJson,
} from "./codec.ts";

export function canonicalInspectionJson(
  value: InspectionDocument,
): Either.Either<string, InspectionCodecError> {
  const decoded = decodeInspectionDocument(value);
  if (Either.isLeft(decoded)) return Either.left(decoded.left);
  const closed = closeInspectionJson(decoded.right);
  if (isCodecError(closed)) return Either.left(closed);
  return Either.right(`${encode(closed)}\n`);
}

export function canonicalJsonValue(
  value: unknown,
): Either.Either<string, InspectionCodecError> {
  const closed = closeInspectionJson(value);
  if (isCodecError(closed)) {
    return Either.left(closed);
  }
  return Either.right(`${encode(closed)}\n`);
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

function isCodecError(value: InspectionJson | InspectionCodecError): value is InspectionCodecError {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    Reflect.get(value, "code") === "inspection-result-invalid" &&
    typeof Reflect.get(value, "reason") === "string";
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
