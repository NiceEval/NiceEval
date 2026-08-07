#!/usr/bin/env -S npx tsx
// Pure E2E selection and matrix planning.
//
// Planning deliberately stops at discovery and selection. It never packs the
// candidate, installs a repo, or reads the secret environment.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { relative, resolve } from "node:path";
import { parseArgs } from "node:util";

import { discoverAllRepos, e2eRootDir, type DiscoveredRepo } from "./discovery.ts";
import { LANES, type Area, type Executor, type Lane, type RepoRequires } from "./manifest.ts";

export interface SelectionOptions {
  /** When omitted, run.ts keeps its historical all-lanes behavior. */
  lane?: Lane;
  /** Repeating --repo is a union; duplicate ids are run/planned once. */
  repoIds?: readonly string[];
  /** An unavailable/empty diff is intentionally fail-open. */
  diffPaths?: readonly string[];
  /** Matches a manifest area (the manifest's capability vocabulary). */
  capability?: string;
}

export interface PlanEntry {
  id: string;
  /** Path relative to e2e/, suitable for a matrix job's checkout. */
  dir: string;
  executor: Executor;
  /** Manifest areas are the stable capability vocabulary. */
  capabilities: readonly Area[];
  /** One discovered repo is one executable matrix shard. */
  shard: string;
  requires?: RepoRequires;
}

export interface PlanCli {
  lane: Lane;
  repoIds: readonly string[];
  diffPaths?: readonly string[];
  capability?: string;
  json: boolean;
}

function normalizePath(value: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//, "");
  return normalized === "." ? "" : normalized;
}

function escapeRegExpChar(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Match the small glob vocabulary used by manifest.paths without a package dependency. */
export function pathMatches(pattern: string, path: string): boolean {
  const source = normalizePath(pattern);
  const value = normalizePath(path);
  let expression = "^";

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === "*" && source[index + 1] === "*") {
      index += 1;
      if (source[index + 1] === "/") {
        index += 1;
        expression += "(?:.*/)?";
      } else {
        expression += ".*";
      }
    } else if (character === "*") {
      expression += "[^/]*";
    } else if (character === "?") {
      expression += "[^/]";
    } else {
      expression += escapeRegExpChar(character);
    }
  }

  return new RegExp(`${expression}$`).test(value);
}

function hasChangedPath(repo: DiscoveredRepo, diffPaths: readonly string[]): boolean {
  // An empty paths declaration means that this repo has opted out of the
  // optimization. Keeping it selected is the safe interpretation.
  if (repo.manifest.paths.length === 0) return true;
  return repo.manifest.paths.some((pattern) => diffPaths.some((path) => pathMatches(pattern, path)));
}

function collectRepoIds(repoIds: readonly string[]): string[] {
  return [...new Set(repoIds)].filter((id) => id.length > 0);
}

/**
 * Apply the formal selection contract in a deterministic order supplied by
 * discovery: lane, explicit repo union, optional capability, optional paths.
 * Missing diff paths do not reject anything; callers must fail open when the
 * diff cannot be computed.
 */
export function selectRepos(all: readonly DiscoveredRepo[], options: SelectionOptions): DiscoveredRepo[] {
  const repoIds = collectRepoIds(options.repoIds ?? []);
  if (repoIds.length > 0) {
    const knownIds = new Set(all.map((repo) => repo.manifest.id));
    const missing = repoIds.filter((id) => !knownIds.has(id));
    if (missing.length > 0) {
      const known = all.map((repo) => repo.manifest.id).join(", ") || "(none discovered)";
      throw new Error(`--repo requested unknown id(s): ${missing.join(", ")}. Known ids: ${known}`);
    }
  }

  const requestedIds = repoIds.length > 0 ? new Set(repoIds) : undefined;
  const diffPaths = options.diffPaths && options.diffPaths.length > 0 ? options.diffPaths : undefined;

  return all.filter((repo) => {
    const manifest = repo.manifest;
    if (options.lane !== undefined && !manifest.lanes.includes(options.lane)) return false;
    if (requestedIds !== undefined && !requestedIds.has(manifest.id)) return false;
    if (options.capability !== undefined && !manifest.areas.some((area) => area === options.capability)) return false;
    if (diffPaths !== undefined && !hasChangedPath(repo, diffPaths)) return false;
    return true;
  });
}

