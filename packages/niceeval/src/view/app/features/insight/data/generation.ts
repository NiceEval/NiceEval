import { QueryClient } from "@tanstack/react-query";

import {
  type InspectionOperationFor,
  type InspectionOperationId,
  type InspectionQuery,
  type InspectionSuccessDocumentFor,
} from "../../../../../inspection/public.ts";
import { inspectionQueryOptions } from "./react-query.tsx";

declare const generationIdentityBrand: unique symbol;
export type ViewGenerationIdentity = string & { readonly [generationIdentityBrand]: true };

export interface OwnedInspectionRepository extends InspectionQuery {
  readonly generationId: string;
  close(): void;
}

export interface ViewGenerationBinding<Snapshot = unknown> {
  readonly identity: ViewGenerationIdentity;
  readonly queryClient: QueryClient;
  readonly snapshot: Snapshot;
  inspectRepository<Kind extends InspectionOperationId>(operation: InspectionOperationFor<Kind>): Promise<InspectionSuccessDocumentFor<Kind>>;
}

export class GenerationLease<Snapshot = unknown> {
  #released = false;
  constructor(readonly generation: ViewGeneration<Snapshot>) {}
  get identity(): ViewGenerationIdentity { return this.generation.identity; }

  inspect<Kind extends InspectionOperationId>(operation: InspectionOperationFor<Kind>): Promise<InspectionSuccessDocumentFor<Kind>> {
    if (this.#released) return Promise.reject(new Error("Generation lease is released."));
    return this.generation.queryClient.fetchQuery(inspectionQueryOptions(this.generation, operation));
  }

  release(): void {
    if (this.#released) return;
    this.#released = true;
    this.generation.releaseLease();
  }
}

export class ViewGeneration<Snapshot = unknown> {
  readonly identity: ViewGenerationIdentity;
  readonly queryClient = new QueryClient({
    defaultOptions: { queries: {
      gcTime: 5 * 60_000,
      retry: 1,
      staleTime: Infinity,
      refetchOnMount: false,
      refetchOnReconnect: false,
      refetchOnWindowFocus: false,
    } },
  });
  #state: "preparing" | "current" | "retiring" | "closed" = "preparing";
  #leases = 0;
  #operations = 0;
  #snapshot: Snapshot | undefined;
  readonly binding: ViewGenerationBinding<Snapshot>;

  constructor(readonly repository: OwnedInspectionRepository) {
    this.identity = repository.generationId as ViewGenerationIdentity;
    const generation = this;
    this.binding = Object.freeze({
      identity: this.identity,
      queryClient: this.queryClient,
      get snapshot() { return generation.snapshot; },
      inspectRepository<Kind extends InspectionOperationId>(operation: InspectionOperationFor<Kind>) {
        return generation.inspectRepository(operation);
      },
    });
  }
  get status(): "preparing" | "current" | "retiring" | "closed" { return this.#state; }
  get snapshot(): Snapshot {
    if (this.#snapshot === undefined) throw new Error("View generation snapshot is not ready.");
    return this.#snapshot;
  }

  attachSnapshot(snapshot: Snapshot): void {
    if (this.#state !== "preparing" || this.#snapshot !== undefined) {
      throw new Error("A View generation snapshot can only be attached once while preparing.");
    }
    this.#snapshot = snapshot;
  }

  acquire(): GenerationLease<Snapshot> {
    if (this.#state === "retiring" || this.#state === "closed") throw new Error(`View generation is ${this.#state}.`);
    this.#leases += 1;
    return new GenerationLease(this);
  }

  inspectRepository<Kind extends InspectionOperationId>(operation: InspectionOperationFor<Kind>): Promise<InspectionSuccessDocumentFor<Kind>> {
    if (this.#state === "retiring" || this.#state === "closed") {
      return Promise.reject(new Error(`View generation is ${this.#state}.`));
    }
    this.#operations += 1;
    let result: Promise<InspectionSuccessDocumentFor<Kind>>;
    try {
      result = this.repository.inspect(operation);
    } catch (cause) {
      this.#releaseOperation();
      return Promise.reject(cause);
    }
    return result.finally(() => this.#releaseOperation());
  }

  publish(): void {
    if (this.#state !== "preparing") throw new Error("Only a preparing generation can be published.");
    this.#state = "current";
  }

  drain(): void {
    if (this.#state === "retiring" || this.#state === "closed") return;
    this.#state = "retiring";
    this.queryClient.clear();
    this.#closeWhenIdle();
  }

  close(): void { this.#leases = 0; this.#close(); }
  releaseLease(): void {
    if (this.#leases > 0) this.#leases -= 1;
    this.#closeWhenIdle();
  }

  #releaseOperation(): void {
    if (this.#operations > 0) this.#operations -= 1;
    this.#closeWhenIdle();
  }

  #closeWhenIdle(): void {
    if (this.#state === "retiring" && this.#leases === 0 && this.#operations === 0) this.#close();
  }

  #close(): void {
    if (this.#state === "closed") return;
    this.#state = "closed";
    this.queryClient.clear();
    this.repository.close();
  }
}
