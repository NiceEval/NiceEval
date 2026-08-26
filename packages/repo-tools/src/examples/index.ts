import { CommandExecutor, FileSystem } from "@effect/platform";
import { createHash } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Effect, ParseResult, Schema } from "effect";

import {
  ExamplesCommandInputSchema,
  ExamplesConflictError,
  ExamplesDirtyTreeError,
  type ExamplesError,
  ExamplesFileError,
  ExamplesGitError,
  ExamplesInputError,
  ExamplesInstallError,
  type ExamplesReceipt,
  ExamplesStateError,
  type TierPair,
  type TierPairReceipt,
  type TierState,
  TierStateSchema,
} from "./model.js";
import { git, runProcess } from "./process.js";

export * from "./model.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const STATE_PATH = "examples/zh/.tier-sync.json";
const STATE_FILE = join(ROOT, STATE_PATH);
const DIFFS_DIR = join(ROOT, "examples/zh/diffs");
const LOCKFILE = "pnpm-lock.yaml";
const VERBATIM_ALLOWED = new Set([
  "package.json",
  "tsconfig.json",
  "pnpm-workspace.yaml",
  LOCKFILE,
  ".env.example",
]);

type ExamplesServices = FileSystem.FileSystem | CommandExecutor.CommandExecutor;
type GitEnvironment = Readonly<Record<string, string>>;

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function decodeInput(input: unknown) {
  return Schema.decodeUnknown(ExamplesCommandInputSchema, { errors: "all" })(input).pipe(
    Effect.mapError((error) => new ExamplesInputError({
      message: ParseResult.TreeFormatter.formatErrorSync(error),
    })),
  );
}

function loadState(): Effect.Effect<TierState, ExamplesStateError, FileSystem.FileSystem> {
  return Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem;
    const source = yield* fs.readFileString(STATE_FILE).pipe(
      Effect.mapError((error) => new ExamplesStateError({
        operation: "read",
        path: STATE_PATH,
        message: String(error),
      })),
    );
    const input = yield* Effect.try({
      try: () => JSON.parse(source) as unknown,
      catch: (error) => new ExamplesStateError({
        operation: "parse",
        path: STATE_PATH,
        message: message(error),
      }),
    });
    return yield* Schema.decodeUnknown(TierStateSchema, { errors: "all" })(input).pipe(
      Effect.mapError((error) => new ExamplesStateError({
        operation: "decode",
        path: STATE_PATH,
        message: ParseResult.TreeFormatter.formatErrorSync(error),
      })),
    );
  });
}

function saveState(state: TierState): Effect.Effect<void, ExamplesStateError, FileSystem.FileSystem> {
  return Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem;
    yield* Effect.scoped(Effect.gen(function*() {
      const temporary = yield* fs.makeTempFileScoped({
        directory: dirname(STATE_FILE),
        prefix: ".tier-sync.",
      });
      yield* fs.writeFileString(temporary, `${JSON.stringify(state, null, 2)}\n`);
      yield* fs.rename(temporary, STATE_FILE);
    })).pipe(
      Effect.mapError((error) => new ExamplesStateError({
        operation: "write",
        path: STATE_PATH,
        message: String(error),
      })),
    );
  });
}

function topoSort(pairs: readonly TierPair[]): Effect.Effect<readonly TierPair[], ExamplesStateError> {
  return Effect.try({
    try: () => {
      const byTo = new Map(pairs.map((pair) => [pair.to, pair]));
      const sorted: TierPair[] = [];
      const visiting = new Set<string>();
      const visited = new Set<string>();
      const visit = (pair: TierPair): void => {
        if (visited.has(pair.to)) return;
        if (visiting.has(pair.to)) throw new Error(`pairs contain a cycle at ${pair.to}`);
        visiting.add(pair.to);
        const upstream = byTo.get(pair.from);
        if (upstream !== undefined) visit(upstream);
        visiting.delete(pair.to);
        visited.add(pair.to);
        sorted.push(pair);
      };
      for (const pair of pairs) visit(pair);
      return sorted;
    },
    catch: (error) => new ExamplesStateError({
      operation: "topology",
      path: STATE_PATH,
      message: message(error),
    }),
  });
}

function selectedPairs(pairs: readonly TierPair[], name: string | undefined) {
  if (name === undefined) return Effect.succeed(pairs);
  const selected = pairs.filter((pair) => basename(pair.to) === name);
  return selected.length > 0
    ? Effect.succeed(selected)
    : Effect.fail(new ExamplesInputError({ message: `no tier pair is named ${JSON.stringify(name)}` }));
}

