import { createHash } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { Effect } from "effect";

import {
  NETLIFY_SITE_ID,
  NICEEVAL_REPOSITORY_URL,
  PREVIEW_REPOSITORY,
  type PreviewBuildReceipt,
  PreviewEnvironmentError,
  type PreviewFile,
  PreviewIoError,
  type PreviewPlatform,
  PreviewVerificationError,
} from "./model.js";
import { requirePreviewSuccess, runPreviewProcess } from "./process.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const PACKAGE_ROOT = join(ROOT, "packages/niceeval");
const ALLOWED_EXTENSIONS = new Set([
  ".css", ".gif", ".html", ".ico", ".jpeg", ".jpg", ".js", ".json", ".mjs",
  ".png", ".svg", ".webp", ".woff", ".woff2",
]);
const PROHIBITED_PATH = /(?:^|\/)(?:\.niceeval|\.env(?:\.|$)|[^/]*\.(?:db|sqlite3|pem|key))(?:\/|$)/iu;
const MAXIMUM_FILES = 256;
const MAXIMUM_STATIC_ASSET_BYTES = 10 * 1024 * 1024;
const MAXIMUM_SITE_BYTES = 64 * 1024 * 1024;
const RECORD_PATH = join(".niceeval", "record.sqlite");
const HASHED_ASSET_PATH = /^assets\/.+-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/u;
const PREVIEW_PUBLISH_PATH = join(ROOT, ".netlify-view-preview");
const PREVIEW_BUILD_RECEIPT_PATH = join(ROOT, ".repo-tools/preview-runs/netlify-build.json");
const PREVIEW_FUNCTION_PATH = join(ROOT, ".netlify-functions");
const PREVIEW_FUNCTION_NAME = "niceeval-inspection";
const PREVIEW_FUNCTION_RUNTIME = "nodejs24.x" as const;

type BuildServices = import("effect/unstable/process").ChildProcessSpawner.ChildProcessSpawner;

export interface PreviewBuildOptions {
  readonly local: boolean;
  readonly environment?: NodeJS.ProcessEnv;
}

function io<A>(operation: string, path: string, thunk: () => Promise<A>) {
  return Effect.tryPromise({
    try: thunk,
    catch: (error) => new PreviewIoError({ operation, path, message: error instanceof Error ? error.message : String(error) }),
  });
}

function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function containsPrivateKeyMaterial(bytes: Uint8Array): boolean {
  return /-----BEGIN ([A-Z ]*PRIVATE KEY)-----\s+[A-Za-z0-9+/=\r\n]{128,}-----END \1-----/u.test(
    Buffer.from(bytes).toString("utf8"),
  );
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(value);
}

export function closureDigest(files: readonly PreviewFile[]): string {
  return sha256(files.map((file) => `${file.path}\0${file.byteLength}\0${file.sha256}\n`).join(""));
}

function requireEnvironment(
  environment: NodeJS.ProcessEnv,
  field: string,
  predicate: (value: string) => boolean,
  message: string,
): Effect.Effect<string, PreviewEnvironmentError> {
  const value = environment[field];
  return value !== undefined && predicate(value)
    ? Effect.succeed(value)
    : Effect.fail(new PreviewEnvironmentError({ field, message }));
}

function absentEnvironment(environment: NodeJS.ProcessEnv, field: string) {
  const value = environment[field];
  return value === undefined || value === ""
    ? Effect.void
    : Effect.fail(new PreviewEnvironmentError({ field, message: "must be absent in this Netlify context" }));
}

