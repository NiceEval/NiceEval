// 宿主 OTLP/HTTP traces 接收器:供 direct agent、run 级共享管线与显式 host override 使用。
// 监听临时或固定端口,收到的 span 攒着,跑完由运行器一次性 collect 挂到
// EvalResult.trace。只认 POST .../v1/traces。

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { gunzipSync } from "node:zlib";
import { Effect, Fiber, Stream } from "effect";
import type { TraceSpan } from "../../types.ts";
import { t } from "../../i18n/index.ts";
import { parseOtlpTraces } from "./parse.ts";

export interface TraceReceiver {
  /** agent 应导出到的完整端点；host 来自本机默认、provider 能力或作者显式覆盖。 */
  endpoint(host: string): string;
  /** 目前为止收到并解析出的全部 span(副本)。 */
  collect(): TraceSpan[];
  /** 给在途的最后一批导出留点落地时间(无新 span 持续 quietMs 即返回,至多 maxMs)。 */
  settle(quietMs: number, maxMs: number): Effect.Effect<void>;
  /** receiver owner 的 release action；Effect.acquireRelease 负责正常、失败与中断时调用它。 */
  readonly close: Effect.Effect<void>;
}

interface InboxClosed {
  readonly code: "otlp-receiver-inbox-closed";
}

const inboxClosed: InboxClosed = Object.freeze({ code: "otlp-receiver-inbox-closed" });
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
  private resume: ((effect: Effect.Effect<Value, InboxClosed>) => void) | undefined;
  private closed = false;

  constructor(private readonly capacity: number) {}

  take(): Effect.Effect<Value, InboxClosed> {
    return Effect.async((resume) => {
      if (this.values.length > 0) {
        resume(Effect.succeed(this.values.shift()!));
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

  offer(value: Value): boolean {
    if (this.closed) return false;
    const resume = this.resume;
    if (resume === undefined) {
      if (this.values.length >= this.capacity) return false;
      this.values.push(value);
      return true;
    }
    this.resume = undefined;
    resume(Effect.succeed(value));
    return true;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
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
  lastAt: number;
  arrivalGeneration: number;
  closed: boolean;
}

/**
 * 创建 OTLP 接收器,并把 close 注册为 Scope finalizer。调用者在 Effect.scoped / Effect.gen
 * 里 yield* 即可。
 */
export function createTraceReceiver(port = 0): Effect.Effect<TraceReceiver, Error, import("effect/Scope").Scope> {
  return Effect.acquireRelease(
    makeTraceReceiver(port),
    (receiver) => receiver.close,
  );
}

/**
 * 供 run 级 pool 使用的 receiver acquisition。pool 自己是 invocation-scoped resource，
 * 所以它在 close 时运行同一份 receiver.close；普通 attempt 则用 createTraceReceiver。
 */
export function makeTraceReceiver(port = 0): Effect.Effect<TraceReceiver, Error> {
  return Effect.gen(function* () {
    const resources = makeResources();
    const boundPort = yield* listen(resources.server, port);
    const drain = Stream.repeatEffect(resources.requests.take()).pipe(
      Stream.mapEffect(
        (request) => handleTraceRequest(resources, request),
        { concurrency: "unbounded", unordered: true },
      ),
      Stream.runDrain,
      Effect.catchAll(() => Effect.void),
    );
    const processor = yield* Effect.forkDaemon(Effect.scoped(drain));
    const close = closeResources(resources, processor);
    const settle = (quietMs: number, maxMs: number): Effect.Effect<void> =>
      settleReceiver(resources, quietMs, maxMs);

    return Object.freeze({
      endpoint: (host: string) => `http://${host}:${boundPort}/v1/traces`,
      collect: () => resources.spans.slice(),
      settle,
      close,
    });
  });
}

function makeResources(): ReceiverResources {
  const requests = new Inbox<HttpRequest>(HTTP_REQUEST_QUEUE_MAX);
  const sockets = new Set<Socket>();
  const server = createServer((request, response) => {
    if (!requests.offer(Object.freeze({ request, response }))) {
      respond(response, 503);
    }
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  return {
    server,
    sockets,
    requests,
    spans: [],
    lastAt: 0,
    arrivalGeneration: 0,
    closed: false,
  };
}

function listen(server: Server, port: number): Effect.Effect<number, Error> {
  return Effect.async((resume) => {
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
      const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
        ? error.code
        : undefined;
      fail(port !== 0 && code === "EADDRINUSE" ? new Error(t("otel.portInUse", { port })) : error);
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
  if (request.request.method !== "POST") return Effect.sync(() => respond(request.response, 405));
  return readRequestBody(request.request).pipe(
    Effect.matchEffect({
      onFailure: () => Effect.sync(() => respond(request.response, 400)),
      onSuccess: (raw) => Effect.sync(() => {
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
            resources.spans.push(...parsed);
            resources.lastAt = Date.now();
            resources.arrivalGeneration += 1;
          }
        } catch {
          // 解析失败不回 5xx,免得导出端重试刷屏。
        }
      }).pipe(
        Effect.zipRight(Effect.sync(() => respondOtlp(request.response, request.request))),
      ),
    }),
  );
}

/** 将 Node request data/end/error callbacks 适配一次；Effect cancellation 会移除所有 listener。 */
function readRequestBody(request: IncomingMessage): Effect.Effect<Buffer, Error> {
  return Effect.async((resume, effectSignal) => {
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

function settleReceiver(resources: ReceiverResources, quietMs: number, maxMs: number): Effect.Effect<void> {
  // 只以本次调用开始后的 arrival 为 quiet 基线；上一批的 lastAt 不能让本次
  // settle 提前返回，否则 BatchSpanProcessor 的迟到 batch 会被 sweep 漏掉。
  const baselineGeneration = resources.arrivalGeneration;
  const waitForQuiet = (): Effect.Effect<void> => Effect.suspend(() => {
    if (
      resources.arrivalGeneration > baselineGeneration &&
      Date.now() - resources.lastAt >= Math.max(0, quietMs)
    ) {
      return Effect.void;
    }
    return Effect.sleep(SETTLE_POLL_MS).pipe(Effect.zipRight(waitForQuiet()));
  });
  return waitForQuiet().pipe(Effect.timeoutOption(Math.max(0, maxMs)), Effect.asVoid);
}

function closeResources(
  resources: ReceiverResources,
  processor: Fiber.RuntimeFiber<void, never>,
): Effect.Effect<void> {
  return Effect.suspend(() => {
    if (resources.closed) return Effect.void;
    resources.closed = true;
    return Effect.sync(() => resources.requests.close()).pipe(
      Effect.zipRight(Fiber.interrupt(processor)),
      Effect.zipRight(
        Effect.forEach(
          [...resources.sockets],
          (socket) => Effect.sync(() => socket.destroy()),
          { discard: true },
        ),
      ),
      Effect.zipRight(closeServer(resources.server).pipe(Effect.timeoutOption(SERVER_CLOSE_TIMEOUT_MS), Effect.asVoid)),
    );
  });
}

function closeServer(server: Server): Effect.Effect<void> {
  return Effect.async((resume) => {
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
  return Effect.async((resume, effectSignal) => {
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
