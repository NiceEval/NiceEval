// The Node view host owns transport and watch lifetime only. Its caller has
// already closed RecordReader -> AnalysisSampleHandle -> executeReport into a
// fixed execution rebuild; this module never reopens a retired Record graph.

import { readdirSync, statSync, watch, type FSWatcher } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { networkInterfaces } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { Effect, Either } from "effect";
import type * as Scope from "effect/Scope";
import {
  isReportDownloadPath,
  reportRoute,
  type ReportRoute,
} from "../report/author/identity.ts";
import type { ReportExecution } from "../report/execution/model.ts";
import type { ReportPageResult } from "../report/execution/results.ts";
import {
  renderReportExecutionJson,
  renderReportExecutionProblemsText,
  type ReportShowRenderError,
} from "../report/host/presentation.ts";
import {
  renderReportLiveHtml,
  renderReportLocaleSwitchPayload,
  type ReportLiveLocaleRevision,
} from "../report/host/html.ts";
import { reportFallbackPage } from "../report/host/fallback.ts";
import {
  REPORT_FRAGMENT_HEADER,
  REPORT_LOCALE_HEADER,
} from "../report/host/html-enhance.ts";
import {
  openReportViewSession,
  type OpenReportViewSessionInput,
  type ReportViewOpenError,
  type ReportViewSessionClosed,
  type ReportViewSession,
  type ReportViewState,
} from "../report/host/view-session.ts";
import type { ViewRevisionClosure } from "../report/host/view-closure.ts";
import type { ThemeDefinition } from "../report/host/node/theme.ts";
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
  /** Defaults to loopback. An explicit address opts into that network exposure. */
  readonly host?: string;
  /** Retained for the CLI-shaped facade; it is never interpreted as Record data. */
  readonly scan?: ViewScanOptions;
  /**
   * Bootstrap watch inputs when the session/request has none yet. After each
   * successful rebuild the session revision owns the next-round watch set.
   */
  readonly watchInputs?: readonly string[];
  readonly onRebuild?: (completedAt: Date) => void;
  /** Static export consumes this exact fixed execution. */
  readonly reportExecution?: ReportExecution;
  /** A one-shot static export Theme; an open session keeps its revision Theme. */
  readonly theme?: ThemeDefinition;
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

type RenderedPage = Extract<ReportPageResult, { readonly state: "rendered" }>;
type PageLookup = RenderedPage | "fallback" | "missing";

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
  /** The one currently published watcher closure. */
  current: WatchSet;
  /** Stable refresh request callback for the current server lifetime. */
  onChange: () => void;
  closed: boolean;
}

/**
 * A complete watcher closure. A candidate stays `opening` until every watch
 * for its current directory tree has opened. Callbacks test both this state
 * and the owning resource's current reference, so an old or failed candidate
 * cannot enqueue a late rebuild.
 */
interface WatchSet {
  readonly inputs: readonly string[];
  readonly watchers: Map<string, FSWatcher>;
  state: "opening" | "active" | "closed";
}

/**
 * Opens a real HTTP server, defaulting to loopback. A watcher event only requests
 * `session.refresh`; the session serializes rebuild and close, preserves the
 * last good immutable execution and recoverable watch set, and publishes a new
 * revision only on success. The Node server then atomically replaces its
 * fs.watch resources from that revision's watchInputs.
 */
