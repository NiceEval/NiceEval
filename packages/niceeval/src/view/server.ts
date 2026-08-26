import { randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { extname, resolve, sep } from "node:path";
import { Effect } from "effect";
import type * as Scope from "effect/Scope";

import type { ViewGeneration } from "./revision.ts";

export interface ViewServerError {
  readonly code: "view-server-failed";
  readonly operation: "listen" | "close";
  readonly reason: string;
}

export interface ViewServer {
  readonly origin: string;
  readonly readyUrl: string;
  readonly publishCandidate: (generation: ViewGeneration) => void;
  readonly close: Effect.Effect<void>;
}

interface ServerState {
  current: ViewGeneration;
  activeNumber: number;
  candidate?: ViewGeneration;
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
const CONTENT_SECURITY_POLICY = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'; style-src 'self'; base-uri 'none'; frame-ancestors 'none'";
const COMMON_HEADERS = Object.freeze({
  "cache-control": "private, no-store",
  pragma: "no-cache",
  "content-security-policy": CONTENT_SECURITY_POLICY,
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
});
const BOOTSTRAP_HTML = "<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"referrer\" content=\"no-referrer\"><title>Opening NiceEval view</title><script src=\"/_niceeval/bootstrap.js\" defer></script></head><body><main role=\"status\">Opening NiceEval view…</main></body></html>";
const BOOTSTRAP_SCRIPT = "(()=>{const credential=location.hash.slice(1);history.replaceState(null,\"\",location.pathname+location.search);fetch(\"/_niceeval/session\",{method:\"POST\",credentials:\"same-origin\",headers:{\"content-type\":\"application/json\"},body:JSON.stringify({credential})}).then(response=>{if(!response.ok)throw new Error(\"unauthorized\");location.reload()}).catch(()=>{document.body.textContent=\"NiceEval view authorization failed\"})})()";

/** Scope-owned, loopback-only transport for Vite assets and a complete RecordSnapshot. */
export function openViewServer(input: {
  readonly initial: ViewGeneration;
  readonly port: number;
  readonly refreshEnabled?: boolean;
  readonly initialRunIds: readonly string[];
}): Effect.Effect<ViewServer, ViewServerError, Scope.Scope> {
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
      readyUrl: viewEntryUrl(resources.origin, resources.credential, input.initialRunIds),
      publishCandidate: (generation: ViewGeneration): void => {
        if (resources.closed) return;
        if (generation.sourceCutoffIdentity === resources.state.current.sourceCutoffIdentity) {
          resources.state.candidate = undefined;
          return;
        }
        resources.state.candidate = generation;
      },
      close: closeResources(resources),
    });
  });
}

function viewEntryUrl(origin: string, credential: string, runIds: readonly string[]): string {
  const url = new URL("/", origin);
  for (const runId of runIds) url.searchParams.append("run", runId);
  url.hash = credential;
  return url.href;
}

function makeResources(initial: ViewGeneration, refreshEnabled: boolean): ServerResources {
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
    if ((request.method === "GET" || request.method === "HEAD") && url.pathname === "/") {
      send(response, 200, request.method === "HEAD" ? "" : BOOTSTRAP_HTML, "text/html; charset=utf-8");
    } else if ((request.method === "GET" || request.method === "HEAD") && url.pathname === "/_niceeval/bootstrap.js") {
      send(response, 200, request.method === "HEAD" ? "" : BOOTSTRAP_SCRIPT, "text/javascript; charset=utf-8", {
        "content-length": String(Buffer.byteLength(BOOTSTRAP_SCRIPT)),
      });
    } else {
      sendText(response, 401, "view session is required");
    }
    return;
  }
  if (!sameOrigin(resources, request)) {
    sendText(response, 403, "view origin is not authorized");
    return;
  }
  if (url.pathname === "/record.sqlite") {
    if (request.method === "POST") {
      serveRefresh(resources, request, response);
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      sendText(response, 405, "method not allowed", { allow: "GET, HEAD, POST" });
      return;
    }
    serveRecordSnapshot(resources, request, response);
    return;
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    sendText(response, 405, "method not allowed", { allow: "GET, HEAD" });
    return;
  }
  void serveAsset(resources.state.current, url.pathname, request, response).catch((cause: unknown) => {
    if (!response.headersSent) sendText(response, 500, cause instanceof Error ? cause.message : "view asset failed");
    else response.destroy(cause instanceof Error ? cause : undefined);
  });
}

function serveRecordSnapshot(resources: ServerResources, request: IncomingMessage, response: ServerResponse): void {
  // Capture exactly one immutable generation before writing any headers. A
  // concurrent refresh only changes later requests; this stream keeps its file.
  const generation = resources.state.current;
  const data = generation;
  const headers = recordHeaders(resources, generation);
  response.writeHead(200, { "content-type": "application/x-sqlite3", ...COMMON_HEADERS, ...headers });
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  const stream = createReadStream(data.snapshotPath);
  stream.once("error", (cause) => response.destroy(cause));
  stream.pipe(response);
}

