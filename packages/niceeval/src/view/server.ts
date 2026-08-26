import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { Effect } from "effect";
import type * as Scope from "effect/Scope";

import { viewRevisionData, type ViewFile, type ViewRevision } from "./revision.ts";

export interface ViewServerError {
  readonly code: "view-server-failed";
  readonly operation: "listen" | "close";
  readonly reason: string;
}

export interface FixedViewServer {
  readonly origin: string;
  readonly readyUrl: string;
  readonly publishCandidate: (revision: ViewRevision) => void;
  readonly close: Effect.Effect<void>;
}

interface ServerState {
  current: ViewRevision;
  activeNumber: number;
  candidate?: ViewRevision;
}

interface ServerResources {
  server: Server;
  readonly sockets: Set<Socket>;
  readonly credential: string;
  readonly session: string;
  readonly state: ServerState;
  readonly refreshEnabled: boolean;
  authority?: string;
  origin?: string;
  credentialConsumed: boolean;
  closed: boolean;
}

const SESSION_COOKIE = "niceeval_view_session";
const NO_STORE = Object.freeze({
  "cache-control": "no-store",
  pragma: "no-cache",
  "x-content-type-options": "nosniff",
});

/** Scope-owned, loopback-only transport for a byte-complete first-party View revision. */
export function openFixedView(input: {
  readonly initial: ViewRevision;
  readonly port: number;
  readonly refreshEnabled?: boolean;
}): Effect.Effect<FixedViewServer, ViewServerError, Scope.Scope> {
  return Effect.gen(function* () {
    const resources = yield* Effect.acquireRelease(
      Effect.sync(() => makeResources(input.initial, input.refreshEnabled === true)),
      closeResources,
    );
    const port = yield* listen(resources.server, input.port);
    resources.authority = `127.0.0.1:${port}`;
    resources.origin = `http://${resources.authority}`;
    return Object.freeze({
      origin: resources.origin,
      readyUrl: `${resources.origin}/#${resources.credential}`,
      publishCandidate: (revision: ViewRevision): void => {
        if (resources.closed) return;
        if (viewRevisionData(revision).identity.sourceCutoffIdentity ===
          viewRevisionData(resources.state.current).identity.sourceCutoffIdentity) {
          resources.state.candidate = undefined;
          return;
        }
        resources.state.candidate = revision;
      },
      close: closeResources(resources),
    });
  });
}

function makeResources(initial: ViewRevision, refreshEnabled: boolean): ServerResources {
  const sockets = new Set<Socket>();
  const resources: ServerResources = {
    server: undefined as unknown as Server,
    sockets,
    credential: randomBytes(32).toString("base64url"),
    session: randomBytes(32).toString("base64url"),
    state: { current: initial, activeNumber: 1 },
    refreshEnabled,
    credentialConsumed: false,
    closed: false,
  };
  resources.server = createServer((request, response) => serveRequest(resources, request, response));
  resources.server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  return resources;
}

function serveRequest(resources: ServerResources, request: IncomingMessage, response: ServerResponse): void {
  if (resources.closed || resources.authority === undefined || resources.origin === undefined) {
    sendText(response, 503, "view is not ready");
    return;
  }
  if (request.headers.host !== resources.authority) {
    sendText(response, 403, "view host is not authorized");
    return;
  }
  const url = requestUrl(request);
  if (url === undefined) {
    sendText(response, 400, "bad request");
    return;
  }
  if (url.pathname === "/_niceeval/session") {
    exchangeCredential(resources, request, response);
    return;
  }
  if (!authorizedSession(resources, request)) {
    if (request.method === "GET" && url.pathname === "/") sendBootstrap(response);
    else sendText(response, 401, "view session is required");
    return;
  }
  if (!sameOrigin(resources, request)) {
    sendText(response, 403, "view origin is not authorized");
    return;
  }
  const file = fileForPath(url.pathname, resources.state.current);
  if (request.method === "POST" && request.headers["x-niceeval-view-action"] === "refresh") {
    serveRevisionRefresh(resources, file, response);
    return;
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    sendText(response, 405, "method not allowed", { allow: "GET, HEAD" });
    return;
  }
  if (file === undefined) {
    sendText(response, 404, "page not found");
    return;
  }
  send(
    response,
    200,
    request.method === "HEAD" ? new Uint8Array() : file.bytes,
    safeContentType(file.mediaType),
    viewHeaders(resources, file.path),
  );
}

function serveRevisionRefresh(resources: ServerResources, file: ViewFile | undefined, response: ServerResponse): void {
  if (!resources.refreshEnabled || file === undefined || !isRefreshPageData(file.path)) {
    sendText(response, 404, "view refresh is not available");
    return;
  }
  if (resources.state.candidate !== undefined) {
    if (viewRevisionData(resources.state.candidate).files.every((candidate) => candidate.path !== file.path)) {
      sendText(response, 409, "view refresh page is not present in the candidate");
      return;
    }
    resources.state.current = resources.state.candidate;
    resources.state.candidate = undefined;
    resources.state.activeNumber += 1;
  }
  send(response, 204, new Uint8Array(), "text/plain; charset=utf-8", viewHeaders(resources, file.path));
}

function viewHeaders(resources: ServerResources, filePath?: string): Readonly<Record<string, string>> {
  return Object.freeze({
    "x-niceeval-view-revision": String(resources.state.activeNumber),
    "x-niceeval-view-content-hash": viewRevisionData(resources.state.current).identity.contentHash,
    ...(resources.refreshEnabled && filePath !== undefined && isRefreshPageData(filePath)
      ? {
          "x-niceeval-view-refresh": "supported",
          "x-niceeval-view-stale": resources.state.candidate === undefined ? "0" : "1",
        }
      : {}),
  });
}

