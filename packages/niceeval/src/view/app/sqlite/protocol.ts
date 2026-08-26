import type {
  InspectionDocument,
  InspectionOperation,
  InspectionOperationId,
} from "../../../inspection/codec.ts";

export type WorkerRequest =
  | { readonly id: number; readonly kind: "open"; readonly bytes: ArrayBuffer }
  | { readonly id: number; readonly kind: "inspect"; readonly operation: InspectionOperation };

export type WorkerResponse =
  | { readonly id: number; readonly ok: true; readonly kind: "ready" }
  | {
      readonly id: number;
      readonly ok: true;
      readonly kind: "result";
      readonly operation: InspectionOperationId;
      readonly result: InspectionDocument;
    }
  | { readonly id: number; readonly ok: false; readonly error: string };

export function inspectionRequest(
  id: number,
  operation: InspectionOperation,
): WorkerRequest {
  return { id, kind: "inspect", operation };
}

export function inspectionResult(
  operation: InspectionOperation,
  response: WorkerResponse,
): InspectionDocument {
  if (!response.ok) throw new Error(response.error);
  if (response.kind !== "result") {
    throw new Error("SQLite Worker returned no Inspection result.");
  }
  if (response.operation !== operation.kind) {
    throw new Error(
      `SQLite Worker returned ${response.operation} for ${operation.kind}.`,
    );
  }
  return response.result;
}
