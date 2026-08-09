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

  async close(): Promise<void> {
    if (this.#state === "released") return;
    if (this.#closeResult !== undefined) return this.#closeResult;
    const result = this.releaseOnce();
    this.#closeResult = result;
    try {
      await result;
      this.#state = "released";
    } catch (cause) {
      // A failed backend finalizer must remain observable and retryable; marking this retain
      // released first would strand the final retain with no capability left to finish it.
      if (this.#closeResult === result) this.#closeResult = undefined;
      throw cause;
    }
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
      await this.finishIfDrained();
    }, this.#identity);
  }

  owns<ChildOwner extends Owner>(retain: LocalRetain<ChildOwner>): boolean {
    return retain.isOwnedBy(this.#identity);
  }

  /**
   * 并发 close 共享同一次 in-flight settled result。真正 finalizer 在最后一个 child retain
   * 离开后执行，避免 close 把已有 capability 的底层连接提前释放；失败则保留 closing，供持有
   * retain 的调用者重试实际 cleanup。
   */
  async close(): Promise<void> {
    if (this.#state === "open") this.#state = "closing";
    await this.finishIfDrained();
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
    await this.finishIfDrained();
  }

  private async finishIfDrained(): Promise<void> {
    if (this.#state !== "closing" || this.#active !== 0) return;
    if (this.#finalizeResult !== undefined) {
      await this.#finalizeResult;
      return;
    }
    const result = this.finalize();
    this.#finalizeResult = result;
    try {
      await result;
      this.#state = "closed";
    } catch (cause) {
      // Keep the registry in closing so the still-held final retain (or an explicit backend
      // close retry) can finish the real finalizer. Do not convert a failed cleanup into closed.
      if (this.#finalizeResult === result) this.#finalizeResult = undefined;
      throw cause;
    }
  }
}
