import type {
  ArtifactsResult,
  AttemptQueryResult,
  CatalogResult,
  CompareResult,
  OverviewResult,
  RunResult,
  SourcesResult,
  ViewQueryInput,
  ViewQueryName,
  ViewQueryOutput,
} from "../../query.ts";
import { queryRequest, queryResult, type WorkerRequest, type WorkerResponse } from "./protocol.ts";

interface PendingRequest {
  readonly resolve: (response: WorkerResponse) => void;
  readonly reject: (cause: Error) => void;
}

class BrowserViewRepository {
  readonly #worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module", name: "niceeval-record-reader" });
  readonly #pending = new Map<number, PendingRequest>();
  #nextId = 1;
  #open: Promise<void> | undefined;

  constructor() {
    this.#worker.addEventListener("message", (event: MessageEvent<WorkerResponse>) => {
      const pending = this.#pending.get(event.data.id);
      if (pending === undefined) return;
      this.#pending.delete(event.data.id);
      event.data.ok ? pending.resolve(event.data) : pending.reject(new Error(event.data.error));
    });
    this.#worker.addEventListener("error", (event) => {
      const error = new Error(event.message || "SQLite Worker failed.");
      for (const pending of this.#pending.values()) pending.reject(error);
      this.#pending.clear();
    });
  }

  catalog(): Promise<CatalogResult> { return this.#query("catalog", undefined); }
  overview(experimentId?: string): Promise<OverviewResult> { return this.#query("overview", experimentId === undefined ? {} : { experimentId }); }
  run(runId: string): Promise<RunResult> { return this.#query("run", { runId }); }
  attempt(locator: string): Promise<AttemptQueryResult> { return this.#query("attempt", { locator }); }
  sources(locator: string): Promise<SourcesResult> { return this.#query("sources", { locator }); }
  artifacts(locator: string): Promise<ArtifactsResult> { return this.#query("artifacts", { locator }); }
  compare(): Promise<CompareResult> { return this.#query("compare", undefined); }

  reset(): void { this.#open = undefined; }

  async #query<Name extends ViewQueryName>(name: Name, input: ViewQueryInput<Name>): Promise<ViewQueryOutput<Name>> {
    await this.#ensureOpen();
    return queryResult(name, await this.#send(queryRequest(this.#nextId++, name, input)));
  }

  #ensureOpen(): Promise<void> {
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
    return new Promise((resolve, reject) => {
      this.#pending.set(request.id, { resolve, reject });
      this.#worker.postMessage(request, transfer);
    });
  }
}

export const viewRepository = new BrowserViewRepository();
