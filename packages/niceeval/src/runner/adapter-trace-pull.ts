import type { ExecutionTraceStreamCutReason, ExecutionTraceStreamItem } from "../adapter-execution-trace.ts";

type Next =
  | { readonly kind: "item"; readonly item: IteratorResult<ExecutionTraceStreamItem> }
  | { readonly kind: "cut"; readonly reason: ExecutionTraceStreamCutReason };

export class AdapterTracePull {
  private readonly controller = new AbortController();
  private reason: ExecutionTraceStreamCutReason | undefined;
  private stopNext: ((reason: ExecutionTraceStreamCutReason) => void) | undefined;
  private readonly abort: () => void;
  private readonly caller: AbortSignal | undefined;

  constructor(caller: AbortSignal | undefined) {
    this.caller = caller;
    this.abort = () => this.stop("aborted");
    if (caller?.aborted === true) this.abort();
    else caller?.addEventListener("abort", this.abort, { once: true });
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  get cut(): ExecutionTraceStreamCutReason | undefined {
    return this.reason;
  }

  stop(reason: ExecutionTraceStreamCutReason): void {
    if (this.reason !== undefined) return;
    this.reason = reason;
    this.stopNext?.(reason);
    this.controller.abort(reason);
  }

  next(iterator: AsyncIterator<ExecutionTraceStreamItem>): Promise<Next> {
    const reason = this.reason;
    if (reason !== undefined) return Promise.resolve({ kind: "cut", reason });
    return new Promise((resolve) => {
      const settle = (next: Next) => {
        if (this.stopNext !== stop) return;
        this.stopNext = undefined;
        resolve(next);
      };
      const stop = (cut: ExecutionTraceStreamCutReason) => settle({ kind: "cut", reason: cut });
      this.stopNext = stop;
      try {
        void Promise.resolve(iterator.next()).then(
          (item) => {
            if (this.stopNext !== stop) return;
            try {
              settle({
                kind: "item",
                item: item.done ? { done: true, value: undefined } : { done: false, value: item.value },
              });
            } catch {
              stop("producer-error");
            }
          },
          () => stop("producer-error"),
        );
      } catch {
        stop("producer-error");
      }
    });
  }

  close(iterator: AsyncIterator<ExecutionTraceStreamItem> | undefined): void {
    this.caller?.removeEventListener("abort", this.abort);
    if (iterator !== undefined) {
      void Promise.resolve()
        .then(() => iterator.return?.())
        .catch(() => undefined);
    }
  }
}
