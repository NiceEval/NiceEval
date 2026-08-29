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

let nextGenerationIdentity = 1;
const createGenerationIdentity = (): ViewGenerationIdentity =>
  `view-generation:${nextGenerationIdentity++}` as ViewGenerationIdentity;

export interface OwnedInspectionRepository extends InspectionQuery { close(): void }

export class GenerationLease<Snapshot = unknown> {
  #released = false;
  constructor(readonly generation: ViewGeneration<Snapshot>) {}
  get identity(): ViewGenerationIdentity { return this.generation.identity; }

  inspect<Kind extends InspectionOperationId>(operation: InspectionOperationFor<Kind>): Promise<InspectionSuccessDocumentFor<Kind>> {
    if (this.#released) return Promise.reject(new Error("Generation lease is released."));
    return this.generation.queryClient.ensureQueryData(inspectionQueryOptions(this.generation, operation));
  }

  retry<Kind extends InspectionOperationId>(operation: InspectionOperationFor<Kind>): Promise<InspectionSuccessDocumentFor<Kind>> {
    if (this.#released) return Promise.reject(new Error("Generation lease is released."));
    const options = inspectionQueryOptions(this.generation, operation);
    this.generation.queryClient.removeQueries({ queryKey: options.queryKey, exact: true });
    return this.generation.queryClient.ensureQueryData(options);
  }

  release(): void {
    if (this.#released) return;
    this.#released = true;
    this.generation.releaseLease();
  }
}

export class ViewGeneration<Snapshot = unknown> {
  readonly identity = createGenerationIdentity();
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
  #state: "open" | "draining" | "closed" = "open";
  #leases = 0;
  #snapshot: Snapshot | undefined;

  constructor(readonly repository: OwnedInspectionRepository) {}
  get status(): "open" | "draining" | "closed" { return this.#state; }
  get snapshot(): Snapshot {
    if (this.#snapshot === undefined) throw new Error("View generation snapshot is not ready.");
    return this.#snapshot;
  }

  attachSnapshot(snapshot: Snapshot): void {
    if (this.#state !== "open" || this.#snapshot !== undefined) {
      throw new Error("A View generation snapshot can only be attached once while open.");
    }
    this.#snapshot = snapshot;
  }

  acquire(): GenerationLease<Snapshot> {
    if (this.#state !== "open") throw new Error(`View generation is ${this.#state}.`);
    this.#leases += 1;
    return new GenerationLease(this);
  }

  inspectRepository<Kind extends InspectionOperationId>(operation: InspectionOperationFor<Kind>): Promise<InspectionSuccessDocumentFor<Kind>> {
    if (this.#state === "closed") return Promise.reject(new Error("View generation is closed."));
    return this.repository.inspect(operation);
  }

  drain(): void {
    if (this.#state !== "open") return;
    this.#state = "draining";
    this.queryClient.clear();
    if (this.#leases === 0) this.#close();
  }

  close(): void { this.#leases = 0; this.#close(); }
  releaseLease(): void {
    if (this.#leases > 0) this.#leases -= 1;
    if (this.#state === "draining" && this.#leases === 0) this.#close();
  }

  #close(): void {
    if (this.#state === "closed") return;
    this.#state = "closed";
    this.queryClient.clear();
    this.repository.close();
  }
}