function decodeNetlifyPlatform(
  environment: NodeJS.ProcessEnv,
  gitHead: string,
): Effect.Effect<PreviewPlatform, PreviewEnvironmentError> {
  return Effect.gen(function*() {
    yield* requireEnvironment(environment, "SITE_ID", (value) => value === NETLIFY_SITE_ID, `must equal ${NETLIFY_SITE_ID}`);
    yield* requireEnvironment(environment, "REPOSITORY_URL", (value) => value === NICEEVAL_REPOSITORY_URL, `must equal ${NICEEVAL_REPOSITORY_URL}`);
    const context = yield* requireEnvironment(environment, "CONTEXT", (value) => value === "production" || value === "deploy-preview", "must be production or deploy-preview");
    const commitRef = yield* requireEnvironment(environment, "COMMIT_REF", (value) => value === gitHead, "must equal the current checkout git HEAD");
    const deployId = yield* requireEnvironment(environment, "DEPLOY_ID", (value) => /^[0-9a-f]{24}$/u.test(value), "must be a 24-character lowercase Netlify deploy ID");
    const deployUrl = yield* requireEnvironment(environment, "DEPLOY_URL", (value) => /^https:\/\/[a-z0-9-]+--[a-z0-9-]+\.netlify\.app\/?$/u.test(value), "must be an immutable Netlify deploy URL");
    const deployPrimeUrl = yield* requireEnvironment(environment, "DEPLOY_PRIME_URL", (value) => /^https:\/\/[a-z0-9-]+\.netlify\.app\/?$/u.test(value), "must be a Netlify prime URL");
    const branch = yield* requireEnvironment(environment, "BRANCH", (value) => value.trim().length > 0, "must be non-empty");
    const pullRequest = yield* requireEnvironment(environment, "PULL_REQUEST", (value) => value === "true" || value === "false", "must be true or false");

    if (context === "production") {
      if (pullRequest !== "false") return yield* new PreviewEnvironmentError({ field: "PULL_REQUEST", message: "must be false for production" });
      if (branch !== "main") return yield* new PreviewEnvironmentError({ field: "BRANCH", message: "must be main for production" });
      yield* absentEnvironment(environment, "REVIEW_ID");
      return {
        mode: "netlify",
        kind: "production",
        siteId: NETLIFY_SITE_ID,
        repositoryUrl: NICEEVAL_REPOSITORY_URL,
        context: "production",
        branch: "main",
        commitRef,
        deployId,
        deployUrl,
        deployPrimeUrl,
      };
    }

    if (pullRequest !== "true") return yield* new PreviewEnvironmentError({ field: "PULL_REQUEST", message: "must be true for deploy-preview" });
    const reviewId = yield* requireEnvironment(environment, "REVIEW_ID", (value) => /^[1-9][0-9]*$/u.test(value), "must be a positive pull request number");
    return {
      mode: "netlify",
      kind: "pull-request",
      siteId: NETLIFY_SITE_ID,
      repositoryUrl: NICEEVAL_REPOSITORY_URL,
      context: "deploy-preview",
      branch,
      reviewId,
      commitRef,
      deployId,
      deployUrl,
      deployPrimeUrl,
    };
  });
}

function scopedTemporaryDirectory(prefix: string) {
  return Effect.acquireRelease(
    io("make-temp-directory", tmpdir(), () => mkdtemp(join(tmpdir(), prefix))),
    (path) => io("remove-temp-directory", path, () => rm(path, { recursive: true, force: true })).pipe(Effect.orDie),
  );
}

function gitOutput(args: readonly string[], cwd: string) {
  return requirePreviewSuccess("git", args, cwd).pipe(Effect.map((result) => result.stdout.trim()));
}

function validateOrchestrator(repositoryRoot: string, commit: string) {
  return Effect.gen(function*() {
    const remote = yield* gitOutput(["remote", "get-url", "origin"], repositoryRoot);
    if (remote !== PREVIEW_REPOSITORY) {
      return yield* new PreviewVerificationError({ subject: "orchestrator remote", message: `expected ${PREVIEW_REPOSITORY}, received ${remote}` });
    }
    const head = yield* gitOutput(["rev-parse", "HEAD"], repositoryRoot);
    if (head !== commit) {
      return yield* new PreviewVerificationError({ subject: "orchestrator HEAD", message: `expected ${commit}, received ${head}` });
    }
    const symbolic = yield* runPreviewProcess("git", ["symbolic-ref", "-q", "HEAD"], repositoryRoot);
    if (symbolic.exitCode === 0) {
      return yield* new PreviewVerificationError({ subject: "orchestrator checkout", message: "HEAD must be detached" });
    }
    if (symbolic.exitCode !== 1) {
      return yield* new PreviewVerificationError({ subject: "orchestrator checkout", message: symbolic.stderr.trim() || "could not verify detached HEAD" });
    }
    const statusOutput = yield* gitOutput(["status", "--porcelain=v1", "--untracked-files=all"], repositoryRoot);
    if (statusOutput !== "") {
      return yield* new PreviewVerificationError({ subject: "orchestrator checkout", message: "checkout is not clean" });
    }
    yield* requirePreviewSuccess("git", ["merge-base", "--is-ancestor", commit, "origin/main"], repositoryRoot).pipe(
      Effect.mapError(() => new PreviewVerificationError({ subject: "orchestrator ancestry", message: `${commit} is not an ancestor of origin/main` })),
    );
  });
}

