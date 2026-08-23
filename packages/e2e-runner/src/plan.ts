// Nx-backed E2E selection. Planning is graph-only: no pack, secret read,
// scenario child process, Testkit build, or artifact creation occurs here.

import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { FileSystem } from "@effect/platform";
import ignore from "ignore";
import { Data, Effect, Either, Schema, Scope } from "effect";

import {
  decodeExternal,
  decodeNxGraph,
  type ContractDecodeError,
  type InvalidPlanOutput,
  type Lane,
  type PlanDocument as ContractPlanDocument,
  type PlanEntry as ContractPlanEntry,
  type PlanRange,
} from "./contracts.ts";
import { discoverAllRepos, e2eRootDir, repoRootDir, type DiscoveredRepo, type DiscoveryIoError } from "./discovery.ts";
import { type RepoRequires } from "./manifest.ts";
import { hasSuccessfulOwnedProcessResult, runOwnedProcess, type OwnedProcess, type OwnedProcessResult } from "./owned-process.ts";

const NxProjectNameListSchema = Schema.Array(Schema.String);

export interface SelectionOptions {
  readonly lane?: Lane;
  readonly repoIds?: readonly string[];
  readonly capability?: string;
  readonly excludeExternalNetwork?: boolean;
  readonly affectedProjectNames?: readonly string[];
}

export type PlanEntry = ContractPlanEntry;
export type PlanDocument = ContractPlanDocument;
export type PlanMode = PlanDocument["mode"] | "invalid";

/** Parsed CLI facts are supplied by the command-program lane. */
export interface PlanCli {
  readonly lane: Lane;
  readonly repoIds: readonly string[];
  readonly diffPaths?: readonly string[];
  readonly noDiff: boolean;
  readonly base?: string;
  readonly head?: string;
  readonly capability?: string;
  readonly excludeExternalNetwork: boolean;
  readonly batch: boolean;
  readonly json: boolean;
}

export interface ResolvedPlan {
  readonly cli: PlanCli;
  readonly entries: readonly PlanEntry[];
  readonly document: PlanDocument;
}

export class PlanSelectionError extends Data.TaggedError("PlanSelectionError")<{
  readonly reason: string;
  readonly detail: string;
}> {}

export class PlanProcessError extends Data.TaggedError("PlanProcessError")<{
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly stderr: string;
  readonly detail: string;
  readonly cause: unknown;
}> {}

export class PlanFilesystemError extends Data.TaggedError("PlanFilesystemError")<{
  readonly operation: "exists" | "read-file" | "temporary-directory";
  readonly path: string;
  readonly cause: unknown;
}> {}

export class PlanJsonError extends Data.TaggedError("PlanJsonError")<{
  readonly source: string;
  readonly cause: unknown;
}> {}

const executionErrorDetail = (cause: unknown): string => {
  if (typeof cause === "object" && cause !== null && "detail" in cause && typeof cause.detail === "string") return cause.detail;
  if (typeof cause === "object" && cause !== null && "stderr" in cause && typeof cause.stderr === "string") return cause.stderr.trim();
  return cause instanceof Error ? cause.message : String(cause);
};

const parseJson = (source: string, text: string): Effect.Effect<unknown, PlanJsonError> =>
  Effect.try({
    try: () => JSON.parse(text),
    catch: (cause) => new PlanJsonError({ source, cause }),
  });

const processDetail = (result: OwnedProcessResult): string =>
  result.timedOut
    ? "command timed out; owned process group received TERM and bounded cleanup"
    : result.cancelled
      ? "command was cancelled; owned process group received cleanup"
      : !hasSuccessfulOwnedProcessResult(result)
        ? result.groupCleanup.gone !== true
          ? result.groupCleanup.detail
          : result.error ?? result.signal ?? `command exited ${result.exitCode}`
        : "command completed";

const runCommand = (
  command: string,
  args: readonly string[],
  cwd: string,
  env?: NodeJS.ProcessEnv,
): Effect.Effect<Buffer, PlanProcessError, OwnedProcess | Scope.Scope> =>
  runOwnedProcess([command, ...args], {
    cwd,
    ...(env === undefined ? {} : { env }),
    output: "capture",
    stream: false,
    timeoutMs: 60_000,
  }).pipe(
    Effect.mapError((cause) => new PlanProcessError({ command, args, cwd, stderr: "", detail: cause.detail, cause })),
    Effect.flatMap((result) => hasSuccessfulOwnedProcessResult(result)
      ? Effect.succeed(Buffer.from(result.stdout))
      : Effect.fail(new PlanProcessError({ command, args, cwd, stderr: result.stderr, detail: processDetail(result), cause: result }))),
  );