/** Read-only best effort diff lookup. Any failure, including an empty result, is fail-open. */
export function tryReadDiffPaths(cwd: string): readonly string[] | undefined {
  try {
    const result = spawnSync("git", ["diff", "--name-only", "--no-renames", "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (result.error || result.status !== 0 || typeof result.stdout !== "string") return undefined;
    const paths = result.stdout
      .split(/\r?\n/)
      .map(normalizePath)
      .filter((path) => path.length > 0);
    return paths.length > 0 ? paths : undefined;
  } catch {
    return undefined;
  }
}

function valueAsStrings(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  return typeof value === "string" ? [value] : [];
}

function parseLane(value: unknown): Lane {
  if (value === undefined) return "pr";
  if (typeof value !== "string" || !(LANES as readonly string[]).includes(value)) {
    throw new Error(`--lane must be one of ${LANES.join("|")}, got ${JSON.stringify(value)}`);
  }
  return value as Lane;
}

export function parsePlanCli(argv: readonly string[]): PlanCli {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      lane: { type: "string" },
      repo: { type: "string", multiple: true, default: [] },
      "diff-path": { type: "string", multiple: true },
      diff: { type: "string", multiple: true },
      capability: { type: "string" },
      json: { type: "boolean", default: false },
    },
    allowPositionals: false,
    strict: true,
  });

  const lane = parseLane(values.lane);
  const diffPaths = [...valueAsStrings(values["diff-path"]), ...valueAsStrings(values.diff)];
  const capability = typeof values.capability === "string" ? values.capability : undefined;

  return {
    lane,
    repoIds: valueAsStrings(values.repo),
    diffPaths: diffPaths.length > 0 ? diffPaths : undefined,
    capability,
    json: values.json === true,
  };
}

export function makePlan(repos: readonly DiscoveredRepo[], root: string, options: SelectionOptions): PlanEntry[] {
  return selectRepos(repos, options)
    .map((repo) => ({
      id: repo.manifest.id,
      dir: relative(root, repo.dir),
      executor: repo.manifest.executor,
      capabilities: repo.manifest.areas,
      shard: repo.manifest.id,
      ...(repo.manifest.requires === undefined ? {} : { requires: repo.manifest.requires }),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function printHumanPlan(entries: readonly PlanEntry[], lane: Lane): void {
  if (entries.length === 0) {
    console.log(`[e2e] no repos matched lane ${lane}.`);
    return;
  }
  console.log(`${entries.length} e2e shard(s) selected for lane ${lane}:\n`);
  for (const entry of entries) {
    const executor = entry.executor.kind === "docker" ? `docker (${entry.executor.image})` : "host";
    console.log(`- ${entry.id}  [${entry.capabilities.join(", ")}]  executor=${executor}`);
    console.log(`    dir: ${entry.dir}  shard: ${entry.shard}`);
  }
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<boolean> {
  try {
    const cli = parsePlanCli(argv);
    const e2eRoot = e2eRootDir();
    const { repos, errors } = discoverAllRepos(e2eRoot);
    if (errors.length > 0) {
      console.error(`[e2e] repo discovery found ${errors.length} problem(s):\n`);
      for (const error of errors) console.error(`  - ${error}`);
      process.exitCode = 1;
      return false;
    }

    const diffPaths = cli.diffPaths ?? tryReadDiffPaths(resolve(e2eRoot, ".."));
    const entries = makePlan(repos, e2eRoot, {
      lane: cli.lane,
      repoIds: cli.repoIds,
      diffPaths,
      capability: cli.capability,
    });

    if (cli.json) {
      console.log(JSON.stringify(entries));
    } else {
      printHumanPlan(entries, cli.lane);
    }
    return true;
  } catch (error) {
    console.error(`[e2e] ${(error as Error).message}`);
    process.exitCode = 1;
    return false;
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main();
}