function cloneOrchestrator(temporaryRoot: string) {
  const repositoryRoot = join(temporaryRoot, "preview");
  return Effect.gen(function*() {
    yield* requirePreviewSuccess("git", ["clone", "--filter=blob:none", "--no-checkout", PREVIEW_REPOSITORY, repositoryRoot], temporaryRoot);
    yield* requirePreviewSuccess("git", ["fetch", "origin", "main"], repositoryRoot);
    const commit = yield* gitOutput(["rev-parse", "origin/main"], repositoryRoot);
    if (!/^[0-9a-f]{40}$/u.test(commit)) {
      return yield* new PreviewVerificationError({ subject: "orchestrator commit", message: "origin/main did not resolve to a lowercase 40-character commit" });
    }
    yield* requirePreviewSuccess("git", ["checkout", "--detach", commit], repositoryRoot);
    yield* validateOrchestrator(repositoryRoot, commit);
    return { repositoryRoot, commit };
  });
}

function packCandidate(temporaryRoot: string) {
  return Effect.gen(function*() {
    yield* requirePreviewSuccess("pnpm", ["run", "build:package"], ROOT);
    yield* requirePreviewSuccess("pnpm", ["run", "build:index"], ROOT);
    const packRoot = join(temporaryRoot, "candidate");
    yield* io("make-pack-directory", packRoot, async () => { await import("node:fs/promises").then((fs) => fs.mkdir(packRoot, { recursive: true })); });
    yield* requirePreviewSuccess("pnpm", ["--config.ignore-scripts=true", "--config.node-linker=hoisted", "pack", "--pack-destination", packRoot], PACKAGE_ROOT);
    const entries = yield* io("read-pack-directory", packRoot, () => readdir(packRoot));
    const tarballs = entries.filter((entry) => entry.endsWith(".tgz"));
    if (tarballs.length !== 1) {
      return yield* new PreviewVerificationError({ subject: "candidate pack", message: `expected one tarball, received ${tarballs.length}` });
    }
    const path = join(packRoot, tarballs[0] ?? "");
    const bytes = yield* io("read-candidate-tarball", path, () => readFile(path));
    const manifestPath = join(PACKAGE_ROOT, "package.json");
    const manifest = yield* io("read-candidate-manifest", manifestPath, async () =>
      JSON.parse(await readFile(manifestPath, "utf8")) as unknown
    );
    const effectVersion = typeof manifest === "object" && manifest !== null &&
        "dependencies" in manifest && typeof manifest.dependencies === "object" &&
        manifest.dependencies !== null && "effect" in manifest.dependencies
      ? manifest.dependencies.effect
      : undefined;
    if (typeof effectVersion !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(effectVersion)) {
      return yield* new PreviewVerificationError({
        subject: "candidate Effect dependency",
        message: "package.json dependencies must declare one exact Effect version",
      });
    }
    return { path, digest: sha256(bytes), effectVersion };
  });
}

async function findPackageFiles(packageRoot: string): Promise<readonly string[]> {
  const result: string[] = [];
  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "node_modules") continue;
      const target = join(directory, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile()) result.push(target);
      else if (entry.isSymbolicLink()) {
        const details = await stat(target);
        if (details.isFile()) result.push(target);
      }
    }
  }
  await visit(packageRoot);
  return result.sort();
}

const NON_RUNTIME_PACKAGE_DIRECTORIES = new Set([
  ".github",
  "docs",
  "documentation",
  "examples",
  "test",
  "tests",
]);

async function findRuntimePackageFiles(packageRoot: string): Promise<readonly string[]> {
  return (await findPackageFiles(packageRoot)).filter((file) => {
    const [topLevel] = relative(packageRoot, file).split(sep);
    return topLevel !== undefined && !NON_RUNTIME_PACKAGE_DIRECTORIES.has(topLevel);
  });
}

