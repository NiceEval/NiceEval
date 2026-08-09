// unbound local backend 的 root-bound 物理基础。create 仅持久化 marker + object namespace；
// Layout 仍为 absent，直到首个 expected:null transaction 成功 commit。open 绝不把普通目录
// 初始化成 Store，也不会替调用方补 genesis / head。

import {
  LocalStoreAlreadyExistsError,
  LocalStoreClosedError,
  LocalStoreInvalidFormatError,
  LocalStoreMissingError,
  LocalStorePhysicalCorruptionError,
} from "./errors.ts";
import {
  createDirectoryExclusively,
  ensureDirectory,
  readFileIfPresent,
  statIfPresent,
  writeFileAtomically,
} from "./fs.ts";
import { LocalGcAdmissionGate } from "./gate.ts";
import { LocalGlobalGcAdmission, LocalGlobalGcBarrierPermit, LocalGlobalMutationPermit } from "./global-gate.ts";
import { recoverLocalStoreJournal } from "./journal.ts";
import { hasRecoverableActiveWriteLease } from "./lease.ts";
import { LocalObjectStore } from "./objects.ts";
import { localStorePaths, type LocalStorePaths } from "./paths.ts";
import {
  decodeLocalLayout,
  decodeLocalStoreMarker,
  encodeLocalLayout,
  localDescriptorProtocol,
  localStoreMarkerBytes,
} from "./protocol-adapter.ts";
import { normalizeLocalStoreRoot } from "./root.ts";
import type { DescriptorV1, LayoutV2 } from "../protocol/core.ts";

export type LocalStoreFoundationState = "open" | "closing" | "closed";

/** Releases both the per-process and filesystem-global admissions exactly once. */
export class LocalStoreGcBarrierPermit implements AsyncDisposable {
  #closed = false;
  #globalClosed = false;
  #localClosed = false;
  #closeResult: Promise<void> | undefined;

  constructor(
    private readonly local: { readonly close: () => Promise<void> },
    private readonly global: LocalGlobalGcBarrierPermit,
  ) {}

