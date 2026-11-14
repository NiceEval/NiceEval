// @concord-file
// @concord-implements docs/feature/inspection/README.md
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import {
  InspectionRequestSchema,
  type InspectionOperation,
  type InspectionOperationFor,
  type InspectionOperationId,
  type InspectionSuccessDocumentFor,
} from "./protocol.ts";

/** Presentation-neutral query boundary implemented by local or remote Inspection adapters. */
export interface InspectionQuery {
  inspect<Kind extends InspectionOperationId>(
    operation: InspectionOperationFor<Kind>,
  ): Promise<InspectionSuccessDocumentFor<Kind>>;
}

/** Reports a malformed request, invalid source or failed operation; its code describes query failure rather than evaluation quality. */
export interface InspectionQueryProtocolError {
  readonly classification: "protocol/query";
  readonly code:
    | "inspection-request-invalid"
    | "inspection-source-invalid"
    | "inspection-record-integrity-failure"
    | "inspection-operation-failed"
    | "inspection-result-invalid"
    | "evidence-budget-exceeded"
    | "restart-required";
  readonly reason: string;
  readonly identity?: { readonly runId: string };
  readonly cause?: unknown;
}

/** Reports that the requested Inspection selection is missing; it must not be converted into an empty successful result. */
export interface InspectionQuerySelectionError {
  readonly classification: "selection";
  readonly code: "inspection-selection-missing";
  readonly reason: string;
  readonly cause?: unknown;
}

/** Distinguishes a missing selection from a protocol or evidence-reading failure; callers should branch on classification. */
export type InspectionQueryError =
  | InspectionQueryProtocolError
  | InspectionQuerySelectionError;

/** Rejects an invalid fixed-operation request at the query boundary; no query execution is implied. */
export interface InspectionOperationDecodeError extends InspectionQueryProtocolError {
  readonly code: "inspection-request-invalid";
}

const decodeRequest = Schema.decodeUnknownResult(InspectionRequestSchema, {
  onExcessProperty: "error",
});

/** Runtime-safe operation builder for route and adapter inputs. */
export function decodeInspectionOperation(
  input: unknown,
): Result.Result<InspectionOperation, InspectionOperationDecodeError> {
  const decoded = decodeRequest({ operation: input });
  return Result.isFailure(decoded)
    ? Result.fail(Object.freeze({
      classification: "protocol/query" as const,
      code: "inspection-request-invalid" as const,
      reason: String(decoded.failure),
    }))
    : Result.succeed(decoded.success.operation);
}