async function runtimePackageRoots(installedNiceeval: string): Promise<ReadonlyMap<string, string>> {
  const rootNodeModules = dirname(installedNiceeval);
  const pending = [await realpath(installedNiceeval)];
  const visited = new Set<string>();
  const roots = new Map<string, string>();
  while (pending.length > 0) {
    const packageRoot = pending.pop();
    if (packageRoot === undefined || visited.has(packageRoot)) continue;
    visited.add(packageRoot);
    const manifestPath = join(packageRoot, "package.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      readonly name?: unknown;
      readonly version?: unknown;
      readonly dependencies?: Record<string, string>;
      readonly optionalDependencies?: Record<string, string>;
      readonly peerDependencies?: Record<string, string>;
    };
    if (typeof manifest.name !== "string" || typeof manifest.version !== "string") {
      throw new Error(`runtime package has invalid identity: ${manifestPath}`);
    }
    const identity = `${manifest.name}@${manifest.version}`;
    roots.set(identity, packageRoot);
    const dependencies = new Set([
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.optionalDependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
    ]);
    const packageNodeModules = manifest.name.startsWith("@")
      ? dirname(dirname(packageRoot))
      : dirname(packageRoot);
    for (const dependency of dependencies) {
      const candidates = [join(packageNodeModules, dependency), join(rootNodeModules, dependency)];
      try {
        let resolved: string | undefined;
        for (const candidate of candidates) {
          try {
            resolved = await realpath(candidate);
            break;
          } catch {}
        }
        if (resolved === undefined) throw new Error(`runtime dependency ${dependency} is not installed`);
        pending.push(resolved);
      } catch (error) {
        if (Object.hasOwn(manifest.dependencies ?? {}, dependency)) throw error;
      }
    }
  }
  return roots;
}

async function installedRuntimeClosure(installedNiceeval: string): Promise<string> {
  const files: PreviewFile[] = [];
  for (const [identity, packageRoot] of await runtimePackageRoots(installedNiceeval)) {
    for (const file of await findPackageFiles(packageRoot)) {
      const bytes = await readFile(file);
      files.push({ path: `${identity}/${relative(packageRoot, file).split(sep).join("/")}`, byteLength: bytes.byteLength, sha256: sha256(bytes) });
    }
  }
  files.sort((left, right) => left.path.localeCompare(right.path));
  return closureDigest(files);
}

function installCandidate(repositoryRoot: string, tarball: string, effectVersion: string) {
  return Effect.gen(function*() {
    yield* requirePreviewSuccess("pnpm", ["install", "--frozen-lockfile"], repositoryRoot);
    yield* requirePreviewSuccess("pnpm", [
      "add",
      "--ignore-scripts",
      "--save-exact",
      tarball,
      `effect@${effectVersion}`,
    ], repositoryRoot);
    const installed = join(repositoryRoot, "node_modules/niceeval");
    const [installedRoot, sourceRoot] = yield* Effect.all([
      io("resolve-installed-candidate", installed, () => realpath(installed)),
      io("resolve-source-candidate", PACKAGE_ROOT, () => realpath(PACKAGE_ROOT)),
    ]);
    if (installedRoot === sourceRoot || installedRoot.startsWith(`${sourceRoot}${sep}`)) {
      return yield* new PreviewVerificationError({ subject: "installed candidate", message: "node_modules/niceeval resolves to the source checkout" });
    }
    const details = yield* io("inspect-installed-candidate", installed, () => lstat(installed));
    if (details.isSymbolicLink() && installedRoot === sourceRoot) {
      return yield* new PreviewVerificationError({ subject: "installed candidate", message: "node_modules/niceeval is a source checkout symlink" });
    }
    return yield* io("digest-installed-runtime-closure", installed, () => installedRuntimeClosure(installed));
  });
}

function installCandidateViewAssets(repositoryRoot: string) {
  return Effect.gen(function*() {
    const candidateApp = join(repositoryRoot, "node_modules", "niceeval", "dist", "view", "app-dist");
    const publishedApp = join(repositoryRoot, ".preview-site");
    yield* io("make-preview-site", publishedApp, () => mkdir(publishedApp, { recursive: true }));
    yield* io("copy-installed-view-index", join(candidateApp, "index.html"), () => cp(join(candidateApp, "index.html"), join(publishedApp, "index.html"), { force: true }));
    yield* io("write-preview-not-found", join(publishedApp, "404.html"), () => writeFile(join(publishedApp, "404.html"), "<!doctype html><title>Not found</title>\n", "utf8"));
    const source = join(candidateApp, "assets");
    const destination = join(publishedApp, "assets");
    yield* io("copy-installed-view-assets", source, () => cp(source, destination, { recursive: true, force: true }));
  });
}

