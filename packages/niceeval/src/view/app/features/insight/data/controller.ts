import { QueryClient } from "@tanstack/react-query";

import { ViewGeneration, type GenerationLease, type OwnedInspectionRepository } from "./generation.ts";

export interface PreparedGeneration<Snapshot = unknown> {
  readonly generation: ViewGeneration<Snapshot>;
  readonly lease: GenerationLease<Snapshot>;
}

export class ViewRuntime<Snapshot = unknown> {
  #current: ViewGeneration<Snapshot> | undefined;
  readonly #prepared = new Set<ViewGeneration<Snapshot>>();
  readonly #owners = new Map<string, ViewGeneration<Snapshot>>();
  readonly #listeners = new Set<() => void>();
  #disposed = false;
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

  get current(): ViewGeneration<Snapshot> | undefined {
    return this.#current;
  }

  acquireCurrent(): GenerationLease<Snapshot> {
    this.#requireActive();
    const current = this.#current;
    if (current === undefined) throw new Error("No View generation has been committed.");
    return current.acquire();
  }

  subscribe(listener: () => void): () => void {
    this.#requireActive();
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  prepare(repository: OwnedInspectionRepository): PreparedGeneration<Snapshot> {
    if (this.#disposed) {
      repository.close();
      throw new Error("View runtime is disposed.");
    }
    const owner = this.#owners.get(repository.generationId);
    if (owner !== undefined) {
      if (owner.repository !== repository) repository.close();
      throw new Error(`View generation ${repository.generationId} already has an owner.`);
    }
    let generation: ViewGeneration<Snapshot>;
    generation = new ViewGeneration<Snapshot>(repository, this.queryClient, () => {
      if (this.#owners.get(generation.identity) === generation) this.#owners.delete(generation.identity);
    });
    try {
      const candidate = { generation, lease: generation.acquire() };
      this.#owners.set(generation.identity, generation);
      this.#prepared.add(generation);
      return candidate;
    } catch (cause) {
      generation.close();
      throw cause;
    }
  }

  attachSnapshot(candidate: PreparedGeneration<Snapshot>, snapshot: Snapshot): void {
    this.#requireActive();
    if (!this.#prepared.has(candidate.generation) || this.#owners.get(candidate.generation.identity) !== candidate.generation) {
      throw new Error("Only a prepared View generation can receive a snapshot.");
    }
    candidate.generation.attachSnapshot(snapshot);
  }

  commit(candidate: PreparedGeneration<Snapshot>): ViewGeneration<Snapshot> | undefined {
    this.#requireActive();
    if (
      !this.#prepared.has(candidate.generation) ||
      this.#owners.get(candidate.generation.identity) !== candidate.generation ||
      candidate.generation.status !== "preparing"
    ) {
      throw new Error("Only an open View generation can be committed.");
    }
    // Validate the complete candidate before consuming its handle. A stale
    // handle must never be able to close the current or a successor owner.
    void candidate.generation.snapshot;
    this.#prepared.delete(candidate.generation);
    const previous = this.#current;
    candidate.generation.publish();
    this.#current = candidate.generation;
    candidate.lease.release();
    for (const listener of this.#listeners) listener();
    return previous;
  }

  retire(generation: ViewGeneration<Snapshot> | undefined): void {
    if (generation !== undefined && generation !== this.#current && this.#owners.get(generation.identity) === generation) {
      generation.drain();
    }
  }

  reject(candidate: PreparedGeneration<Snapshot>): void {
    if (
      !this.#prepared.has(candidate.generation) ||
      this.#owners.get(candidate.generation.identity) !== candidate.generation ||
      candidate.generation.status !== "preparing"
    ) return;
    this.#prepared.delete(candidate.generation);
    candidate.lease.release();
    candidate.generation.close();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#listeners.clear();
    this.#current = undefined;
    this.#prepared.clear();
    for (const generation of [...this.#owners.values()]) generation.close();
    this.#owners.clear();
    this.queryClient.clear();
  }

  #requireActive(): void {
    if (this.#disposed) throw new Error("View runtime is disposed.");
  }
}
