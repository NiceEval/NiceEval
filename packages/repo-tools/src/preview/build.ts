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
  ".png", ".sqlite", ".svg", ".wasm", ".webp", ".woff", ".woff2",
]);
const PROHIBITED_PATH = /(?:^|\/)(?:\.niceeval|\.env(?:\.|$)|[^/]*\.(?:db|sqlite3|pem|key))(?:\/|$)/iu;
const MAXIMUM_FILES = 256;
const MAXIMUM_FILE_BYTES = 10 * 1024 * 1024;
const SYNTHETIC_RECORD_PATH = "record.sqlite";
const PINNED_RECORD_PATH = join("snapshot", "record.sqlite");
const HASHED_ASSET_PATH = /^assets\/.+-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/u;
const PREVIEW_PUBLISH_PATH = join(ROOT, ".netlify-view-preview");
const PREVIEW_BUILD_RECEIPT_PATH = join(ROOT, ".repo-tools/preview-runs/netlify-build.json");

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

async function installedRuntimeClosure(installedNiceeval: string): Promise<string> {
  const rootNodeModules = dirname(installedNiceeval);
  const pending = [await realpath(installedNiceeval)];
  const visited = new Set<string>();
  const files: PreviewFile[] = [];
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
    for (const file of await findPackageFiles(packageRoot)) {
      const bytes = await readFile(file);
      files.push({ path: `${identity}/${relative(packageRoot, file).split(sep).join("/")}`, byteLength: bytes.byteLength, sha256: sha256(bytes) });
    }
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
    const source = join(candidateApp, "assets");
    const destination = join(publishedApp, "assets");
    yield* io("copy-installed-view-assets", source, () => cp(source, destination, { recursive: true, force: true }));
  });
}

function stagePinnedRecord(repositoryRoot: string) {
  return Effect.gen(function*() {
    const destination = join(repositoryRoot, ".preview-site", SYNTHETIC_RECORD_PATH);
    const alreadyPresent = yield* io("check-preview-record-absence", destination, async () => {
      try {
        await stat(destination);
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw error;
      }
    });
    if (alreadyPresent) {
      return yield* new PreviewVerificationError({ subject: "tracked RecordSnapshot", message: `${SYNTHETIC_RECORD_PATH} was present before the tracked snapshot was staged` });
    }
    const source = join(repositoryRoot, PINNED_RECORD_PATH);
    const details = yield* io("inspect-tracked-record", source, () => lstat(source));
    if (!details.isFile() || details.isSymbolicLink()) {
      return yield* new PreviewVerificationError({ subject: "tracked RecordSnapshot", message: `${PINNED_RECORD_PATH} must be a regular file` });
    }
    yield* io("copy-tracked-record", source, () => cp(source, destination, { force: false }));
  });
}

async function collectSiteManifest(root: string): Promise<readonly PreviewFile[]> {
  const files: PreviewFile[] = [];
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
      if (path !== SYNTHETIC_RECORD_PATH && PROHIBITED_PATH.test(path)) throw new Error(`published site contains prohibited path: ${path}`);
      const extension = extname(path).toLowerCase();
      if (!ALLOWED_EXTENSIONS.has(extension)) throw new Error(`published site contains non-allowlisted file: ${path}`);
      if (extension === ".sqlite" && path !== SYNTHETIC_RECORD_PATH) throw new Error(`published site contains an unapproved SQLite path: ${path}`);
      if (path.startsWith("assets/") && !HASHED_ASSET_PATH.test(path)) throw new Error(`published site contains a non-hashed asset: ${path}`);
      const bytes = await readFile(target);
      if (bytes.byteLength > MAXIMUM_FILE_BYTES) throw new Error(`published file exceeds ${MAXIMUM_FILE_BYTES} bytes: ${path}`);
      const sqlite = bytes.subarray(0, 16).equals(Buffer.from("SQLite format 3\0"));
      if (path === SYNTHETIC_RECORD_PATH && !sqlite) throw new Error("published tracked RecordSnapshot is not SQLite data");
      if (path !== SYNTHETIC_RECORD_PATH && sqlite) throw new Error(`published site contains SQLite data: ${path}`);
      if (/BEGIN (?:[A-Z ]+ )?PRIVATE KEY/u.test(bytes.toString("utf8"))) throw new Error(`published site contains private-key material: ${path}`);
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
  if (!files.some((file) => file.path === SYNTHETIC_RECORD_PATH)) throw new Error("published site is missing the tracked RecordSnapshot");
  return files;
}

function verifyPreviewClosure(root: string) {
  return io("verify-preview-closure", root, () => collectSiteManifest(root));
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
      yield* stagePinnedRecord(orchestratorRoot);
      yield* verifyPreviewClosure(join(orchestratorRoot, ".preview-site"));
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
      };
      yield* writeReceipt(PREVIEW_BUILD_RECEIPT_PATH, buildReceipt);
      return buildReceipt;
    });
    return yield* run;
  }));
}