async function collectSiteManifest(root: string): Promise<readonly PreviewFile[]> {
  const files: PreviewFile[] = [];
  let siteBytes = 0;
  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const target = join(directory, entry.name);
      const path = relative(root, target).split(sep).join("/");
      if (path === "" || path.startsWith("../") || path.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) {
        throw new Error(`unsafe published path: ${path}`);
      }
      if (entry.isDirectory()) {
        await visit(target);
        continue;
      }
      if (!entry.isFile()) throw new Error(`published site contains unsupported entry: ${path}`);
      if (PROHIBITED_PATH.test(path)) throw new Error(`published site contains prohibited path: ${path}`);
      const extension = extname(path).toLowerCase();
      if (!ALLOWED_EXTENSIONS.has(extension)) throw new Error(`published site contains non-allowlisted file: ${path}`);
      if (path.startsWith("assets/") && !HASHED_ASSET_PATH.test(path)) throw new Error(`published site contains a non-hashed asset: ${path}`);
      const bytes = await readFile(target);
      if (bytes.byteLength > MAXIMUM_STATIC_ASSET_BYTES) {
        throw new Error(`published static asset exceeds ${MAXIMUM_STATIC_ASSET_BYTES} bytes: ${path}`);
      }
      siteBytes += bytes.byteLength;
      if (siteBytes > MAXIMUM_SITE_BYTES) throw new Error(`published site exceeds ${MAXIMUM_SITE_BYTES} bytes`);
      const sqlite = bytes.subarray(0, 16).equals(Buffer.from("SQLite format 3\0"));
      if (sqlite) throw new Error(`published site contains SQLite data: ${path}`);
      if (containsPrivateKeyMaterial(bytes)) throw new Error(`published site contains private-key material: ${path}`);
      if (extension === ".json") {
        const parsed = JSON.parse(bytes.toString("utf8")) as unknown;
        const record = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
        if (record === undefined || Object.keys(record).sort().join("\0") !== ["en", "format", "zh-CN"].join("\0") || record.format !== "niceeval.view-page/v1" || typeof record.en !== "string" || typeof record["zh-CN"] !== "string") {
          throw new Error(`published site contains Inspection or unknown JSON: ${path}`);
        }
      }
      files.push({ path, byteLength: bytes.byteLength, sha256: sha256(bytes) });
      if (files.length > MAXIMUM_FILES) throw new Error(`published site exceeds ${MAXIMUM_FILES} files`);
    }
  }
  await visit(root);
  files.sort((left, right) => left.path.localeCompare(right.path));
  if (!files.some((file) => file.path === "index.html")) throw new Error("published site is missing index.html");
  return files;
}

function verifyPreviewClosure(root: string) {
  return io("verify-preview-closure", root, () => collectSiteManifest(root));
}

async function collectPrivateFunctionManifest(root: string): Promise<readonly PreviewFile[]> {
  const files: PreviewFile[] = [];
  let bytesTotal = 0;
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const target = join(directory, entry.name);
      const path = relative(root, target).split(sep).join("/");
      if (path === "" || path.startsWith("../") || path.split("/").some((part) => part === "" || part === "." || part === "..")) {
        throw new Error(`unsafe Function path: ${path}`);
      }
      if (entry.isDirectory()) {
        await visit(target);
        continue;
      }
      if (!entry.isFile()) throw new Error(`Function closure contains unsupported entry: ${path}`);
      const bytes = await readFile(target);
      bytesTotal += bytes.byteLength;
      if (bytesTotal > 128 * 1024 * 1024) throw new Error("Function closure exceeds 128 MiB");
      if (containsPrivateKeyMaterial(bytes)) throw new Error(`Function closure contains private-key material: ${path}`);
      files.push({ path, byteLength: bytes.byteLength, sha256: sha256(bytes) });
    }
  }
  await visit(root);
  files.sort((left, right) => left.path.localeCompare(right.path));
  return files;
}