const runGit = (args: readonly string[], cwd: string): Effect.Effect<string, PlanProcessError, OwnedProcess | Scope.Scope> =>
  Effect.map(runCommand("git", args, cwd), (stdout) => stdout.toString("utf8").trim());

const decodeNulPaths = (source: string, stdout: Buffer): Effect.Effect<readonly string[], PlanJsonError> => {
  const decoded = stdout.toString("utf8");
  return decoded.includes("�")
    ? Effect.fail(new PlanJsonError({ source, cause: "paths contain a filename that is not valid UTF-8" }))
    : Effect.succeed(decoded.split("\0").filter(Boolean));
};

/** `git diff` accepts rename and name-only controls; `ls-files` does not. */
const gitDiffPaths = (args: readonly string[], cwd: string): Effect.Effect<readonly string[], PlanProcessError | PlanJsonError, OwnedProcess | Scope.Scope> =>
  Effect.flatMap(runCommand("git", [...args, "--name-only", "-z", "--no-renames"], cwd), (stdout) =>
    decodeNulPaths(`git ${args.join(" ")}`, stdout));

/** Untracked files are already names; only request their NUL-delimited output. */
const gitUntrackedPaths = (cwd: string): Effect.Effect<readonly string[], PlanProcessError | PlanJsonError, OwnedProcess | Scope.Scope> =>
  Effect.flatMap(runCommand("git", ["ls-files", "--others", "--exclude-standard", "-z"], cwd), (stdout) =>
    decodeNulPaths("git ls-files --others --exclude-standard -z", stdout));

const localChangedPaths = (cwd: string): Effect.Effect<readonly string[], PlanProcessError | PlanJsonError, OwnedProcess | Scope.Scope> =>
  Effect.gen(function*() {
    const paths = [
      ...(yield* gitDiffPaths(["diff"], cwd)),
      ...(yield* gitDiffPaths(["diff", "--cached"], cwd)),
      ...(yield* gitUntrackedPaths(cwd)),
    ];
    return [...new Set(paths.map((path) => path.replaceAll("\\", "/")))].sort();
  });

const nxEnvironment = (dataDirectory: string): NodeJS.ProcessEnv => ({
  ...process.env,
  NX_DAEMON: "false",
  NX_WORKSPACE_DATA_DIRECTORY: dataDirectory,
});

const nxProjects = (
  args: readonly string[],
  cwd: string,
  dataDirectory: string,
  withE2ETarget: boolean,
): Effect.Effect<readonly string[], PlanProcessError | PlanJsonError | ContractDecodeError, OwnedProcess | Scope.Scope> =>
  Effect.gen(function*() {
    const stdout = yield* runCommand("pnpm", ["exec", "nx", "show", "projects", "--affected", ...(withE2ETarget ? ["--with-target", "e2e"] : []), "--json", ...args], cwd, nxEnvironment(dataDirectory));
    const raw = yield* parseJson("Nx affected selection", stdout.toString("utf8"));
    const decoded = decodeExternal(NxProjectNameListSchema, "NxProjectNames")(raw);
    const names = yield* eitherEffect(decoded);
    return [...new Set(names)].sort();
  });

const readNxGraph = (cwd: string, dataDirectory: string): Effect.Effect<
  import("./contracts.ts").NxGraph,
  PlanProcessError | PlanJsonError | ContractDecodeError,
  OwnedProcess | Scope.Scope
> => Effect.gen(function*() {
  const stdout = yield* runCommand("pnpm", ["exec", "nx", "graph", "--file=stdout"], cwd, nxEnvironment(dataDirectory));
  const raw = yield* parseJson("Nx graph", stdout.toString("utf8"));
  return yield* eitherEffect(decodeNxGraph(raw));
});

const planFileSystem = <A, R>(
  operation: PlanFilesystemError["operation"],
  path: string,
  use: (service: FileSystem.FileSystem) => Effect.Effect<A, unknown, R>,
): Effect.Effect<A, PlanFilesystemError, FileSystem.FileSystem | R> =>
  Effect.flatMap(FileSystem.FileSystem, use).pipe(
    Effect.mapError((cause) => new PlanFilesystemError({ operation, path, cause })),
  );

