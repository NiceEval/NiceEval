import type {
  InspectionDocument,
  InspectionOperation,
} from "../../../inspection/codec.ts";
import {
  inspectionRequest,
  inspectionResult,
  type WorkerRequest,
  type WorkerResponse,
} from "./protocol.ts";

interface PendingRequest {
  readonly resolve: (response: WorkerResponse) => void;
  readonly reject: (cause: Error) => void;
}

class BrowserInspectionRepository {
  readonly #worker = new Worker(new URL("./worker.ts", import.meta.url), {
    type: "module",
    name: "niceeval-record-reader",
  });
  readonly #pending = new Map<number, PendingRequest>();
  #nextId = 1;
  #open: Promise<void> | undefined;

  constructor() {
    this.#worker.addEventListener(
      "message",
      (event: MessageEvent<WorkerResponse>) => {
        const pending = this.#pending.get(event.data.id);
        if (pending === undefined) return;
        this.#pending.delete(event.data.id);
        event.data.ok
          ? pending.resolve(event.data)
          : pending.reject(new Error(event.data.error));
      },
    );
    this.#worker.addEventListener("error", (event) => {
      const error = new Error(event.message || "SQLite Worker failed.");
      for (const pending of this.#pending.values()) pending.reject(error);
      this.#pending.clear();
    });
  }

  async inspect(operation: InspectionOperation): Promise<InspectionDocument> {
    await this.#ensureOpen();
    return inspectionResult(
      operation,
      await this.#send(inspectionRequest(this.#nextId++, operation)),
    );
  }

  reset(): void {
    this.#open = undefined;
  }

  #ensureOpen(): Promise<void> {
    this.#open ??= fetch(new URL("record.sqlite", document.baseURI), {
      cache: "no-store",
      credentials: "same-origin",
    }).then(async (response) => {
      if (!response.ok) {
        throw new Error(`RecordSnapshot request failed (${response.status}).`);
      }
      const bytes = await response.arrayBuffer();
      const request: WorkerRequest = {
        id: this.#nextId++,
        kind: "open",
        bytes,
      };
      const opened = await this.#send(request, [bytes]);
      if (!opened.ok) throw new Error(opened.error);
      if (opened.kind !== "ready") {
        throw new Error("SQLite Worker did not acknowledge the RecordSnapshot.");
      }
    });
    return this.#open;
  }

  #send(
    request: WorkerRequest,
    transfer: Transferable[] = [],
  ): Promise<WorkerResponse> {
    return new Promise((resolve, reject) => {
      this.#pending.set(request.id, { resolve, reject });
      this.#worker.postMessage(request, transfer);
    });
  }
}

export const viewRepository = new BrowserInspectionRepository();
