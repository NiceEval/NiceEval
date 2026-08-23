// Nx project-graph backed discovery for the E2E root orchestrator.

import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { FileSystem } from "@effect/platform";
import { Data, Effect, Either, ParseResult, Schema } from "effect";

import { decodeExternal } from "./contracts.ts";
import { formatManifestError, isCanonicalRelativePath, parseManifest, type E2ERepoManifest } from "./manifest.ts";

export type { E2ERepoManifest, RepoRequires } from "./manifest.ts";

export interface DiscoveredRepo {
  readonly dir: string;
  readonly projectName: string;
  readonly manifest: E2ERepoManifest;
}

export interface DiscoveryResult {
  readonly repos: readonly DiscoveredRepo[];
  readonly errors: readonly string[];
}

export class DiscoveryIoError extends Data.TaggedError("DiscoveryIoError")<{
  readonly operation: "exists" | "read-directory" | "read-file" | "stat";
  readonly path: string;
  readonly cause: unknown;
}> {}

export const ADAPTER_COLLECTION = "adapter";

export const repoRootDir = (): string => resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const e2eRootDir = (): string => join(repoRootDir(), "e2e");
export const adapterRootDir = (): string => join(e2eRootDir(), ADAPTER_COLLECTION);

export const canonicalRepoId = (projectRoot: string): string => {
  const normalized = projectRoot.replaceAll("\\", "/");
  return !normalized.startsWith("e2e/") || normalized === "e2e/adapter" ? "" : normalized.slice("e2e/".length);
};

export const e2eProjectName = (id: string): string => `e2e-${id.replaceAll("/", "-")}`;

const ProjectDocumentSchema = Schema.Struct({
  root: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  tags: Schema.optional(Schema.Array(Schema.String)),
  targets: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
});
const ProjectTargetSchema = Schema.Struct({
  executor: Schema.optional(Schema.String),
  cache: Schema.optional(Schema.Boolean),
  command: Schema.optional(Schema.Unknown),
  options: Schema.optional(Schema.Unknown),
  metadata: Schema.optional(Schema.Struct({ niceeval: Schema.optional(Schema.Unknown) })),
});

const fileSystem = <A>(
  operation: DiscoveryIoError["operation"],
  path: string,
  use: (service: FileSystem.FileSystem) => Effect.Effect<A, unknown>,
): Effect.Effect<A, DiscoveryIoError, FileSystem.FileSystem> =>
  Effect.flatMap(FileSystem.FileSystem, use).pipe(
    Effect.mapError((cause) => new DiscoveryIoError({ operation, path, cause })),
  );

const exists = (path: string): Effect.Effect<boolean, DiscoveryIoError, FileSystem.FileSystem> =>
  fileSystem("exists", path, (service) => service.exists(path));

const readText = (path: string): Effect.Effect<string, DiscoveryIoError, FileSystem.FileSystem> =>
  fileSystem("read-file", path, (service) => service.readFileString(path));

const parseProjectJson = (text: string): Either.Either<unknown, string> => {
  try {
    return Either.right(JSON.parse(text));
  } catch (cause) {
    return Either.left(cause instanceof Error ? cause.message : String(cause));
  }
};

const collectLeafDirs = (root: string, adapter: boolean): Effect.Effect<readonly string[], DiscoveryIoError, FileSystem.FileSystem> =>
  Effect.flatMap(exists(root), (present) => present
    ? Effect.gen(function*() {
      const names = yield* fileSystem("read-directory", root, (service) => service.readDirectory(root));
      const entries = yield* Effect.forEach(names, (name) => {
        const path = join(root, name);
        return fileSystem("stat", path, (service) => service.stat(path)).pipe(
          Effect.map((info) => ({ path, isDirectory: info.type === "Directory" })),
        );
      }, { concurrency: 1 });
      return entries
        .filter((entry) => entry.isDirectory)
        .map((entry) => entry.path)
        .filter((dir) => adapter || dir !== join(root, ADAPTER_COLLECTION))
        .sort((left, right) => left.localeCompare(right));
    })
    : Effect.succeed([]));

