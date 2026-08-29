import { randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { extname, resolve, sep } from "node:path";
import { Effect, Result, Schema } from "effect";
import type * as Scope from "effect/Scope";

import { inspectViewGeneration } from "./inspection-host.ts";
import {
  VIEW_HTTP_BODY_LIMIT,
  decodeGenerationCommitRequest,
  decodeViewInspectionRequest,
  type ViewGenerationDescriptor,
  type ViewHttpErrorDocument,
} from "./http-protocol.ts";
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
  candidate?: ViewGeneration;
  readonly leases: Map<string, number>;
  readonly retired: Set<string>;
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
  activeRequests: number;
  readonly drained: Set<() => void>;
}

const SESSION_COOKIE = "niceeval_view_session";
const CONTENT_SECURITY_POLICY = "default-src 'none'; script-src 'self'; connect-src 'self'; style-src-elem 'self' 'sha256-nzTgYzXYDNe6BAHiiI7NNlfK8n/auuOAhh2t92YvuXo='; style-src-attr 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'";
const COMMON_HEADERS = Object.freeze({
  "cache-control": "private, no-store",
  pragma: "no-cache",
  "content-security-policy": CONTENT_SECURITY_POLICY,
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
});
const BOOTSTRAP_HTML = "<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"referrer\" content=\"no-referrer\"><title>Opening NiceEval view</title><script src=\"/_niceeval/bootstrap.js\" defer></script></head><body><main role=\"status\">Opening NiceEval view…</main></body></html>";
const BOOTSTRAP_SCRIPT = "(()=>{const credential=location.hash.slice(1);history.replaceState(null,\"\",location.pathname+location.search);fetch(\"/_niceeval/session\",{method:\"POST\",credentials:\"same-origin\",headers:{\"content-type\":\"application/json\"},body:JSON.stringify({credential})}).then(response=>{if(!response.ok)throw new Error(\"unauthorized\");location.reload()}).catch(()=>{document.body.textContent=\"NiceEval view authorization failed\"})})()";
const SessionRequestSchema = Schema.Struct({ credential: Schema.String });

