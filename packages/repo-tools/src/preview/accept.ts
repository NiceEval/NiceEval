import { Effect, Predicate, Schema } from "effect";

import {
  NETLIFY_SITE_ID,
  type PreviewAcceptanceInput,
  PreviewAcceptanceInputSchema,
  type PreviewAcceptanceReceipt,
  type PreviewFile,
  PreviewHttpError,
  PreviewInputError,
  PreviewVerificationError,
} from "./model.js";
import { closureDigest } from "./build.js";
import { createHash } from "node:crypto";
import { extname } from "node:path";
import { QUERY_PROTOCOL } from "../../../niceeval/src/inspection/protocol-values.js";

const CONTENT_TYPES = new Map<string, ReadonlySet<string>>([
  [".html", new Set(["text/html"])],
  [".css", new Set(["text/css"])],
  [".js", new Set(["application/javascript", "text/javascript"])],
  [".mjs", new Set(["application/javascript", "text/javascript"])],
  [".json", new Set(["application/json"])],
  [".wasm", new Set(["application/wasm"])],
  [".svg", new Set(["image/svg+xml"])],
  [".png", new Set(["image/png"])],
  [".jpeg", new Set(["image/jpeg"])],
  [".jpg", new Set(["image/jpeg"])],
  [".gif", new Set(["image/gif"])],
  [".webp", new Set(["image/webp"])],
  [".ico", new Set(["image/x-icon", "image/vnd.microsoft.icon"])],
  [".woff", new Set(["font/woff"])],
  [".woff2", new Set(["font/woff2"])],
]);
const SECURITY_HEADERS = new Map<string, string>([
  ["content-security-policy", "default-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'; connect-src 'self'; img-src 'self' data:; style-src-elem 'self' 'sha256-nzTgYzXYDNe6BAHiiI7NNlfK8n/auuOAhh2t92YvuXo='; style-src-attr 'unsafe-inline'; script-src 'self'"],
  ["cross-origin-resource-policy", "same-origin"],
  ["permissions-policy", "camera=(), geolocation=(), microphone=(), payment=(), usb=()"],
  ["referrer-policy", "no-referrer"],
  ["x-content-type-options", "nosniff"],
  ["x-frame-options", "DENY"],
]);
const CACHE_CONTROL_DIRECTIVE = /^([!#$%&'*+\-.^_`|~0-9A-Za-z]+)(?:[ \t]*=[ \t]*([!#$%&'*+\-.^_`|~0-9A-Za-z]+))?$/u;

function decodeInput(input: unknown) {
  return Schema.decodeUnknownEffect(PreviewAcceptanceInputSchema, { errors: "all", onExcessProperty: "error" })(input).pipe(
    Effect.mapError((error) => new PreviewInputError({ message: String(error) })),
  );
}

function fail(subject: string, message: string) {
  return Effect.fail(new PreviewVerificationError({ subject, message }));
}

function validateMetadata(input: PreviewAcceptanceInput) {
  return Effect.gen(function*() {
    const platform = input.buildReceipt.platform;
    if (platform.mode !== "netlify") return yield* fail("build platform", "a local build receipt cannot be remotely accepted");
    const deploy = input.deploy;
    if (deploy.state !== "ready") return yield* fail("deploy state", `expected ready, received ${deploy.state}`);
    if (deploy.id !== platform.deployId) return yield* fail("deploy id", "deploy metadata does not match the build receipt");
    if (deploy.siteId !== NETLIFY_SITE_ID || deploy.siteId !== platform.siteId) return yield* fail("site id", "deploy metadata does not match the fixed site");
    if (deploy.commitRef !== platform.commitRef) return yield* fail("commit ref", "deploy metadata does not match the build receipt");
    if (deploy.context !== platform.context) return yield* fail("deploy context", "deploy metadata does not match the build receipt");
    if (deploy.deployUrl !== platform.deployUrl) return yield* fail("deploy URL", "deploy metadata does not match the build receipt");
    if (deploy.deployPrimeUrl !== platform.deployPrimeUrl) return yield* fail("prime URL", "deploy metadata does not match the build receipt");
    if (deploy.immutableUrl !== platform.deployUrl) return yield* fail("immutable URL", "immutable URL must be the receipt's deploy URL");
    if (platform.kind === "pull-request") {
      if (deploy.reviewId !== platform.reviewId) return yield* fail("review id", "deploy metadata does not match the pull request receipt");
    } else if (deploy.reviewId !== undefined && deploy.reviewId !== "") {
      return yield* fail("review id", "production deploy metadata must not contain a review id");
    }
    if (deploy.functions.length !== 1) return yield* fail("functions", `deploy metadata must contain exactly one Function, received ${deploy.functions.length}`);
    const deployedFunction = deploy.functions[0];
    if (!Predicate.isObject(deployedFunction) || deployedFunction.name !== input.buildReceipt.function.name) {
      return yield* fail("functions", "deploy metadata does not identify the admitted Function");
    }
    if (deploy.edgeFunctions.length !== 0) return yield* fail("edge functions", "deploy metadata contains edge functions");
    if (input.github.currentHead !== platform.commitRef) return yield* fail("GitHub current head", "pull request/current branch head no longer equals the deployed commit");
    if (input.github.netlifyCheck.headSha !== input.github.currentHead) return yield* fail("Netlify check head", "check is not attached to the current GitHub head");
    if (input.github.netlifyCheck.status !== "completed" || input.github.netlifyCheck.conclusion !== "success") {
      return yield* fail("Netlify check", "current-head Netlify check is not completed successfully");
    }
  });
}

function fileUrl(base: string, path: string): string {
  const root = base.endsWith("/") ? base : `${base}/`;
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return new URL(encoded, root).href;
}

function expectedCacheControl(path: string): string | undefined {
  if (path.startsWith("assets/")) return "public, max-age=31536000, immutable";
  return undefined;
}

function parseCacheControl(value: string): ReadonlyMap<string, string | undefined> | undefined {
  const directives = new Map<string, string | undefined>();
  for (const part of value.split(",")) {
    const directive = CACHE_CONTROL_DIRECTIVE.exec(part.trim());
    if (directive === null) return undefined;
    const rawName = directive[1];
    if (rawName === undefined) return undefined;
    const name = rawName.toLowerCase();
    if (directives.has(name)) return undefined;
    directives.set(name, directive[2]);
  }
  return directives;
}

function matchesCacheControl(actual: string | null, expected: string): boolean {
  if (actual === null) return false;
  const expectedDirectives = parseCacheControl(expected);
  const actualDirectives = parseCacheControl(actual);
  if (expectedDirectives === undefined || actualDirectives === undefined || expectedDirectives.size !== actualDirectives.size) {
    return false;
  }
  for (const [name, value] of expectedDirectives) {
    if (!actualDirectives.has(name) || actualDirectives.get(name) !== value) return false;
  }
  return true;
}

function verifyRemoteFile(base: string, expected: PreviewFile) {
  const url = fileUrl(base, expected.path);
  return Effect.tryPromise({
    try: () => fetch(url, { redirect: "error" }),
    catch: (error) => new PreviewHttpError({ url, message: error instanceof Error ? error.message : String(error) }),
  }).pipe(Effect.flatMap((response) => Effect.gen(function*() {
    if (response.status < 200 || response.status >= 300) {
      return yield* new PreviewHttpError({ url, message: `expected 2xx, received ${response.status}` });
    }
    const extension = extname(expected.path).toLowerCase();
    const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (contentType === undefined || !CONTENT_TYPES.get(extension)?.has(contentType)) {
      return yield* fail(expected.path, `unexpected Content-Type ${String(contentType)}`);
    }
    for (const [name, value] of SECURITY_HEADERS) {
      const actual = response.headers.get(name);
      if (actual !== value) return yield* fail(expected.path, `security header ${name} does not match the required value`);
    }
    const cacheControl = expectedCacheControl(expected.path);
    if (cacheControl !== undefined && !matchesCacheControl(response.headers.get("cache-control"), cacheControl)) {
      return yield* fail(expected.path, "cache-control does not match the required value");
    }
    const bytes = new Uint8Array(yield* Effect.tryPromise({
      try: () => response.arrayBuffer(),
      catch: (error) => new PreviewHttpError({ url, message: error instanceof Error ? error.message : String(error) }),
    }));
    const actual: PreviewFile = {
      path: expected.path,
      byteLength: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
    if (actual.byteLength !== expected.byteLength) return yield* fail(expected.path, `byte length ${actual.byteLength} does not match ${expected.byteLength}`);
    if (actual.sha256 !== expected.sha256) return yield* fail(expected.path, `sha256 ${actual.sha256} does not match ${expected.sha256}`);
    return actual;
  })));
}

function fetchJson(url: string, init: RequestInit) {
  return Effect.tryPromise({
    try: () => fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(15_000) }),
    catch: (error) => new PreviewHttpError({ url, message: error instanceof Error ? error.message : String(error) }),
  }).pipe(Effect.flatMap((response) => Effect.gen(function*() {
    if (!response.ok) return yield* new PreviewHttpError({ url, message: `expected 2xx, received ${response.status}` });
    return yield* Effect.tryPromise({
      try: () => response.json() as Promise<unknown>,
      catch: (error) => new PreviewHttpError({ url, message: error instanceof Error ? error.message : String(error) }),
    });
  })));
}

function verifyRemoteInspection(base: string) {
  return Effect.gen(function*() {
    const generationUrl = new URL("/_niceeval/generation", base).href;
    const generation = yield* fetchJson(generationUrl, { method: "GET" });
    if (!Predicate.isObject(generation) || typeof generation.generationId !== "string" || typeof generation.sourceCutoffIdentity !== "string") {
      return yield* fail("remote generation", "Function returned an invalid generation descriptor");
    }
    const inspectionUrl = new URL("/_niceeval/inspection", base).href;
    const overview = yield* fetchJson(inspectionUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ generationId: generation.generationId, request: { protocol: QUERY_PROTOCOL, operation: { kind: "overview.get" } } }),
    });
    if (!Predicate.isObject(overview) || overview.protocol !== QUERY_PROTOCOL || overview.outcome !== "success" || !("overview" in overview)) {
      return yield* fail("remote overview", "Function returned an invalid overview Inspection document");
    }
    for (const method of ["GET", "HEAD"] as const) {
      const recordUrl = new URL("/record.sqlite", base).href;
      const response = yield* Effect.tryPromise({
        try: () => fetch(recordUrl, { method, redirect: "error", signal: AbortSignal.timeout(15_000) }),
        catch: (error) => new PreviewHttpError({ url: recordUrl, message: error instanceof Error ? error.message : String(error) }),
      });
      if (response.status !== 404) return yield* fail("public Record", `${method} /record.sqlite must return 404, received ${response.status}`);
    }
    return { generationId: generation.generationId, overviewProtocol: overview.protocol };
  });
}