function readCanonicalCutoff(repositoryRoot: string) {
  const program = [
    'import { Effect } from "effect";',
    'import { openInspectionSource } from "./node_modules/niceeval/dist/inspection/source.js";',
    'const source = { kind: "external-record", recordPath: new URL("./.niceeval/record.sqlite", import.meta.url).pathname };',
    'const cutoff = await Effect.runPromise(Effect.scoped(Effect.map(openInspectionSource(source), (facts) => facts.cutoff())));',
    'process.stdout.write(JSON.stringify(cutoff));',
  ].join("\n");
  return requirePreviewSuccess("node", ["--input-type=module", "--eval", program], repositoryRoot).pipe(
    Effect.flatMap((result) => {
      try {
        const value = JSON.parse(result.stdout) as { readonly identity?: unknown; readonly runCount?: unknown };
        if (typeof value.identity !== "string" || value.identity.length === 0 || !Number.isSafeInteger(value.runCount)) throw new Error("invalid cutoff");
        return Effect.succeed(value.identity);
      } catch (error) {
        return Effect.fail(new PreviewVerificationError({ subject: "canonical Record cutoff", message: error instanceof Error ? error.message : String(error) }));
      }
    }),
  );
}

function functionSource(generationId: string, sourceCutoffIdentity: string): string {
  return `import { copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Result } from "effect";
import { Schema } from "effect";
import { decodeGenerationCommitRequest, decodeViewInspectionRequest, inspectViewGeneration, ViewGenerationDescriptorSchema } from "./node_modules/niceeval/dist/view/function-runtime.mjs";

const PACKAGED_RECORD_PATH = fileURLToPath(new URL("./record.sqlite", import.meta.url));
const RECORD_PATH = join(mkdtempSync(join(tmpdir(), "niceeval-view-")), "record.sqlite");
copyFileSync(PACKAGED_RECORD_PATH, RECORD_PATH);
const DESCRIPTOR = Object.freeze(Schema.decodeUnknownSync(ViewGenerationDescriptorSchema, { onExcessProperty: "error" })(${JSON.stringify({ generationId, sourceCutoffIdentity, refreshSupported: false, stale: false })}));
const GENERATION = Object.freeze({ generationId: DESCRIPTOR.generationId, appRoot: "", recordPath: RECORD_PATH, recordByteLength: 0, contentHash: "private", sourceCutoffIdentity: DESCRIPTOR.sourceCutoffIdentity, retire: async () => {} });
const BODY_LIMIT = 64 * 1024;
const RESPONSE_LIMIT = 6 * 1024 * 1024;
const DEADLINE_MS = 10_000;
const headers = { "cache-control": "private, no-store", "content-type": "application/json; charset=utf-8", "x-content-type-options": "nosniff" };
const error = (status, code, reason, correction) => json(status, { code, reason, correction });
function json(status, value) {
  const body = JSON.stringify(value);
  if (Buffer.byteLength(body) > RESPONSE_LIMIT) return error(413, "view-inspection-failed", "Inspection response exceeded the fixed limit.", "fix-request");
  return new Response(body, { status, headers });
}
async function body(request) {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > BODY_LIMIT) throw new Error("body-limit");
  const text = await request.text();
  if (Buffer.byteLength(text) > BODY_LIMIT) throw new Error("body-limit");
  try { return JSON.parse(text); } catch { throw new Error("json"); }
}
async function withDeadline(promise) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("deadline")), DEADLINE_MS); })]); }
  finally { clearTimeout(timer); }
}
export default async (request) => {
  const pathname = new URL(request.url).pathname;
  try {
    if (request.method === "GET" && pathname === "/_niceeval/generation") return json(200, DESCRIPTOR);
    if (request.method === "POST" && pathname === "/_niceeval/generation/refresh") return json(200, DESCRIPTOR);
    if (request.method === "POST" && pathname === "/_niceeval/generation/commit") {
      if (request.headers.get("content-type") !== "application/json") return error(415, "view-request-invalid", "Content-Type must be exactly application/json.", "fix-request");
      const decoded = decodeGenerationCommitRequest(await body(request));
      if (Result.isFailure(decoded) || decoded.success.generationId !== DESCRIPTOR.generationId) return error(409, "view-generation-not-found", "The immutable deploy has one different generation.", "refresh-generation");
      return json(200, DESCRIPTOR);
    }
    if (request.method === "POST" && pathname === "/_niceeval/inspection") {
      if (request.headers.get("content-type") !== "application/json") return error(415, "view-request-invalid", "Content-Type must be exactly application/json.", "fix-request");
      const decoded = decodeViewInspectionRequest(await body(request));
      if (Result.isFailure(decoded)) return error(400, "view-request-invalid", "The Inspection request is invalid.", "fix-request");
      if (decoded.success.generationId !== DESCRIPTOR.generationId) return error(409, "view-generation-not-found", "The generation is not part of this immutable deploy.", "refresh-generation");
      const result = await withDeadline(inspectViewGeneration(GENERATION, decoded.success.request));
      return json(200, result);
    }
    return error(404, "view-request-invalid", "The View endpoint does not exist.", "fix-request");
  } catch (cause) {
    if (cause instanceof Error && cause.message === "body-limit") return error(413, "view-request-invalid", "The request body exceeds 64 KiB.", "fix-request");
    if (cause instanceof Error && cause.message === "json") return error(400, "view-request-invalid", "The request body is invalid.", "fix-request");
    return error(500, "view-inspection-failed", "The immutable Preview could not complete the Inspection request.", "retry");
  }
};
`;
}

