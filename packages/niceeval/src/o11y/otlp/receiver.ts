// 宿主 OTLP/HTTP traces 接收器:供 direct agent、run 级共享管线与显式 host override 使用。
// 监听临时或固定端口,收到的 span 攒着,跑完由运行器一次性 collect 挂到
// EvalResult.trace。只认 POST .../v1/traces。

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { gunzipSync } from "node:zlib";
import { Effect, Fiber, Option } from "effect";
import type { TraceSpan } from "../../types.ts";
import { parseOtlpTraces } from "./parse.ts";

export interface TraceReceiver {
  /** agent 应导出到的完整端点；host 来自本机默认、provider 能力或作者显式覆盖。 */
  endpoint(host: string): string;
  /** 目前为止收到并解析出的全部 span(副本)。 */
  collect(): TraceSpan[];
  /** Known wire bytes already accepted by a dedicated host receiver. */
  readonly receivedBytes?: () => number;
  /** Gives in-flight exports up to maxMs to reach a quiet window. */
  settle(quietMs: number, maxMs: number): Effect.Effect<TraceSettleResult>;
  /** Synchronous checkpoint for attribution on run-scoped host receivers. */
  readonly disconnectedRequests?: () => number;
  /** Waits for current requests without extending the caller's collection budget. */
  readonly awaitAcceptedRequests?: Effect.Effect<void>;
  /** Sandbox transport drains bounded chunks, publishing decoded prefixes before the next read. */
  readonly drain?: (activity: TraceCollectionActivity) => Effect.Effect<void, unknown>;
  /** receiver owner 的 release action；Effect.acquireRelease 负责正常、失败与中断时调用它。 */
  readonly close: Effect.Effect<void>;
}

export interface TraceSettleResult {
  readonly settled: boolean;
  readonly disconnectedRequests: number;
}

export type TraceCollectionActivity = <A>(
  key: "telemetry.read" | "telemetry.decode",
  operation: Effect.Effect<A, unknown>,
  count: (value: A) => number,
) => Effect.Effect<A, unknown>;

interface InboxClosed {
  readonly code: "otlp-receiver-inbox-closed";
}

const inboxClosed: InboxClosed = { code: "otlp-receiver-inbox-closed" };
const HTTP_REQUEST_QUEUE_MAX = 128;
const SETTLE_POLL_MS = 50;
const SERVER_CLOSE_TIMEOUT_MS = 2_000;

interface HttpRequest {
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
}

/**
 * Node listener 只 offer；所有 body 读取、解析与 response 都在同一个 daemon Effect Stream 内。
 * 这样 listener callback 不会自己启动 Promise/runtime，scope close 时也会唤醒 waiting stream。
 */
class Inbox<Value> {
  private readonly values: Value[] = [];
  // Requests waiting for a slot stay paused, so their sockets supply body backpressure.
  private readonly waiting = new Set<Value>();
  private resume: ((effect: Effect.Effect<Value, InboxClosed>) => void) | undefined;
  private closed = false;

  private readonly capacity: number;
  constructor(capacity: number) {
    this.capacity = capacity;
  }

  take(): Effect.Effect<Value, InboxClosed> {
    return Effect.callback((resume) => {
      if (this.values.length > 0) {
        const next = this.values.shift()!;
        const waiting = this.waiting.values().next();
        if (!waiting.done) {
          this.waiting.delete(waiting.value);
          this.values.push(waiting.value);
        }
        resume(Effect.succeed(next));
        return Effect.void;
      }
      if (this.closed) {
        resume(Effect.fail(inboxClosed));
        return Effect.void;
      }
      this.resume = resume;
      return Effect.sync(() => {
        if (this.resume === resume) this.resume = undefined;
      });
    });
  }

  offer(value: Value): void {
    if (this.closed) return;
    const resume = this.resume;
    if (resume === undefined) {
      if (this.values.length >= this.capacity) this.waiting.add(value);
      else this.values.push(value);
      return;
    }
    this.resume = undefined;
    resume(Effect.succeed(value));
  }

