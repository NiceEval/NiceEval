// Shared discovery for the e2e root orchestrator.
//
// Layout (docs/engineering/testing/e2e/scenario-repos.md): e2e/adapter/ is the
// only collection — one repo per immediate subdirectory — and every other
// immediate child of e2e/ that carries its own e2e.json is a standalone
// feature repo (undo/, scripts/ carry no top-level e2e.json and are never
// scanned). Physical location is grouping only, not identity.
//
// Identity rules: every repo declares `id` in its e2e.json (schema in
// manifest.ts); adapter collection repos must declare `adapter/<leaf>` and ids
// are globally unique across the whole discovered set.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseManifest, type E2ERepoManifest } from "./manifest.ts";

export type { E2ERepoManifest, RepoRequires } from "./manifest.ts";

export interface DiscoveredRepo {
  /** Absolute path to the repo directory (e.g. e2e/adapter/ai-sdk or e2e/cli). */
  dir: string;
  manifest: E2ERepoManifest;
}

export interface DiscoveryResult {
  repos: DiscoveredRepo[];
  /** Empty when discovery is clean. Non-empty means the caller must treat the whole run as invalid. */
  errors: string[];
}

export const ADAPTER_COLLECTION = "adapter";
const ADAPTER_ID_PREFIX = "adapter/";

/** Absolute path to the niceeval checkout root (two levels up from e2e/scripts/). */
export function repoRootDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "..", "..");
}

/** Absolute path to e2e/, the root every test repo lives under. */
export function e2eRootDir(): string {
  return join(repoRootDir(), "e2e");
}

/** Absolute path to e2e/adapter/, the collection holding every adapter test repo. */
export function adapterRootDir(): string {
  return join(e2eRootDir(), ADAPTER_COLLECTION);
}

function describe(reposRoot: string, manifestPath: string): string {
  return relative(reposRoot, manifestPath) || manifestPath;
}

type LoadedManifest = { ok: true; manifest: E2ERepoManifest } | { ok: false; errors: string[] };

function loadManifestFile(manifestPath: string, source: string): LoadedManifest {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (err) {
    return { ok: false, errors: [`${source}: invalid JSON (${(err as Error).message})`] };
  }
  const result = parseManifest(raw, source);
  if (!result.ok) return { ok: false, errors: result.errors };
  return { ok: true, manifest: result.manifest };
}

/**
 * Discover every repo under one flat root: each `<root>/<name>/e2e.json`.
 *
 * When `enforceAdapterId` is set, every manifest id must be `adapter/<name>`
 * — adapter identity is location-derived and cannot drift from its directory.
 * Zero repos under `root` (directory missing or empty) is not an error.
 */
function collectRepos(root: string, enforceAdapterId: boolean): { repos: DiscoveredRepo[]; errors: string[] } {
  const repos: DiscoveredRepo[] = [];
  const errors: string[] = [];

  if (!existsSync(root)) return { repos, errors };

  const names = readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));

  for (const name of names) {
    const dir = join(root, name);
    const manifestPath = join(dir, "e2e.json");
    if (!existsSync(manifestPath)) continue; // not a repo (yet) — not an error

    const source = describe(root, manifestPath);
    const loaded = loadManifestFile(manifestPath, source);
    if (!loaded.ok) {
      errors.push(...loaded.errors);
      continue;
    }
    const manifest = loaded.manifest;

    if (enforceAdapterId) {
      const expected = `${ADAPTER_ID_PREFIX}${name}`;
      if (manifest.id !== expected) {
        errors.push(
          `${source}: "id" must be ${JSON.stringify(expected)} for adapter repos, got ${JSON.stringify(manifest.id)}`,
        );
        continue;
      }
    }

    repos.push({ dir, manifest });
  }

  return { repos, errors };
}

/**
 * Discover every repo across the e2e/ layout: each adapter repo under
 * `adapter/<leaf>/` plus every standalone feature repo `e2e/<name>/` that
 * carries its own e2e.json. Ids are globally unique across the whole set;
 * a duplicate or a malformed manifest lands in `errors`, and callers must
 * treat a non-empty `errors` as fatal (the whole discovery result is
 * untrustworthy, not just the bad repo).
 */
export function discoverAllRepos(e2eRoot: string): DiscoveryResult {
  const repos: DiscoveredRepo[] = [];
  const errors: string[] = [];

  const adapter = collectRepos(join(e2eRoot, ADAPTER_COLLECTION), true);
  repos.push(...adapter.repos);
  errors.push(...adapter.errors);

  const standalone = collectRepos(e2eRoot, false);
  for (const repo of standalone.repos) {
    if (repo.dir !== join(e2eRoot, ADAPTER_COLLECTION)) repos.push(repo);
  }
  errors.push(...standalone.errors);

  const byId = new Map<string, string[]>();
  for (const r of repos) {
    const list = byId.get(r.manifest.id) ?? [];
    list.push(relative(e2eRoot, r.dir));
    byId.set(r.manifest.id, list);
  }
  for (const [id, dirs] of byId) {
    if (dirs.length > 1) {
      errors.push(`duplicate id ${JSON.stringify(id)} declared by: ${dirs.join(", ")}`);
    }
  }

  return { repos, errors };
}
