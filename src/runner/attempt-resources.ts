import type { AttemptResourceRegistry } from "../types.ts";

type Entry = {
  shutdown(signal: AbortSignal): Promise<void>;
  release(signal: AbortSignal): Promise<void>;
  shutdownReceipt?: Promise<void>;
};

export class ManagedAttemptResources implements AttemptResourceRegistry {
  private readonly entries: Entry[] = [];
  private closing = false;
  private releaseReceipt?: Promise<void>;

  async acquire<T>(
    acquire: () => Promise<T>,
    lifecycle: {
      shutdown: (resource: T, signal: AbortSignal) => Promise<void>;
      release: (resource: T, signal: AbortSignal) => Promise<void>;
    },
  ): Promise<T> {
    if (this.closing) throw new Error("Attempt resource registry is closing");
    const resource = await acquire();
    try {
      if (this.closing) throw new Error("Attempt resource registry is closing");
      this.entries.push({
        shutdown: (signal) => lifecycle.shutdown(resource, signal),
        release: (signal) => lifecycle.release(resource, signal),
      });
      return resource;
    } catch (error) {
      const controller = new AbortController();
      await lifecycle.release(resource, controller.signal).catch(() => undefined);
      throw error;
    }
  }

  async shutdownAll(signal: AbortSignal): Promise<void> {
    const failures: unknown[] = [];
    for (const entry of this.entries.slice().reverse()) {
      entry.shutdownReceipt ??= entry.shutdown(signal);
      try { await entry.shutdownReceipt; } catch (error) { failures.push(error); }
    }
    if (failures.length > 0) throw new AggregateError(failures, "Attempt managed resource shutdown failed");
  }

  async releaseAll(signal: AbortSignal): Promise<void> {
    return this.releaseReceipt ??= this.releaseEntries(signal);
  }

  private async releaseEntries(signal: AbortSignal): Promise<void> {
    this.closing = true;
    const failures: unknown[] = [];
    for (const entry of this.entries.splice(0).reverse()) {
      try { await entry.release(signal); } catch (error) { failures.push(error); }
    }
    if (failures.length > 0) throw new AggregateError(failures, "Attempt managed resource cleanup failed");
  }
}
