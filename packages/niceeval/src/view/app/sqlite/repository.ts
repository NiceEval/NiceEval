import {
  decodeInspectionDocument,
  decodeInspectionOperation,
  narrowInspectionSuccess,
  type InspectionOperationFor,
  type InspectionOperationId,
  type InspectionQuery,
  type InspectionSuccessDocumentFor,
} from "../../../inspection/public.ts";
import { Result } from "effect";
import { decodeWorkerResponse, inspectionRequest, type WorkerRequest, type WorkerResponse } from "./protocol.ts";

interface PendingRequest {
  readonly resolve: (response: WorkerResponse) => void;
  readonly reject: (cause: Error) => void;
}

export class BrowserInspectionRepository implements InspectionQuery {
  readonly #worker: Worker;
  readonly #pending = new Map<number, PendingRequest>();
  #nextId = 1;
  #open: Promise<void> | undefined;
  #closedError: Error | undefined;

  constructor() {
    this.#worker = new Worker(new URL("./worker.ts", import.meta.url), {
      type: "module",
      name: "niceeval-record-reader",
    });
    this.#worker.addEventListener("message", (event: MessageEvent<unknown>) => {
      let response: WorkerResponse;
      try {
        response = decodeWorkerResponse(event.data);
      } catch (cause) {
        this.#fail(cause instanceof Error ? cause : new Error("SQLite Worker response is invalid."));
        return;
      }
      const pending = this.#pending.get(response.id);
      if (pending === undefined) return;
      this.#pending.delete(response.id);
      response.ok ? pending.resolve(response) : pending.reject(new Error(response.error));
    });
    this.#worker.addEventListener("error", (event) => {
      this.#fail(new Error(event.message || "SQLite Worker failed."));
    });
    this.#worker.addEventListener("messageerror", () => {
      this.#fail(new Error("SQLite Worker response could not be deserialized."));
    });
  }

  async inspect<Kind extends InspectionOperationId>(
    operation: InspectionOperationFor<Kind>,
  ): Promise<InspectionSuccessDocumentFor<Kind>> {
    const decodedOperation = decodeInspectionOperation(operation);
    if (Result.isFailure(decodedOperation)) throw new Error(decodedOperation.failure.reason);
    await this.#ensureOpen();
    const response = await this.#send(inspectionRequest(this.#nextId++, decodedOperation.success));
    if (!response.ok) throw new Error(response.error);
    if (response.kind !== "result") throw new Error("SQLite Worker returned no Inspection result.");
    if (response.operation !== operation.kind) {
      throw new Error(`SQLite Worker returned ${response.operation} for ${operation.kind}.`);
    }
    const decodedDocument = decodeInspectionDocument(response.result);
    if (!decodedDocument.success) {
      throw new Error(`SQLite Worker Inspection result is invalid: ${decodedDocument.reason}`);
    }
    const narrowed = narrowInspectionSuccess(decodedDocument.value, operation.kind);
    if (!narrowed.success) throw new Error(narrowed.reason);
    return narrowed.value;
  }

  reset(): void {
    this.#open = undefined;
  }

  close(): void {
    if (this.#closedError !== undefined) return;
    this.#closedError = new Error("Browser Inspection repository is closed.");
    this.#worker.terminate();
    this.#rejectPending(this.#closedError);
  }

  #ensureOpen(): Promise<void> {
    if (this.#closedError !== undefined) return Promise.reject(this.#closedError);
    this.#open ??= fetch(new URL("record.sqlite", document.baseURI), {
      cache: "no-store",
      credentials: "same-origin",
    }).then(async (response) => {
      if (!response.ok) throw new Error(`RecordSnapshot request failed (${response.status}).`);
      const bytes = await response.arrayBuffer();
      const request: WorkerRequest = { id: this.#nextId++, kind: "open", bytes };
      const opened = await this.#send(request, [bytes]);
      if (!opened.ok) throw new Error(opened.error);
      if (opened.kind !== "ready") throw new Error("SQLite Worker did not acknowledge the RecordSnapshot.");
    });
    return this.#open;
  }

  #send(request: WorkerRequest, transfer: Transferable[] = []): Promise<WorkerResponse> {
    if (this.#closedError !== undefined) return Promise.reject(this.#closedError);
    return new Promise((resolve, reject) => {
      this.#pending.set(request.id, { resolve, reject });
      try {
        this.#worker.postMessage(request, transfer);
      } catch (cause) {
        this.#pending.delete(request.id);
        reject(cause instanceof Error ? cause : new Error("SQLite Worker request failed."));
      }
    });
  }

  #fail(error: Error): void {
    if (this.#closedError !== undefined) return;
    this.#closedError = error;
    this.#worker.terminate();
    this.#rejectPending(error);
  }

  #rejectPending(error: Error): void {
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
  }
}

export const createBrowserInspectionRepository = (): BrowserInspectionRepository => new BrowserInspectionRepository();
