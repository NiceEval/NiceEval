import type { EvidenceCoverage } from "../agents/types.ts";
import type { AttemptResourceRegistry } from "../types.ts";

const ADAPTER_UNAVAILABLE_ENTRY = Object.freeze({
  status: "unavailable" as const,
  reason: "not-collected",
});

/** Ordinary Adapters do not imply Agent conversation or usage evidence. */
export const adapterEvidenceUnavailable: EvidenceCoverage = Object.freeze({
  events: ADAPTER_UNAVAILABLE_ENTRY,
  actions: ADAPTER_UNAVAILABLE_ENTRY,
  messages: ADAPTER_UNAVAILABLE_ENTRY,
  usage: ADAPTER_UNAVAILABLE_ENTRY,
  status: ADAPTER_UNAVAILABLE_ENTRY,
  data: ADAPTER_UNAVAILABLE_ENTRY,
});

export type AdapterResourceWindow = "forward-open" | "cleanup-open" | "closed";

export class AdapterResourceWindowClosedError extends Error {
  readonly code = "adapter-resource-window-closed";

  constructor(readonly window: AdapterResourceWindow) {
    super(`Adapter Attempt resource window is ${window}`);
    this.name = "AdapterResourceWindowClosedError";
  }
}

export class AdapterAuthoringClosedError extends Error {
  readonly code = "adapter-authoring-closed";

  constructor() {
    super("Cannot call an Adapter method after Attempt authoring has closed");
    this.name = "AdapterAuthoringClosedError";
  }
}

export interface AdapterCleanupResult {
  readonly failures: readonly unknown[];
  readonly timedOut: boolean;
}

/**
 * Attempt-local Adapter resource owner. The same fixed cleanup window
 * admits callbacks registered by an already-running create/test handoff and
 * drains every admitted callback in global LIFO order.
 */
export class AdapterAttemptResources {
  private windowState: AdapterResourceWindow = "forward-open";
  private authorOpen = true;
  private readonly cleanups: Array<() => void | Promise<void>> = [];
  private readonly handoffs = new Set<Promise<void>>();

  get window(): AdapterResourceWindow {
    return this.windowState;
  }

  assertForwardOpen(): void {
    if (!this.authorOpen) throw new AdapterAuthoringClosedError();
    if (this.windowState !== "forward-open") {
      throw new AdapterResourceWindowClosedError(this.windowState);
    }
  }

  onCleanup(cleanup: () => void | Promise<void>): void {
    if (typeof cleanup !== "function") {
      throw new TypeError("Adapter onCleanup() requires a function");
    }
    if (this.windowState === "closed") {
      throw new AdapterResourceWindowClosedError(this.windowState);
    }
    this.cleanups.push(cleanup);
  }

  trackHandoff<Value>(promise: Promise<Value>): Promise<Value> {
    let settled!: Promise<void>;
    settled = promise.then(
      () => undefined,
      () => undefined,
    ).finally(() => {
      this.handoffs.delete(settled);
    });
    this.handoffs.add(settled);
    return promise;
  }

  beginCleanup(): void {
    this.closeAuthoring();
    if (this.windowState === "forward-open") this.windowState = "cleanup-open";
  }

  closeAuthoring(): void {
    this.authorOpen = false;
  }

  close(): void {
    this.windowState = "closed";
  }

  async cleanup(signal: AbortSignal): Promise<AdapterCleanupResult> {
    this.beginCleanup();
    const failures: unknown[] = [];
    let timedOut = signal.aborted;
    let stopWaiting: (() => void) | undefined;
    let onAbort: (() => void) | undefined;
    const aborted = new Promise<void>((resolve) => {
      stopWaiting = resolve;
      if (signal.aborted) resolve();
      else {
        onAbort = () => resolve();
        signal.addEventListener("abort", onAbort, { once: true });
      }
    });
    try {
      while (!timedOut) {
        while (this.cleanups.length > 0 && !timedOut) {
          const cleanup = this.cleanups.pop()!;
          const outcome = await Promise.race([
            Promise.resolve().then(cleanup).then(
              () => ({ _tag: "settled" as const }),
              (error: unknown) => ({ _tag: "failed" as const, error }),
            ),
            aborted.then(() => ({ _tag: "aborted" as const })),
          ]);
          if (outcome._tag === "aborted") {
            timedOut = true;
          } else if (outcome._tag === "failed") {
            failures.push(outcome.error);
          }
        }
        if (timedOut || this.cleanups.length > 0) continue;
        if (this.handoffs.size === 0) break;
        const outcome = await Promise.race([
          ...this.handoffs,
          aborted,
        ]).then(() => signal.aborted ? "aborted" as const : "settled" as const);
        if (outcome === "aborted") timedOut = true;
      }
    } finally {
      this.close();
      if (onAbort !== undefined) signal.removeEventListener("abort", onAbort);
      stopWaiting?.();
    }
    return Object.freeze({ failures: Object.freeze(failures), timedOut });
  }
}

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