  async close(): Promise<void> {
    if (this.#closed) return;
    if (this.#closeResult !== undefined) return this.#closeResult;
    const result = this.closeOnce();
    this.#closeResult = result;
    try {
      await result;
      this.#closed = true;
    } catch (cause) {
      // Do not report this permit as closed while either admission remains held. A retry resumes
      // at the first unfinished cleanup step, preserving the global-before-local release order.
      if (this.#closeResult === result) this.#closeResult = undefined;
      throw cause;
    }
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }

  private async closeOnce(): Promise<void> {
    if (!this.#globalClosed) {
      await this.global.close();
      this.#globalClosed = true;
    }
    if (!this.#localClosed) {
      await this.local.close();
      this.#localClosed = true;
    }
  }
}

export class LocalStoreFoundation implements AsyncDisposable {
  #state: LocalStoreFoundationState = "open";
  readonly objects: LocalObjectStore<DescriptorV1>;
  readonly #gate = new LocalGcAdmissionGate();
  readonly #globalAdmission: LocalGlobalGcAdmission;
  // A mutation's global ticket can fail while its durable remove/fsync is finishing. Keep the
  // exact permit object so later admission, barrier, or final close can retry instead of leaving
  // a live-process ticket to block every cross-process GC barrier forever.
  readonly #pendingMutationPermits = new Set<LocalGlobalMutationPermit>();

  private constructor(readonly paths: LocalStorePaths) {
    this.objects = new LocalObjectStore(paths, localDescriptorProtocol);
    this.#globalAdmission = new LocalGlobalGcAdmission(paths);
  }

  get root(): string {
    return this.paths.root;
  }

  get state(): LocalStoreFoundationState {
    return this.#state;
  }

  static async create(root: string | URL): Promise<LocalStoreFoundation> {
    const normalized = normalizeLocalStoreRoot(root);
    const existing = await statIfPresent(normalized);
    if (existing !== undefined) {
      throw new LocalStoreAlreadyExistsError({ root: normalized });
    }
    const created = await createDirectoryExclusively(normalized);
    if (created === "exists") {
      throw new LocalStoreAlreadyExistsError({ root: normalized });
    }

    const paths = localStorePaths(normalized);
    await ensureDirectory(paths.objects);
    await writeFileAtomically(paths.marker, localStoreMarkerBytes());
    return new LocalStoreFoundation(paths);
  }

  static async open(root: string | URL): Promise<LocalStoreFoundation> {
    const normalized = normalizeLocalStoreRoot(root);
    const metadata = await statIfPresent(normalized);
    if (metadata === undefined) {
      throw new LocalStoreMissingError({ root: normalized });
    }
    if (!metadata.isDirectory()) {
      throw new LocalStoreInvalidFormatError({
        root: normalized,
        detail: "local RecordStore root must be a directory",
      });
    }

    const paths = localStorePaths(normalized);
    const marker = await readFileIfPresent(paths.marker);
    if (marker === undefined) {
      throw new LocalStoreInvalidFormatError({ root: normalized, detail: "Store marker is missing" });
    }
    const markerResult = decodeLocalStoreMarker(marker);
    if (markerResult.state === "invalid") {
      throw new LocalStoreInvalidFormatError({ root: normalized, detail: markerResult.detail });
    }

    const objectDirectory = await statIfPresent(paths.objects);
    if (objectDirectory === undefined || !objectDirectory.isDirectory()) {
      throw new LocalStorePhysicalCorruptionError({
        component: "marker",
        path: paths.objects,
        detail: "Store marker exists but content-addressed object namespace is absent",
      });
    }

    const foundation = new LocalStoreFoundation(paths);
    await foundation.recoverIfQuiescent();
    await foundation.readLayout(); // validates physical Layout when Store is bound
    return foundation;
  }

  /** Layout absence is the unbound state, not corruption. */
  async readLayout(): Promise<LayoutV2 | null> {
    const snapshot = await this.readLayoutSnapshot();
    return snapshot.layout;
  }

  /** Journal compares exact canonical bytes, so commit reads one snapshot instead of re-encoding old Layout. */
  async readLayoutSnapshot(): Promise<{ readonly layout: LayoutV2 | null; readonly bytes: Uint8Array | undefined }> {
    this.assertOpen("retain");
    const bytes = await readFileIfPresent(this.paths.layout);
    if (bytes === undefined) return Object.freeze({ layout: null, bytes: undefined });
    const decoded = decodeLocalLayout(bytes);
    if (decoded.state === "invalid") {
      throw new LocalStorePhysicalCorruptionError({
        component: "layout",
        path: this.paths.layout,
        detail: decoded.detail,
      });
    }
    return Object.freeze({ layout: decoded.value, bytes });
  }

  /**
   * backend commit 是唯一调用方。它必须先写 prepare journal、持有 valid fencing lease，随后
   * 在 GC mutation gate 内执行此完整 Layout 替换。
   */
  async writeLayout(layout: LayoutV2): Promise<Uint8Array> {
    this.assertOpen("begin-write");
    const bytes = this.encodeLayout(layout);
    await this.writeLayoutBytes(bytes);
    return bytes;
  }

  encodeLayout(layout: LayoutV2): Uint8Array {
    const encoded = encodeLocalLayout(layout);
    if (encoded.state === "invalid") {
      throw new LocalStorePhysicalCorruptionError({
        component: "layout",
        path: this.paths.layout,
        detail: encoded.detail,
      });
    }
    return encoded.value;
  }

  async writeLayoutBytes(bytes: Uint8Array): Promise<void> {
    this.assertOpen("begin-write");
    await writeFileAtomically(this.paths.layout, bytes);
  }

  /**
   * Every operation that can change an object or a GC root first enters both gates. The local
   * gate coordinates awaiters in this backend; the durable ticket coordinates other local
   * processes that opened the same root independently.
   */
  async mutation<A>(operation: () => Promise<A>): Promise<A> {
    return this.#gate.mutation(async () => {
      await this.drainPendingMutationPermits();
      const permit: LocalGlobalMutationPermit = await this.#globalAdmission.beginMutation();
      try {
        return await operation();
      } finally {
        try {
          await permit.close();
        } catch (cause) {
          // Do not lose the only exact owner of a ticket whose unlink/parent fsync failed. The
          // original operation's caller still receives this typed cleanup failure.
          this.#pendingMutationPermits.add(permit);
          throw cause;
        }
      }
    });
  }

  /** A GC snapshot is valid only while both the in-process and cross-process barriers are held. */
  async beginGcBarrier(): Promise<LocalStoreGcBarrierPermit> {
    // Retrying a failed mutation-ticket release before exposing a barrier keeps the barrier from
    // waiting on an unowned ticket created by this Foundation.
    await this.#gate.mutation(() => this.drainPendingMutationPermits());
    const local = await this.#gate.beginBarrier();
    try {
      const global = await this.#globalAdmission.beginBarrier();
      return new LocalStoreGcBarrierPermit(local, global);
    } catch (cause) {
      await local.close();
      throw cause;
    }
  }

  async close(): Promise<void> {
    if (this.#state !== "open") return;
    await this.#gate.mutation(() => this.drainPendingMutationPermits());
    this.#state = "closing";
    // Local filesystem backend does not hold a socket or child process. Its real lifetime is
    // controlled by LocalRecordStoreBackend retains; this state transition only rejects later
    // direct physical operations after that backend's finalizer runs.
    this.#state = "closed";
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }

  private async recoverIfQuiescent(): Promise<void> {
    // Recovery itself changes the durable journal marker. Taking the same filesystem-global
    // barrier first closes the race where open observed no lease just before another process
    // began a write; only after all admitted operations drain do we inspect the lease/journal.
    const barrier = await this.beginGcBarrier();
    try {
      if (await hasRecoverableActiveWriteLease(this.paths)) return;
      const layout = await readFileIfPresent(this.paths.layout);
      await recoverLocalStoreJournal(this.paths, layout);
    } finally {
      await barrier.close();
    }
  }

  private assertOpen(operation: "retain" | "begin-write"): void {
    if (this.state !== "open") throw new LocalStoreClosedError({ operation });
  }

  private async drainPendingMutationPermits(): Promise<void> {
    await this.#globalAdmission.cleanupPendingPermits();
    for (const permit of [...this.#pendingMutationPermits]) {
      await permit.close();
      this.#pendingMutationPermits.delete(permit);
    }
  }
}