function isRefreshPageData(path: string): boolean {
  return path === "index.view.json" || path === "overview/page.view.json";
}

function exchangeCredential(resources: ServerResources, request: IncomingMessage, response: ServerResponse): void {
  if (request.method !== "POST") {
    sendText(response, 405, "method not allowed", { allow: "POST" });
    return;
  }
  if (!sameOrigin(resources, request, true)) {
    sendText(response, 403, "view origin is not authorized");
    return;
  }
  let bytes = 0;
  const chunks: Buffer[] = [];
  request.on("data", (chunk: Buffer) => {
    bytes += chunk.byteLength;
    if (bytes > 1_024) request.destroy();
    else chunks.push(chunk);
  });
  request.once("end", () => {
    if (bytes > 1_024) return;
    let credential: unknown;
    try {
      credential = Reflect.get(JSON.parse(Buffer.concat(chunks).toString("utf8")) as object, "credential");
    } catch {
      sendText(response, 400, "credential request is invalid");
      return;
    }
    if (resources.credentialConsumed || typeof credential !== "string" || !safeEqual(credential, resources.credential)) {
      sendText(response, 401, "credential is invalid or already used");
      return;
    }
    resources.credentialConsumed = true;
    send(response, 204, new Uint8Array(), "text/plain; charset=utf-8", {
      "set-cookie": `${SESSION_COOKIE}=${resources.session}; Path=/; HttpOnly; SameSite=Strict`,
    });
  });
  request.once("error", () => {
    if (!response.headersSent) sendText(response, 400, "credential request failed");
  });
}

function sendBootstrap(response: ServerResponse): void {
  const nonce = randomBytes(18).toString("base64url");
  const body = `<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"></head><body><main role="status">Opening NiceEval view…</main><script nonce="${nonce}">(()=>{const credential=location.hash.slice(1);history.replaceState(null,"",location.pathname+location.search);fetch("/_niceeval/session",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify({credential})}).then(response=>{if(!response.ok)throw new Error("unauthorized");location.reload()}).catch(()=>{document.body.textContent="NiceEval view authorization failed"})})()</script></body></html>`;
  send(response, 200, body, "text/html; charset=utf-8", {
    "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'`,
    "referrer-policy": "no-referrer",
  });
}

function authorizedSession(resources: ServerResources, request: IncomingMessage): boolean {
  const session = cookieValue(request.headers.cookie, SESSION_COOKIE);
  return session !== undefined && safeEqual(session, resources.session);
}

function sameOrigin(resources: ServerResources, request: IncomingMessage, required = false): boolean {
  const origin = request.headers.origin;
  if (origin !== undefined) return origin === resources.origin;
  if (required) return false;
  const fetchSite = request.headers["sec-fetch-site"];
  return fetchSite === undefined || fetchSite === "same-origin" || fetchSite === "none";
}

function fileForPath(pathname: string, revision: ViewRevision): ViewFile | undefined {
  if (!pathname.startsWith("/") || pathname.includes("%") || pathname.includes("\\")) return undefined;
  const relative = pathname.slice(1);
  const path = relative.length === 0 ? "index.html" : relative.endsWith("/") ? `${relative}index.html` : relative;
  return viewRevisionData(revision).files.find((file) => file.path === path);
}

function requestUrl(request: IncomingMessage): URL | undefined {
  try { return new URL(request.url ?? "/", "http://127.0.0.1"); } catch { return undefined; }
}

function cookieValue(header: string | undefined, name: string): string | undefined {
  if (header === undefined) return undefined;
  for (const entry of header.split(";")) {
    const [candidate, ...value] = entry.trim().split("=");
    if (candidate === name) return value.join("=");
  }
  return undefined;
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.byteLength === rightBytes.byteLength && timingSafeEqual(leftBytes, rightBytes);
}

function listen(server: Server, port: number): Effect.Effect<number, ViewServerError> {
  return Effect.async((resume) => {
    const cleanup = (): void => {
      server.off("error", onError);
      server.off("listening", onListening);
    };
    const onError = (cause: Error): void => {
      cleanup();
      resume(Effect.fail(viewError("listen", cause.message)));
    };
    const onListening = (): void => {
      cleanup();
      const address = server.address();
      resume(address === null || typeof address === "string"
        ? Effect.fail(viewError("listen", "server did not expose a TCP port"))
        : Effect.succeed(address.port));
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
    return Effect.sync(cleanup);
  });
}

function closeResources(resources: ServerResources): Effect.Effect<void> {
  return Effect.suspend(() => {
    if (resources.closed) return Effect.void;
    resources.closed = true;
    for (const socket of resources.sockets) socket.destroy();
    return Effect.async((resume) => {
      if (!resources.server.listening) {
        resume(Effect.void);
        return Effect.void;
      }
      resources.server.close(() => resume(Effect.void));
      return Effect.void;
    });
  });
}

function sendText(response: ServerResponse, status: number, body: string, headers: Readonly<Record<string, string>> = {}): void {
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
  response.writeHead(status, { "content-type": contentType, ...NO_STORE, ...headers });
  response.end(body);
}

const SAFE_MEDIA_TYPE = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+\/[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;

function safeContentType(mediaType: string): string {
  const base = mediaType.split(";", 1)[0]?.trim() ?? "";
  return SAFE_MEDIA_TYPE.test(base) ? base : "application/octet-stream";
}

function viewError(operation: ViewServerError["operation"], reason: string): ViewServerError {
  return Object.freeze({ code: "view-server-failed" as const, operation, reason });
}
