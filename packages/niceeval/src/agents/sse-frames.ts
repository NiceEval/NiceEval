import * as Schema from "effect/Schema";
import type { JsonValue } from "../shared/types.ts";
import type { AgentContext } from "./types.ts";
import { attemptResources } from "../context/attempt-resources.ts";

/** A sequential decoded SSE reader; inspect done before consuming value and return it to cancel the transport. */
export interface SseFrameCursor<T> {
  /** Reads one decoded frame. The done tag, never a data value, denotes EOF. */
  next(): Promise<IteratorResult<T, void>>;
  /** Cancels pending reads and returns the shared underlying close receipt. */
  return(): Promise<IteratorResult<T, void>>;
}

/** Reports invalid JSON or a frame that fails its Schema, without exposing the received payload. */
export class SseFrameDecodeError extends Schema.TaggedError<SseFrameDecodeError>()("SseFrameDecodeError", {
  message: Schema.String,
}) {}

/** Reports a decoder defect or asynchronous decoder where the SSE reader requires synchronous decoding. */
export class SseFrameDecoderError extends Schema.TaggedError<SseFrameDecoderError>()("SseFrameDecoderError", {
  message: Schema.String,
}) {}

// Shared with external cursor consumers; one caller must not mutate another cursor's EOF.
const end: IteratorReturnResult<void> = Object.freeze({ done: true, value: undefined });

/** Decodes SSE JSON at the transport boundary. Schemas must decode synchronously without services. */
export function sseJsonFrames(body: ReadableStream<Uint8Array>): SseFrameCursor<JsonValue>;
export function sseJsonFrames<S extends Schema.ConstraintDecoder<unknown, never>>(
  body: ReadableStream<Uint8Array>,
  schema: S,
): SseFrameCursor<S["Type"]>;
// @concord-code
// @concord-implements docs/feature/adapters/library/streaming.md
export function sseJsonFrames(
  body: ReadableStream<Uint8Array>,
  schema: Schema.ConstraintDecoder<unknown, never> = Schema.MutableJson,
): SseFrameCursor<unknown> {
  const decodeFrame = Schema.decodeUnknownResult(Schema.fromJsonString(schema));
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let reading = false;
  let closed = false;
  let closeReceipt: Promise<IteratorResult<unknown, void>> | undefined;

  function close(): Promise<IteratorResult<unknown, void>> {
    if (closeReceipt !== undefined) return closeReceipt;
    closed = true;
    buffer = "";
    const activeReader = reader;
    reader = undefined;
    try {
      closeReceipt = activeReader === undefined ? Promise.resolve(end) : activeReader.cancel().then(() => end);
    } catch (error) {
      closeReceipt = Promise.reject(error);
    } finally {
      activeReader?.releaseLock();
    }
    // A caller may be waiting for next() while cancellation settles separately.
    void closeReceipt.catch(() => {});
    return closeReceipt;
  }

  async function read(): Promise<IteratorResult<unknown, void>> {
    try {
      for (;;) {
        if (closed) return end;
        const separator = buffer.indexOf("\n\n");
        if (separator !== -1) {
          const event = buffer.slice(0, separator);
          buffer = buffer.slice(separator + 2);
          const line = event.split("\n").find((value) => value.startsWith("data: "));
          if (line === undefined) continue;
          const payload = line.slice("data: ".length);
          if (payload === "[DONE]") continue;
          let decoded: ReturnType<typeof decodeFrame>;
          try {
            decoded = decodeFrame(payload);
          } catch {
            throw new SseFrameDecoderError({
              message: "SSE frame decoder must complete synchronously without defects.",
            });
          }
          if (decoded._tag === "Failure") {
            throw new SseFrameDecodeError({ message: "Invalid SSE JSON frame." });
          }
          return { done: false, value: decoded.success };
        }
        const activeReader = reader;
        if (activeReader === undefined) return end;
        const chunk = await activeReader.read();
        if (closed) return end;
        if (chunk.done) {
          closed = true;
          buffer = "";
          reader = undefined;
          activeReader.releaseLock();
          closeReceipt = Promise.resolve(end);
          return end;
        }
        buffer += decoder.decode(chunk.value, { stream: true });
      }
    } catch (error) {
      if (closed) return end;
      await close().catch(() => {});
      throw error;
    }
  }

  return {
    next() {
      if (closed) return Promise.resolve(end);
      if (reading) return Promise.reject(new TypeError("Concurrent SSE cursor reads are not supported."));
      reading = true;
      return read().finally(() => {
        reading = false;
      });
    },
    return: close,
  };
}

