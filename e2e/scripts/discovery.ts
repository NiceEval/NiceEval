// Shared discovery + schema validation for the e2e root orchestrator.
//
// This module is orchestration code, not a test repo under e2e/repos/*, so it
// is exempt from the "no shared code between test repos" rule in
// docs/engineering/e2e-ci/README.md — it only reads each repo's own e2e.json,
// never a repo's Eval/Experiment/adapter source.
//
// Schema is defined in docs/engineering/e2e-ci/README.md §2.3.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const GROUPS = ["sdk", "sandbox", "contract"] as const;
export type Group = (typeof GROUPS)[number];

export interface RepoRequires {
  runtimes?: string[];
  docker?: boolean;
  arch?: string;
  memoryGB?: number;
}

export interface RepoManifest {
  id: string;
  group: Group;
  command: string[];
  timeoutMinutes: number;
  secrets: string[];
  artifacts: string[];
  requires?: RepoRequires;
}

export interface DiscoveredRepo {
  /** Absolute path to the repo directory (e.g. e2e/repos/claude-agent-sdk). */
  dir: string;
  manifest: RepoManifest;
}

export interface DiscoveryResult {
  repos: DiscoveredRepo[];
  /** Empty when discovery is clean. Non-empty means the caller must treat the whole run as invalid. */
  errors: string[];
}

/** Absolute path to the niceeval checkout root (two levels up from e2e/scripts/). */
export function repoRootDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "..", "..");
}

/** Absolute path to e2e/repos/, the root under which every test repo lives. */
export function reposRootDir(): string {
  return join(repoRootDir(), "e2e", "repos");
}

function describe(reposRoot: string, manifestPath: string): string {
  return relative(reposRoot, manifestPath) || manifestPath;
}

type ValidateResult = { ok: true; manifest: RepoManifest } | { ok: false; errors: string[] };

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((item) => typeof item === "string");
}

function validateManifest(raw: unknown, source: string): ValidateResult {
  const errors: string[] = [];

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: [`${source}: e2e.json must be a JSON object`] };
  }
  const r = raw as Record<string, unknown>;

  if (typeof r.id !== "string" || r.id.trim() === "") {
    errors.push(`${source}: "id" must be a non-empty string, got ${JSON.stringify(r.id)}`);
  }

  if (typeof r.group !== "string" || !(GROUPS as readonly string[]).includes(r.group)) {
    errors.push(`${source}: "group" must be one of ${GROUPS.join("|")}, got ${JSON.stringify(r.group)}`);
  }

  if (!isStringArray(r.command) || r.command.length === 0 || r.command.some((c) => c.length === 0)) {
    errors.push(`${source}: "command" must be a non-empty array of non-empty strings, got ${JSON.stringify(r.command)}`);
  }

  if (typeof r.timeoutMinutes !== "number" || !Number.isFinite(r.timeoutMinutes) || r.timeoutMinutes <= 0) {
    errors.push(`${source}: "timeoutMinutes" must be a positive number, got ${JSON.stringify(r.timeoutMinutes)}`);
  }

  if (!isStringArray(r.secrets)) {
    errors.push(`${source}: "secrets" must be an array of strings, got ${JSON.stringify(r.secrets)}`);
  }

  if (!isStringArray(r.artifacts)) {
    errors.push(`${source}: "artifacts" must be an array of strings, got ${JSON.stringify(r.artifacts)}`);
  }

  let requires: RepoRequires | undefined;
  if (r.requires !== undefined) {
    if (typeof r.requires !== "object" || r.requires === null || Array.isArray(r.requires)) {
      errors.push(`${source}: "requires" must be an object when present, got ${JSON.stringify(r.requires)}`);
    } else {
      const req = r.requires as Record<string, unknown>;
      requires = {};

      if (req.runtimes !== undefined) {
        if (!isStringArray(req.runtimes)) {
          errors.push(`${source}: "requires.runtimes" must be an array of strings, got ${JSON.stringify(req.runtimes)}`);
        } else {
          requires.runtimes = req.runtimes;
        }
      }
      if (req.docker !== undefined) {
        if (typeof req.docker !== "boolean") {
          errors.push(`${source}: "requires.docker" must be a boolean, got ${JSON.stringify(req.docker)}`);
        } else {
          requires.docker = req.docker;
        }
      }
      if (req.arch !== undefined) {
        if (typeof req.arch !== "string" || req.arch.trim() === "") {
          errors.push(`${source}: "requires.arch" must be a non-empty string, got ${JSON.stringify(req.arch)}`);
        } else {
          requires.arch = req.arch;
        }
      }
      if (req.memoryGB !== undefined) {
        if (typeof req.memoryGB !== "number" || !Number.isFinite(req.memoryGB) || req.memoryGB <= 0) {
          errors.push(`${source}: "requires.memoryGB" must be a positive number, got ${JSON.stringify(req.memoryGB)}`);
        } else {
          requires.memoryGB = req.memoryGB;
        }
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    manifest: {
      id: (r.id as string).trim(),
      group: r.group as Group,
      command: r.command as string[],
      timeoutMinutes: r.timeoutMinutes as number,
      secrets: r.secrets as string[],
      artifacts: r.artifacts as string[],
      requires,
    },
  };
}

/**
 * Discover every e2e/repos/<id>/e2e.json, parse and validate it against the
 * schema, and check that every id is globally unique.
 *
 * Zero repos under reposRoot (directory missing or empty) is not an error —
 * it returns `{ repos: [], errors: [] }`. Any malformed e2e.json or duplicate
 * id is collected into `errors`; callers must treat a non-empty `errors` as
 * fatal (the whole discovery result is untrustworthy, not just the bad repo).
 */
export function discoverRepos(reposRoot: string): DiscoveryResult {
  const repos: DiscoveredRepo[] = [];
  const errors: string[] = [];

  if (!existsSync(reposRoot)) {
    return { repos, errors };
  }

  const entries = readdirSync(reposRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));

  for (const name of entries) {
    const dir = join(reposRoot, name);
    const manifestPath = join(dir, "e2e.json");
    if (!existsSync(manifestPath)) continue; // not a repo (yet) — not an error

    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(manifestPath, "utf8"));
    } catch (err) {
      errors.push(`${describe(reposRoot, manifestPath)}: invalid JSON (${(err as Error).message})`);
      continue;
    }

    const result = validateManifest(raw, describe(reposRoot, manifestPath));
    if (!result.ok) {
      errors.push(...result.errors);
      continue;
    }

    repos.push({ dir, manifest: result.manifest });
  }

  const byId = new Map<string, string[]>();
  for (const r of repos) {
    const list = byId.get(r.manifest.id) ?? [];
    list.push(r.dir);
    byId.set(r.manifest.id, list);
  }
  for (const [id, dirs] of byId) {
    if (dirs.length > 1) {
      errors.push(
        `duplicate id "${id}" declared by: ${dirs.map((d) => describe(reposRoot, d)).join(", ")}`,
      );
    }
  }

  return { repos, errors };
}