/** Scope-owned, loopback-only transport for Vite assets and a validated Record generation. */
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
        if (resources.closed) {
          void retireGeneration(resources, generation);
          return;
        }
        if (generation.generationId === resources.state.current.generationId ||
          generation.generationId === resources.state.candidate?.generationId) return;
        if (generation.sourceCutoffIdentity === resources.state.current.sourceCutoffIdentity) {
          if (resources.state.candidate !== undefined) retireCandidate(resources, resources.state.candidate);
          resources.state.candidate = undefined;
          void retireGeneration(resources, generation);
          return;
        }
        if (resources.state.candidate !== undefined) retireCandidate(resources, resources.state.candidate);
        resources.state.leases.set(generation.generationId, 0);
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
    state: { current: initial, leases: new Map([[initial.generationId, 0]]), retired: new Set() },
    refreshEnabled,
    credentialConsumed: false,
    closed: false,
    activeRequests: 0,
    drained: new Set(),
  };
  resources.server = createServer((request, response) => {
    resources.activeRequests += 1;
    response.once("close", () => {
      resources.activeRequests -= 1;
      if (resources.activeRequests === 0) {
        for (const resolve of resources.drained) resolve();
        resources.drained.clear();
      }
    });
    serveRequest(resources, request, response);
  });
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
  if (url.pathname === "/_niceeval/generation") {
    if (request.method !== "GET") return methodNotAllowed(response, "GET");
    sendJson(response, 200, descriptor(resources, resources.state.current));
    return;
  }
  if (url.pathname === "/_niceeval/generation/refresh") {
    if (request.method !== "POST") return methodNotAllowed(response, "POST");
    sendJson(response, 200, descriptor(resources, resources.state.candidate ?? resources.state.current));
    return;
  }
  if (url.pathname === "/_niceeval/generation/commit") {
    if (request.method !== "POST") return methodNotAllowed(response, "POST");
    if (!exactJson(request, response)) return;
    void serveCommit(resources, request, response);
    return;
  }
  if (url.pathname === "/_niceeval/inspection") {
    if (request.method !== "POST") return methodNotAllowed(response, "POST");
    if (!exactJson(request, response)) return;
    void serveInspection(resources, request, response);
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

function descriptor(resources: ServerResources, generation: ViewGeneration): ViewGenerationDescriptor {
  return Object.freeze({
    generationId: generation.generationId,
    sourceCutoffIdentity: generation.sourceCutoffIdentity,
    refreshSupported: resources.refreshEnabled,
    stale: generation.generationId === resources.state.current.generationId && resources.state.candidate !== undefined,
  });
}

async function serveCommit(resources: ServerResources, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const body = await readJsonBody(request);
  if (!body.ok) return sendJson(response, body.status, body.error);
  const decoded = decodeGenerationCommitRequest(body.value);
  if (Result.isFailure(decoded)) return sendJson(response, 400, requestInvalid(decoded.failure));
  const candidate = resources.state.candidate;
  if (candidate === undefined || candidate.generationId !== decoded.success.generationId) {
    return sendJson(response, 409, generationError("view-generation-stale", "The requested candidate is no longer available."));
  }
  const retired = resources.state.current;
  resources.state.current = candidate;
  resources.state.candidate = undefined;
  resources.state.leases.set(candidate.generationId, resources.state.leases.get(candidate.generationId) ?? 0);
  retireIfDrained(resources, retired);
  sendJson(response, 200, descriptor(resources, candidate));
}

async function serveInspection(resources: ServerResources, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const body = await readJsonBody(request);
  if (!body.ok) return sendJson(response, body.status, body.error);
  const decoded = decodeViewInspectionRequest(body.value);
  if (Result.isFailure(decoded)) return sendJson(response, 400, requestInvalid(decoded.failure));
  const generation = findGeneration(resources, decoded.success.generationId);
  if (generation === undefined) return sendJson(response, 404, generationError("view-generation-not-found", "The requested generation is not available."));
  acquireLease(resources, generation);
  try {
    const document = await inspectViewGeneration(generation, decoded.success.request);
    sendJson(response, 200, document);
  } catch {
    sendJson(response, 500, Object.freeze({
      code: "view-inspection-failed", reason: "Inspection could not be completed for this generation.", correction: "retry",
    } satisfies ViewHttpErrorDocument));
  } finally {
    releaseLease(resources, generation);
  }
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
    let value: unknown;
    try {
      value = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    } catch {
      sendText(response, 400, "credential request is invalid");
      return;
    }
    const decoded = Schema.decodeUnknownResult(SessionRequestSchema, { onExcessProperty: "error" })(value);
    if (Result.isFailure(decoded)) {
      sendText(response, 400, "credential request is invalid");
      return;
    }
    if (resources.credentialConsumed || !safeEqual(decoded.success.credential, resources.credential)) {
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
  return Effect.callback((resume) => {
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
    return Effect.callback<void>((resume) => {
      // `listening` is still false during the small bind-in-flight window.
      // Calling close unconditionally also cancels that pending listener; an
      // ERR_SERVER_NOT_RUNNING callback is an already-closed success here.
      let finishing = false;
      const finish = (): void => {
        if (finishing) return;
        finishing = true;
        const retirements = [retireGeneration(resources, resources.state.current)];
        if (resources.state.candidate !== undefined) {
          retirements.push(retireGeneration(resources, resources.state.candidate));
        }
        void Promise.all(retirements).finally(() => {
          for (const socket of resources.sockets) socket.destroy();
          resume(Effect.void);
        });
      };
      try { resources.server.close(() => {
        if (resources.activeRequests === 0) finish();
        else resources.drained.add(finish);
      }); }
      catch { finish(); }
      resources.server.closeIdleConnections();
      // The browser may keep a polling connection alive while the CLI is
      // shutting down. Stop transport immediately; generation leases still
      // drain through each request's `finally` before retirement.
      resources.server.closeAllConnections();
      return Effect.void;
    });
  });
}

function findGeneration(resources: ServerResources, id: string): ViewGeneration | undefined {
  if (resources.state.current.generationId === id) return resources.state.current;
  if (resources.state.candidate?.generationId === id) return resources.state.candidate;
  return undefined;
}

function acquireLease(resources: ServerResources, generation: ViewGeneration): void {
  resources.state.leases.set(generation.generationId, (resources.state.leases.get(generation.generationId) ?? 0) + 1);
}

function releaseLease(resources: ServerResources, generation: ViewGeneration): void {
  const remaining = Math.max(0, (resources.state.leases.get(generation.generationId) ?? 1) - 1);
  resources.state.leases.set(generation.generationId, remaining);
  retireIfDrained(resources, generation);
}

function retireIfDrained(resources: ServerResources, generation: ViewGeneration): void {
  if (generation.generationId !== resources.state.current.generationId &&
    generation.generationId !== resources.state.candidate?.generationId &&
    resources.state.leases.get(generation.generationId) === 0) {
    resources.state.leases.delete(generation.generationId);
    void retireGeneration(resources, generation);
  }
}

function retireCandidate(resources: ServerResources, generation: ViewGeneration): void {
  if ((resources.state.leases.get(generation.generationId) ?? 0) === 0) {
    resources.state.leases.delete(generation.generationId);
    void retireGeneration(resources, generation);
  }
}

function retireGeneration(resources: ServerResources, generation: ViewGeneration): Promise<void> {
  if (resources.state.retired.has(generation.generationId)) return Promise.resolve();
  resources.state.retired.add(generation.generationId);
  return generation.retire().catch(() => undefined);
}

function exactJson(request: IncomingMessage, response: ServerResponse): boolean {
  if (request.headers["content-type"] === "application/json") return true;
  sendJson(response, 415, requestInvalid("Content-Type must be exactly application/json."));
  return false;
}

type JsonBody = { readonly ok: true; readonly value: unknown } | {
  readonly ok: false; readonly status: number; readonly error: ViewHttpErrorDocument;
};

function readJsonBody(request: IncomingMessage): Promise<JsonBody> {
  return new Promise((resolveBody) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const finish = (value: JsonBody): void => {
      if (settled) return;
      settled = true;
      resolveBody(value);
    };
    request.on("data", (chunk: Buffer) => {
      size += chunk.byteLength;
      if (size > VIEW_HTTP_BODY_LIMIT) finish({ ok: false, status: 413, error: requestInvalid("JSON body exceeds 64 KiB.") });
      else chunks.push(chunk);
    });
    request.once("end", () => {
      if (settled) return;
      try { finish({ ok: true, value: JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown }); }
      catch { finish({ ok: false, status: 400, error: requestInvalid("Body must be valid JSON.") }); }
    });
    request.once("error", () => finish({ ok: false, status: 400, error: requestInvalid("Request body could not be read.") }));
  });
}

function requestInvalid(reason: string): ViewHttpErrorDocument {
  return Object.freeze({ code: "view-request-invalid", reason: sanitizeReason(reason), correction: "fix-request" });
}

function generationError(code: "view-generation-not-found" | "view-generation-stale", reason: string): ViewHttpErrorDocument {
  return Object.freeze({ code, reason, correction: "refresh-generation" });
}

function sanitizeReason(reason: string): string {
  return reason.replace(/[\u0000-\u001f\u007f-\u009f]/gu, " ").slice(0, 512);
}

function methodNotAllowed(response: ServerResponse, allow: string): void {
  sendText(response, 405, "method not allowed", { allow });
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  send(response, status, JSON.stringify(value), "application/json");
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