interface TreeEntry {
  readonly mode: string;
  readonly oid: string;
  readonly name: string;
  readonly source: string;
}

function parseTreeEntries(source: string): readonly TreeEntry[] {
  return source.split("\n").filter(Boolean).map((line) => {
    const tab = line.indexOf("\t");
    const metadata = line.slice(0, tab).split(" ");
    const mode = metadata[0];
    const oid = metadata[2];
    if (tab < 0 || mode === undefined || oid === undefined) {
      throw new Error(`invalid git ls-tree entry: ${line}`);
    }
    return { mode, oid, name: line.slice(tab + 1), source: line };
  });
}

function hashTree(entries: readonly TreeEntry[], objectFormat: string): string {
  const oidBytes = objectFormat === "sha256" ? 32 : objectFormat === "sha1" ? 20 : 0;
  if (oidBytes === 0) throw new Error(`unsupported git object format ${objectFormat}`);
  const content = Buffer.concat(entries.map((entry) => Buffer.concat([
    Buffer.from(`${entry.mode.replace(/^0+/, "")} ${entry.name}\0`),
    Buffer.from(entry.oid, "hex"),
  ])));
  if (entries.some((entry) => Buffer.from(entry.oid, "hex").length !== oidBytes)) {
    throw new Error(`invalid ${objectFormat} object id in tree`);
  }
  return createHash(objectFormat).update(Buffer.from(`tree ${content.length}\0`)).update(content).digest("hex");
}

function stripLockfile(
  treeOid: string,
  materialize: boolean,
  environment?: GitEnvironment,
): Effect.Effect<string, ExamplesGitError, CommandExecutor.CommandExecutor> {
  return Effect.gen(function*() {
    const listing = yield* git(ROOT, ["ls-tree", treeOid], {
      ...(environment === undefined ? {} : { environment }),
    });
    const entries = yield* Effect.try({
      try: () => parseTreeEntries(listing.stdout).filter((entry) => entry.name !== LOCKFILE),
      catch: (error) => new ExamplesGitError({ args: ["ls-tree", treeOid], message: message(error) }),
    });
    if (materialize) {
      const source = entries.map((entry) => entry.source).join("\n");
      return (yield* git(ROOT, ["mktree"], {
        input: source.length === 0 ? "" : `${source}\n`,
        ...(environment === undefined ? {} : { environment }),
      })).stdout.trim();
    }
    const objectFormat = (yield* git(ROOT, ["rev-parse", "--show-object-format"])).stdout.trim();
    return yield* Effect.try({
      try: () => hashTree(entries, objectFormat),
      catch: (error) => new ExamplesGitError({ args: ["hash tree", treeOid], message: message(error) }),
    });
  });
}

function headTree(
  directory: string,
  materialize: boolean,
  environment?: GitEnvironment,
): Effect.Effect<string, ExamplesGitError, CommandExecutor.CommandExecutor> {
  return git(ROOT, ["rev-parse", `HEAD:${directory}`], {
    ...(environment === undefined ? {} : { environment }),
  }).pipe(
    Effect.flatMap((result) => stripLockfile(result.stdout.trim(), materialize, environment)),
  );
}

function ensureTreeObject(treeOid: string, directory: string, environment: GitEnvironment) {
  return Effect.gen(function*() {
    const present = yield* git(ROOT, ["cat-file", "-e", `${treeOid}^{tree}`], {
      accept: [0, 128],
      environment,
    });
    if (present.exitCode === 0) return;

    const history = yield* git(ROOT, ["rev-list", "--all", "--", directory]);
    for (const commit of history.stdout.split("\n").filter(Boolean)) {
      const source = yield* git(ROOT, ["rev-parse", `${commit}:${directory}`], { accept: [0, 128] });
      if (source.exitCode !== 0) continue;
      const digest = yield* stripLockfile(source.stdout.trim(), false);
      if (digest !== treeOid) continue;
      const materialized = yield* stripLockfile(source.stdout.trim(), true, environment);
      if (materialized !== treeOid) {
        return yield* new ExamplesGitError({
          args: ["materialize tree", treeOid],
          message: `materialized tree ${materialized} does not match expected ${treeOid}`,
        });
      }
      return;
    }
    return yield* new ExamplesGitError({
      args: ["locate tree", treeOid],
      message: `cannot reconstruct base tree ${treeOid} for ${directory} from Git history`,
    });
  });
}

