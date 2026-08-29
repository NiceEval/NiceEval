import { Result, Schema } from "effect";

import {
  InspectionRequestSchema,
  type InspectionOperation,
  type InspectionOperationFor,
  type InspectionOperationId,
  type InspectionSuccessDocumentFor,
} from "./protocol.ts";
import { QUERY_PROTOCOL } from "./protocol-values.ts";

/** Presentation-neutral query boundary implemented by local or remote Inspection adapters. */
export interface InspectionQuery {
  inspect<Kind extends InspectionOperationId>(
    operation: InspectionOperationFor<Kind>,
  ): Promise<InspectionSuccessDocumentFor<Kind>>;
}

export interface InspectionQueryProtocolError {
  readonly classification: "protocol/query";
  readonly code:
    | "inspection-request-invalid"
    | "inspection-source-invalid"
    | "inspection-operation-failed"
    | "inspection-result-invalid";
  readonly reason: string;
  readonly cause?: unknown;
}

export interface InspectionQuerySelectionError {
  readonly classification: "selection";
  readonly code: "inspection-selection-missing";
  readonly reason: string;
  readonly cause?: unknown;
}

export type InspectionQueryError =
  | InspectionQueryProtocolError
  | InspectionQuerySelectionError;

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
  const decoded = decodeRequest({ protocol: QUERY_PROTOCOL, operation: input });
  return Result.isFailure(decoded)
    ? Result.fail(Object.freeze({
      classification: "protocol/query" as const,
      code: "inspection-request-invalid" as const,
      reason: String(decoded.failure),
    }))
    : Result.succeed(decoded.success.operation);
}
