import { ViewGeneration, type GenerationLease, type OwnedInspectionRepository } from "./generation.ts";

export interface PreparedGeneration<Snapshot = unknown> {
  readonly generation: ViewGeneration<Snapshot>;
  readonly lease: GenerationLease<Snapshot>;
}

export interface GenerationControllerHooks<Snapshot = unknown> {
  readonly onCommitted?: (current: ViewGeneration<Snapshot>, previous: ViewGeneration<Snapshot> | undefined) => void;
}

export class GenerationController<Snapshot = unknown> {
  #current: ViewGeneration<Snapshot> | undefined;
  readonly #prepared = new Set<ViewGeneration<Snapshot>>();
  readonly #listeners = new Set<() => void>();

  constructor(
    readonly createRepository: () => OwnedInspectionRepository,
    readonly hooks: GenerationControllerHooks<Snapshot> = {},
  ) {}

  get current(): ViewGeneration<Snapshot> | undefined {
    return this.#current;
  }

  acquireCurrent(): GenerationLease<Snapshot> {
    const current = this.#current;
    if (current === undefined) throw new Error("No View generation has been committed.");
    return current.acquire();
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  prepare(): PreparedGeneration<Snapshot> {
    const generation = new ViewGeneration<Snapshot>(this.createRepository());
    try {
      const candidate = { generation, lease: generation.acquire() };
      this.#prepared.add(generation);
      return candidate;
    } catch (cause) {
      generation.close();
      throw cause;
    }
  }

  attachSnapshot(candidate: PreparedGeneration<Snapshot>, snapshot: Snapshot): void {
    if (!this.#prepared.has(candidate.generation)) throw new Error("Only a prepared View generation can receive a snapshot.");
    candidate.generation.attachSnapshot(snapshot);
  }

  commit(candidate: PreparedGeneration<Snapshot>): ViewGeneration<Snapshot> | undefined {
    if (!this.#prepared.delete(candidate.generation) || candidate.generation.status !== "open") {
      candidate.lease.release();
      candidate.generation.close();
      throw new Error("Only an open View generation can be committed.");
    }
    const previous = this.#current;
    // Reading the snapshot here makes an incomplete generation impossible to publish.
    void candidate.generation.snapshot;
    this.#current = candidate.generation;
    candidate.lease.release();
    try {
      this.hooks.onCommitted?.(candidate.generation, previous);
      for (const listener of this.#listeners) listener();
      return previous;
    } catch (cause) {
      this.#current = previous;
      candidate.generation.drain();
      for (const listener of this.#listeners) listener();
      throw cause;
    }
  }

  restore(failed: ViewGeneration<Snapshot>, previous: ViewGeneration<Snapshot> | undefined): void {
    if (this.#current !== failed) throw new Error("Only the current View generation can be rolled back.");
    if (previous === undefined || previous.status !== "open") throw new Error("The last-good View generation is unavailable.");
    this.#current = previous;
    failed.drain();
    for (const listener of this.#listeners) listener();
  }

  retire(generation: ViewGeneration<Snapshot> | undefined): void {
    if (generation !== undefined && generation !== this.#current) generation.drain();
  }

  reject(candidate: PreparedGeneration<Snapshot>): void {
    this.#prepared.delete(candidate.generation);
    candidate.lease.release();
    candidate.generation.close();
  }

  close(): void {
    const current = this.#current;
    this.#current = undefined;
    current?.close();
    for (const generation of this.#prepared) generation.close();
    this.#prepared.clear();
  }
}
