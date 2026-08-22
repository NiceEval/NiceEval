#!/usr/bin/env -S npx tsx
// Nx-backed E2E selection. Planning is graph-only: no pack, secret read,
// scenario child process, Testkit build, or artifact creation occurs here.

import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { parseArgs } from "node:util";

import { discoverAllRepos, e2eRootDir, repoRootDir, type DiscoveredRepo } from "./discovery.ts";
import { LANES, type Area, type BatchId, type Executor, type Lane, type RepoRequires } from "./manifest.ts";

const NX_DATA_DIR = join(tmpdir(), `niceeval-nx-plan-${process.pid}`);
function nxEnvironment(): NodeJS.ProcessEnv {
  return { ...process.env, NX_DAEMON: "false", NX_WORKSPACE_DATA_DIRECTORY: NX_DATA_DIR };
}

export interface SelectionOptions {
  lane?: Lane;
  repoIds?: readonly string[];
  capability?: string;
  excludeExternalNetwork?: boolean;
  affectedProjectNames?: readonly string[];
}

export interface PlanEntry {
  id: string;
  repoIds: readonly string[];
  batch: BatchId;
  dir?: string;
  dirs: readonly string[];
  executor: Executor;
  capabilities: readonly Area[];
  shard: string;
  requires?: RepoRequires;
}

export type PlanMode = "invalid" | "affected" | "full" | "fail-open-full";

export interface PlanDocument {
  schemaVersion: 1;
  mode: PlanMode;
  reason: string;
  detail?: string;
  lane: Lane;
  range?: { base: string; head: string };
  changedPaths: readonly string[];
  projectIds: readonly string[];
  cells: readonly PlanEntry[];
  graph: {
    selector: "nx show projects --affected --with-target e2e";
    nxVersion: "23.1.1";
    affectedProjectNames: readonly string[];
    selectedE2EProjectNames: readonly string[];
    e2eProjectNames: readonly string[];
  };
}

export interface PlanCli {
  lane: Lane;
  repoIds: readonly string[];
  diffPaths?: readonly string[];
  noDiff: boolean;
  base?: string;
  head?: string;
  capability?: string;
  excludeExternalNetwork: boolean;
  batch: boolean;
  json: boolean;
}

function collectRepoIds(repoIds: readonly string[]): string[] {
  return [...new Set(repoIds)].filter((id) => id.length > 0);
}