/** Waits for cleanup only within the owning deadline; the close operation has already started. */
function waitForClose(receipt: Promise<unknown>, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    const finish = () => signal.removeEventListener("abort", abort);
    receipt.then(
      () => {
        finish();
        resolve();
      },
      (error: unknown) => {
        finish();
        reject(error);
      },
    );
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}

/** Opens an SSE transport owned by the current Attempt, so a waiting Turn can resume its response. */
export function openSseJsonFrames(
  ctx: AgentContext,
  open: (signal: AbortSignal) => Promise<ReadableStream<Uint8Array>>,
): Promise<SseFrameCursor<JsonValue>>;
export function openSseJsonFrames<S extends Schema.ConstraintDecoder<unknown, never>>(
  ctx: AgentContext,
  open: (signal: AbortSignal) => Promise<ReadableStream<Uint8Array>>,
  schema: S,
): Promise<SseFrameCursor<S["Type"]>>;
// @concord-code
// @concord-implements docs/feature/adapters/library/streaming.md
export async function openSseJsonFrames(
  ctx: AgentContext,
  open: (signal: AbortSignal) => Promise<ReadableStream<Uint8Array>>,
  schema: Schema.ConstraintDecoder<unknown, never> = Schema.MutableJson,
): Promise<SseFrameCursor<unknown>> {
  const resources = attemptResources(ctx);
  if (resources === undefined) throw new Error("Opening an Attempt-owned SSE stream requires a Runner AgentContext.");
  const transport = new AbortController();
  let cursor: SseFrameCursor<unknown> | undefined;
  let closed = false;
  let opening: Promise<void> = Promise.resolve();
  let lateClose: Promise<void> = Promise.resolve();
  let closeReceipt: Promise<IteratorResult<unknown, void>> | undefined;

  function close(): Promise<IteratorResult<unknown, void>> {
    if (closeReceipt !== undefined) return closeReceipt;
    closed = true;
    transport.abort();
    const current = cursor;
    cursor = undefined;
    closeReceipt = Promise.all([current?.return(), opening.then(() => lateClose)]).then(() => end);
    void closeReceipt.catch(() => {});
    return closeReceipt;
  }

  const owner = { close };
  await resources.acquire(async () => owner, {
    shutdown: (resource, signal) => waitForClose(resource.close(), signal),
    release: (resource, signal) => waitForClose(resource.close(), signal),
  });
  const abort = () => {
    void close();
  };
  ctx.signal.addEventListener("abort", abort, { once: true });
  try {
    ctx.signal.throwIfAborted();
    transport.signal.throwIfAborted();
    const request = Promise.resolve().then(async () => {
      const body = await open(transport.signal);
      if (closed) {
        lateClose = body.cancel();
        await lateClose;
        transport.signal.throwIfAborted();
      }
      cursor = sseJsonFrames(body, schema);
    });
    opening = request.then(
      () => {},
      () => {},
    );
    await request;
    ctx.signal.throwIfAborted();
    transport.signal.throwIfAborted();
  } catch (error) {
    await close().catch(() => {});
    throw error;
  } finally {
    ctx.signal.removeEventListener("abort", abort);
  }
  return {
    async next() {
      const current = cursor;
      if (current === undefined) return end;
      try {
        const result = await current.next();
        if (result.done) await close();
        return result;
      } catch (error) {
        await close().catch(() => {});
        throw error;
      }
    },
    return: close,
  };
}