  withdraw(value: Value): void {
    this.waiting.delete(value);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.waiting.clear();
    this.values.length = 0;
    const resume = this.resume;
    this.resume = undefined;
    resume?.(Effect.fail(inboxClosed));
  }
}

interface ReceiverResources {
  readonly server: Server;
  readonly sockets: Set<Socket>;
  readonly requests: Inbox<HttpRequest>;
  readonly spans: TraceSpan[];
  receivedBytes: number;
  readonly pendingRequests: Set<ServerResponse>;
  disconnectedRequests: number;
  lastAt: number;
  arrivalGeneration: number;
  closed: boolean;
}

/**
 * 创建 OTLP 接收器,并把 close 注册为 Scope finalizer。调用者在 Effect.scoped / Effect.gen
 * 里 yield* 即可。
 */
export function createTraceReceiver(port = 0): Effect.Effect<TraceReceiver, Error, import("effect/Scope").Scope> {
  return Effect.acquireRelease(makeTraceReceiver(port), (receiver) => receiver.close);
}

/**
 * 供 run 级 pool 使用的 receiver acquisition。pool 自己是 invocation-scoped resource，
 * 所以它在 close 时运行同一份 receiver.close；普通 attempt 则用 createTraceReceiver。
 */
export function makeTraceReceiver(port = 0): Effect.Effect<TraceReceiver, Error> {
  return Effect.gen(function* () {
    const resources = makeResources();
    const boundPort = yield* listen(resources.server, port);
    const drain = Effect.forever(
      resources.requests.take().pipe(Effect.flatMap((request) => handleTraceRequest(resources, request))),
    ).pipe(Effect.catch(() => Effect.void));
    const processor = yield* Effect.forkDetach(Effect.scoped(drain));
    const close = closeResources(resources, processor);
    return {
      endpoint: (host: string) => `http://${host}:${boundPort}/v1/traces`,
      collect: () => resources.spans.slice(),
      receivedBytes: () => resources.receivedBytes,
      settle: (quietMs, maxMs) => settleReceiver(resources, quietMs, maxMs),
      disconnectedRequests: () => resources.disconnectedRequests,
      awaitAcceptedRequests: awaitAcceptedRequests(resources),
      close,
    };
  });
}