export function selectRepos(all: readonly DiscoveredRepo[], options: SelectionOptions): DiscoveredRepo[] {
  const repoIds = collectRepoIds(options.repoIds ?? []);
  const knownIds = new Set(all.map((repo) => repo.manifest.id));
  const missing = repoIds.filter((id) => !knownIds.has(id));
  if (missing.length > 0) {
    throw new Error(`--repo requested unknown id(s): ${missing.join(", ")}. Known ids: ${[...knownIds].join(", ")}`);
  }
  const requested = repoIds.length > 0 ? new Set(repoIds) : undefined;
  const affected = options.affectedProjectNames === undefined ? undefined : new Set(options.affectedProjectNames);
  const explicitlyRequested = requested === undefined ? [] : all.filter((repo) => requested.has(repo.manifest.id));
  if (options.lane !== undefined) {
    const unavailable = explicitlyRequested.filter((repo) => !repo.manifest.lanes.includes(options.lane!));
    if (unavailable.length > 0) {
      throw new Error(`--repo selection is unavailable in lane ${JSON.stringify(options.lane)} for: ${unavailable.map((repo) => `${repo.manifest.id}: ${repo.manifest.lanes.join(", ")}`).join("; ")}`);
    }
  }
  if (options.excludeExternalNetwork && explicitlyRequested.some((repo) => repo.manifest.requires?.externalNetwork === true)) {
    throw new Error(`--repo selection requires external network but --exclude-external-network was set: ${explicitlyRequested.filter((repo) => repo.manifest.requires?.externalNetwork === true).map((repo) => repo.manifest.id).join(", ")}`);
  }
  return all.filter((repo) => {
    if (options.lane !== undefined && !repo.manifest.lanes.includes(options.lane)) return false;
    if (requested !== undefined && !requested.has(repo.manifest.id)) return false;
    if (options.capability !== undefined && !repo.manifest.areas.includes(options.capability as Area)) return false;
    if (options.excludeExternalNetwork && repo.manifest.requires?.externalNetwork === true) return false;
    if (requested === undefined && affected !== undefined && !affected.has(repo.projectName)) return false;
    return true;
  });
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
      lane: { type: "string" }, repo: { type: "string", multiple: true, default: [] },
      "diff-path": { type: "string", multiple: true }, diff: { type: "string", multiple: true },
      "no-diff": { type: "boolean", default: false }, base: { type: "string" }, head: { type: "string" },
      capability: { type: "string" }, "exclude-external-network": { type: "boolean", default: false },
      batch: { type: "boolean", default: false }, json: { type: "boolean", default: false },
    },
    allowPositionals: false, strict: true,
  });
  const diffPaths = [...valueAsStrings(values["diff-path"]), ...valueAsStrings(values.diff)];
  const noDiff = values["no-diff"] === true;
  const base = typeof values.base === "string" ? values.base : undefined;
  const head = typeof values.head === "string" ? values.head : undefined;
  if (noDiff && (diffPaths.length > 0 || base !== undefined || head !== undefined)) throw new Error("--no-diff cannot be combined with diff paths or --base/--head");
  if ((base === undefined) !== (head === undefined)) throw new Error("--base and --head must be supplied together");
  if (diffPaths.length > 0 && base !== undefined) throw new Error("diff paths cannot be combined with --base/--head");
  return {
    lane: parseLane(values.lane), repoIds: valueAsStrings(values.repo),
    ...(diffPaths.length > 0 ? { diffPaths } : {}), noDiff, ...(base === undefined ? {} : { base, head }),
    ...(typeof values.capability === "string" ? { capability: values.capability } : {}),
    excludeExternalNetwork: values["exclude-external-network"] === true,
    batch: values.batch === true, json: values.json === true,
  };
}

function singletonEntry(repo: DiscoveredRepo, root: string): PlanEntry {
  const dir = relative(root, repo.dir).replaceAll("\\", "/");
  return { id: repo.manifest.id, repoIds: [repo.manifest.id], batch: repo.manifest.batch, dir, dirs: [dir], executor: repo.manifest.executor, capabilities: repo.manifest.areas, shard: repo.manifest.id, ...(repo.manifest.requires === undefined ? {} : { requires: repo.manifest.requires }) };
}

function mergedRequires(entries: readonly PlanEntry[]): RepoRequires | undefined {
  const requirements = entries.flatMap((entry) => entry.requires === undefined ? [] : [entry.requires]);
  if (requirements.length === 0) return undefined;
  const runtimes = [...new Set(requirements.flatMap((r) => r.runtimes ?? []))];
  const browsers = [...new Set(requirements.flatMap((r) => r.browsers ?? []))];
  const sets = requirements.flatMap((r) => r.platforms === undefined ? [] : [new Set(r.platforms)]);
  const platforms = sets.length === 0 ? [] : [...sets[0]!].filter((p) => sets.slice(1).every((set) => set.has(p)));
  if (sets.length > 0 && platforms.length === 0) throw new Error("E2E batch has no host platform accepted by every Repo");
  return { ...(requirements.some((r) => r.docker) ? { docker: true } : {}), ...(requirements.some((r) => r.externalNetwork) ? { externalNetwork: true } : {}), ...(platforms.length ? { platforms } : {}), ...(runtimes.length ? { runtimes } : {}), ...(browsers.length ? { browsers } : {}) };
}

function repoBatch(entries: readonly PlanEntry[]): PlanEntry {
  const first = entries[0];
  if (!first || new Set(entries.map((e) => JSON.stringify(e.executor))).size !== 1) throw new Error("E2E batch requires one shared executor");
  if (new Set(entries.map((e) => e.batch)).size !== 1) throw new Error("E2E batch contains multiple placement ids");
  const id = `repo-batch-${first.batch}`;
  const requires = mergedRequires(entries);
  return { id, repoIds: entries.flatMap((e) => e.repoIds), batch: first.batch, dirs: entries.flatMap((e) => e.dirs), executor: first.executor, capabilities: [...new Set(entries.flatMap((e) => e.capabilities))], shard: id, ...(requires ? { requires } : {}) };
}