const loadProject = (checkoutRoot: string, dir: string): Effect.Effect<DiscoveryResult, DiscoveryIoError, FileSystem.FileSystem> =>
  Effect.gen(function*() {
    const packagePath = join(dir, "package.json");
    const projectPath = join(dir, "project.json");
    const source = relative(checkoutRoot, projectPath).replaceAll("\\", "/");
    const [hasPackage, hasProject] = yield* Effect.all([exists(packagePath), exists(projectPath)]);
    if (hasPackage && !hasProject) return { repos: [], errors: [`${relative(checkoutRoot, dir)}: scenario package.json is missing project.json`] };
    if (!hasPackage && !hasProject) return { repos: [], errors: [] };
    if (!hasPackage) return { repos: [], errors: [`${source}: E2E project is missing scenario package.json`] };

    const text = yield* readText(projectPath);
    const parsedJson = parseProjectJson(text);
    if (Either.isLeft(parsedJson)) return { repos: [], errors: [`${source}: invalid JSON (${parsedJson.left})`] };
    const raw = parsedJson.right;
    const project = decodeExternal(ProjectDocumentSchema, "NxProjectConfiguration")(raw);
    if (Either.isLeft(project)) return { repos: [], errors: [`${source}: ${ParseResult.TreeFormatter.formatErrorSync(project.left.issue)}`] };

    const expectedRoot = relative(checkoutRoot, dir).replaceAll("\\", "/");
    const id = canonicalRepoId(expectedRoot);
    const expectedName = e2eProjectName(id);
    const errors: string[] = [];
    if (!isCanonicalRelativePath(id)) errors.push(`${source}: derived E2E id is not a canonical contained path: ${JSON.stringify(id)}`);
    if (project.right.root !== expectedRoot) errors.push(`${source}: "root" must be ${JSON.stringify(expectedRoot)}`);
    if (project.right.name !== expectedName) errors.push(`${source}: "name" must be ${JSON.stringify(expectedName)}`);
    if (project.right.tags === undefined || !project.right.tags.includes("kind:e2e") || !project.right.tags.includes(`e2e:${id}`)) {
      errors.push(`${source}: tags must include "kind:e2e" and ${JSON.stringify(`e2e:${id}`)}`);
    }
    const targetRaw = project.right.targets?.e2e;
    const target = targetRaw === undefined ? undefined : decodeExternal(ProjectTargetSchema, "NxE2ETarget")(targetRaw);
    if (targetRaw === undefined) errors.push(`${source}: targets.e2e is required`);
    if (target && Either.isLeft(target)) errors.push(`${source}: ${ParseResult.TreeFormatter.formatErrorSync(target.left.issue)}`);
    const configured = target && Either.isRight(target) ? target.right : undefined;
    if (configured?.executor !== "nx:selection-only") errors.push(`${source}: targets.e2e.executor must be the non-resolvable selection guard "nx:selection-only"`);
    if (configured && (configured.command !== undefined || configured.options !== undefined)) errors.push(`${source}: targets.e2e is selection-only and must not declare command or options`);
    if (configured?.cache !== false) errors.push(`${source}: targets.e2e.cache must be false`);
    const metadata = configured?.metadata?.niceeval;
    if (metadata === undefined) errors.push(`${source}: targets.e2e.metadata.niceeval is required`);
    const decoded = metadata === undefined ? undefined : parseManifest(metadata);
    if (decoded && Either.isLeft(decoded)) errors.push(formatManifestError(source, decoded.left));
    if (errors.length > 0 || decoded === undefined || Either.isLeft(decoded)) return { repos: [], errors };

    return { repos: [{ dir, projectName: expectedName, manifest: { ...decoded.right, id } }], errors: [] };
  });

/** File discovery is effectful; validation failures are returned as diagnostics. */
export const discoverAllRepos = (e2eRoot: string): Effect.Effect<DiscoveryResult, DiscoveryIoError, FileSystem.FileSystem> =>
  Effect.gen(function*() {
    const checkoutRoot = resolve(e2eRoot, "..");
    const dirs = [
      ...(yield* collectLeafDirs(e2eRoot, false)),
      ...(yield* collectLeafDirs(join(e2eRoot, ADAPTER_COLLECTION), true)),
    ];
    const loaded = yield* Effect.forEach(dirs, (dir) => loadProject(checkoutRoot, dir), { concurrency: 1 });
    const repos = loaded.flatMap((result) => result.repos);
    const errors = loaded.flatMap((result) => result.errors);
    const ids = new Set<string>();
    const names = new Map<string, string[]>();
    for (const repo of repos) {
      if (ids.has(repo.manifest.id)) errors.push(`duplicate E2E id ${JSON.stringify(repo.manifest.id)}`);
      ids.add(repo.manifest.id);
      names.set(repo.projectName, [...(names.get(repo.projectName) ?? []), repo.manifest.id]);
    }
    for (const [name, repoIds] of names) {
      if (repoIds.length > 1) errors.push(`duplicate E2E project name ${JSON.stringify(name)} derived by: ${repoIds.join(", ")}`);
    }
    if (repos.length === 0) errors.push("E2E discovery found no scenario projects");
    return { repos, errors };
  });
