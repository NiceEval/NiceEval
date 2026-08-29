import { Result, Schema } from "effect";

import {
  decodeInspectionDocument,
  decodeInspectionOperation,
  narrowInspectionSuccess,
  QUERY_PROTOCOL,
  type InspectionOperationFor,
  type InspectionOperationId,
  type InspectionQuery,
  type InspectionSuccessDocumentFor,
} from "../../../inspection/public.ts";
import {
  ViewGenerationDescriptorSchema,
  type ViewGenerationDescriptor,
  type ViewHttpErrorDocument,
} from "../../http-protocol.ts";

const ViewHttpErrorDocumentSchema = Schema.Struct({
  code: Schema.Literals([
    "view-request-invalid",
    "view-generation-not-found",
    "view-generation-stale",
    "view-inspection-failed",
  ]),
  reason: Schema.String,
  correction: Schema.Literals(["fix-request", "refresh-generation", "retry"]),
});

const strict = { errors: "all" as const, onExcessProperty: "error" as const };
const decodeDescriptor = Schema.decodeUnknownResult(ViewGenerationDescriptorSchema, strict);
const decodeHttpError = Schema.decodeUnknownResult(ViewHttpErrorDocumentSchema, strict);

export class ViewHttpError extends Error {
  readonly classification = "view-http" as const;

  constructor(
    readonly status: number,
    readonly code: ViewHttpErrorDocument["code"] | "view-response-invalid",
    readonly correction: ViewHttpErrorDocument["correction"],
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ViewHttpError";
  }
}

export class HttpInspectionRepository implements InspectionQuery {
  readonly generationId: string;
  readonly #controller = new AbortController();
  #closed = false;

  constructor(readonly descriptor: ViewGenerationDescriptor) {
    this.generationId = descriptor.generationId;
  }

  async inspect<Kind extends InspectionOperationId>(
    operation: InspectionOperationFor<Kind>,
  ): Promise<InspectionSuccessDocumentFor<Kind>> {
    if (this.#closed) throw new Error("HTTP Inspection repository is closed.");
    const decodedOperation = decodeInspectionOperation(operation);
    if (Result.isFailure(decodedOperation)) throw new Error(decodedOperation.failure.reason);
    const response = await viewFetch("/_niceeval/inspection", {
      method: "POST",
      signal: this.#controller.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        generationId: this.descriptor.generationId,
        request: { protocol: QUERY_PROTOCOL, operation: decodedOperation.success },
      }),
    });
    const body = await responseBody(response);
    if (!response.ok) throw responseError(response.status, body);
    const decodedDocument = decodeInspectionDocument(body);
    if (!decodedDocument.success) {
      throw new ViewHttpError(response.status, "view-response-invalid", "retry", decodedDocument.reason);
    }
    const narrowed = narrowInspectionSuccess(decodedDocument.value, operation.kind);
    if (!narrowed.success) {
      throw new ViewHttpError(response.status, "view-response-invalid", "retry", narrowed.reason);
    }
    return narrowed.value;
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#controller.abort();
  }
}

export async function fetchCurrentGeneration(): Promise<ViewGenerationDescriptor> {
  return fetchDescriptor("/_niceeval/generation", { method: "GET" });
}

export async function refreshGeneration(): Promise<ViewGenerationDescriptor> {
  return fetchDescriptor("/_niceeval/generation/refresh", { method: "POST" });
}

export async function commitGeneration(generationId: string): Promise<ViewGenerationDescriptor> {
  return fetchDescriptor("/_niceeval/generation/commit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ generationId }),
  });
}

async function fetchDescriptor(path: string, init: RequestInit): Promise<ViewGenerationDescriptor> {
  const response = await viewFetch(path, init);
  const body = await responseBody(response);
  if (!response.ok) throw responseError(response.status, body);
  const decoded = decodeDescriptor(body);
  if (Result.isFailure(decoded)) {
    throw new ViewHttpError(response.status, "view-response-invalid", "retry", String(decoded.failure));
  }
  return decoded.success;
}

function viewFetch(path: string, init: RequestInit): Promise<Response> {
  return fetch(new URL(path, document.baseURI), {
    ...init,
    cache: "no-store",
    credentials: "same-origin",
  });
}

async function responseBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (cause) {
    throw new ViewHttpError(response.status, "view-response-invalid", "retry", "View HTTP response is not JSON.", { cause });
  }
}

function responseError(status: number, body: unknown): ViewHttpError {
  const decoded = decodeHttpError(body);
  if (Result.isFailure(decoded)) {
    return new ViewHttpError(status, "view-response-invalid", "retry", `View HTTP request failed (${status}).`);
  }
  return new ViewHttpError(status, decoded.success.code, decoded.success.correction, decoded.success.reason);
}
