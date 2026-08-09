// Public-facing runtime capability wrapper for the local backend. It intentionally exposes no
// mutable Layout, transaction, raw object or GC machinery; writer/open layers obtain those only
// through the package-private `localBackendOf` bridge.

import { LocalStoreClosedError } from "./errors.ts";
import {
  LocalRecordStoreBackend,
  type LocalBackendRetainOwner,
  type LocalRecordStoreGraphAccess,
} from "./backend.ts";
import type { LocalRetain } from "./retain.ts";

const RECORD_STORE: unique symbol = Symbol("niceeval.record-store/1");
const BACKENDS = new WeakMap<LocalRecordStore, {
  readonly backend: LocalRecordStoreBackend;
  readonly retain: LocalRetain<LocalBackendRetainOwner>;
}>();

export type LocalRecordStoreState = "open" | "closing" | "closed";

/**
 * Runtime-branded, root-bound Store capability. `create` returns an unbound Store (marker +
 * object namespace only); `open` requires that marker to exist and never initializes a directory.
 */
export class LocalRecordStore implements AsyncDisposable {
  readonly [RECORD_STORE]: "niceeval.record-store/1" = "niceeval.record-store/1";
  #state: LocalRecordStoreState = "open";
  #closeResult: Promise<void> | undefined;

  private constructor(backend: LocalRecordStoreBackend, retain: LocalRetain<LocalBackendRetainOwner>) {
    BACKENDS.set(this, Object.freeze({ backend, retain }));
  }

  get state(): LocalRecordStoreState {
    return this.#state;
  }

  static async create(root: string | URL, graph: LocalRecordStoreGraphAccess): Promise<LocalRecordStore> {
    const backend = await LocalRecordStoreBackend.create(root, graph);
    const retain = backend.retain({ kind: "record-store" });
    return new LocalRecordStore(backend, retain);
  }

  static async open(root: string | URL, graph: LocalRecordStoreGraphAccess): Promise<LocalRecordStore> {
    const backend = await LocalRecordStoreBackend.open(root, graph);
    const retain = backend.retain({ kind: "record-store" });
    return new LocalRecordStore(backend, retain);
  }

  async close(): Promise<void> {
    if (this.#state === "closed") return;
    if (this.#closeResult !== undefined) return this.#closeResult;
    this.#state = "closing";
    const result = this.closeOnce();
    this.#closeResult = result;
    try {
      await result;
      this.#state = "closed";
    } catch (cause) {
      // A failed final retain must not be reported as a closed Store. Its retain stays held and a
      // caller can retry close; independently retained children were never closed by this path.
      if (this.#closeResult === result) this.#closeResult = undefined;
      throw cause;
    }
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }

  private async closeOnce(): Promise<void> {
    const entry = BACKENDS.get(this);
    if (entry === undefined) {
      throw new LocalStoreClosedError({ operation: "retain" });
    }
    await entry.retain.close();
  }
}

/** Internal bridge only; public `niceeval/record` must not re-export it. */
export function localBackendOf(store: LocalRecordStore): LocalRecordStoreBackend {
  const entry = BACKENDS.get(store);
  if (entry === undefined || store.state !== "open") {
    throw new LocalStoreClosedError({ operation: "retain" });
  }
  return entry.backend;
}