const fileExists = (path: string): Effect.Effect<boolean, PlanFilesystemError, FileSystem.FileSystem> =>
  planFileSystem("exists", path, (service) => service.exists(path));

const nxIgnoredPaths = (paths: readonly string[], cwd: string): Effect.Effect<Set<string>, PlanFilesystemError, FileSystem.FileSystem> =>
  Effect.gen(function*() {
    const matcher = ignore();
    for (const filename of [".gitignore", ".nxignore"]) {
      const path = join(cwd, filename);
      if (yield* fileExists(path)) {
        const contents = yield* planFileSystem("read-file", path, (service) => service.readFileString(path));
        matcher.add(contents);
      }
    }
    return new Set(paths.filter((path) => matcher.ignores(path)));
  });

const owningProject = (path: string, graph: import("./contracts.ts").NxGraph): string | undefined => {
  const normalized = path.replaceAll("\\", "/");
  return Object.entries(graph.graph.nodes)
    .filter(([, node]) => node.data.root === "." || normalized === node.data.root || normalized.startsWith(`${node.data.root}/`))
    .sort(([, left], [, right]) => right.data.root.length - left.data.root.length)[0]?.[0];
};

const downstreamE2E = (project: string, graph: import("./contracts.ts").NxGraph): readonly string[] => {
  const reverse = new Map<string, string[]>();
  for (const dependencies of Object.values(graph.graph.dependencies)) {
    for (const edge of dependencies) reverse.set(edge.target, [...(reverse.get(edge.target) ?? []), edge.source]);
  }
  const seen = new Set([project]);
  const queue = [project];
  const selected = new Set<string>();
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) continue;
    const node = graph.graph.nodes[current];
    if (node?.data.targets?.e2e !== undefined && node.data.tags?.includes("kind:e2e")) selected.add(current);
    for (const dependent of reverse.get(current) ?? []) if (!seen.has(dependent)) { seen.add(dependent); queue.push(dependent); }
  }
  return [...selected].sort();
};

const selectAffected = (
  nxArgs: readonly string[],
  changedPaths: readonly string[],
  cwd: string,
  dataDirectory: string,
): Effect.Effect<
  { readonly all: readonly string[]; readonly e2e: readonly string[] },
  PlanSelectionError | PlanProcessError | PlanFilesystemError | PlanJsonError | ContractDecodeError,
  FileSystem.FileSystem | OwnedProcess | Scope.Scope
> =>
  Effect.gen(function*() {
    if (changedPaths.some((path) => /[\r\n,]/.test(path))) {
      return yield* Effect.fail(new PlanSelectionError({ reason: "unrepresentable-path", detail: "changed paths contain comma or newline characters that Nx --files cannot represent losslessly" }));
    }
    const graph = yield* readNxGraph(cwd, dataDirectory);
    const [all, e2e] = yield* Effect.all([nxProjects(nxArgs, cwd, dataDirectory, false), nxProjects(nxArgs, cwd, dataDirectory, true)]);
    const ignoredPaths = yield* nxIgnoredPaths(changedPaths, cwd);
    const expected = new Set<string>();
    for (const path of changedPaths) {
      if (ignoredPaths.has(path)) continue;
      const owner = owningProject(path, graph);
      if (owner === undefined) return yield* Effect.fail(new PlanSelectionError({ reason: "unowned-path", detail: `changed path has no Nx owner: ${path}` }));
      const downstream = downstreamE2E(owner, graph);
      const tags = graph.graph.nodes[owner]?.data.tags ?? [];
      if (downstream.length === 0 && !tags.includes("e2e:none")) {
        return yield* Effect.fail(new PlanSelectionError({ reason: "missing-e2e-owner", detail: `changed path ${path} belongs to ${owner}, which has neither E2E downstream nor e2e:none` }));
      }
      downstream.forEach((project) => expected.add(project));
    }
    if (JSON.stringify([...expected].sort()) !== JSON.stringify(e2e)) {
      return yield* Effect.fail(new PlanSelectionError({ reason: "nx-graph-disagreement", detail: `Nx affected selection disagrees with graph downstream closure: expected=${[...expected].sort().join(",")} actual=${e2e.join(",")}` }));
    }
    return { all, e2e };
  });

