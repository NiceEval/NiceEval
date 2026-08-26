import { Either, Schema } from "effect";

import { RunIdSchema } from "../record/codec/identifiers.ts";
import { ATTEMPT_LOCATOR_PATTERN } from "../attempt-locator.ts";

export const QUERY_PROTOCOL = "niceeval.query/v1" as const;
export const VIEW_LIFECYCLE_PROTOCOL = "niceeval.view-lifecycle/v1" as const;

export const INSPECTION_OPERATION_IDS = Object.freeze([
  "runs.list",
  "run.get",
  "run.summary",
  "attempt.get",
  "attempt.trace",
  "attempt.diff",
  "attempt.sources",
  "attempt.artifacts",
  "runs.compare",
] as const);

export type InspectionOperationId = (typeof INSPECTION_OPERATION_IDS)[number];

export const InspectionOperationIdSchema = Schema.Literal(...INSPECTION_OPERATION_IDS);

const AttemptLocatorSchema = Schema.String.pipe(
  Schema.filter((value) => ATTEMPT_LOCATOR_PATTERN.test(value), {
    identifier: "AttemptLocator",
    description: "a canonical @-prefixed Attempt locator",
  }),
);

const RunIdsSchema = Schema.Array(RunIdSchema);

export const InspectionRequestSchema = Schema.Struct({
  protocol: Schema.Literal(QUERY_PROTOCOL),
  operation: Schema.Union(
    Schema.Struct({
      kind: Schema.Literal("runs.list"),
      continuation: Schema.optional(Schema.String),
    }),
    Schema.Struct({ kind: Schema.Literal("run.get"), runId: RunIdSchema }),
    Schema.Struct({ kind: Schema.Literal("run.summary"), runId: RunIdSchema }),
    Schema.Struct({ kind: Schema.Literal("attempt.get"), locator: AttemptLocatorSchema }),
    Schema.Struct({ kind: Schema.Literal("attempt.trace"), locator: AttemptLocatorSchema }),
    Schema.Struct({ kind: Schema.Literal("attempt.diff"), locator: AttemptLocatorSchema }),
    Schema.Struct({ kind: Schema.Literal("attempt.sources"), locator: AttemptLocatorSchema }),
    Schema.Struct({ kind: Schema.Literal("attempt.artifacts"), locator: AttemptLocatorSchema }),
    Schema.Struct({
      kind: Schema.Literal("runs.compare"),
      mode: Schema.Literal("side-by-side", "exact", "paired"),
      leftRunIds: RunIdsSchema,
      rightRunIds: RunIdsSchema,
    }),
  ),
});

export type InspectionRequest = Schema.Schema.Type<typeof InspectionRequestSchema>;
export type InspectionOperation = InspectionRequest["operation"];

export interface InspectionCodecError {
  readonly code: "inspection-request-invalid" | "inspection-result-invalid";
  readonly reason: string;
}

const strictDecodeRequest = Schema.decodeUnknownEither(InspectionRequestSchema, {
  onExcessProperty: "error",
});

export function decodeInspectionRequest(
  input: unknown,
): Either.Either<InspectionRequest, InspectionCodecError> {
  const decoded = strictDecodeRequest(input);
  return Either.isLeft(decoded)
    ? Either.left(Object.freeze({
      code: "inspection-request-invalid" as const,
      reason: String(decoded.left),
    }))
    : Either.right(decoded.right);
}

/** JSON value accepted at the final machine-delivery boundary. */
export type InspectionJson =
  | null
  | boolean
  | number
  | string
  | readonly InspectionJson[]
  | { readonly [key: string]: InspectionJson };

export interface InspectionDocument {
  readonly protocol: typeof QUERY_PROTOCOL;
  readonly operation: InspectionOperationId;
  readonly behaviorVersion: string;
  readonly sealedCutoff: InspectionJson;
  readonly selection: InspectionJson;
  readonly issues: readonly InspectionJson[];
  readonly evidence: InspectionJson;
  readonly continuation?: string;
}

export type InspectionFailureCode =
  | "inspection-request-invalid"
  | "inspection-selection-missing"
  | "inspection-source-invalid"
  | "inspection-operation-failed"
  | "inspection-result-invalid";

export interface InspectionFailureDocument {
  readonly protocol: typeof QUERY_PROTOCOL;
  readonly outcome: "failure";
  readonly operation: InspectionOperationId | null;
  readonly behaviorVersion: string | null;
  readonly failure: {
    readonly code: InspectionFailureCode;
    readonly reason: string;
    readonly correction:
      | "fix-request"
      | "choose-existing-selection"
      | "fix-record-source"
      | "retry"
      | "upgrade-or-report";
  };
}

