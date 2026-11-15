import type { JsonValue, ManagedProcess, ManagedProcessStart, Sandbox } from "../types.ts";
import * as Schema from "effect/Schema";
import { requireManagedProcessCapability } from "../sandbox/backend.ts";
import { normalizeExternalCause, type ExternalCause } from "../shared/external-cause.ts";

const encoder = new TextEncoder();
const decodeFrame = Schema.decodeUnknownSync(Schema.MutableJson);

class ManagedJsonlOutputError extends Error {
  readonly _tag = "ManagedJsonlOutputError";
  override readonly cause: ExternalCause;

  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.cause = normalizeExternalCause(cause);
  }
}

function timeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`managed process did not exit within ${milliseconds}ms`)),
      milliseconds,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export class ManagedJsonlDriver {
  private readonly frames: JsonValue[] = [];
  private readonly frameSubscribers = new Set<(frame: JsonValue) => void>();
  private readonly waiters = new Set<() => void>();
  private stderrText = "";
  private outputFailure: ManagedJsonlOutputError | undefined;
  private state: "open" | "closing" | "closed" = "open";
  private revision = 0;
  private shutdownReceipt: Promise<void> | undefined;
  private releaseReceipt: Promise<void> | undefined;
  private writes: Promise<void> = Promise.resolve();
  private readonly exit: ReturnType<ManagedProcess["wait"]>;
  private observedExit: Awaited<ReturnType<ManagedProcess["wait"]>> | undefined;

  private constructor(
    private readonly process: ManagedProcess,
    private readonly shutdownFrame: () => JsonValue | undefined,
  ) {
    this.exit = process.wait().then((receipt) => {
      this.observedExit = receipt;
      this.state = "closed";
      return receipt;
    });
    void this.consume();
  }

  static async start(
    sandbox: Sandbox,
    agent: string,
    resources: import("../types.ts").AttemptResourceRegistry,
    input: ManagedProcessStart,
    shutdownFrame?: () => JsonValue | undefined,
  ): Promise<ManagedJsonlDriver> {
    const startProcess = requireManagedProcessCapability(sandbox, agent);
    return resources.acquire(
      async () => {
        const process = await startProcess(input);
        try {
          return new ManagedJsonlDriver(process, shutdownFrame ?? (() => undefined));
        } catch (cause) {
          // The process exists but the registry has not received a Driver yet.
          // Close this constructor gap locally with the same bounded cleanup.
          await process.closeStdin().catch(() => undefined);
          await process.terminate().catch(() => undefined);
          await timeout(process.wait(), 2_000).catch(() => undefined);
          throw cause;
        }
      },
      {
        shutdown: (driver) => driver.shutdown(),
        release: (driver) => driver.release(),
      },
    );
  }

  cursor(): number {
    return this.frames.length;
  }
  stderr(): string {
    return this.stderrText;
  }
  processReceipt(): {
    readonly exitCode: number | undefined;
    readonly signal: string | undefined;
    readonly stderr: string;
  } {
    return {
      exitCode: this.observedExit?.exitCode ?? undefined,
      signal: this.observedExit?.signal,
      stderr: this.stderrText,
    };
  }

  async write(value: unknown): Promise<void> {
    if (this.state !== "open") throw new Error("managed process stdin is closing or closed");
    const receipt = this.writes.then(() => this.writeRaw(value));
    this.writes = receipt.catch(() => undefined);
    await receipt;
  }

  async waitFor(
    cursor: number,
    accept: (frame: JsonValue) => boolean,
    signal: AbortSignal,
  ): Promise<{ readonly frame: JsonValue; readonly cursor: number }> {
    let next = cursor;
    for (;;) {
      while (next < this.frames.length) {
        const frame = this.frames[next++]!;
        if (accept(frame)) return { frame, cursor: next };
      }
      if (this.outputFailure !== undefined) throw this.outputFailure;
      const observedRevision = this.revision;
      const outcome = await Promise.race([
        this.waitForChange(observedRevision, signal).then(() => ({ exited: false as const })),
        this.exit.then((receipt) => ({ exited: true as const, receipt })),
      ]);
      if (outcome.exited && next >= this.frames.length) {
        throw new Error(
          `managed process exited before the expected protocol frame (exitCode=${outcome.receipt.exitCode ?? "null"}, signal=${outcome.receipt.signal ?? "none"})${this.stderrText ? `: ${this.stderrText.slice(-1000)}` : ""}`,
        );
      }
    }
  }

  framesSince(cursor: number): readonly JsonValue[] {
    return this.frames.slice(cursor);
  }
  /** Observe only future frames. The owning physical send must always unsubscribe. */
  subscribeFrames(subscriber: (frame: JsonValue) => void): () => void {
    this.frameSubscribers.add(subscriber);
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      this.frameSubscribers.delete(subscriber);
    };
  }
  frameKinds(): string {
    return this.frames
      .slice(-12)
      .map((value) => {
        if (value === null || typeof value !== "object" || Array.isArray(value)) return typeof value;
        return String(
          value.type ?? value.method ?? (value.id === undefined ? "object" : `response:${String(value.id)}`),
        );
      })
      .join(",");
  }

  shutdown(): Promise<void> {
    return (this.shutdownReceipt ??= (async () => {
      if (this.state !== "open") return;
      this.state = "closing";
      await this.writes;
      const frame = this.shutdownFrame();
      if (frame !== undefined) await this.writeRaw(frame).catch(() => undefined);
      await this.process.closeStdin().catch(() => undefined);
      this.state = "closed";
    })());
  }

  release(): Promise<void> {
    return (this.releaseReceipt ??= (async () => {
      await this.shutdown();
      try {
        await timeout(this.exit, 2_000);
      } catch {
        await this.process.terminate();
        await timeout(this.exit, 2_000);
      }
    })());
  }

  private async consume(): Promise<void> {
    const stdoutDecoder = new TextDecoder();
    const stderrDecoder = new TextDecoder();
    let stdout = "";
    try {
      for await (const chunk of this.process.output) {
        if (chunk._tag === "Stderr") {
          this.stderrText += stderrDecoder.decode(chunk.bytes, { stream: true });
          continue;
        }
        stdout += stdoutDecoder.decode(chunk.bytes, { stream: true });
        for (;;) {
          const newline = stdout.indexOf("\n");
          if (newline < 0) break;
          const line = stdout.slice(0, newline).trim();
          stdout = stdout.slice(newline + 1);
          if (!line) continue;
          const frame = decodeFrame(JSON.parse(line));
          this.frames.push(frame);
          this.publishFrame(frame);
          this.notify();
        }
      }
      const tail = `${stdout}${stdoutDecoder.decode()}`.trim();
      if (tail) {
        const frame = decodeFrame(JSON.parse(tail));
        this.frames.push(frame);
        this.publishFrame(frame);
        this.notify();
      }
      this.stderrText += stderrDecoder.decode();
    } catch (error) {
      this.outputFailure = new ManagedJsonlOutputError(error);
    } finally {
      this.notify();
    }
  }

  private writeRaw(value: unknown): Promise<void> {
    return this.process.writeStdin(encoder.encode(`${JSON.stringify(value)}\n`));
  }

  private waitForChange(observedRevision: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(signal.reason);
    return new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = (): void => {
        signal.removeEventListener("abort", aborted);
        this.waiters.delete(done);
      };
      const done = (): void => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };
      const aborted = (): void => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(signal.reason);
      };
      this.waiters.add(done);
      signal.addEventListener("abort", aborted, { once: true });
      if (signal.aborted) aborted();
      else if (this.revision !== observedRevision) done();
    });
  }

  private notify(): void {
    this.revision += 1;
    for (const waiter of [...this.waiters]) waiter();
  }

  private publishFrame(frame: JsonValue): void {
    for (const subscriber of [...this.frameSubscribers]) {
      try {
        subscriber(frame);
      } catch {
        // ACTIVE feedback is best-effort and must not corrupt protocol intake.
      }
    }
  }
}