export function openViewServer<Requirements>(
  options: ViewOptions<Requirements> = {},
): Effect.Effect<ReportViewServer, NodeViewServerError | ReportViewOpenError, Scope.Scope | Requirements> {
  return Effect.gen(function* () {
    if (options.session !== undefined && options.request !== undefined) {
      return yield* Effect.fail(serverError("open", "provide either session or request, not both"));
    }
    const host = (options.host ?? "127.0.0.1").trim();
    if (host.length === 0) {
      return yield* Effect.fail(serverError("open", "view host must not be empty"));
    }
    if (host.includes("%")) {
      return yield* Effect.fail(serverError("open", "scoped IPv6 view hosts are not supported"));
    }
    const port = options.port ?? 0;
    if (!Number.isInteger(port) || port < 0 || port > 65_535) {
      return yield* Effect.fail(serverError("open", `view port must be an integer from 0 through 65535, got ${port}`));
    }

    const session = options.session ?? (options.request === undefined
      ? yield* Effect.fail(serverError("open", "view needs a scoped ReportViewSession or current rebuild request"))
      : yield* openReportViewSession({
        ...options.request,
        // Bootstrap the opening revision when the request omitted a watch set.
        watchInputs: options.request.watchInputs ?? optionWatchInputs(options),
      }));

    const opening = yield* session.snapshot.pipe(
      Effect.mapError(() => serverError("open", "report view session closed before watchers opened")),
    );
    const initialWatchInputs = opening.current.watchInputs.length > 0
      ? opening.current.watchInputs
      : optionWatchInputs(options);

    const resources = yield* Effect.acquireRelease(
      Effect.sync(() => makeResources()),
      (value) => closeResources(value),
    );
    const address = yield* listen(resources.server, host, port);
    const urls = viewUrls(host, address.port);
    const advertisedAuthorities = Object.freeze(new Set(urls.map((url) => new URL(url).host)));
    const watches = yield* Effect.acquireRelease(
      openWatchers(initialWatchInputs, () => resources.refreshes.request()),
      (value) => closeWatchers(value),
    );

    yield* Effect.forkScoped(
      Effect.forever(
        Effect.flatMap(
          resources.requests.take(),
          (request) => serveRequest(session, request, advertisedAuthorities),
        ),
      ).pipe(Effect.catchAll(() => Effect.void)),
    );
    yield* Effect.forkScoped(
      Effect.forever(
        Effect.flatMap(resources.refreshes.take(), () =>
          refreshSession(session, watches, options.onRebuild)),
      ).pipe(Effect.catchAll(() => Effect.void)),
    );

    const close = Effect.zipRight(closeWatchers(watches), closeResources(resources));
    return Object.freeze({ url: urls[0]!, urls, close });
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
  advertisedAuthorities: ReadonlySet<string>,
): Effect.Effect<void> {
  const authority = requestAuthority(request.request.headers.host);
  if (authority === undefined || !advertisedAuthorities.has(authority)) {
    return Effect.sync(() => sendText(request.response, 421, "view host is not advertised"));
  }
  if (request.request.method !== "GET" && request.request.method !== "HEAD") {
    return Effect.sync(() => sendText(
      request.response,
      405,
      "method not allowed",
      { allow: "GET, HEAD" },
    ));
  }
  const url = requestUrl(request.request);
  if (url === undefined) {
    return Effect.sync(() => sendText(request.response, 400, "bad request"));
  }
  if (url.pathname === "/healthz") {
    return Effect.sync(() => sendText(request.response, 200, "ok"));
  }
  return session.snapshot.pipe(
    Effect.flatMap((state) => {
      // Every request reads only the current revision. Closure revisions
      // select the locale execution as a pure lookup on the validated pair;
      // legacy single-execution revisions serve their fixed English
      // execution and honestly reject locale requests they cannot serve.
      // Language switches keep the exact URL and revision; only the locale
      // header selects the sibling execution inside the same closure. This
      // never re-runs author callbacks, re-reads the Record, or mixes two
      // revisions.
      const headers = Object.freeze({
        "cache-control": "no-store",
        "x-niceeval-report-revision": String(state.current.revision),
        ...(state.lastProblem === undefined ? {} : { "x-niceeval-last-rebuild-problem": "1" }),
      });
      const closure = state.current.closure;
      const requestedLocale = requestLocale(request.request.headers);
      if (closure === undefined) {
        // Legacy single-execution session: English only, never faked as a
        // bilingual closure. A zh-CN request is an honest non-2xx answer.
        if (requestedLocale === "zh-CN") {
          return Effect.sync(() => sendText(
            request.response,
            406,
            "this view revision has no bilingual closure; English is the only locale",
            headers,
          ));
        }
        return serveWithExecution(
          request,
          url,
          state.current.execution,
          state,
          headers,
        );
      }
      const locale = requestedLocale;
      const execution = closure[locale];
      return serveWithExecution(
        request,
        url,
        execution,
        state,
        headers,
        siblingLocaleRevision(closure, locale, url.pathname),
      );
    }),
    Effect.catchAll(() => Effect.sync(() => sendText(request.response, 503, "report view session is closed"))),
  );
}

/** Serves one fixed execution of the current revision; `sibling` embeds the in-place language payload. */
function serveWithExecution(
  request: HttpRequest,
  url: URL,
  execution: ReportExecution,
  state: ReportViewState,
  headers: Readonly<Record<string, string>>,
  sibling?: ReportLiveLocaleRevision,
): Effect.Effect<void, ReportShowRenderError> {
  const hostTextPrefix = state.lastProblem === undefined
    ? `Revision ${state.current.revision}\n\n`
    : `Revision ${state.current.revision}\nLast rebuild failed: ${state.lastProblem.summary}\n\n`;
  if (url.pathname === "/_niceeval/execution.json") {
    return Effect.flatMap(
      renderReportExecutionJson({ execution }),
      (body) => Effect.sync(() => send(request.response, 200, body, "application/json; charset=utf-8", headers)),
    );
  }
  if (url.pathname === "/_niceeval/problems" || url.pathname === "/_niceeval/problems/") {
    return Effect.sync(() => send(
      request.response,
      200,
      renderHtml(`${hostTextPrefix}${renderReportExecutionProblemsText(execution)}`, state.current.theme),
      "text/html; charset=utf-8",
      headers,
    ));
  }
  const download = downloadForPath(url.pathname, execution);
  if (download !== undefined) {
    return Effect.sync(() => send(
      request.response,
      200,
      download.bytes,
      downloadContentType(download.mediaType),
      {
        ...headers,
        "content-disposition": "attachment",
        "x-content-type-options": "nosniff",
      },
    ));
  }
  const canonical = canonicalPagePath(url.pathname);
  if (
    canonical !== undefined &&
    canonical !== url.pathname &&
    pageForPath(canonical, execution) !== "missing"
  ) {
    return Effect.sync(() => redirect(request.response, canonical, headers));
  }
  const page = pageForPath(url.pathname, execution);
  if (page === "missing") {
    return Effect.sync(() => sendText(
      request.response,
      404,
      url.pathname.startsWith("/downloads/") ? "download not found" : "page not found",
      headers,
    ));
  }
  const current = page === "fallback" ? reportFallbackPage(execution) : page;
  const requestedRevision = request.request.headers[REPORT_FRAGMENT_HEADER];
  if (requestedRevision !== undefined) {
    if (requestedRevision !== String(state.current.revision)) {
      return Effect.sync(() => send(
        request.response,
        409,
        `${JSON.stringify({ revision: state.current.revision })}\n`,
        "application/json; charset=utf-8",
        headers,
      ));
    }
    // One payload serves both progressive-enhancement consumers: the
    // locale switch applies the full navigation of the requested locale
    // (and the current document when the live URL is a direct/family
    // page), and the dialog click applies the requested page's
    // title/html. Everything comes from the same execution inside the
    // current closure; nothing re-reads the Record.
    return Effect.sync(() => send(
      request.response,
      200,
      `${JSON.stringify(renderReportLocaleSwitchPayload({
        revision: state.current.revision,
        locale: execution.locale,
        title: current.document.title,
        navigation: liveNavigation(execution),
        currentRoute: current.route,
        currentDocument: current.document,
      }))}\n`,
      "application/json; charset=utf-8",
      headers,
    ));
  }
  return Effect.sync(() => send(
    request.response,
    200,
    renderReportLiveHtml({
      title: current.document.title,
      locale: execution.locale,
      revision: state.current.revision,
      currentRoute: current.route,
      currentDocument: current.document,
      navigation: liveNavigation(execution),
      theme: state.current.theme,
      hostMetadata: {
        ...(state.lastProblem === undefined
          ? {}
          : { lastRebuildProblem: state.lastProblem.summary }),
      },
      // The sibling execution from the same closure lets the language
      // control switch in place without a round trip. Same URL, same
      // revision; the renderer never touches Record data.
      ...(sibling === undefined ? {} : { localeRevisions: [sibling] }),
      ...(page === "fallback" ? { forceDirectPage: true } : {}),
    }),
    "text/html; charset=utf-8",
    headers,
  ));
}

/**
 * The closure's two locales are the only language inputs. The locale header
 * drives in-place switches on the same URL and revision; anything else is
 * English.
 */
function requestLocale(
  headers: IncomingMessage["headers"],
): "en" | "zh-CN" {
  const raw = headers[REPORT_LOCALE_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === "zh-CN" ? "zh-CN" : "en";
}

/**
 * The already-rendered sibling locale revision of the live URL, so the
 * embedded language control can swap localized text without a fragment
 * round trip. A direct/family page (and every fixed page) carries its own
 * localized document; the switch never leaves the page on the previous
 * locale.
 */
function siblingLocaleRevision(
  closure: ViewRevisionClosure,
  locale: "en" | "zh-CN",
  pathname: string,
): ReportLiveLocaleRevision {
  const siblingLocale = locale === "en" ? "zh-CN" as const : "en" as const;
  const siblingExecution = closure[siblingLocale];
  const siblingPage = pageForPath(pathname, siblingExecution);
  const current = siblingPage === "fallback"
    ? reportFallbackPage(siblingExecution)
    : siblingPage === "missing"
    ? undefined
    : siblingPage;
  return Object.freeze({
    locale: siblingLocale,
    title: current?.document.title ?? "NiceEval report",
    navigation: liveNavigation(siblingExecution),
    ...(current === undefined
      ? {}
      : { currentRoute: current.route, currentDocument: current.document }),
  });
}

function liveNavigation(
  execution: ReportExecution,
): ReadonlyArray<{
  readonly pageId: string;
  readonly title: string;
  readonly route: ReportRoute;
  readonly state: "rendered" | "data-unavailable" | "execution-failed";
  readonly document?: Extract<ReportPageResult, { readonly state: "rendered" }>["document"];
}> {
  return execution.navigation
    .filter((item) => item.visible)
    .map((item) => {
      const page = execution.pages.find((candidate) =>
        candidate.pageId === item.pageId && candidate.route === item.route
      );
      if (page === undefined) {
        throw new Error("a live navigation item lost its fixed Page result");
      }
      return Object.freeze({
        pageId: item.pageId,
        title: item.title,
        route: item.route,
        state: page.state,
        ...(page.state === "rendered" ? { document: page.document } : {}),
      });
    });
}

function refreshSession<Requirements>(
  session: ReportViewSession<Requirements>,
  watches: WatchResources,
  onRebuild: ViewOptions["onRebuild"],
): Effect.Effect<void, ReportViewSessionClosed, Requirements> {
  return Effect.gen(function* () {
    const before = yield* session.snapshot;
    yield* session.refresh;
    const after = yield* session.snapshot;
    if (after.current.revision <= before.current.revision) {
      // Failure kept last-good execution and the prior recoverable watch set.
      return;
    }
    // One successful revision owns one fixed execution and one next-round watch set.
    yield* Effect.sync(() => replaceWatchInputs(watches, after.current.watchInputs));
    if (onRebuild !== undefined) {
      yield* Effect.try({
        try: () => onRebuild(new Date()),
        catch: () => undefined,
      }).pipe(Effect.ignore);
    }
  });
}

function optionWatchInputs<Requirements>(options: ViewOptions<Requirements>): readonly string[] {
  const values = options.watchInputs ?? [];
  return Object.freeze([...new Set(values.map((value) => resolve(value)))]);
}

function openWatchers(
  inputs: readonly string[],
  onChange: () => void,
): Effect.Effect<WatchResources, NodeViewServerError> {
  return Effect.try({
    try: () => {
      const resources: WatchResources = {
        current: closedWatchSet(),
        onChange,
        closed: false,
      };
      try {
        const opening = openWatchSet(resources, inputs);
        publishWatchSet(resources, opening);
        return resources;
      } catch (error) {
        closeWatchSet(resources.current);
        throw error;
      }
    },
    catch: (error): NodeViewServerError => serverError("watch", asError(error).message),
  });
}

/**
 * Atomically swaps the next-round watch set after a successful revision. Failure
 * paths never call this, so last-good entry edges remain recoverable.
 */
function replaceWatchInputs(
  resources: WatchResources,
  inputs: readonly string[],
): void {
  if (resources.closed) return;
  try {
    const opening = openWatchSet(resources, inputs);
    if (resources.closed) {
      closeWatchSet(opening);
      return;
    }
    // No Effect boundary or callback can interleave this publication: the
    // replacement is entirely synchronous after the candidate validated.
    publishWatchSet(resources, opening);
  } catch {
    // A transient directory race must not discard the previous recoverable
    // closure. The next filesystem hint retries full reconciliation.
  }
}

function closedWatchSet(): WatchSet {
  return {
    inputs: Object.freeze([]),
    watchers: new Map(),
    state: "closed",
  };
}

/**
 * Opens a whole candidate closure without touching the published set. This is
 * also the full reconciliation path for directory-tree changes: fs.watch is a
 * hint, so every event rescans all inputs before requesting a rebuild.
 */
function openWatchSet(resources: WatchResources, inputs: readonly string[]): WatchSet {
  const watchSet: WatchSet = {
    inputs: normalizeWatchInputs(inputs),
    watchers: new Map(),
    state: "opening",
  };
  try {
    synchronizeWatchSet(resources, watchSet);
    return watchSet;
  } catch (error) {
    closeWatchSet(watchSet);
    throw error;
  }
}

/** Watch the Record root and its current Run directories without a polling loop. */
function synchronizeWatchSet(resources: WatchResources, watchSet: WatchSet): void {
  for (const input of watchSet.inputs) {
    let inputIsDirectory: boolean;
    try {
      inputIsDirectory = statSync(input).isDirectory();
    } catch (error) {
      if (!isMissingPath(error)) throw error;
      // A missing config / module / Record root remains observable through its
      // parent directory. It can appear later without restarting the host.
      watchNamedInput(resources, watchSet, dirname(input), basename(input));
      continue;
    }
    if (inputIsDirectory) {
      watchDirectoryTree(resources, watchSet, input, 0);
    } else {
      watchNamedInput(resources, watchSet, dirname(input), basename(input));
    }
  }
}

function normalizeWatchInputs(inputs: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(inputs.map((input) => resolve(input)))].sort());
}

const WATCH_DIRECTORY_DEPTH_MAX = 4;

function watchDirectoryTree(
  resources: WatchResources,
  watchSet: WatchSet,
  directory: string,
  depth: number,
): void {
  try {
    watchDirectory(resources, watchSet, directory);
  } catch (error) {
    if (!isMissingPath(error)) throw error;
    watchNamedInput(resources, watchSet, dirname(directory), basename(directory));
    return;
  }
  if (depth >= WATCH_DIRECTORY_DEPTH_MAX) return;
  let entries: readonly { readonly name: string; isDirectory(): boolean }[];
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    if (!isMissingPath(error)) throw error;
    watchNamedInput(resources, watchSet, dirname(directory), basename(directory));
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      watchDirectoryTree(resources, watchSet, resolve(directory, entry.name), depth + 1);
    }
  }
}

