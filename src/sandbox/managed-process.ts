import type { ManagedProcessChunk } from "./types.ts";

/** Small single-consumer async queue used by provider-native process streams. */
export class ManagedProcessOutput implements AsyncIterable<ManagedProcessChunk> {
  private readonly queued: ManagedProcessChunk[] = [];
  private waiter?: (value: IteratorResult<ManagedProcessChunk>) => void;
  private ended = false;
  private consumed = false;

  push(chunk: ManagedProcessChunk): void {
    if (this.ended) return;
    const waiter = this.waiter;
    if (waiter !== undefined) {
      this.waiter = undefined;
      waiter({ done: false, value: chunk });
    } else {
      this.queued.push(chunk);
    }
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;
    const waiter = this.waiter;
    if (waiter !== undefined) {
      this.waiter = undefined;
      waiter({ done: true, value: undefined });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<ManagedProcessChunk> {
    if (this.consumed) throw new Error("managed process output already has a consumer");
    this.consumed = true;
    return {
      next: () => {
        const value = this.queued.shift();
        if (value !== undefined) return Promise.resolve({ done: false, value });
        if (this.ended) return Promise.resolve({ done: true, value: undefined });
        return new Promise((resolve) => { this.waiter = resolve; });
      },
    };
  }
}
