import { Result, Schema } from "effect";

import type { InspectionOperation } from "../../../inspection/public.ts";

export type WorkerRequest =
  | { readonly id: number; readonly kind: "open"; readonly bytes: ArrayBuffer }
  | { readonly id: number; readonly kind: "inspect"; readonly operation: InspectionOperation };

export type WorkerResponse =
  | { readonly id: number; readonly ok: true; readonly kind: "ready" }
  | { readonly id: number; readonly ok: true; readonly kind: "result"; readonly operation: string; readonly result: unknown }
  | { readonly id: number; readonly ok: false; readonly error: string };

const WorkerResponseSchema = Schema.Union([
  Schema.Struct({ id: Schema.Int, ok: Schema.Literal(true), kind: Schema.Literal("ready") }),
  Schema.Struct({ id: Schema.Int, ok: Schema.Literal(true), kind: Schema.Literal("result"), operation: Schema.String, result: Schema.Unknown }),
  Schema.Struct({ id: Schema.Int, ok: Schema.Literal(false), error: Schema.String }),
]);

const decodeResponse = Schema.decodeUnknownResult(WorkerResponseSchema, {
  errors: "all",
  onExcessProperty: "error",
});

export function decodeWorkerResponse(input: unknown): WorkerResponse {
  const decoded = decodeResponse(input);
  if (Result.isFailure(decoded)) {
    throw new Error(`SQLite Worker response is invalid: ${String(decoded.failure)}`);
  }
  return decoded.success;
}

export function inspectionRequest(id: number, operation: InspectionOperation): WorkerRequest {
  return { id, kind: "inspect", operation };
}
