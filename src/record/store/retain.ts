// Store / handle / writer / reader / GC 的资源所有权。backend 本身不会因为 public Store close
// 而抢先断开已有 handle；只有最后一个 retain 释放后才执行 transport finalizer。

import { LocalStoreClosedError } from "./errors.ts";

export type LocalRetainState = "held" | "released";
export type LocalRetainRegistryState = "open" | "closing" | "closed";

export class LocalRetain<Owner> implements AsyncDisposable {
  #state: LocalRetainState = "held";
  #closeResult: Promise<void> | undefined;

  constructor(
    readonly owner: Owner,
    private readonly releaseOnce: () => Promise<void>,
    private readonly registryIdentity: object,
  ) {}

  get state(): LocalRetainState {
    return this.#state;
  }

  close(): Promise<void> {
    if (this.#closeResult !== undefined) return this.#closeResult;
    if (this.#state === "released") return Promise.resolve();
    // Release is an ownership transfer, not a retryable lease on this wrapper.  Once the
    // registry owns the finalizer retry path, this escaped retain must never become held again.
    this.#state = "released";
    const result = this.releaseOnce();
    this.#closeResult = result;
    return result;
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }

  /** Internal provenance check: a held retain from another Store is never a valid authority. */
  isOwnedBy(registryIdentity: object): boolean {
    return this.registryIdentity === registryIdentity;
  }
}

/**
 * 一个 backend 只维护一个 registry。所有 child resource 都持有独立 retain；因此 public
 * close 的线性化点只是拒绝新 child，不会中断已经开始的 read / transaction / barrier。
 */
export class LocalRetainRegistry<Owner> implements AsyncDisposable {
  #state: LocalRetainRegistryState = "open";
  #active = 0;
  #finalizeResult: Promise<void> | undefined;
  #retryScheduled = false;
  readonly #identity = Object.freeze({});

  constructor(private readonly finalize: () => Promise<void>) {}

  get state(): LocalRetainRegistryState {
    return this.#state;
  }

  retain<ChildOwner extends Owner>(
    owner: ChildOwner,
    operation: "retain" | "begin-write" | "open-read" | "begin-gc" | "mirror-install" = "retain",
  ): LocalRetain<ChildOwner> {
    if (this.#state !== "open") {
      throw new LocalStoreClosedError({ operation });
    }
    this.#active += 1;
    // If the last-count decrement reaches a failing finalizer, LocalRetain.close may be retried.
    // The per-retain flag prevents that retry from decrementing the shared count a second time.
    let releasedFromCount = false;
    return new LocalRetain(owner, async () => {
      if (!releasedFromCount) {
        releasedFromCount = true;
        await this.releaseCount();
        return;
      }
      await this.finishIfDrained(false);
    }, this.#identity);
  }

  owns<ChildOwner extends Owner>(retain: LocalRetain<ChildOwner>): boolean {
    return retain.isOwnedBy(this.#identity);
  }

  /** A manual backend close also gives a pending finalizer one explicit retry opportunity. */
  async close(): Promise<void> {
    if (this.#state === "open") this.#state = "closing";
    await this.finishIfDrained(true);
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }

  private async releaseCount(): Promise<void> {
    if (this.#active > 0) this.#active -= 1;
    // The final public/root retain is the only place that may start backend shutdown. Public
    // Store.close therefore only releases its own retain; existing handle/writer/lease retains
    // keep this registry open and may still derive their documented child capabilities.
    if (this.#active === 0 && this.#state === "open") this.#state = "closing";
    await this.finishIfDrained(false);
  }

  private async finishIfDrained(retry: boolean): Promise<void> {
    if (this.#state !== "closing" || this.#active !== 0) return;
    const existing = this.#finalizeResult;
    if (existing !== undefined) {
      try {
        await existing;
        return;
      } catch (cause) {
        if (!retry) throw cause;
        if (this.#finalizeResult === existing) this.#finalizeResult = undefined;
      }
    }
    const result = this.finalize();
    this.#finalizeResult = result;
    try {
      await result;
      this.#state = "closed";
    } catch (cause) {
      // The retain that triggered this finalizer is already released.  Preserve the failure for
      // that caller, keep the registry as its new cleanup owner, and arrange one safe background
      // retry.  Later mutations/open-read/GC/backend-close also explicitly retry this path.
      this.scheduleFinalizerRetry();
      throw cause;
    }
  }

  private scheduleFinalizerRetry(): void {
    if (this.#retryScheduled || this.#state !== "closing") return;
    this.#retryScheduled = true;
    queueMicrotask(() => {
      void this.retryFinalizerInBackground();
    });
  }

  private async retryFinalizerInBackground(): Promise<void> {
    try {
      await this.finishIfDrained(true);
    } catch {
      // A later safe admission point retries again.  This callback deliberately has no caller
      // whose promise could observe a second finalizer result.
    } finally {
      this.#retryScheduled = false;
    }
  }
}
