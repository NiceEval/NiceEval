// GC barrier 的 admission gate。它不是 graph walker：仅把“会改变 GC root 或创建/删除对象”的
// 单步 Store operation 与一个 immutable snapshot 线性化，普通已有对象读取不经过本 gate。

class DeferredSignal {
  readonly promise: Promise<void>;
  #resolve: (() => void) | undefined;

  constructor() {
    this.promise = new Promise<void>((resolve) => {
      this.#resolve = resolve;
    });
  }

  resolve(): void {
    const resolve = this.#resolve;
    if (resolve === undefined) return;
    this.#resolve = undefined;
    resolve();
  }
}

class AsyncMutex {
  #tail = Promise.resolve();

  async lock(): Promise<() => void> {
    let releaseNext: (() => void) | undefined;
    const next = new Promise<void>((resolve) => {
      releaseNext = resolve;
    });
    const previous = this.#tail;
    this.#tail = next;
    await previous;
    return () => {
      const release = releaseNext;
      if (release === undefined) return;
      releaseNext = undefined;
      release();
    };
  }
}

/** Holds the barrier admission until explicit close; close is idempotent for async disposal. */
export class LocalGcBarrierPermit implements AsyncDisposable {
  #closed = false;
  #closeResult: Promise<void> | undefined;

  constructor(private readonly release: () => Promise<void>) {}

  async close(): Promise<void> {
    if (this.#closed) return;
    if (this.#closeResult !== undefined) return this.#closeResult;
    const result = this.release();
    this.#closeResult = result;
    try {
      await result;
      this.#closed = true;
    } catch (cause) {
      // The local gate must remain held until its release actually succeeds. A later close may
      // retry instead of silently reporting success while mutations stay blocked.
      if (this.#closeResult === result) this.#closeResult = undefined;
      throw cause;
    }
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }
}

/**
 * beginBarrier 的 await 返回即为该轮 GC 的线性化点：此前已经获准的 mutation 都结束，之后
 * 的 mutation/read-lease lifecycle/pin 改动均阻塞到 barrier close。多个 barrier 自然排队。
 */
export class LocalGcAdmissionGate {
  #mutex = new AsyncMutex();
  #barrierActive = false;
  #activeMutations = 0;
  #available = new DeferredSignal();
  #drained = new DeferredSignal();

  async mutation<A>(operation: () => Promise<A>): Promise<A> {
    await this.admitMutation();
    try {
      return await operation();
    } finally {
      await this.finishMutation();
    }
  }

  async beginBarrier(): Promise<LocalGcBarrierPermit> {
    for (;;) {
      const unlock = await this.#mutex.lock();
      if (!this.#barrierActive) {
        this.#barrierActive = true;
        if (this.#activeMutations === 0) this.#drained.resolve();
        const drained = this.#drained.promise;
        unlock();
        await drained;
        return new LocalGcBarrierPermit(() => this.endBarrier());
      }
      const available = this.#available.promise;
      unlock();
      await available;
    }
  }

  private async admitMutation(): Promise<void> {
    for (;;) {
      const unlock = await this.#mutex.lock();
      if (!this.#barrierActive) {
        this.#activeMutations += 1;
        unlock();
        return;
      }
      const available = this.#available.promise;
      unlock();
      await available;
    }
  }

  private async finishMutation(): Promise<void> {
    const unlock = await this.#mutex.lock();
    this.#activeMutations -= 1;
    if (this.#activeMutations === 0 && this.#barrierActive) this.#drained.resolve();
    unlock();
  }

  private async endBarrier(): Promise<void> {
    const unlock = await this.#mutex.lock();
    if (!this.#barrierActive) {
      unlock();
      return;
    }
    this.#barrierActive = false;
    this.#available.resolve();
    this.#available = new DeferredSignal();
    this.#drained = new DeferredSignal();
    unlock();
  }
}

/**
 * Per-capability admission gate.  Unlike `LocalCapabilitySerial`, this gate does not serialize
 * business work: it only gives close a linearization point and counts operations that were
 * already admitted before that point.  A caller supplies its own closed error so this primitive
 * remains usable by read leases and future borrowed reader capabilities.
 */
export class LocalOperationGate {
  #closed = false;
  #active = 0;
  #drained: DeferredSignal | undefined;

  get closed(): boolean {
    return this.#closed;
  }

  admit<A>(operation: () => Promise<A>, closed: () => unknown): Promise<A> {
    if (this.#closed) return Promise.reject(closed());
    this.#active += 1;
    let result: Promise<A>;
    try {
      result = operation();
    } catch (cause) {
      this.finishAdmission();
      return Promise.reject(cause);
    }
    return result.then(
      (value) => {
        this.finishAdmission();
        return value;
      },
      (cause) => {
        this.finishAdmission();
        throw cause;
      },
    );
  }

  async close(): Promise<void> {
    this.#closed = true;
    if (this.#active === 0) return;
    if (this.#drained === undefined) this.#drained = new DeferredSignal();
    await this.#drained.promise;
  }

  private finishAdmission(): void {
    this.#active -= 1;
    if (this.#active !== 0) return;
    this.#drained?.resolve();
  }
}