const validateRange = (base: string, head: string, cwd: string): Effect.Effect<PlanRange, PlanProcessError | PlanSelectionError, OwnedProcess | Scope.Scope> =>
  Effect.gen(function*() {
    const actualHead = yield* runGit(["rev-parse", "HEAD"], cwd);
    const resolvedHead = yield* runGit(["rev-parse", `${head}^{commit}`], cwd);
    const resolvedBase = yield* runGit(["rev-parse", `${base}^{commit}`], cwd);
    if (resolvedHead !== actualHead) {
      return yield* Effect.fail(new PlanSelectionError({ reason: "head-mismatch", detail: `--head must resolve to actual checkout HEAD ${actualHead}, got ${resolvedHead}` }));
    }
    yield* runGit(["merge-base", "--is-ancestor", resolvedBase, resolvedHead], cwd);
    return { base: resolvedBase, head: resolvedHead };
  });

const collectRepoIds = (repoIds: readonly string[]): readonly string[] => [...new Set(repoIds)].filter((id) => id.length > 0);

/** Pure selection: explicit selection always retains its validation semantics. */
export const selectRepos = (all: readonly DiscoveredRepo[], options: SelectionOptions): Either.Either<readonly DiscoveredRepo[], PlanSelectionError> => {
  const repoIds = collectRepoIds(options.repoIds ?? []);
  const knownIds = new Set(all.map((repo) => repo.manifest.id));
  const missing = repoIds.filter((id) => !knownIds.has(id));
  if (missing.length > 0) return Either.left(new PlanSelectionError({ reason: "unknown-repo", detail: `--repo requested unknown id(s): ${missing.join(", ")}. Known ids: ${[...knownIds].join(", ")}` }));
  const requested = repoIds.length > 0 ? new Set(repoIds) : undefined;
  const affected = options.affectedProjectNames === undefined ? undefined : new Set(options.affectedProjectNames);
  const explicitlyRequested = requested === undefined ? [] : all.filter((repo) => requested.has(repo.manifest.id));
  const lane = options.lane;
  if (lane !== undefined) {
    const unavailable = explicitlyRequested.filter((repo) => !repo.manifest.lanes.includes(lane));
    if (unavailable.length > 0) return Either.left(new PlanSelectionError({ reason: "unavailable-lane", detail: `--repo selection is unavailable in lane ${JSON.stringify(options.lane)} for: ${unavailable.map((repo) => `${repo.manifest.id}: ${repo.manifest.lanes.join(", ")}`).join("; ")}` }));
  }
  if (options.excludeExternalNetwork && explicitlyRequested.some((repo) => repo.manifest.requires?.externalNetwork === true)) {
    return Either.left(new PlanSelectionError({ reason: "external-network", detail: `--repo selection requires external network but --exclude-external-network was set: ${explicitlyRequested.filter((repo) => repo.manifest.requires?.externalNetwork === true).map((repo) => repo.manifest.id).join(", ")}` }));
  }
  return Either.right(all.filter((repo) => {
    if (lane !== undefined && !repo.manifest.lanes.includes(lane)) return false;
    if (requested !== undefined && !requested.has(repo.manifest.id)) return false;
    if (options.capability !== undefined && !repo.manifest.areas.some((area) => area === options.capability)) return false;
    if (options.excludeExternalNetwork && repo.manifest.requires?.externalNetwork === true) return false;
    return !(requested === undefined && affected !== undefined && !affected.has(repo.projectName));
  }));
};

const singletonEntry = (repo: DiscoveredRepo, root: string): PlanEntry => {
  const dir = relative(root, repo.dir).replaceAll("\\", "/");
  return { id: repo.manifest.id, repoIds: [repo.manifest.id], batch: repo.manifest.batch, dir, dirs: [dir], executor: repo.manifest.executor, capabilities: [...repo.manifest.areas], shard: repo.manifest.id, ...(repo.manifest.requires === undefined ? {} : { requires: repo.manifest.requires }) };
};