function conflictMarkers(directory: string) {
  return git(ROOT, ["grep", "-l", "<<<<<<<", "--", directory], { accept: [0, 1] }).pipe(
    Effect.map((result) => result.exitCode === 0
      ? result.stdout.trim().split("\n").filter(Boolean)
      : []),
  );
}

function verbatimViolations(pair: TierPair) {
  return Effect.gen(function*() {
    const from = (yield* git(ROOT, ["rev-parse", `HEAD:${pair.from}`])).stdout.trim();
    const to = (yield* git(ROOT, ["rev-parse", `HEAD:${pair.to}`])).stdout.trim();
    const result = yield* git(ROOT, ["diff", "--no-renames", "--name-status", from, to]);
    return result.stdout.trim().split("\n").filter(Boolean).flatMap((line) => {
      const [code, path] = line.split("\t");
      if (path === undefined || VERBATIM_ALLOWED.has(path)) return [];
      if (code === "M") return [`${path} differs from upstream`];
      if (code === "D") return [`${path} is missing from the tier`];
      return [];
    });
  });
}

function pairCheck(pair: TierPair): Effect.Effect<TierPairReceipt, ExamplesGitError, CommandExecutor.CommandExecutor> {
  return Effect.gen(function*() {
    const upstreamTree = yield* headTree(pair.from, false);
    const markers = yield* conflictMarkers(pair.to);
    const violations = pair.contract === "verbatim" ? yield* verbatimViolations(pair) : [];
    const problems = [
      ...(pair.pending === undefined ? [] : ["a conflict sync is pending completion"]),
      ...(pair.pending === undefined && upstreamTree !== pair.baseTree
        ? [`base ${pair.baseTree.slice(0, 8)} differs from upstream ${upstreamTree.slice(0, 8)}`]
        : []),
      ...markers.map((path) => `unresolved conflict marker in ${path}`),
      ...violations,
    ];
    return {
      from: pair.from,
      to: pair.to,
      status: pair.pending !== undefined ? "pending-conflict" : problems.length === 0 ? "current" : "would-sync",
      upstreamTree,
      changed: [],
      problems,
    };
  });
}

function checkSelected(name: string | undefined) {
  return Effect.gen(function*() {
    const state = yield* loadState();
    const sorted = yield* topoSort(state.pairs);
    const pairs = yield* selectedPairs(sorted, name);
    const receipts = yield* Effect.forEach(pairs, pairCheck, { concurrency: 4 });
    return {
      domain: "examples" as const,
      operation: "check" as const,
      ok: receipts.every((receipt) => receipt.problems.length === 0),
      pairs: receipts,
    } satisfies ExamplesReceipt;
  });
}

function isClean(paths: readonly string[]) {
  return git(ROOT, ["status", "--porcelain", "--", ...paths]).pipe(
    Effect.map((result) => result.stdout.split("\n").filter(Boolean)
      .filter((line) => !line.endsWith(`/${LOCKFILE}`)).length === 0),
  );
}

function mergeTree(baseTree: string, tierTree: string, upstreamTree: string, environment: GitEnvironment) {
  return git(ROOT, [
    "merge-tree",
    "--write-tree",
    "--name-only",
    `--merge-base=${baseTree}`,
    tierTree,
    upstreamTree,
  ], { accept: [0, 1], environment }).pipe(
    Effect.map((result) => {
      const lines = result.stdout.split("\n");
      const treeOid = lines[0] ?? "";
      const blank = lines.indexOf("", 1);
      return {
        treeOid,
        clean: result.exitCode === 0,
        conflicts: result.exitCode === 0 ? [] : lines.slice(1, blank < 0 ? undefined : blank).filter(Boolean),
      };
    }),
  );
}

function checkoutTree(treeOid: string, destination: string, environment: GitEnvironment) {
  return Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem;
    yield* Effect.scoped(Effect.gen(function*() {
      const temporary = yield* fs.makeTempDirectoryScoped({ prefix: "niceeval-examples-" }).pipe(
        Effect.mapError((error) => new ExamplesFileError({
          operation: "create temporary directory",
          path: destination,
          message: String(error),
        })),
      );
      const archive = join(temporary, "tree.tar");
      const archived = yield* git(ROOT, ["archive", `--output=${archive}`, treeOid], { environment });
      if (archived.exitCode !== 0) return yield* Effect.fail(new ExamplesGitError({
        args: ["archive", treeOid],
        exitCode: archived.exitCode,
        message: archived.stderr,
      }));
      const extracted = yield* runProcess("tar", ["-xf", archive, "-C", destination], { cwd: ROOT });
      if (extracted.exitCode !== 0) return yield* Effect.fail(new ExamplesFileError({
        operation: "extract",
        path: destination,
        message: extracted.stderr || `tar exited ${extracted.exitCode}`,
      }));
    }).pipe(
      Effect.mapError((error) => error._tag === "ExamplesProcessError"
        ? new ExamplesFileError({ operation: "extract", path: destination, message: error.message })
        : error),
    ));
  });
}