function watchDirectory(
  resources: WatchResources,
  watchSet: WatchSet,
  directory: string,
): void {
  const key = `directory:${directory}`;
  if (watchSet.watchers.has(key)) return;
  const watcher = watch(directory, () => watchSetChanged(resources, watchSet));
  watchSet.watchers.set(key, watcher);
  watchFailure(resources, watchSet, key, watcher);
}

function watchNamedInput(
  resources: WatchResources,
  watchSet: WatchSet,
  directory: string,
  name: string,
): void {
  const key = `named:${directory}:${name}`;
  if (watchSet.watchers.has(key)) return;
  const watcher = watch(directory, (_event, filename) => {
    if (filename === null || filename.toString() === name) watchSetChanged(resources, watchSet);
  });
  watchSet.watchers.set(key, watcher);
  watchFailure(resources, watchSet, key, watcher);
}

function watchFailure(
  resources: WatchResources,
  watchSet: WatchSet,
  key: string,
  watcher: FSWatcher,
): void {
  watcher.once("error", () => {
    if (watchSet.watchers.get(key) === watcher) {
      watchSet.watchers.delete(key);
      closeWatcher(watcher);
    }
    watchSetChanged(resources, watchSet);
  });
}

function watchSetChanged(resources: WatchResources, watchSet: WatchSet): void {
  if (!isCurrentWatchSet(resources, watchSet)) return;
  // A new Run gets its own directory before its completion marker. Reconcile
  // the whole closure now so the marker change is observed as well as the
  // first incomplete rebuild. Failure leaves this complete old set active.
  replaceWatchInputs(resources, watchSet.inputs);
  if (isCurrentWatchSet(resources, resources.current)) resources.onChange();
}