export function batchEntries(entries: readonly PlanEntry[]): PlanEntry[] {
  const groups = new Map<string, PlanEntry[]>();
  for (const entry of entries) groups.set(entry.batch, [...(groups.get(entry.batch) ?? []), entry]);
  const result = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, group]) => repoBatch(group));
  const before = entries.flatMap((e) => e.repoIds).sort();
  const after = result.flatMap((e) => e.repoIds).sort();
  if (new Set(after).size !== after.length || JSON.stringify(before) !== JSON.stringify(after)) throw new Error("batching changed the selected E2E repo-id set");
  return result;
}

function runGit(args: readonly string[], cwd: string): string {
  const result = spawnSync("git", [...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.error || result.status !== 0) throw new Error((result.stderr || result.error?.message || `git ${args[0]} failed`).trim());
  return result.stdout.trim();
}

function gitChangedPaths(args: readonly string[], cwd: string): string[] {
  const result = spawnSync("git", [...args, "--name-only", "-z", "--no-renames"], { cwd, encoding: "buffer", stdio: ["ignore", "pipe", "pipe"] });
  if (result.error || result.status !== 0 || !Buffer.isBuffer(result.stdout)) throw new Error(`git changed-path discovery failed for ${args.join(" ")}`);
  const decoded = result.stdout.toString("utf8");
  if (decoded.includes("�")) throw new Error("git changed paths contain a filename that is not valid UTF-8");
  return decoded.split("\0").filter(Boolean);
}

function localChangedPaths(cwd: string): string[] {
  const paths: string[] = [];
  paths.push(...gitChangedPaths(["diff"], cwd), ...gitChangedPaths(["diff", "--cached"], cwd));
  const untracked = spawnSync("git", ["ls-files", "--others", "--exclude-standard", "-z"], { cwd, encoding: "buffer", stdio: ["ignore", "pipe", "pipe"] });
  if (untracked.error || untracked.status !== 0 || !Buffer.isBuffer(untracked.stdout)) throw new Error("git untracked-file discovery failed");
  const decoded = untracked.stdout.toString("utf8");
  if (decoded.includes("�")) throw new Error("untracked paths contain a filename that is not valid UTF-8");
  paths.push(...decoded.split("\0").filter(Boolean));
  return [...new Set(paths.map((p) => p.replaceAll("\\", "/")))].sort();
}

function nxProjects(args: readonly string[], cwd: string, withE2ETarget: boolean): string[] {
  const result = spawnSync("pnpm", ["exec", "nx", "show", "projects", "--affected", ...(withE2ETarget ? ["--with-target", "e2e"] : []), "--json", ...args], {
    cwd, encoding: "utf8", env: nxEnvironment(), stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) throw new Error((result.stderr || result.error?.message || "Nx affected selection failed").trim());
  const parsed: unknown = JSON.parse(result.stdout);
  if (!Array.isArray(parsed) || !parsed.every((value) => typeof value === "string")) throw new Error("Nx affected selection did not return a string array");
  return [...new Set(parsed)].sort();
}

interface NxGraphNode { data: { root: string; tags?: string[]; targets?: Record<string, unknown> } }
interface NxGraphDocument { graph: { nodes: Record<string, NxGraphNode>; dependencies: Record<string, Array<{ source: string; target: string }>> } }

function readNxGraph(cwd: string): NxGraphDocument {
  const result = spawnSync("pnpm", ["exec", "nx", "graph", "--file=stdout"], { cwd, encoding: "utf8", env: nxEnvironment(), stdio: ["ignore", "pipe", "pipe"] });
  if (result.error || result.status !== 0) throw new Error((result.stderr || "could not read Nx project graph").trim());
  const raw = JSON.parse(result.stdout) as NxGraphDocument;
  if (!raw?.graph?.nodes || !raw.graph.dependencies) throw new Error("Nx graph JSON is missing nodes or dependencies");
  return raw;
}

function owningProject(path: string, graph: NxGraphDocument): string | undefined {
  const normalized = path.replaceAll("\\", "/");
  return Object.entries(graph.graph.nodes)
    .filter(([, node]) => node.data.root === "." || normalized === node.data.root || normalized.startsWith(`${node.data.root}/`))
    .sort(([, left], [, right]) => right.data.root.length - left.data.root.length)[0]?.[0];
}

function downstreamE2E(project: string, graph: NxGraphDocument): string[] {
  const reverse = new Map<string, string[]>();
  for (const dependencies of Object.values(graph.graph.dependencies)) {
    for (const edge of dependencies) reverse.set(edge.target, [...(reverse.get(edge.target) ?? []), edge.source]);
  }
  const seen = new Set([project]);
  const queue = [project];
  const selected = new Set<string>();
  while (queue.length > 0) {
    const current = queue.shift()!;
    const node = graph.graph.nodes[current];
    if (node?.data.targets?.e2e !== undefined && node.data.tags?.includes("kind:e2e")) selected.add(current);
    for (const dependent of reverse.get(current) ?? []) if (!seen.has(dependent)) { seen.add(dependent); queue.push(dependent); }
  }
  return [...selected].sort();
}

function selectAffected(nxArgs: readonly string[], changedPaths: readonly string[], cwd: string): { all: string[]; e2e: string[] } {
  if (changedPaths.some((path) => /[\r\n,]/.test(path))) throw new Error("changed paths contain comma or newline characters that Nx --files cannot represent losslessly");
  const graph = readNxGraph(cwd);
  const all = nxProjects(nxArgs, cwd, false);
  const e2e = nxProjects(nxArgs, cwd, true);
  const expected = new Set<string>();
  for (const path of changedPaths) {
    const owner = owningProject(path, graph);
    if (owner === undefined) throw new Error(`changed path has no Nx owner: ${path}`);
    const downstream = downstreamE2E(owner, graph);
    const tags = graph.graph.nodes[owner]?.data.tags ?? [];
    if (downstream.length === 0 && !tags.includes("e2e:none")) throw new Error(`changed path ${path} belongs to ${owner}, which has neither E2E downstream nor e2e:none`);
    downstream.forEach((project) => expected.add(project));
  }
  if (JSON.stringify([...expected].sort()) !== JSON.stringify(e2e)) throw new Error(`Nx affected selection disagrees with graph downstream closure: expected=${[...expected].sort().join(",")} actual=${e2e.join(",")}`);
  return { all, e2e };
}

function validateRange(base: string, head: string, cwd: string): { base: string; head: string } {
  const actualHead = runGit(["rev-parse", "HEAD"], cwd);
  const resolvedHead = runGit(["rev-parse", `${head}^{commit}`], cwd);
  const resolvedBase = runGit(["rev-parse", `${base}^{commit}`], cwd);
  if (resolvedHead !== actualHead) throw new Error(`--head must resolve to actual checkout HEAD ${actualHead}, got ${resolvedHead}`);
  runGit(["merge-base", "--is-ancestor", resolvedBase, resolvedHead], cwd);
  return { base: resolvedBase, head: resolvedHead };
}

export interface ResolvedPlan { cli: PlanCli; entries: PlanEntry[]; document: PlanDocument }

export function resolvePlan(argv: readonly string[]): ResolvedPlan {
  try {
  const cli = parsePlanCli(argv);
  const e2eRoot = e2eRootDir();
  const discovery = discoverAllRepos(e2eRoot);
  if (discovery.errors.length) throw new Error(`repo discovery found ${discovery.errors.length} problem(s): ${discovery.errors.join("; ")}`);
  const full = cli.repoIds.length === 0 && (
    cli.noDiff || (cli.lane !== "pr" && cli.base === undefined && cli.diffPaths === undefined)
  );
  let mode: PlanMode = full ? "full" : "affected";
  let reason = cli.repoIds.length
    ? "explicit-repo"
    : cli.noDiff
      ? "explicit-full"
      : cli.lane !== "pr" && cli.base === undefined && cli.diffPaths === undefined
        ? `full-lane-${cli.lane}`
        : "nx-affected";
  let detail: string | undefined;
  let changedPaths: string[] = [];
  let affectedNames: string[] | undefined;
  let allAffectedNames: string[] = [];
  let range: { base: string; head: string } | undefined;
  if (!full && cli.repoIds.length === 0) {
    try {
      if (cli.base && cli.head) {
        range = validateRange(cli.base, cli.head, repoRootDir());
        changedPaths = gitChangedPaths(["diff", `${range.base}...${range.head}`], repoRootDir()).map((path) => path.replaceAll("\\", "/")).sort();
        const selected = changedPaths.length === 0 ? { all: [], e2e: [] } : selectAffected([`--base=${range.base}`, `--head=${range.head}`], changedPaths, repoRootDir());
        affectedNames = selected.e2e;
        allAffectedNames = selected.all;
      } else {
        changedPaths = cli.diffPaths ? [...new Set(cli.diffPaths)].sort() : localChangedPaths(repoRootDir());
        if (changedPaths.length === 0) {
          affectedNames = [];
        } else {
          const selected = selectAffected(changedPaths.flatMap((path) => ["--files", path]), changedPaths, repoRootDir());
          affectedNames = selected.e2e;
          allAffectedNames = selected.all;
        }
        if (changedPaths.length === 0) reason = "clean-working-tree";
      }
    } catch (error) {
      mode = "fail-open-full";
      reason = "nx-selection-failed";
      detail = error instanceof Error ? error.message : String(error);
      affectedNames = undefined;
    }
  }
  const selected = selectRepos(discovery.repos, {
    lane: cli.lane, repoIds: cli.repoIds, capability: mode === "fail-open-full" ? undefined : cli.capability,
    excludeExternalNetwork: cli.excludeExternalNetwork, affectedProjectNames: affectedNames,
  });
  const singleton = selected.map((repo) => singletonEntry(repo, e2eRoot)).sort((a, b) => a.id.localeCompare(b.id));
  const entries = cli.batch ? batchEntries(singleton) : singleton;
  const projectIds = selected.map((repo) => repo.manifest.id).sort();
  const document: PlanDocument = {
    schemaVersion: 1, mode, reason, ...(detail ? { detail } : {}), lane: cli.lane, ...(range ? { range } : {}), changedPaths, projectIds, cells: entries,
    graph: { selector: "nx show projects --affected --with-target e2e", nxVersion: "23.1.1", affectedProjectNames: affectedNames === undefined ? discovery.repos.map((repo) => repo.projectName).sort() : allAffectedNames, selectedE2EProjectNames: affectedNames ?? discovery.repos.map((repo) => repo.projectName).sort(), e2eProjectNames: discovery.repos.map((repo) => repo.projectName).sort() },
  };
  return { cli, entries, document };
  } finally {
    rmSync(NX_DATA_DIR, { recursive: true, force: true });
  }
}

export function printResolvedPlan(plan: ResolvedPlan): void {
  if (plan.cli.json) { console.log(JSON.stringify(plan.document)); return; }
  console.log(`[e2e] mode=${plan.document.mode} reason=${plan.document.reason} lane=${plan.cli.lane}`);
  if (plan.document.detail) console.log(`[e2e] ${plan.document.detail}`);
  if (!plan.entries.length) { console.log("[e2e] affected selection is empty."); return; }
  for (const entry of plan.entries) console.log(`- ${entry.id}: ${entry.repoIds.join(", ")}`);
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  try {
    const plan = resolvePlan(argv); printResolvedPlan(plan); return plan.entries.length;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (argv.includes("--json")) console.log(JSON.stringify({ schemaVersion: 1, mode: "invalid", reason: "invalid-plan", detail: message, cells: [], projectIds: [], changedPaths: [] }));
    else console.error(`[e2e] ${message}`);
    process.exitCode = 1; return -1;
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main();