function makeResources(): ReceiverResources {
  const requests = new Inbox<HttpRequest>(HTTP_REQUEST_QUEUE_MAX);
  const sockets = new Set<Socket>();
  const server = createServer();
  const resources: ReceiverResources = {
    server,
    sockets,
    requests,
    spans: [],
    receivedBytes: 0,
    pendingRequests: new Set(),
    disconnectedRequests: 0,
    lastAt: 0,
    arrivalGeneration: 0,
    closed: false,
  };
  server.on("request", (request, response) => {
    if (request.method !== "POST") {
      respond(response, 405);
      return;
    }
    const pending = { request, response };
    resources.pendingRequests.add(response);
    request.once("close", () => {
      if (resources.closed || request.readableEnded) return;
      resources.disconnectedRequests += 1;
      requests.withdraw(pending);
    });
    // A queued request may fail before the body reader attaches its own listener.
    request.on("error", () => {});
    response.once("close", () => {
      resources.pendingRequests.delete(response);
    });
    requests.offer(pending);
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  return resources;
}

function listen(server: Server, port: number): Effect.Effect<number, Error> {
  return Effect.callback((resume) => {
    let settled = false;
    const cleanup = (): void => {
      server.off("error", onError);
      server.off("listening", onListening);
    };
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resume(Effect.fail(error));
    };
    const onError = (error: Error): void => {
      const code =
        typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
          ? error.code
          : undefined;
      fail(
        port !== 0 && code === "EADDRINUSE"
          ? new Error(
              `OTLP receiver port ${port} is already in use (another process is bound to it). Pick a free port in defineConfig({ telemetry: { port } }), or stop whatever is using ${port} and retry.`,
            )
          : error,
      );
    };
    const onListening = (): void => {
      if (settled) return;
      const address = server.address();
      if (address === null || typeof address === "string") {
        fail(new Error("OTLP receiver did not expose a TCP address"));
        return;
      }
      settled = true;
      cleanup();
      resume(Effect.succeed(address.port));
    };
    server.once("error", onError);
    server.once("listening", onListening);
    try {
      // 显式 tunnel / 固定端口接入可能不从 loopback 到达，不能只听 127.0.0.1。
      server.listen({ port, host: "0.0.0.0" });
    } catch (error) {
      onError(error instanceof Error ? error : new Error(String(error)));
    }
    return Effect.sync(() => {
      cleanup();
      if (!settled && server.listening) {
        try {
          server.close();
        } catch {
          // Listener acquisition was interrupted before ownership transferred.
        }
      }
    });
  });
}

function handleTraceRequest(resources: ReceiverResources, request: HttpRequest): Effect.Effect<void> {
  return Effect.suspend(() =>
    request.request.destroyed && !request.request.readableEnded
      ? Effect.void
      : readRequestBody(request.request).pipe(
          Effect.matchEffect({
            onFailure: () => Effect.sync(() => respond(request.response, 400)),
            onSuccess: (raw) =>
              Effect.sync(() => {
                resources.receivedBytes += raw.byteLength;
                const contentType = request.request.headers["content-type"] ?? "";
                try {
                  let body = raw;
                  // OTLP 导出端可能 gzip(OTEL_EXPORTER_OTLP_COMPRESSION 或默认开)。按 header 或 gzip 魔数解压。
                  const contentEncoding = String(request.request.headers["content-encoding"] ?? "");
                  if (contentEncoding.includes("gzip") || (body[0] === 0x1f && body[1] === 0x8b)) {
                    try {
                      body = gunzipSync(body);
                    } catch {
                      // 不是合法 gzip 就按原样试。
                    }
                  }
                  const parsed = parseOtlpTraces(body, contentType);
                  if (parsed.length > 0) {
                    for (const span of parsed) resources.spans.push(span);
                    resources.lastAt = Date.now();
                    resources.arrivalGeneration += 1;
                  }
                } catch {
                  // 解析失败不回 5xx,免得导出端重试刷屏。
                }
              }).pipe(Effect.andThen(Effect.sync(() => respondOtlp(request.response, request.request)))),
          }),
        ),
  );
}

function awaitAcceptedRequests(resources: ReceiverResources): Effect.Effect<void> {
  return Effect.callback((resume) => {
    const responses = [...resources.pendingRequests];
    let remaining = responses.length;
    if (remaining === 0) {
      resume(Effect.void);
      return Effect.void;
    }
    const onClose = () => {
      remaining -= 1;
      if (remaining === 0) resume(Effect.void);
    };
    for (const response of responses) response.once("close", onClose);
    return Effect.sync(() => {
      for (const response of responses) response.off("close", onClose);
    });
  });
}

/** 将 Node request data/end/error callbacks 适配一次；Effect cancellation 会移除所有 listener。 */
function readRequestBody(request: IncomingMessage): Effect.Effect<Buffer, Error> {
  return Effect.callback((resume, effectSignal) => {
    const chunks: Buffer[] = [];
    let completed = false;
    const cleanup = (): void => {
      request.off("data", onData);
      request.off("end", onEnd);
      request.off("error", onError);
      request.off("aborted", onAborted);
      effectSignal.removeEventListener("abort", onEffectAbort);
    };
    const complete = (effect: Effect.Effect<Buffer, Error>): void => {
      if (completed) return;
      completed = true;
      cleanup();
      resume(effect);
    };
    const onData = (chunk: Buffer): void => {
      chunks.push(chunk);
    };
    const onEnd = (): void => complete(Effect.succeed(Buffer.concat(chunks)));
    const onError = (error: Error): void => complete(Effect.fail(error));
    const onAborted = (): void => complete(Effect.fail(new Error("OTLP request aborted")));
    const onEffectAbort = (): void => cleanup();
    request.on("data", onData);
    request.once("end", onEnd);
    request.once("error", onError);
    request.once("aborted", onAborted);
    effectSignal.addEventListener("abort", onEffectAbort, { once: true });
    return Effect.sync(cleanup);
  });
}

function respondOtlp(response: ServerResponse, request: IncomingMessage): void {
  const contentType = request.headers["content-type"] ?? "";
  if (contentType.includes("json")) {
    respond(response, 200, { "content-type": "application/json" }, "{}");
  } else {
    respond(response, 200, { "content-type": "application/x-protobuf" }, Buffer.alloc(0));
  }
}

function respond(
  response: ServerResponse,
  status: number,
  headers?: Readonly<globalThis.Record<string, string>>,
  body?: string | Buffer,
): void {
  try {
    response.writeHead(status, headers).end(body);
  } catch {
    // Client disconnects can race with the response. The scoped server close still owns cleanup.
  }
}

function settleReceiver(
  resources: ReceiverResources,
  quietMs: number,
  maxMs: number,
): Effect.Effect<TraceSettleResult> {
  // 只以本次调用开始后的 arrival 为 quiet 基线；上一批的 lastAt 不能让本次
  // settle 提前返回，否则 BatchSpanProcessor 的迟到 batch 会被 sweep 漏掉。
  return Effect.suspend(() => {
    const baselineGeneration = resources.arrivalGeneration;
    const quiet = () => resources.pendingRequests.size === 0 && Date.now() - resources.lastAt >= quietMs;
    const waitForQuiet = (): Effect.Effect<void> =>
      Effect.suspend(() =>
        resources.arrivalGeneration > baselineGeneration && quiet()
          ? Effect.void
          : Effect.sleep(SETTLE_POLL_MS).pipe(Effect.andThen(waitForQuiet())),
      );
    return waitForQuiet().pipe(
      Effect.timeoutOption(Math.max(0, maxMs)),
      Effect.map((result) => ({
        settled: Option.isSome(result) || quiet(),
        disconnectedRequests: resources.disconnectedRequests,
      })),
    );
  });
}

function closeResources(resources: ReceiverResources, processor: Fiber.Fiber<void, never>): Effect.Effect<void> {
  return Effect.suspend(() => {
    if (resources.closed) return Effect.void;
    resources.closed = true;
    return Effect.sync(() => resources.requests.close()).pipe(
      Effect.andThen(Fiber.interrupt(processor)),
      Effect.andThen(
        Effect.forEach([...resources.sockets], (socket) => Effect.sync(() => socket.destroy()), { discard: true }),
      ),
      Effect.andThen(closeServer(resources.server).pipe(Effect.timeoutOption(SERVER_CLOSE_TIMEOUT_MS), Effect.asVoid)),
    );
  });
}

function closeServer(server: Server): Effect.Effect<void> {
  return Effect.callback((resume) => {
    if (!server.listening) {
      resume(Effect.void);
      return Effect.void;
    }
    try {
      server.close(() => resume(Effect.void));
    } catch {
      resume(Effect.void);
    }
    return Effect.void;
  });
}

/**
 * External cancellation stays on Effect's interruption channel. Register before inspecting
 * `aborted`: otherwise an abort between the check and addEventListener is lost forever.
 */
export function interruptOnAbort(signal: AbortSignal): Effect.Effect<never> {
  return Effect.callback((resume, effectSignal) => {
    let completed = false;
    const cleanup = (): void => {
      signal.removeEventListener("abort", onAbort);
      effectSignal.removeEventListener("abort", onEffectAbort);
    };
    const cancel = (): void => {
      if (completed) return;
      completed = true;
      cleanup();
    };
    const onAbort = (): void => {
      if (completed) return;
      cancel();
      resume(Effect.interrupt);
    };
    const onEffectAbort = (): void => cancel();
    signal.addEventListener("abort", onAbort, { once: true });
    effectSignal.addEventListener("abort", onEffectAbort, { once: true });
    // Both listeners are live before either state is observed.
    if (effectSignal.aborted) onEffectAbort();
    else if (signal.aborted) onAbort();
    return Effect.sync(cancel);
  });
}