export function acceptPreview(input: unknown): Effect.Effect<PreviewAcceptanceReceipt, import("./model.js").PreviewError> {
  return Effect.gen(function*() {
    const decoded = yield* decodeInput(input);
    yield* validateMetadata(decoded);
    if (closureDigest(decoded.buildReceipt.files) !== decoded.buildReceipt.closureSha256) {
      return yield* fail("build receipt closure", "manifest does not match its declared closure digest");
    }
    const platform = decoded.buildReceipt.platform;
    if (platform.mode !== "netlify") return yield* fail("build platform", "a local build receipt cannot be remotely accepted");
    if (decoded.buildReceipt.files.some((file) => file.path.endsWith(".sqlite"))) return yield* fail("build receipt", "static closure contains SQLite data");
    if (closureDigest(decoded.buildReceipt.function.files) !== decoded.buildReceipt.function.closureSha256) return yield* fail("Function closure", "Function manifest does not match its digest");
    if (decoded.buildReceipt.function.record.path !== "record.sqlite") return yield* fail("Function Record", "private Record path is not fixed");
    const files = yield* Effect.forEach(
      decoded.buildReceipt.files,
      (file) => verifyRemoteFile(decoded.deploy.immutableUrl, file),
      { concurrency: 8 },
    );
    const verifiedClosureSha256 = closureDigest(files);
    if (verifiedClosureSha256 !== decoded.buildReceipt.closureSha256) {
      return yield* fail("remote closure", "verified manifest closure does not match the build receipt");
    }
    const inspection = yield* verifyRemoteInspection(decoded.deploy.immutableUrl);
    return {
      format: "niceeval.preview-acceptance/v1",
      buildReceiptClosureSha256: decoded.buildReceipt.closureSha256,
      immutableUrl: decoded.deploy.immutableUrl,
      deployId: decoded.deploy.id,
      siteId: NETLIFY_SITE_ID,
      commitRef: decoded.deploy.commitRef,
      context: platform.context,
      verifiedFiles: files,
      verifiedClosureSha256,
      function: {
        name: decoded.buildReceipt.function.name,
        runtime: decoded.buildReceipt.function.runtime,
        closureSha256: decoded.buildReceipt.function.closureSha256,
        recordSha256: decoded.buildReceipt.function.record.sha256,
      },
      generationId: inspection.generationId,
      overviewProtocol: inspection.overviewProtocol,
      recordNotPublic: true,
      remoteClosureClaim: "static-manifest-and-function-runtime",
    };
  });
}