function stageFunction(repositoryRoot: string, generationId: string, sourceCutoffIdentity: string) {
  return Effect.gen(function*() {
    yield* io("replace-function-directory", PREVIEW_FUNCTION_PATH, async () => {
      await rm(PREVIEW_FUNCTION_PATH, { recursive: true, force: true });
      await mkdir(join(PREVIEW_FUNCTION_PATH, "node_modules"), { recursive: true });
    });
    const installed = join(repositoryRoot, "node_modules", "niceeval");
    const roots = yield* io("resolve-function-runtime-closure", installed, () => runtimePackageRoots(installed));
    for (const packageRoot of roots.values()) {
      const manifest = JSON.parse(yield* io("read-function-package", join(packageRoot, "package.json"), () => readFile(join(packageRoot, "package.json"), "utf8"))) as { readonly name?: unknown };
      if (typeof manifest.name !== "string") return yield* new PreviewVerificationError({ subject: "Function package", message: "runtime package name is invalid" });
      const packageName = manifest.name;
      const destination = join(PREVIEW_FUNCTION_PATH, "node_modules", ...packageName.split("/"));
      yield* io("copy-function-package", packageRoot, async () => {
        for (const file of await findRuntimePackageFiles(packageRoot)) {
          const target = join(destination, relative(packageRoot, file));
          await mkdir(dirname(target), { recursive: true });
          await cp(file, target, { dereference: true, force: false });
        }
      });
    }
    const recordSource = join(repositoryRoot, RECORD_PATH);
    const details = yield* io("inspect-tracked-record", recordSource, () => lstat(recordSource));
    if (!details.isFile() || details.isSymbolicLink()) return yield* new PreviewVerificationError({ subject: "tracked Record", message: `${RECORD_PATH} must be a regular file` });
    yield* io("copy-private-record", recordSource, () => cp(recordSource, join(PREVIEW_FUNCTION_PATH, "record.sqlite"), { force: false }));
    yield* io("write-function-entry", PREVIEW_FUNCTION_PATH, () => writeFile(join(PREVIEW_FUNCTION_PATH, `${PREVIEW_FUNCTION_NAME}.mjs`), functionSource(generationId, sourceCutoffIdentity), "utf8"));
    const files = yield* io("verify-function-closure", PREVIEW_FUNCTION_PATH, () => collectPrivateFunctionManifest(PREVIEW_FUNCTION_PATH));
    const record = files.find((file) => file.path === "record.sqlite");
    if (record === undefined) return yield* new PreviewVerificationError({ subject: "Function Record", message: "private Record is missing" });
    return { name: PREVIEW_FUNCTION_NAME as "niceeval-inspection", runtime: PREVIEW_FUNCTION_RUNTIME, entry: `${PREVIEW_FUNCTION_NAME}.mjs` as const, files, closureSha256: closureDigest(files), record };
  });
}