function isCurrentWatchSet(resources: WatchResources, watchSet: WatchSet): boolean {
  return !resources.closed && resources.current === watchSet && watchSet.state === "active";
}

/** Publishes a fully opened candidate, then retires the old closure synchronously. */
function publishWatchSet(resources: WatchResources, opening: WatchSet): void {
  if (resources.closed) {
    closeWatchSet(opening);
    return;
  }
  const previous = resources.current;
  opening.state = "active";
  resources.current = opening;
  closeWatchSet(previous);
}

function closeWatchSet(watchSet: WatchSet): void {
  if (watchSet.state === "closed") return;
  watchSet.state = "closed";
  const watchers = [...watchSet.watchers.values()];
  watchSet.watchers.clear();
  for (const watcher of watchers) closeWatcher(watcher);
}

function closeWatcher(watcher: FSWatcher): void {
  try {
    watcher.close();
  } catch {
    // Closing is best-effort and idempotent at the Node boundary.
  }
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
    return Effect.sync(() => closeWatchSet(resources.current));
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

function pageForPath(pathname: string, execution: ReportExecution): PageLookup {
  const route = routeForOutputPath(pathname);
  if (route === undefined) return "missing";
  const page = execution.pages.find(
    (candidate): candidate is RenderedPage =>
      candidate.state === "rendered" && candidate.route === route,
  );
  if (page !== undefined) return page;
  return route === "/" ? "fallback" : "missing";
}

function canonicalPagePath(pathname: string): string | undefined {
  if (routeForOutputPath(pathname) !== undefined) return pathname;
  const direct = reportRoute(pathname);
  if (Either.isRight(direct) && direct.right !== "/") {
    return `${direct.right}/index.html`;
  }
  if (pathname.endsWith("/") && pathname.length > 1) {
    const withoutTrailingSlash = pathname.slice(0, -1);
    const parsed = reportRoute(withoutTrailingSlash);
    if (Either.isRight(parsed)) return `${parsed.right}/index.html`;
  }
  return undefined;
}

function routeForOutputPath(pathname: string): ReportRoute | undefined {
  if (pathname === "/" || pathname === "/index.html") {
    return reportRoute("/").pipe(Either.getOrUndefined);
  }
  if (!pathname.endsWith("/index.html")) return undefined;
  return reportRoute(pathname.slice(0, -"/index.html".length)).pipe(Either.getOrUndefined);
}

function downloadForPath(
  pathname: string,
  execution: ReportExecution,
): { readonly bytes: Uint8Array; readonly mediaType: string } | undefined {
  const prefix = "/downloads/";
  if (!pathname.startsWith(prefix)) return undefined;
  const path = pathname.slice(prefix.length);
  if (!isReportDownloadPath(path)) return undefined;
  for (const download of execution.downloads) {
    if (download.state !== "built") continue;
    const file = download.files.find((candidate) => candidate.path === path);
    if (file !== undefined) return file;
  }
  return undefined;
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
  body: string | Uint8Array,
  contentType: string,
  headers: Readonly<Record<string, string>>,
): void {
  if (response.destroyed) return;
  response.writeHead(status, { "content-type": contentType, ...headers });
  response.end(body);
}

function redirect(
  response: ServerResponse,
  location: string,
  headers: Readonly<Record<string, string>>,
): void {
  if (response.destroyed) return;
  response.writeHead(308, { location, ...headers });
  response.end();
}

const SAFE_MEDIA_TYPE = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+\/[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;

function downloadContentType(mediaType: string): string {
  return SAFE_MEDIA_TYPE.test(mediaType) ? mediaType : "application/octet-stream";
}

function viewUrls(host: string, port: number): readonly string[] {
  if (host === "0.0.0.0") {
    return urlsForAddresses([
      "127.0.0.1",
      ...interfaceAddresses("IPv4"),
    ], port);
  }
  if (host === "::") {
    return urlsForAddresses([
      "::1",
      ...interfaceAddresses("IPv6"),
    ], port);
  }
  return Object.freeze([viewUrl(host, port)]);
}

function interfaceAddresses(family: "IPv4" | "IPv6"): readonly string[] {
  const addresses: string[] = [];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (
        entry.family === family &&
        !entry.internal &&
        !entry.address.includes("%") &&
        (family !== "IPv6" || entry.scopeid === 0)
      ) {
        addresses.push(entry.address);
      }
    }
  }
  return addresses.sort((left, right) => left.localeCompare(right));
}

function urlsForAddresses(addresses: readonly string[], port: number): readonly string[] {
  return Object.freeze([...new Set(addresses)].map((address) => viewUrl(address, port)));
}

function viewUrl(host: string, port: number): string {
  return new URL(`http://${formatHost(host)}:${port}/`).toString();
}

function requestAuthority(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  try {
    const url = new URL(`http://${value}`);
    if (url.username.length > 0 || url.password.length > 0) return undefined;
    return url.host;
  } catch {
    return undefined;
  }
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

function isMissingPath(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = Reflect.get(error, "code");
  return code === "ENOENT" || code === "ENOTDIR";
}
