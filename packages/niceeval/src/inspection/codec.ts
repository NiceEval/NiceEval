import { Result, Schema } from "effect";
import { QUERY_PROTOCOL } from "./protocol-values.ts";
import { InspectionRequestSchema, type InspectionOperation, type InspectionRequest } from "./protocol.ts";
export { QUERY_PROTOCOL } from "./protocol-values.ts";
export { INSPECTION_OPERATION_IDS, InspectionOperationIdSchema, InspectionRequestSchema } from "./protocol.ts";
export type { InspectionFailureDocument, InspectionOperation, InspectionOperationId, InspectionRequest } from "./protocol.ts";
export type InspectionDocument = import("./protocol.ts").InspectionOperationDocument;

export interface InspectionCodecError {
  readonly code: "inspection-request-invalid" | "inspection-result-invalid";
  readonly reason: string;
}

const strictDecodeRequest = Schema.decodeUnknownResult(InspectionRequestSchema, {
  onExcessProperty: "error",
});

export function decodeInspectionRequest(
  input: unknown,
): Result.Result<InspectionRequest, InspectionCodecError> {
  const decoded = strictDecodeRequest(input);
  return Result.isFailure(decoded)
    ? Result.fail(Object.freeze({
      code: "inspection-request-invalid" as const,
      reason: String(decoded.failure),
    }))
    : Result.succeed(decoded.success);
}

/** JSON value accepted at the final machine-delivery boundary. */
export type InspectionJson =
  | null
  | boolean
  | number
  | string
  | readonly InspectionJson[]
  | { readonly [key: string]: InspectionJson };

export type InspectionSourceProvenance = { readonly kind: "operational" | "record-snapshot"; readonly sealedCutoffIdentity: string };
export type InspectionFailureCode = "inspection-request-invalid" | "inspection-selection-missing" | "inspection-source-invalid" | "inspection-record-integrity-failure" | "inspection-operation-failed" | "inspection-result-invalid";

export function closeInspectionJson(value: unknown): InspectionJson | InspectionCodecError {
  const seen = new Set<object>();
  const close = (current: unknown, path: readonly string[]): InspectionJson | InspectionCodecError => {
    if (current === null || typeof current === "string" || typeof current === "boolean") return current;
    if (typeof current === "number") {
      return Number.isFinite(current) ? current : invalidResult(path, "numbers must be finite");
    }
    if (Array.isArray(current)) {
      if (seen.has(current)) return invalidResult(path, "cyclic arrays are not encodable");
      seen.add(current);
      const output: InspectionJson[] = [];
      for (const [index, entry] of current.entries()) {
        const closed = close(entry, [...path, String(index)]);
        if (isCodecError(closed)) return closed;
        output.push(closed);
      }
      seen.delete(current);
      return Object.freeze(output);
    }
    if (typeof current !== "object" || current === null) return invalidResult(path, `unsupported ${typeof current} value`);
    if (seen.has(current)) return invalidResult(path, "cyclic objects are not encodable");
    const prototype = Object.getPrototypeOf(current);
    if (prototype !== Object.prototype && prototype !== null) return invalidResult(path, "only plain objects may cross Inspection delivery");
    seen.add(current);
    const output: Record<string, InspectionJson> = {};
    for (const key of Object.keys(current).sort(compareCodeUnits)) {
      const closed = close(Reflect.get(current, key), [...path, key]);
      if (isCodecError(closed)) return closed;
      output[key] = closed;
    }
    seen.delete(current);
    return Object.freeze(output);
  };
  return close(value, []);
}

function invalidResult(path: readonly string[], reason: string): InspectionCodecError {
  return Object.freeze({ code: "inspection-result-invalid", reason: `${path.length === 0 ? "$" : path.join(".")}: ${reason}` });
}

function isCodecError(value: InspectionJson | InspectionCodecError): value is InspectionCodecError {
  return isObject(value) && value.code === "inspection-result-invalid" && typeof value.reason === "string";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