function publishSite(source: string, publish: string) {
  const parent = dirname(publish);
  return Effect.gen(function*() {
    const staging = yield* io("make-publish-staging", parent, () => mkdtemp(join(parent, `.${basename(publish)}.staging-`)));
    const cleanup = io("remove-publish-staging", staging, () => rm(staging, { recursive: true, force: true })).pipe(Effect.orDie);
    return yield* Effect.gen(function*() {
      yield* io("copy-publish-staging", staging, () => cp(source, staging, { recursive: true }));
      const files = yield* io("verify-publish-staging", staging, () => collectSiteManifest(staging));
      const digest = closureDigest(files);
      yield* io("remove-old-publish", publish, () => rm(publish, { recursive: true, force: true }));
      yield* io("publish-atomic-rename", publish, () => rename(staging, publish));
      return { files, digest };
    }).pipe(Effect.onError(() => cleanup));
  });
}

function writeReceipt(path: string, receipt: PreviewBuildReceipt) {
  return io("write-build-receipt", path, async () => {
    await import("node:fs/promises").then((fs) => fs.mkdir(dirname(path), { recursive: true }));
    await writeFile(path, `${canonicalJson(receipt)}\n`, { encoding: "utf8", flag: "w" });
  });
}

export function buildPreview(options: PreviewBuildOptions): Effect.Effect<PreviewBuildReceipt, import("./model.js").PreviewError, BuildServices> {
  return Effect.scoped(Effect.gen(function*() {
    const run = Effect.gen(function*() {
      const gitHead = yield* gitOutput(["rev-parse", "HEAD"], ROOT);
      if (!/^[0-9a-f]{40}$/u.test(gitHead)) return yield* new PreviewVerificationError({ subject: "candidate HEAD", message: "git HEAD is not a lowercase 40-character commit" });
      const platform: PreviewPlatform = options.local
        ? { mode: "local" }
        : yield* decodeNetlifyPlatform(options.environment ?? process.env, gitHead);
      const temporaryRoot = yield* scopedTemporaryDirectory("niceeval-preview-build-");
      const orchestrator = yield* cloneOrchestrator(temporaryRoot);
      const orchestratorRoot = orchestrator.repositoryRoot;
      const candidate = yield* packCandidate(temporaryRoot);
      const runtimeDigestBefore = yield* installCandidate(orchestratorRoot, candidate.path, candidate.effectVersion);
      yield* requirePreviewSuccess("pnpm", ["typecheck"], orchestratorRoot);
      yield* installCandidateViewAssets(orchestratorRoot);
      yield* verifyPreviewClosure(join(orchestratorRoot, ".preview-site"));
      const sourceCutoffIdentity = yield* readCanonicalCutoff(orchestratorRoot);
      const recordBytes = yield* io("read-private-record", join(orchestratorRoot, RECORD_PATH), () => readFile(join(orchestratorRoot, RECORD_PATH)));
      const generationId = `netlify-${sha256(recordBytes).slice(0, 32)}`;
      const previewFunction = yield* stageFunction(orchestratorRoot, generationId, sourceCutoffIdentity);
      const runtimeDigestAfter = yield* io("digest-installed-runtime-closure", join(orchestratorRoot, "node_modules/niceeval"), () => installedRuntimeClosure(join(orchestratorRoot, "node_modules/niceeval")));
      if (runtimeDigestAfter !== runtimeDigestBefore) {
        return yield* new PreviewVerificationError({ subject: "installed runtime closure", message: "runtime closure changed while building the preview" });
      }
      const published = yield* publishSite(join(orchestratorRoot, ".preview-site"), PREVIEW_PUBLISH_PATH);
      const buildReceipt: PreviewBuildReceipt = {
        format: "niceeval.preview-build/v1",
        platform,
        candidate: {
          gitCommit: gitHead,
          packedArtifactSha256: candidate.digest,
          installedRuntimeClosureSha256: runtimeDigestBefore,
        },
        orchestrator: { repository: PREVIEW_REPOSITORY, commit: orchestrator.commit },
        files: published.files,
        closureSha256: published.digest,
        function: previewFunction,
      };
      yield* writeReceipt(PREVIEW_BUILD_RECEIPT_PATH, buildReceipt);
      return buildReceipt;
    });
    return yield* run;
  }));
}