const mergedRequires = (entries: readonly PlanEntry[]): Either.Either<RepoRequires | undefined, PlanSelectionError> => {
  const requirements = entries.flatMap((entry) => entry.requires === undefined ? [] : [entry.requires]);
  if (requirements.length === 0) return Either.right(undefined);
  const runtimes = [...new Set(requirements.flatMap((requirement) => requirement.runtimes ?? []))];
  const browsers = [...new Set(requirements.flatMap((requirement) => requirement.browsers ?? []))];
  const sets = requirements.flatMap((requirement) => requirement.platforms === undefined ? [] : [new Set(requirement.platforms)]);
  const platforms = sets.length === 0 ? [] : [...sets[0]!].filter((platform) => sets.slice(1).every((set) => set.has(platform)));
  if (sets.length > 0 && platforms.length === 0) return Either.left(new PlanSelectionError({ reason: "batch-platform-conflict", detail: "E2E batch has no host platform accepted by every Repo" }));
  return Either.right({ ...(requirements.some((requirement) => requirement.docker) ? { docker: true } : {}), ...(requirements.some((requirement) => requirement.externalNetwork) ? { externalNetwork: true } : {}), ...(platforms.length ? { platforms } : {}), ...(runtimes.length ? { runtimes } : {}), ...(browsers.length ? { browsers } : {}) });
};

const repoBatch = (entries: readonly PlanEntry[]): Either.Either<PlanEntry, PlanSelectionError> => {
  const first = entries[0];
  if (!first || new Set(entries.map((entry) => JSON.stringify(entry.executor))).size !== 1) return Either.left(new PlanSelectionError({ reason: "batch-executor", detail: "E2E batch requires one shared executor" }));
  if (new Set(entries.map((entry) => entry.batch)).size !== 1) return Either.left(new PlanSelectionError({ reason: "batch-placement", detail: "E2E batch contains multiple placement ids" }));
  const repoIds = [first.repoIds[0], ...entries.flatMap((entry) => entry.repoIds).slice(1)] as const;
  const dirs = [first.dirs[0], ...entries.flatMap((entry) => entry.dirs).slice(1)] as const;
  const allCapabilities = [...new Set(entries.flatMap((entry) => entry.capabilities))];
  const capabilities = [first.capabilities[0], ...allCapabilities.filter((capability) => capability !== first.capabilities[0])] as const;
  return Either.map(mergedRequires(entries), (requires) => ({ id: `repo-batch-${first.batch}`, repoIds, batch: first.batch, dirs, executor: first.executor, capabilities, shard: `repo-batch-${first.batch}`, ...(requires === undefined ? {} : { requires }) }));
};

/** Pure batching preserves exactly the selected repo-id set. */
export const batchEntries = (entries: readonly PlanEntry[]): Either.Either<readonly PlanEntry[], PlanSelectionError> => {
  const groups = new Map<string, PlanEntry[]>();
  for (const entry of entries) groups.set(entry.batch, [...(groups.get(entry.batch) ?? []), entry]);
  const result = Either.all([...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, group]) => repoBatch(group)));
  return Either.flatMap(result, (batches) => {
    const before = entries.flatMap((entry) => entry.repoIds).sort();
    const after = batches.flatMap((entry) => entry.repoIds).sort();
    return new Set(after).size !== after.length || JSON.stringify(before) !== JSON.stringify(after)
      ? Either.left(new PlanSelectionError({ reason: "batch-set-changed", detail: "batching changed the selected E2E repo-id set" }))
      : Either.right(batches);
  });
};

const eitherEffect = <A, E>(value: Either.Either<A, E>): Effect.Effect<A, E> => Either.isLeft(value) ? Effect.fail(value.left) : Effect.succeed(value.right);

type PlanFailure = DiscoveryIoError | PlanSelectionError | PlanProcessError | PlanFilesystemError | PlanJsonError | ContractDecodeError;

/**
 * Effect-native planning composition. The command layer parses argv and owns
 * output/runtime closing; this function owns discovery, Git/Nx I/O and plan
 * construction only.
 */
