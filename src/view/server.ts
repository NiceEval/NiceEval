// The Node view host owns transport and watch lifetime only. Its caller has
// already closed RecordReader -> AnalysisSampleHandle -> executeReport into a
// fixed execution rebuild; this module never reopens a retired Record graph.

import { readdirSync, statSync, watch, type FSWatcher } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { basename, dirname, resolve } from "node:path";
import { Effect, Either } from "effect";
import type * as Scope from "effect/Scope";
import { reportRoute, type ReportRoute } from "../report/author/identity.ts";
import type { ReportExecution } from "../report/execution/model.ts";
import {
  renderReportExecutionJson,
  renderReportExecutionProblemsText,
  renderReportExecutionText,
} from "../report/host/presentation.ts";
import {
  openReportViewSession,
  type OpenReportViewSessionInput,
  type ReportViewOpenError,
  type ReportViewSessionClosed,
  type ReportViewSession,
} from "../report/host/view-session.ts";
import type { ViewScanOptions } from "./data.ts";
import { renderHtml } from "./site.ts";

export interface NodeViewServerError {
  readonly code: "report-view-server-failed";
  readonly operation: "open" | "listen" | "watch";
  readonly reason: string;
}

export interface ViewOptions<Requirements = never> {
  readonly input?: string;
  readonly out?: string;
  readonly port?: number;
  /** Loopback only. A public listener is not a Report host capability. */
  readonly host?: string;
  /** Retained for the CLI-shaped facade; it is never interpreted as Record data. */
  readonly scan?: ViewScanOptions;
  /** A legacy alias for one caller-supplied watch input. */
  readonly watchRoot?: string;
  /** Exact files or directories whose changes should request one rebuild. */
  readonly watchInputs?: readonly string[];
  readonly onRebuild?: (completedAt: Date) => void;
  /** Static export consumes this exact fixed execution. */
  readonly reportExecution?: ReportExecution;
  /** An already-open scoped session owned by the caller. */
  readonly session?: ReportViewSession<Requirements>;
  /** Or let this scope open a session from a caller-supplied current rebuild. */
  readonly request?: OpenReportViewSessionInput<Requirements>;
}

/** The native Effect-facing server handle. Its resources are also Scope-owned. */
export interface ReportViewServer {
  readonly url: string;
  readonly urls: readonly string[];
  readonly close: Effect.Effect<void>;
}

export type RebuildReason = "records" | "modules";

interface InboxClosed {
  readonly code: "report-view-inbox-closed";
}

const inboxClosed: InboxClosed = Object.freeze({ code: "report-view-inbox-closed" });

interface HttpRequest {
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
}

const HTTP_REQUEST_QUEUE_MAX = 128;

/**
 * A small callback-to-Effect bridge. Node callbacks only enqueue a value; the
 * long-lived scoped Effect performs every session operation, so callbacks do
 * not create private runtimes or invoke `runPromise`/`runSync`.
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

/** Coalesces a burst of filesystem events into sequential refresh requests. */
class RefreshInbox {
  private pending = false;
  private resume: ((effect: Effect.Effect<void, InboxClosed>) => void) | undefined;
  private closed = false;