export function closeInspectionJson(value: unknown): InspectionJson | InspectionCodecError {
  const seen = new Set<object>();
  const close = (current: unknown, path: readonly string[]): InspectionJson | InspectionCodecError => {
    if (current === null || typeof current === "string" || typeof current === "boolean") return current;
    if (typeof current === "number") {
      return Number.isFinite(current)
        ? current
        : invalidResult(path, "numbers must be finite");
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
    if (typeof current !== "object" || current === null) {
      return invalidResult(path, `unsupported ${typeof current} value`);
    }
    if (seen.has(current)) return invalidResult(path, "cyclic objects are not encodable");
    const prototype = Object.getPrototypeOf(current);
    if (prototype !== Object.prototype && prototype !== null) {
      return invalidResult(path, "only plain objects may cross Inspection delivery");
    }
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

export function decodeInspectionDocument(
  input: unknown,
): Either.Either<InspectionDocument, InspectionCodecError> {
  const closed = closeInspectionJson(input);
  if (isCodecError(closed)) return Either.left(closed);
  if (!isObject(closed) || closed.protocol !== QUERY_PROTOCOL) {
    return Either.left(invalidResult(["protocol"], `expected ${QUERY_PROTOCOL}`));
  }
  if (typeof closed.operation !== "string" || !isOperationId(closed.operation)) {
    return Either.left(invalidResult(["operation"], "expected one fixed operation id"));
  }
  if (typeof closed.behaviorVersion !== "string" || closed.behaviorVersion.length === 0) {
    return Either.left(invalidResult(["behaviorVersion"], "expected a non-empty behavior version"));
  }
  for (const key of ["sealedCutoff", "selection", "issues", "evidence"] as const) {
    if (!Object.hasOwn(closed, key)) return Either.left(invalidResult([key], "required field is missing"));
  }
  if (!Array.isArray(closed.issues)) return Either.left(invalidResult(["issues"], "expected an array"));
  const resultField = operationResultField(closed.operation);
  const explanation = Object.hasOwn(closed, "factKinds");
  if (explanation) {
    if (!Array.isArray(closed.factKinds) || closed.factKinds.some((entry) => typeof entry !== "string")) {
      return Either.left(invalidResult(["factKinds"], "expected an array of fact kind strings"));
    }
    if (Object.hasOwn(closed, resultField)) {
      return Either.left(invalidResult([resultField], "explanation cannot contain an operation result"));
    }
  } else if (!Object.hasOwn(closed, resultField)) {
    return Either.left(invalidResult([resultField], "operation result is missing"));
  }
  const allowed = new Set([
    "protocol",
    "operation",
    "behaviorVersion",
    "sealedCutoff",
    "selection",
    "issues",
    "evidence",
    "continuation",
    explanation ? "factKinds" : resultField,
  ]);
  if (Object.hasOwn(closed, "continuation") && typeof closed.continuation !== "string") {
    return Either.left(invalidResult(["continuation"], "expected an opaque string token"));
  }
  const excess = Object.keys(closed).find((key) => !allowed.has(key));
  if (excess !== undefined) return Either.left(invalidResult([excess], "field is not part of the fixed result codec"));
  return Either.right(closed as unknown as InspectionDocument);
}

function operationResultField(operation: InspectionOperationId): string {
  switch (operation) {
    case "runs.list": return "runs";
    case "run.get": return "run";
    case "run.summary": return "summary";
    case "attempt.get": return "attempt";
    case "attempt.trace": return "trace";
    case "attempt.diff": return "diff";
    case "attempt.sources": return "sources";
    case "attempt.artifacts": return "artifacts";
    case "runs.compare": return "comparison";
  }
}

function invalidResult(path: readonly string[], reason: string): InspectionCodecError {
  return Object.freeze({
    code: "inspection-result-invalid",
    reason: `${path.length === 0 ? "$" : path.join(".")}: ${reason}`,
  });
}

function isCodecError(value: InspectionJson | InspectionCodecError): value is InspectionCodecError {
  return isObject(value) &&
    value.code === "inspection-result-invalid" &&
    typeof value.reason === "string";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOperationId(value: string): value is InspectionOperationId {
  return (INSPECTION_OPERATION_IDS as readonly string[]).includes(value);
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