function serveRefresh(resources: ServerResources, request: IncomingMessage, response: ServerResponse): void {
  if (!resources.refreshEnabled || request.headers["x-niceeval-view-action"] !== "refresh") {
    sendText(response, 404, "view refresh is not available");
    return;
  }
  if (resources.state.candidate !== undefined) {
    resources.state.current = resources.state.candidate;
    resources.state.candidate = undefined;
    resources.state.activeNumber += 1;
  }
  send(response, 204, "", "text/plain; charset=utf-8", {
    ...recordHeaders(resources, resources.state.current),
    "content-length": "0",
  });
}

function recordHeaders(resources: ServerResources, generation: ViewGeneration): Readonly<Record<string, string>> {
  const data = generation;
  return Object.freeze({
    "content-length": String(data.snapshotByteLength),
    etag: `\"sha256-${data.contentHash}\"`,
    "x-niceeval-view-revision": String(resources.state.activeNumber),
    "x-niceeval-view-content-hash": data.contentHash,
    ...(resources.refreshEnabled
      ? {
          "x-niceeval-view-refresh": "supported",
          "x-niceeval-view-stale": resources.state.candidate === undefined ? "0" : "1",
        }
      : {}),
  });
}

async function serveAsset(
  generation: ViewGeneration,
  pathname: string,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const data = generation;
  const file = await assetFile(data.appRoot, pathname, request.headers.accept);
  if (file === undefined) {
    sendText(response, 404, "page not found");
    return;
  }
  response.writeHead(200, {
    "content-type": mediaType(file.path),
    "content-length": String(file.size),
    ...COMMON_HEADERS,
  });
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  const stream = createReadStream(file.path);
  stream.once("error", (cause) => response.destroy(cause));
  stream.pipe(response);
}

async function assetFile(
  appRoot: string,
  pathname: string,
  accept: string | undefined,
): Promise<{ readonly path: string; readonly size: number } | undefined> {
  const relative = safeRelativePath(pathname);
  if (relative === undefined) return undefined;
  const exact = relative.length === 0 ? "index.html" : relative;
  const found = await regularAsset(appRoot, exact);
  if (found !== undefined) return found;
  if (accept?.includes("text/html") !== true || exact.startsWith("assets/") || extname(exact) !== "") return undefined;
  return regularAsset(appRoot, "index.html");
}

function safeRelativePath(pathname: string): string | undefined {
  let decoded: string;
  try { decoded = decodeURIComponent(pathname); } catch { return undefined; }
  if (!decoded.startsWith("/") || decoded.includes("\\") || decoded.includes("\u0000")) return undefined;
  const relative = decoded.slice(1);
  if (relative.split("/").some((segment) => segment === "." || segment === "..")) return undefined;
  return relative;
}

async function regularAsset(
  appRoot: string,
  relative: string,
): Promise<{ readonly path: string; readonly size: number } | undefined> {
  const root = resolve(appRoot);
  const path = resolve(root, relative);
  if (!path.startsWith(`${root}${sep}`)) return undefined;
  try {
    const metadata = await lstat(path);
    return metadata.isFile() && !metadata.isSymbolicLink()
      ? Object.freeze({ path, size: metadata.size })
      : undefined;
  } catch (cause) {
    if (typeof cause === "object" && cause !== null && Reflect.get(cause, "code") === "ENOENT") return undefined;
    throw cause;
  }
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
    send(response, 204, "", "text/plain; charset=utf-8", {
      "set-cookie": `${SESSION_COOKIE}=${resources.session}; Path=/; HttpOnly; SameSite=Strict`,
    });
  });
  request.once("error", () => {
    if (!response.headersSent) sendText(response, 400, "credential request failed");
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
      // `listening` is still false during the small bind-in-flight window.
      // Calling close unconditionally also cancels that pending listener; an
      // ERR_SERVER_NOT_RUNNING callback is an already-closed success here.
      try { resources.server.close(() => resume(Effect.void)); }
      catch { resume(Effect.void); }
      return Effect.void;
    });
  });
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
  headers: Readonly<Record<string, string>> = {},
): void {
  if (response.destroyed) return;
  response.writeHead(status, {
    "content-type": contentType,
    "content-length": String(typeof body === "string" ? Buffer.byteLength(body) : body.byteLength),
    ...COMMON_HEADERS,
    ...headers,
  });
  response.end(body);
}

function mediaType(path: string): string {
  switch (extname(path).toLowerCase()) {
    case ".html": return "text/html; charset=utf-8";
    case ".css": return "text/css; charset=utf-8";
    case ".js": case ".mjs": return "text/javascript; charset=utf-8";
    case ".wasm": return "application/wasm";
    case ".json": return "application/json; charset=utf-8";
    case ".svg": return "image/svg+xml";
    case ".png": return "image/png";
    case ".jpg": case ".jpeg": return "image/jpeg";
    case ".webp": return "image/webp";
    case ".ico": return "image/x-icon";
    case ".woff2": return "font/woff2";
    default: return "application/octet-stream";
  }
}

function viewError(operation: ViewServerError["operation"], reason: string): ViewServerError {
  return Object.freeze({ code: "view-server-failed" as const, operation, reason });
}
