import { Result, Schema } from "effect";

import { InspectionRequestSchema, type InspectionDocument, type InspectionRequest } from "../inspection/protocol.ts";

export const VIEW_HTTP_BODY_LIMIT = 64 * 1024;

export const ViewGenerationDescriptorSchema = Schema.Struct({
  generationId: Schema.String,
  sourceCutoffIdentity: Schema.String,
  refreshSupported: Schema.Boolean,
  stale: Schema.Boolean,
});
export type ViewGenerationDescriptor = Schema.Schema.Type<typeof ViewGenerationDescriptorSchema>;

export const ViewGenerationCommitRequestSchema = Schema.Struct({ generationId: Schema.String });
export type ViewGenerationCommitRequest = Schema.Schema.Type<typeof ViewGenerationCommitRequestSchema>;

export const ViewInspectionHttpRequestSchema = Schema.Struct({
  generationId: Schema.String,
  request: InspectionRequestSchema,
});
export type ViewInspectionHttpRequest = Schema.Schema.Type<typeof ViewInspectionHttpRequestSchema>;

export interface ViewHttpErrorDocument {
  readonly code: "view-request-invalid" | "view-generation-not-found" | "view-generation-stale" | "view-inspection-failed";
  readonly reason: string;
  readonly correction: "fix-request" | "refresh-generation" | "retry";
}

const strict = { errors: "all" as const, onExcessProperty: "error" as const };
export function decodeGenerationCommitRequest(input: unknown): Result.Result<ViewGenerationCommitRequest, string> {
  const decoded = Schema.decodeUnknownResult(ViewGenerationCommitRequestSchema, strict)(input);
  return Result.isSuccess(decoded) ? Result.succeed(decoded.success) : Result.fail(String(decoded.failure));
}
export function decodeViewInspectionRequest(input: unknown): Result.Result<ViewInspectionHttpRequest, string> {
  const decoded = Schema.decodeUnknownResult(ViewInspectionHttpRequestSchema, strict)(input);
  return Result.isSuccess(decoded) ? Result.succeed(decoded.success) : Result.fail(String(decoded.failure));
}

export type ViewInspectionHttpResponse = InspectionDocument;
