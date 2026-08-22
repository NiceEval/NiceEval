// Nx project-graph backed discovery for the E2E root orchestrator.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { isCanonicalRelativePath, parseManifest, type E2ERepoManifest } from "./manifest.ts";

export type { E2ERepoManifest, RepoRequires } from "./manifest.ts";

export interface DiscoveredRepo {
  dir: string;
  projectName: string;
  manifest: E2ERepoManifest;
}

export interface DiscoveryResult {
  repos: DiscoveredRepo[];
  errors: string[];
}

export const ADAPTER_COLLECTION = "adapter";

export function repoRootDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "..", "..", "..");
}

export function e2eRootDir(): string {
  return join(repoRootDir(), "e2e");
}

export function adapterRootDir(): string {
  return join(e2eRootDir(), ADAPTER_COLLECTION);
}

export function canonicalRepoId(projectRoot: string): string {
  const normalized = projectRoot.replaceAll("\\", "/");
  if (!normalized.startsWith("e2e/") || normalized === "e2e/adapter") return "";
  return normalized.slice("e2e/".length);
}

export function e2eProjectName(id: string): string {
  return `e2e-${id.replaceAll("/", "-")}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collectLeafDirs(root: string, adapter: boolean): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(root, entry.name))
    .filter((dir) => adapter || dir !== join(root, ADAPTER_COLLECTION))
    .sort((left, right) => left.localeCompare(right));
}

function loadProject(checkoutRoot: string, dir: string): { repo?: DiscoveredRepo; errors: string[] } {
  const errors: string[] = [];
  const packagePath = join(dir, "package.json");
  const projectPath = join(dir, "project.json");
  const source = relative(checkoutRoot, projectPath).replaceAll("\\", "/");
  const hasPackage = existsSync(packagePath);
  const hasProject = existsSync(projectPath);

  if (hasPackage && !hasProject) return { errors: [`${relative(checkoutRoot, dir)}: scenario package.json is missing project.json`] };
  if (!hasPackage && !hasProject) return { errors };
  if (!hasPackage) return { errors: [`${source}: E2E project is missing scenario package.json`] };

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(projectPath, "utf8"));
  } catch (error) {
    return { errors: [`${source}: invalid JSON (${(error as Error).message})`] };
  }
  if (!isObject(raw)) return { errors: [`${source}: project.json must be a JSON object`] };

  const expectedRoot = relative(checkoutRoot, dir).replaceAll("\\", "/");
  const id = canonicalRepoId(expectedRoot);
  const expectedName = e2eProjectName(id);
  if (!isCanonicalRelativePath(id)) errors.push(`${source}: derived E2E id is not a canonical contained path: ${JSON.stringify(id)}`);
  if (raw.root !== expectedRoot) errors.push(`${source}: "root" must be ${JSON.stringify(expectedRoot)}`);
  if (raw.name !== expectedName) errors.push(`${source}: "name" must be ${JSON.stringify(expectedName)}`);
  if (!Array.isArray(raw.tags) || !raw.tags.includes("kind:e2e") || !raw.tags.includes(`e2e:${id}`)) {
    errors.push(`${source}: tags must include "kind:e2e" and ${JSON.stringify(`e2e:${id}`)}`);
  }
  const targets = isObject(raw.targets) ? raw.targets : undefined;
  const target = targets && isObject(targets.e2e) ? targets.e2e : undefined;
  if (target === undefined) errors.push(`${source}: targets.e2e is required`);
  if (target?.executor !== "nx:selection-only") {
    errors.push(`${source}: targets.e2e.executor must be the non-resolvable selection guard "nx:selection-only"`);
  }
  if (target && ("command" in target || "options" in target)) {
    errors.push(`${source}: targets.e2e is selection-only and must not declare command or options`);
  }
  if (target?.cache !== false) errors.push(`${source}: targets.e2e.cache must be false`);
  const metadata = target && isObject(target.metadata) && isObject(target.metadata.niceeval)
    ? target.metadata.niceeval
    : undefined;
  if (metadata === undefined) errors.push(`${source}: targets.e2e.metadata.niceeval is required`);
  const parsed = metadata === undefined ? undefined : parseManifest(metadata, source);
  if (parsed && !parsed.ok) errors.push(...parsed.errors);
  if (errors.length > 0 || parsed === undefined || !parsed.ok) return { errors };

  return {
    errors,
    repo: { dir, projectName: expectedName, manifest: { ...parsed.manifest, id } },
  };
}

export function discoverAllRepos(e2eRoot: string): DiscoveryResult {
  const checkoutRoot = resolve(e2eRoot, "..");
  const dirs = [
    ...collectLeafDirs(e2eRoot, false),
    ...collectLeafDirs(join(e2eRoot, ADAPTER_COLLECTION), true),
  ];
  const repos: DiscoveredRepo[] = [];
  const errors: string[] = [];
  for (const dir of dirs) {
    const loaded = loadProject(checkoutRoot, dir);
    if (loaded.repo) repos.push(loaded.repo);
    errors.push(...loaded.errors);
  }
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
}