export const resolvePlan = (cli: PlanCli): Effect.Effect<ResolvedPlan, PlanFailure, FileSystem.FileSystem | OwnedProcess> => {
  const root = repoRootDir();
  return Effect.scoped(Effect.gen(function*() {
    const dataDirectory = yield* planFileSystem(
      "temporary-directory",
      tmpdir(),
      (service) => service.makeTempDirectoryScoped({ directory: tmpdir(), prefix: "niceeval-nx-plan-" }),
    );
    const discovery = yield* discoverAllRepos(e2eRootDir());
    if (discovery.errors.length > 0) return yield* Effect.fail(new PlanSelectionError({ reason: "discovery", detail: `repo discovery found ${discovery.errors.length} problem(s): ${discovery.errors.join("; ")}` }));
    const full = cli.repoIds.length === 0 && (cli.noDiff || (cli.lane !== "pr" && cli.base === undefined && cli.diffPaths === undefined));
    let mode: PlanDocument["mode"] = full ? "full" : "affected";
    let reason = cli.repoIds.length ? "explicit-repo" : cli.noDiff ? "explicit-full" : cli.lane !== "pr" && cli.base === undefined && cli.diffPaths === undefined ? `full-lane-${cli.lane}` : "nx-affected";
    let detail: string | undefined;
    let changedPaths: readonly string[] = [];
    let affectedNames: readonly string[] | undefined;
    let allAffectedNames: readonly string[] = [];
    let range: PlanRange | undefined;
    if (!full && cli.repoIds.length === 0) {
      const selected = yield* Effect.either(Effect.gen(function*() {
        if (cli.base !== undefined && cli.head !== undefined) {
          const resolvedRange = yield* validateRange(cli.base, cli.head, root);
          const paths = (yield* gitDiffPaths(["diff", `${resolvedRange.base}...${resolvedRange.head}`], root)).map((path) => path.replaceAll("\\", "/")).sort();
          const selection = paths.length === 0 ? { all: [], e2e: [] } : yield* selectAffected(paths.flatMap((path) => ["--files", path]), paths, root, dataDirectory);
          return { range: resolvedRange, changedPaths: paths, affectedNames: selection.e2e, allAffectedNames: selection.all };
        }
        const paths = cli.diffPaths === undefined ? yield* localChangedPaths(root) : [...new Set(cli.diffPaths)].sort();
        const selection = paths.length === 0 ? { all: [], e2e: [] } : yield* selectAffected(paths.flatMap((path) => ["--files", path]), paths, root, dataDirectory);
        return { changedPaths: paths, affectedNames: selection.e2e, allAffectedNames: selection.all };
      }));
      if (Either.isLeft(selected)) {
        mode = "fail-open-full";
        reason = "nx-selection-failed";
        detail = "detail" in selected.left ? selected.left.detail : executionErrorDetail(selected.left);
      } else {
        ({ range, changedPaths, affectedNames, allAffectedNames } = selected.right);
        if (changedPaths.length === 0) reason = "clean-working-tree";
      }
    }
    const selected = yield* eitherEffect(selectRepos(discovery.repos, {
      lane: cli.lane,
      repoIds: cli.repoIds,
      ...(mode === "fail-open-full" || cli.capability === undefined ? {} : { capability: cli.capability }),
      excludeExternalNetwork: cli.excludeExternalNetwork,
      ...(affectedNames === undefined ? {} : { affectedProjectNames: affectedNames }),
    }));
    const singleton = selected.map((repo) => singletonEntry(repo, e2eRootDir())).sort((left, right) => left.id.localeCompare(right.id));
    const entries = cli.batch ? yield* eitherEffect(batchEntries(singleton)) : singleton;
    const projectNames = discovery.repos.map((repo) => repo.projectName).sort();
    const document: PlanDocument = {
      mode,
      reason,
      ...(detail === undefined ? {} : { detail }),
      lane: cli.lane,
      ...(range === undefined ? {} : { range }),
      changedPaths: [...changedPaths],
      projectIds: selected.map((repo) => repo.manifest.id).sort(),
      cells: [...entries],
      graph: { selector: "nx show projects --affected --with-target e2e", nxVersion: "23.1.1", affectedProjectNames: affectedNames === undefined ? projectNames : [...allAffectedNames], selectedE2EProjectNames: affectedNames === undefined ? projectNames : [...affectedNames], e2eProjectNames: projectNames },
    };
    return { cli, entries, document };
  }));
};

export const invalidPlanOutput = (detail: string): InvalidPlanOutput => ({
  mode: "invalid",
  reason: "invalid-plan",
  detail,
  cells: [],
  projectIds: [],
  changedPaths: [],
});

/** Rendering is pure; the command handler owns its output capability. */
export const formatResolvedPlan = (plan: ResolvedPlan): readonly string[] => {
  if (plan.cli.json) return [JSON.stringify(plan.document)];
  const lines = [`[e2e] mode=${plan.document.mode} reason=${plan.document.reason} lane=${plan.cli.lane}`];
  if (plan.document.detail !== undefined) lines.push(`[e2e] ${plan.document.detail}`);
  if (plan.entries.length === 0) return [...lines, "[e2e] affected selection is empty."];
  return [...lines, ...plan.entries.map((entry) => `- ${entry.id}: ${entry.repoIds.join(", ")}`)];
};