  take(): Effect.Effect<void, InboxClosed> {
    return Effect.async((resume) => {
      if (this.pending) {
        this.pending = false;
        resume(Effect.void);
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

  request(): void {
    if (this.closed) return;
    const resume = this.resume;
    if (resume === undefined) {
      this.pending = true;
      return;
    }
    this.resume = undefined;
    resume(Effect.void);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    const resume = this.resume;
    this.resume = undefined;
    resume?.(Effect.fail(inboxClosed));
  }
}

interface ServerResources {
  readonly server: Server;
  readonly sockets: Set<Socket>;
  readonly requests: Inbox<HttpRequest>;
  readonly refreshes: RefreshInbox;
  closed: boolean;
}

interface WatchResources {
  readonly watchers: Map<string, FSWatcher>;
  closed: boolean;
}

/**
 * Opens a real loopback HTTP server. A watcher event only requests
 * `session.refresh`; the session serializes rebuild and close, preserves the
 * last good immutable execution, and publishes a new revision only on success.
 */
export function openViewServer<Requirements>(
  options: ViewOptions<Requirements> = {},
): Effect.Effect<ReportViewServer, NodeViewServerError | ReportViewOpenError, Scope.Scope | Requirements> {
  return Effect.gen(function* () {
    if (options.session !== undefined && options.request !== undefined) {
      return yield* Effect.fail(serverError("open", "provide either session or request, not both"));
    }
    const host = options.host ?? "127.0.0.1";
    if (!isLoopbackHost(host)) {
      return yield* Effect.fail(serverError("open", `view host must be loopback, got ${host}`));
    }
    const port = options.port ?? 0;
    if (!Number.isInteger(port) || port < 0 || port > 65_535) {
      return yield* Effect.fail(serverError("open", `view port must be an integer from 0 through 65535, got ${port}`));
    }

    const session = options.session ?? (options.request === undefined
      ? yield* Effect.fail(serverError("open", "view needs a scoped ReportViewSession or current rebuild request"))
      : yield* openReportViewSession(options.request));

    const resources = yield* Effect.acquireRelease(
      Effect.sync(() => makeResources()),
      (value) => closeResources(value),
    );
    const address = yield* listen(resources.server, host, port);
    const watches = yield* Effect.acquireRelease(
      openWatchers(watchInputs(options), () => resources.refreshes.request()),
      (value) => closeWatchers(value),
    );

    yield* Effect.forkScoped(
      Effect.forever(
        Effect.flatMap(resources.requests.take(), (request) => serveRequest(session, request)),
      ).pipe(Effect.catchAll(() => Effect.void)),
    );
    yield* Effect.forkScoped(
      Effect.forever(
        Effect.flatMap(resources.refreshes.take(), () => refreshSession(session, options.onRebuild)),
      ).pipe(Effect.catchAll(() => Effect.void)),
    );

    const close = Effect.zipRight(closeWatchers(watches), closeResources(resources));
    const url = `http://${formatHost(address.host)}:${address.port}/`;
    return Object.freeze({ url, urls: Object.freeze([url]), close });
  });
}

function makeResources(): ServerResources {
  const requests = new Inbox<HttpRequest>(HTTP_REQUEST_QUEUE_MAX);
  const refreshes = new RefreshInbox();
  const sockets = new Set<Socket>();
  const server = createServer((request, response) => {
    if (!requests.offer(Object.freeze({ request, response }))) {
      sendText(response, 503, "report view is busy; retry shortly");
    }
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  return { server, sockets, requests, refreshes, closed: false };
}

function listen(
  server: Server,
  host: string,
  port: number,
): Effect.Effect<{ readonly host: string; readonly port: number }, NodeViewServerError> {
  return Effect.async((resume) => {
    const cleanup = (): void => {
      server.off("error", onError);
      server.off("listening", onListening);
    };
    const onError = (error: Error): void => {
      cleanup();
      resume(Effect.fail(serverError("listen", error.message)));
    };
    const onListening = (): void => {
      cleanup();
      const address = server.address();
      if (address === null || typeof address === "string") {
        resume(Effect.fail(serverError("listen", "server did not expose a TCP address")));
        return;
      }
      resume(Effect.succeed(Object.freeze({ host: address.address, port: address.port })));
    };
    server.once("error", onError);
    server.once("listening", onListening);
    try {
      server.listen({ host, port });
    } catch (error) {
      onError(asError(error));
    }
    return Effect.sync(() => cleanup());
  });
}

function serveRequest<Requirements>(
  session: ReportViewSession<Requirements>,
  request: HttpRequest,
): Effect.Effect<void> {
  const url = requestUrl(request.request);
  if (url === undefined) {
    return Effect.sync(() => sendText(request.response, 400, "bad request"));
  }
  if (url.pathname === "/healthz") {
    return Effect.sync(() => sendText(request.response, 200, "ok"));
  }
  return session.snapshot.pipe(
    Effect.flatMap((state) => {
      const headers = Object.freeze({
        "cache-control": "no-store",
        "x-niceeval-report-revision": String(state.current.revision),
        ...(state.lastProblem === undefined ? {} : { "x-niceeval-last-rebuild-problem": "1" }),
      });
      if (url.pathname === "/_niceeval/execution.json") {
        return Effect.flatMap(
          renderReportExecutionJson({ execution: state.current.execution }),
          (body) => Effect.sync(() => send(request.response, 200, body, "application/json; charset=utf-8", headers)),
        );
      }
      if (url.pathname === "/_niceeval/problems" || url.pathname === "/_niceeval/problems/") {
        const prefix = state.lastProblem === undefined
          ? `Revision ${state.current.revision}\n\n`
          : `Revision ${state.current.revision}\nLast rebuild failed: ${state.lastProblem.summary}\n\n`;
        return Effect.sync(() => send(
          request.response,
          200,
          renderHtml(`${prefix}${renderReportExecutionProblemsText(state.current.execution)}`),
          "text/html; charset=utf-8",
          headers,
        ));
      }
      const page = pageForPath(url.pathname, state.current.execution);
      if (page === "missing") {
        return Effect.sync(() => sendText(request.response, 404, "page not found", headers));
      }
      const rendered = renderReportExecutionText({
        execution: state.current.execution,
        ...(page === undefined ? {} : { page }),
      });
      const prefix = state.lastProblem === undefined
        ? `Revision ${state.current.revision}\n\n`
        : `Revision ${state.current.revision}\nLast rebuild failed: ${state.lastProblem.summary}\n\n`;
      return Effect.sync(() => send(request.response, 200, renderHtml(`${prefix}${rendered}`), "text/html; charset=utf-8", headers));
    }),
    Effect.catchAll(() => Effect.sync(() => sendText(request.response, 503, "report view session is closed"))),
  );
}

function refreshSession<Requirements>(
  session: ReportViewSession<Requirements>,
  onRebuild: ViewOptions["onRebuild"],
): Effect.Effect<void, ReportViewSessionClosed, Requirements> {
  return Effect.gen(function* () {
    const before = yield* session.snapshot;
    yield* session.refresh;
    const after = yield* session.snapshot;
    if (after.current.revision > before.current.revision && onRebuild !== undefined) {
      yield* Effect.try({
        try: () => onRebuild(new Date()),
        catch: () => undefined,
      }).pipe(Effect.ignore);
    }
  });
}

function watchInputs<Requirements>(options: ViewOptions<Requirements>): readonly string[] {
  const values = [
    ...(options.watchInputs ?? []),
    ...(options.watchRoot === undefined ? [] : [options.watchRoot]),
  ];
  return Object.freeze([...new Set(values.map((value) => resolve(value)))]);
}

function openWatchers(
  inputs: readonly string[],
  onChange: () => void,
): Effect.Effect<WatchResources, NodeViewServerError> {
  return Effect.try({
    try: () => {
      const resources: WatchResources = { watchers: new Map(), closed: false };
      const notify = (): void => {
        if (resources.closed) return;
        // A new Run gets its own directory before its completion marker. Rescan
        // immediately after the parent event so the marker change is observed
        // as well as the first incomplete rebuild.
        try {
          synchronizeWatchers(resources, inputs, notify);
        } catch {
          // A transient directory race must not escape a Node callback. The
          // existing watcher still requests this rebuild and the next event
          // will retry the watch-set synchronization.
        }
        onChange();
      };
      try {
        synchronizeWatchers(resources, inputs, notify);
        return resources;
      } catch (error) {
        for (const watcher of resources.watchers.values()) watcher.close();
        throw error;
      }
    },
    catch: (error): NodeViewServerError => serverError("watch", asError(error).message),
  });
}

/** Watch the Record root and its current Run directories without a polling loop. */
function synchronizeWatchers(
  resources: WatchResources,
  inputs: readonly string[],
  onChange: () => void,
): void {
  for (const input of inputs) {
    try {
      if (statSync(input).isDirectory()) {
        watchDirectoryTree(resources, input, onChange, 0);
      } else {
        watchNamedInput(resources, dirname(input), basename(input), onChange);
      }
    } catch {
      // A missing config / module / Record root remains observable through its
      // parent directory. It can appear later without restarting the host.
      watchNamedInput(resources, dirname(input), basename(input), onChange);
    }
  }
}

const WATCH_DIRECTORY_DEPTH_MAX = 4;

function watchDirectoryTree(
  resources: WatchResources,
  directory: string,
  onChange: () => void,
  depth: number,
): void {
  watchDirectory(resources, directory, onChange);
  if (depth >= WATCH_DIRECTORY_DEPTH_MAX) return;
  let entries: readonly { readonly name: string; isDirectory(): boolean }[];
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      watchDirectoryTree(resources, resolve(directory, entry.name), onChange, depth + 1);
    }
  }
}

function watchDirectory(
  resources: WatchResources,
  directory: string,
  onChange: () => void,
): void {
  const key = `directory:${directory}`;
  if (resources.watchers.has(key)) return;
  resources.watchers.set(key, watch(directory, () => onChange()));
}

function watchNamedInput(
  resources: WatchResources,
  directory: string,
  name: string,
  onChange: () => void,
): void {
  const key = `named:${directory}:${name}`;
  if (resources.watchers.has(key)) return;
  resources.watchers.set(key, watch(directory, (_event, filename) => {
    if (filename === null || filename.toString() === name) onChange();
  }));
}

function closeResources(resources: ServerResources): Effect.Effect<void> {
  return Effect.suspend(() => {
    if (resources.closed) return Effect.void;
    resources.closed = true;
    return Effect.zipRight(
      Effect.sync(() => {
        resources.requests.close();
        resources.refreshes.close();
        for (const socket of resources.sockets) socket.destroy();
      }),
      closeServer(resources.server),
    );
  });
}

function closeWatchers(resources: WatchResources): Effect.Effect<void> {
  return Effect.suspend(() => {
    if (resources.closed) return Effect.void;
    resources.closed = true;
    return Effect.sync(() => {
      for (const watcher of resources.watchers.values()) {
        try {
          watcher.close();
        } catch {
          // Closing is best-effort and idempotent at the Node boundary. The
          // owning Scope still proceeds to close the listener and sockets.
        }
      }
    });
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

function pageForPath(
  pathname: string,
  execution: ReportExecution,
): ReportRoute | "missing" | undefined {
  if (pathname === "/") return undefined;
  const parsed = reportRoute(pathname);
  if (Either.isLeft(parsed) || !execution.pages.some((page) => page.route === parsed.right)) return "missing";
  return parsed.right;
}

function requestUrl(request: IncomingMessage): URL | undefined {
  try {
    return new URL(request.url ?? "/", "http://127.0.0.1");
  } catch {
    return undefined;
  }
}

function sendText(
  response: ServerResponse,
  status: number,
  body: string,
  headers: Readonly<Record<string, string>> = {},
): void {
  send(response, status, body, "text/plain; charset=utf-8", headers);
}

function send(
  response: ServerResponse,
  status: number,
  body: string,
  contentType: string,
  headers: Readonly<Record<string, string>>,
): void {
  if (response.destroyed) return;
  response.writeHead(status, { "content-type": contentType, ...headers });
  response.end(body);
}

function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

function formatHost(host: string): string {
  return host.includes(":") ? `[${host}]` : host;
}

function serverError(operation: NodeViewServerError["operation"], reason: string): NodeViewServerError {
  return Object.freeze({ code: "report-view-server-failed", operation, reason });
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