function changedFiles(oldTree: string, newTree: string, environment: GitEnvironment) {
  return git(ROOT, ["diff", "--no-renames", "--name-status", oldTree, newTree], { environment }).pipe(
    Effect.map((result) => result.stdout.trim().split("\n").filter(Boolean).map((line) => {
      const [code = "", path = ""] = line.split("\t");
      return { code, path };
    })),
  );
}

function removeDeleted(destination: string, changed: readonly { readonly code: string; readonly path: string }[]) {
  return Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem;
    yield* Effect.forEach(
      changed.filter((entry) => entry.code === "D" && entry.path !== LOCKFILE),
      (entry) => fs.remove(join(destination, entry.path), { force: true }).pipe(
        Effect.mapError((error) => new ExamplesFileError({
          operation: "remove deleted path",
          path: join(destination, entry.path),
          message: String(error),
        })),
      ),
      { discard: true },
    );
  });
}

function install(destination: string) {
  return runProcess("pnpm", ["install"], { cwd: destination }).pipe(
    Effect.mapError((error) => new ExamplesInstallError({
      directory: destination,
      message: error.message,
    })),
    Effect.flatMap((result) => result.exitCode === 0
      ? Effect.void
      : Effect.fail(new ExamplesInstallError({
        directory: destination,
        message: result.stderr || result.stdout,
      }))),
  );
}

function exportPatch(pair: TierPair, upstreamTree: string, tierTree: string, environment: GitEnvironment) {
  return Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem;
    const result = yield* git(ROOT, ["diff", upstreamTree, tierTree], { environment });
    yield* fs.makeDirectory(DIFFS_DIR, { recursive: true }).pipe(
      Effect.mapError((error) => new ExamplesFileError({ operation: "mkdir", path: DIFFS_DIR, message: String(error) })),
    );
    const patchName = pair.to.split("/").slice(-2).join("-");
    const path = join(DIFFS_DIR, `${patchName}.patch`);
    yield* fs.writeFileString(path, result.stdout.length === 0 || result.stdout.endsWith("\n")
      ? result.stdout
      : `${result.stdout}\n`).pipe(
      Effect.mapError((error) => new ExamplesFileError({ operation: "write patch", path, message: String(error) })),
    );
  });
}

function replacePair(state: TierState, pair: TierPair): TierState {
  return { pairs: state.pairs.map((candidate) => candidate.to === pair.to ? pair : candidate) };
}

