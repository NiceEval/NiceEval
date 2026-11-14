import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import type * as SchemaIssue from "effect/SchemaIssue";
import { inspectionProtocolRegistry, INSPECTION_OPERATION_IDS } from "./protocol.ts";
import { InspectionRequestSchema, type InspectionRequest } from "./protocol.ts";
export { INSPECTION_OPERATION_IDS, InspectionOperationIdSchema, InspectionRequestSchema } from "./protocol.ts";
export type {
  InspectionFailureDocument,
  InspectionOperation,
  InspectionOperationId,
  InspectionRequest,
} from "./protocol.ts";
export type InspectionDocument = import("./protocol.ts").InspectionOperationDocument;

/** Explains why an Inspection request or result failed strict decoding; it is a protocol error rather than an evaluation Verdict. */
export interface InspectionCodecError {
  readonly code: "inspection-request-invalid" | "inspection-result-invalid";
  readonly reason: string;
  readonly issues?: readonly { readonly path: string; readonly expected: string; readonly received: string }[];
  readonly omittedIssueCount?: number;
}

const inspectionCodecErrors = new WeakSet<object>();

const strictDecodeRequest = Schema.decodeUnknownResult(InspectionRequestSchema, {
  onExcessProperty: "error",
  errors: "all",
});

/** Strictly validates a complete Inspection request and returns a success or failure Result. Unknown fields are rejected instead of ignored. */
export function decodeInspectionRequest(input: unknown): Result.Result<InspectionRequest, InspectionCodecError> {
  const kind =
    typeof input === "object" &&
    input !== null &&
    "operation" in input &&
    typeof input.operation === "object" &&
    input.operation !== null &&
    "kind" in input.operation
      ? input.operation.kind
      : undefined;
  const known = INSPECTION_OPERATION_IDS.find((id) => id === kind);
  const decoded =
    known === undefined
      ? strictDecodeRequest(input)
      : Schema.decodeUnknownResult(Schema.Struct({ operation: inspectionProtocolRegistry[known].request }), {
          onExcessProperty: "error",
          errors: "all",
        })(input);
  if (Result.isSuccess(decoded)) return Result.succeed(decoded.success);
  const issues: { path: string; expected: string; received: string }[] = [];
  const type = (value: unknown) => (value === null ? "null" : Array.isArray(value) ? "array" : typeof value);
  if (known === undefined)
    issues.push({ path: "/operation/kind", expected: INSPECTION_OPERATION_IDS.join(", "), received: type(kind) });
  const visit = (issue: SchemaIssue.Issue, path: readonly PropertyKey[] = []): void => {
    if (issue._tag === "Pointer") return visit(issue.issue, [...path, ...issue.path]);
    if ("issues" in issue) {
      for (const child of issue.issues) visit(child, path);
      return;
    }
    if ("issue" in issue) return visit(issue.issue, path);
    const pointer = path.map((key) => "/" + String(key).replace(/~/g, "~0").replace(/\//g, "~1")).join("");
    if (known === undefined && pointer.startsWith("/operation")) return;
    const expected =
      "ast" in issue ? String(issue.ast) : issue._tag === "Forbidden" ? "no additional property" : "required value";
    let received: unknown = input;
    for (const key of path)
      received = typeof received === "object" && received !== null ? Reflect.get(received, key) : undefined;
    issues.push({ path: pointer, expected, received: type(received) });
  };
  visit(decoded.failure.issue);
  return Result.fail(
    Object.freeze({
      code: "inspection-request-invalid" as const,
      reason: "The Inspection request does not match Inspection.",
      issues: Object.freeze(issues.slice(0, 20)),
      omittedIssueCount: Math.max(0, issues.length - 20),
    }),
  );
}

/** JSON value accepted at the final machine-delivery boundary. */
export type InspectionJson =
  | null
  | boolean
  | number
  | string
  | readonly InspectionJson[]
  | { readonly [key: string]: InspectionJson };

export type InspectionSourceProvenance = {
  readonly kind: "project-record" | "external-record";
  readonly publicationCutoffIdentity: string;
};
export type InspectionFailureCode =
  | "unsupported-format"
  | "inspection-request-invalid"
  | "inspection-selection-missing"
  | "inspection-source-invalid"
  | "inspection-record-integrity-failure"
  | "inspection-operation-failed"
  | "inspection-result-invalid"
  | "evidence-budget-exceeded"
  | "restart-required";

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
    if (typeof current !== "object" || current === null)
      return invalidResult(path, `unsupported ${typeof current} value`);
    if (seen.has(current)) return invalidResult(path, "cyclic objects are not encodable");
    const prototype = Object.getPrototypeOf(current);
    if (prototype !== Object.prototype && prototype !== null)
      return invalidResult(path, "only plain objects may cross Inspection delivery");
    seen.add(current);
    const output: Record<string, InspectionJson> = Object.create(null);
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
  const error = Object.freeze({
    code: "inspection-result-invalid" as const,
    reason: `${path.length === 0 ? "$" : path.join(".")}: ${reason}`,
  });
  inspectionCodecErrors.add(error);
  return error;
}

export function isInspectionCodecError(value: InspectionJson | InspectionCodecError): value is InspectionCodecError {
  return isObject(value) && inspectionCodecErrors.has(value);
}

const isCodecError = isInspectionCodecError;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