function syncSelected(name: string | undefined): Effect.Effect<ExamplesReceipt, ExamplesError, ExamplesServices> {
  return Effect.scoped(Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem;
    const actualObjects = (yield* git(ROOT, [
      "rev-parse",
      "--path-format=absolute",
      "--git-path",
      "objects",
    ])).stdout.trim();
    const temporary = yield* fs.makeTempDirectoryScoped({ prefix: "niceeval-example-objects-" }).pipe(
      Effect.mapError((error) => new ExamplesFileError({
        operation: "create temporary Git object directory",
        path: ROOT,
        message: String(error),
      })),
    );
    const objectDirectory = join(temporary, "objects");
    yield* fs.makeDirectory(objectDirectory, { recursive: true }).pipe(
      Effect.mapError((error) => new ExamplesFileError({
        operation: "create temporary Git object directory",
        path: objectDirectory,
        message: String(error),
      })),
    );
    const environment: GitEnvironment = {
      GIT_OBJECT_DIRECTORY: objectDirectory,
      GIT_ALTERNATE_OBJECT_DIRECTORIES: actualObjects,
    };
    let state = yield* loadState();
    const sorted = yield* topoSort(state.pairs);
    const pairs = yield* selectedPairs(sorted, name);
    const effective = new Map<string, string>();
    const receipts: TierPairReceipt[] = [];

    for (const initialPair of pairs) {
      let pair = state.pairs.find((candidate) => candidate.to === initialPair.to) ?? initialPair;
      const chained = effective.get(pair.from);
      const cleanPaths = chained === undefined ? [pair.from, pair.to] : [pair.to];
      if (!(yield* isClean(cleanPaths))) return yield* new ExamplesDirtyTreeError({ paths: cleanPaths });
      let tierTree = yield* headTree(pair.to, true, environment);

      if (pair.pending !== undefined) {
        const markers = yield* conflictMarkers(pair.to);
        if (markers.length > 0) {
          receipts.push({
            from: pair.from,
            to: pair.to,
            status: "pending-conflict",
            changed: [],
            problems: markers.map((path) => `unresolved conflict marker in ${path}`),
          });
          const receipt: ExamplesReceipt = {
            domain: "examples",
            operation: "sync",
            ok: false,
            pairs: receipts,
          };
          return yield* new ExamplesConflictError({ receipt });
        }
        if (pair.pending.needsInstall) yield* install(join(ROOT, pair.to));
        yield* ensureTreeObject(pair.pending.upstreamTree, pair.from, environment);
        yield* exportPatch(pair, pair.pending.upstreamTree, tierTree, environment);
        pair = {
          from: pair.from,
          to: pair.to,
          contract: pair.contract,
          baseTree: pair.pending.upstreamTree,
        };
        state = replacePair(state, pair);
        yield* saveState(state);
        tierTree = yield* headTree(pair.to, true, environment);
      }

      const upstreamTree = chained ?? (yield* headTree(pair.from, true, environment));
      if (upstreamTree === pair.baseTree) {
        receipts.push({
          from: pair.from,
          to: pair.to,
          status: "current",
          upstreamTree,
          tierTree,
          changed: [],
          problems: [],
        });
        continue;
      }

      yield* ensureTreeObject(pair.baseTree, pair.from, environment);
      const merged = yield* mergeTree(pair.baseTree, tierTree, upstreamTree, environment);
      const destination = join(ROOT, pair.to);
      const changed = yield* changedFiles(tierTree, merged.treeOid, environment);
      yield* checkoutTree(merged.treeOid, destination, environment);
      yield* removeDeleted(destination, changed);
      const needsInstall = changed.some((entry) => entry.path === "package.json" || entry.path === "pnpm-workspace.yaml");

      if (!merged.clean) {
        const pendingPair: TierPair = {
          ...pair,
          pending: { upstreamTree, needsInstall },
        };
        state = replacePair(state, pendingPair);
        yield* saveState(state);
        receipts.push({
          from: pair.from,
          to: pair.to,
          status: "conflict",
          upstreamTree,
          tierTree: merged.treeOid,
          changed: changed.map((entry) => entry.path),
          problems: merged.conflicts.map((path) => `merge conflict in ${pair.to}/${path}`),
        });
        const receipt: ExamplesReceipt = {
          domain: "examples",
          operation: "sync",
          ok: false,
          pairs: receipts,
        };
        return yield* new ExamplesConflictError({ receipt });
      }

      if (needsInstall) yield* install(destination);
      yield* exportPatch(pair, upstreamTree, merged.treeOid, environment);
      pair = { ...pair, baseTree: upstreamTree };
      state = replacePair(state, pair);
      yield* saveState(state);
      effective.set(pair.to, merged.treeOid);
      receipts.push({
        from: pair.from,
        to: pair.to,
        status: "synced",
        upstreamTree,
        tierTree: merged.treeOid,
        changed: changed.map((entry) => entry.path),
        problems: [],
      });
    }

    return {
      domain: "examples",
      operation: "sync",
      ok: true,
      pairs: receipts,
    };
  }));
}

export function runExamplesCommand(
  input: unknown,
): Effect.Effect<ExamplesReceipt, ExamplesError, ExamplesServices> {
  return decodeInput(input).pipe(
    Effect.flatMap((decoded) => decoded.operation === "check"
      ? checkSelected(decoded.name)
      : syncSelected(decoded.name)),
  );
}

export const checkExamples = (name?: string) => runExamplesCommand({
  operation: "check",
  ...(name === undefined ? {} : { name }),
});

export const syncExamples = (name?: string) => runExamplesCommand({
  operation: "sync",
  ...(name === undefined ? {} : { name }),
});

export const examplesCommandContribution = Object.freeze({
  name: "examples",
  summary: "Check or synchronize example tier chains.",
  input: ExamplesCommandInputSchema,
  run: runExamplesCommand,
  check: checkExamples,
  sync: syncExamples,
});
