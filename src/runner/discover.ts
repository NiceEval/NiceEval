// Discovery is the only boundary where executable modules enter the typed runner.
// Dynamic imports are decoded immediately; every later stage receives branded, immutable definitions.

import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Data, Effect, Either, Option, Schema } from "effect";
import { pad4 } from "../util.ts";
import {
  assertNoHiddenInputLeaks,
  captureEvalSource,
  folderEntryBaseId,
  type HiddenInput,
  type LeakGateHints,
} from "./eval-source.ts";
import { evalPrefixPredicate } from "../shared/aggregate.ts";
import { captureLoadedFiles } from "../loaders/index.ts";
import { sandboxLayerStateOf, type SandboxLayer } from "../sandbox/layer.ts";
import {
  assertPathWithinEvalOwner,
  activateEvalRootHooks,
  EvalRootPreflightError,
  moduleFactsForEval,
  originForEval,
  preflightEvalRootSources,
  preflightEvalRoots,
  supportsExternalEvalRoots,
  type EvalRootIssueCode,
  type ResolvedEvalRoot,
} from "./eval-roots.ts";
import {
  discoverEval,
  discoverExperiment,
  isEvalDefinition,
  isRemoteEvalReference,
  isExperimentDefinition,
} from "../types.ts";
import type {
  AnyEvalDefinition,
  Config,
  DiscoveredEval,
  DiscoveredExperiment,
  ExperimentDefinition,
  PackageEvalRoot,
  RemoteEvalReference,
} from "../types.ts";

const SKIP_DIRS = new Set(["node_modules", ".git", ".niceeval", "dist", ".next"]);

export type DiscoveryIssueCode =
  | "discovery.filesystem"
  | "discovery.duplicate-id"
  | "discovery.import-failed"
  | "discovery.invalid-export"
  | "discovery.invalid-dataset-key"
  | "discovery.source-capture-failed"
  | "discovery.leak-gate-failed"
  | EvalRootIssueCode;

export interface DiscoveryIssue {
  readonly file: string;
  readonly code: DiscoveryIssueCode;
  /** Preserve the root barrier's machine fields through P4 discovery. */
  readonly mount?: string;
  readonly dependency?: string;
  readonly packageFile?: string;
  readonly evalFile?: string;
  readonly specifier?: string;
  readonly field?: string;
  readonly message: string;
  readonly actions: readonly string[];
}

/** Discovery reports the whole invalid batch, rather than stopping at the first bad file. */
export class DiscoveryError extends Data.TaggedError("DiscoveryError")<{
  readonly message: string;
  readonly issues: readonly DiscoveryIssue[];
}> {}

interface EvalEntry {
  readonly file: string;
  readonly baseId: string;
  readonly kind: "file" | "folder";
}

interface EvalDiscoveryScope {
  /** Capability boundary and source-capture root. */
  readonly ownerRoot: string;
  /** Directory whose descendants form relative Eval ids. */
  readonly evalRoot: string;
  /** Mounted package metadata; absent for project-local discovery. */
  readonly external?: ResolvedEvalRoot;
}

interface ExternalLoaderCapture {
  readonly modules: ReadonlySet<string>;
  readonly paths: readonly string[];
  readonly criteriaPaths: readonly string[];
  readonly privatePaths: readonly string[];
}

// ESM only evaluates a shared module once.  Preserve its loader registrations
// by module closure so a later Eval that reaches the cached module receives the
// same data/criteria/private facts instead of silently losing fingerprint input.
const externalLoaderCaptures = new Map<string, ExternalLoaderCapture[]>();

type EvalModuleExport =
  | AnyEvalDefinition
  | RemoteEvalReference
  | readonly AnyEvalDefinition[]
  | Readonly<globalThis.Record<string, AnyEvalDefinition>>;

interface EvalModule {
  readonly default: EvalModuleExport;
}

interface ExperimentModule {
  readonly default?: ExperimentDefinition;
}

const EvalDefinitionSchema = Schema.declare(isEvalDefinition, {
  identifier: "EvalDefinition",
  description: "a value returned by defineEval() or defineScoreEval()",
});
const EvalModuleSchema: Schema.Schema<EvalModule> = Schema.Struct({
  default: Schema.Union(
    EvalDefinitionSchema,
    Schema.declare(isRemoteEvalReference, { identifier: "RemoteEvalReference" }),
    Schema.Array(EvalDefinitionSchema),
    Schema.Record({ key: Schema.String, value: EvalDefinitionSchema }),
  ),
});
const ExperimentDefinitionSchema = Schema.declare(isExperimentDefinition, {
  identifier: "ExperimentDefinition",
  description: "a value returned by defineExperiment()",
});
const ExperimentModuleSchema: Schema.Schema<ExperimentModule> = Schema.Struct({
  default: Schema.optional(ExperimentDefinitionSchema),
});

function discoveryError(issues: readonly DiscoveryIssue[]): DiscoveryError {
  const frozenIssues = Object.freeze(issues.map((issue) => Object.freeze({
    ...issue,
    actions: Object.freeze([...issue.actions]),
  })));
  return new DiscoveryError({
    message: frozenIssues.map((issue) =>
      `${issue.code} ${issue.file}: ${issue.message} Actions: ${issue.actions.join(" ")}`
    ).join("\n"),
    issues: frozenIssues,
  });
}

function issue(
  file: string,
  code: DiscoveryIssueCode,
  message: string,
  actions: readonly string[],
): DiscoveryError {
  return discoveryError([{ file, code, message, actions }]);
}

function causeMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Preserve P4's structured root error codes through Effect's discovery batch. */
function discoveryErrorFromCause(
  cause: unknown,
  fallback: { readonly file: string; readonly code: DiscoveryIssueCode; readonly actions: readonly string[] },
): DiscoveryError {
  if (cause instanceof EvalRootPreflightError) {
    return discoveryError(cause.issues.map((rootIssue) => ({
      file: rootIssue.evalFile ?? fallback.file,
      ...(rootIssue.mount === undefined ? {} : { mount: rootIssue.mount }),
      ...(rootIssue.dependency === undefined ? {} : { dependency: rootIssue.dependency }),
      ...(rootIssue.packageFile === undefined ? {} : { packageFile: rootIssue.packageFile }),
      ...(rootIssue.evalFile === undefined ? {} : { evalFile: rootIssue.evalFile }),
      ...(rootIssue.specifier === undefined ? {} : { specifier: rootIssue.specifier }),
      ...(rootIssue.field === undefined ? {} : { field: rootIssue.field }),
      code: rootIssue.code,
      message: rootIssue.message,
      actions: rootIssue.actions,
    })));
  }
  return issue(fallback.file, fallback.code, causeMessage(cause), fallback.actions);
}

function importModule(file: string, root: string, kind: "eval" | "experiment"): Effect.Effect<unknown, DiscoveryError> {
  return Effect.tryPromise({
    try: () => import(pathToFileURL(file).href),
    catch: (cause) => issue(
      relative(root, file),
      "discovery.import-failed",
      `Top-level ${kind} module evaluation failed: ${causeMessage(cause)}`,
      [`Move resource work into the selected ${kind} body.`, "Fix the reported top-level exception."],
    ),
  });
}

function decodeEvalModule(value: unknown, file: string): Effect.Effect<EvalModule, DiscoveryError> {
  return Schema.decodeUnknown(EvalModuleSchema, { errors: "all" })(value).pipe(
    Effect.mapError((error) => issue(
      file,
      "discovery.invalid-export",
      String(error),
      ["Default-export defineEval()/defineScoreEval() output, defineRemoteEval() reference, an array of local outputs, or a keyed record of local outputs."],
    )),
  );
}

function decodeExperimentModule(value: unknown, file: string): Effect.Effect<ExperimentModule, DiscoveryError> {
  return Schema.decodeUnknown(ExperimentModuleSchema, { errors: "all" })(value).pipe(
    Effect.mapError((error) => issue(
      file,
      "discovery.invalid-export",
      String(error),
      ["Default-export defineExperiment({...}) instead of a plain object."],
    )),
  );
}

function collectAll<A>(
  values: readonly A[],
  f: (value: A) => Effect.Effect<readonly DiscoveredEval[], DiscoveryError>,
): Effect.Effect<readonly DiscoveredEval[], DiscoveryError> {
  return Effect.partition(values, f, { concurrency: 1 }).pipe(
    Effect.flatMap(([errors, groups]) => errors.length > 0
      ? Effect.fail(discoveryError(errors.flatMap((error) => error.issues)))
      : Effect.succeed(Object.freeze(groups.flat()))),
  );
}

function walkFiles(
  dir: string,
  root: string,
  match: (name: string) => boolean,
): Effect.Effect<readonly string[], DiscoveryError> {
  if (!existsSync(dir)) return Effect.succeed(Object.freeze([]));
  return Effect.tryPromise({
    try: async () => {
      const out: string[] = [];
      const walk = async (current: string): Promise<void> => {
        const entries = await readdir(current, { withFileTypes: true });
        for (const entry of entries) {
          const full = join(current, entry.name);
          if (entry.isDirectory()) {
            if (!SKIP_DIRS.has(entry.name)) await walk(full);
          } else if (entry.isFile() && match(entry.name)) {
            out.push(full);
          }
        }
      };
      await walk(dir);
      return Object.freeze(out.sort());
    },
    catch: (cause) => issue(
      relative(root, dir) || ".",
      "discovery.filesystem",
      causeMessage(cause),
      ["Check that the discovery directory is readable."],
    ),
  });
}

function isFolderEntryName(name: string): boolean {
  return name === "eval.ts" || name === "eval.tsx";
}

function isFileEntryName(name: string): boolean {
  return name.endsWith(".eval.ts") || name.endsWith(".eval.tsx");
}

function collectEvalEntries(evalsDir: string, root: string): Effect.Effect<readonly EvalEntry[], DiscoveryError> {
  return walkFiles(evalsDir, root, (name) => isFileEntryName(name) || isFolderEntryName(name)).pipe(
    Effect.flatMap((files) => {
      const entries = files.map((file): EvalEntry => {
        const name = basename(file);
        if (isFolderEntryName(name)) {
          const relDir = relative(evalsDir, dirname(file)).split(sep).join("/");
          return {
            file,
            baseId: folderEntryBaseId(relDir === "" ? "." : relDir),
            kind: "folder",
          };
        }
        return {
          file,
          baseId: relative(evalsDir, file).replace(/\.eval\.tsx?$/, "").split(sep).join("/"),
          kind: "file",
        };
      });
      const byId = new Map<string, EvalEntry[]>();
      for (const entry of entries) byId.set(entry.baseId, [...(byId.get(entry.baseId) ?? []), entry]);
      const duplicates = [...byId.entries()].flatMap(([id, owners]) => owners.length < 2 ? [] : [{
        file: owners.map((owner) => relative(root, owner.file).split(sep).join("/")).join(", "),
        code: "discovery.duplicate-id" as const,
        message: `Duplicate eval id ${JSON.stringify(id)}: multiple entries map to the same id.`,
        actions: Object.freeze(["Keep either the file entry or the folder entry for this id."]),
      }]);
      return duplicates.length > 0
        ? Effect.fail(discoveryError(duplicates))
        : Effect.succeed(Object.freeze(entries));
    }),
  );
}

function validDatasetKey(key: string): boolean {
  return key.length > 0 && key !== "." && key !== ".." && !key.includes("/") && !key.includes("\\") &&
    !/[\u0000-\u001f\u007f]/.test(key);
}

function isEvalDefinitionArray(
  exported: EvalModuleExport,
): exported is readonly AnyEvalDefinition[] {
  return Array.isArray(exported) && exported.every((value) => isEvalDefinition(value));
}

type ExpandedEvalExport =
  | { readonly id: string; readonly definition: AnyEvalDefinition }
  | { readonly id: string; readonly remote: RemoteEvalReference };

function expandEvalExport(
  exported: EvalModuleExport,
  entry: EvalEntry,
  root: string,
): Effect.Effect<readonly ExpandedEvalExport[], DiscoveryError> {
  if (isEvalDefinition(exported)) {
    return Effect.succeed(Object.freeze([{ id: entry.baseId, definition: exported }]));
  }
  if (isRemoteEvalReference(exported)) {
    return Effect.succeed(Object.freeze([{ id: entry.baseId, remote: exported }]));
  }
  if (isEvalDefinitionArray(exported)) {
    return Effect.succeed(Object.freeze(exported.map((definition, index) => ({
      id: `${entry.baseId}/${pad4(index)}`,
      definition,
    }))));
  }
  // `Array.isArray` does not narrow readonly arrays; the array branch above has already returned.
  const dataset = exported;
  const invalidKeys = Object.keys(dataset).filter((key) => !validDatasetKey(key));
  if (invalidKeys.length > 0) {
    return Effect.fail(discoveryError(invalidKeys.map((key) => ({
      file: relative(root, entry.file),
      code: "discovery.invalid-dataset-key" as const,
      message: `Invalid keyed eval dataset key ${JSON.stringify(key)}.`,
      actions: Object.freeze(["Use a non-empty path segment without slash, backslash, dot segments, or control characters."]),
    }))));
  }
  return Effect.succeed(Object.freeze(Object.keys(dataset).sort().map((key) => ({
    id: `${entry.baseId}/${key}`,
    definition: dataset[key]!,
  }))));
}

function leakGateHintsForLayer(
  layer: SandboxLayer | undefined,
  baseDir: string,
  file: string,
  ownerRoot: string,
): Effect.Effect<Option.Option<LeakGateHints>, DiscoveryError> {
  if (layer === undefined) return Effect.succeed(Option.none());
  const state = sandboxLayerStateOf(layer);
  if (!("template" in state)) return Effect.succeed(Option.none());
  const leakGate = state.template.leakGate;
  if (leakGate._tag === "None") return Effect.succeed(Option.none());
  if (leakGate._tag === "Dockerfile") {
    const contextDir = leakGate.context._tag === "Url"
      ? fileURLToPath(leakGate.context.value)
      : resolve(baseDir, leakGate.context.value);
    const dockerfile = resolve(contextDir, leakGate.dockerfile);
    return Effect.tryPromise({
      try: async () => {
        const hints: LeakGateHints = { buildContexts: [{ contextDir, label: "dockerfile" }] };
        await assertLeakGatePathsOwned(hints, ownerRoot, [dockerfile]);
        return Option.some(hints);
      },
      catch: (cause) => issue(
        file,
        "discovery.leak-gate-failed",
        causeMessage(cause),
        ["Keep Dockerfile Sandbox inputs inside the Eval owner package."],
      ),
    });
  }
  const composeFile = leakGate.file._tag === "Url" ? new URL(leakGate.file.value) : leakGate.file.value;
  return Effect.tryPromise({
    try: async () => {
      const { leakGateHintsFromComposeFile } = await import("../sandbox/compose.ts");
      const { hints, composePath, inspection } = await leakGateHintsFromComposeFile(composeFile, {
        mainService: leakGate.workspaceService,
        baseDir,
      });
      const dockerfiles = inspection.services.flatMap((service) => service.build === undefined
        ? []
        : [resolve(resolve(dirname(composePath), service.build.context), service.build.dockerfile ?? "Dockerfile")]);
      await assertLeakGatePathsOwned(hints, ownerRoot, [composePath, ...dockerfiles]);
      return Option.some(hints);
    },
    catch: (cause) => issue(
      file,
      "discovery.leak-gate-failed",
      causeMessage(cause),
      ["Fix the Docker Compose declaration used by this eval SandboxLayer."],
    ),
  });
}

/** Every host path that a Sandbox declaration makes NiceEval read is owner-scoped. */
async function assertLeakGatePathsOwned(
  hints: LeakGateHints,
  ownerRoot: string,
  explicitPaths: readonly string[] = [],
): Promise<void> {
  const paths = [
    ...explicitPaths,
    ...hints.buildContexts.flatMap((context) => [
      context.contextDir,
      ...(context.dockerignorePath === undefined ? [] : [context.dockerignorePath]),
    ]),
    ...(hints.bindMounts ?? []).map((mount) => mount.source),
  ];
  for (const path of paths) await assertPathWithinEvalOwner(path, ownerRoot);
}

function runLeakGate(
  definition: AnyEvalDefinition,
  input: {
    readonly evalId: string;
    readonly file: string;
    readonly baseDir: string;
    readonly ownerRoot: string;
    readonly criteriaPaths: readonly string[];
    readonly privatePaths: readonly string[];
  },
): Effect.Effect<void, DiscoveryError> {
  const hidden: readonly HiddenInput[] = Object.freeze([
    ...input.criteriaPaths.map((path) => ({ path, kind: "verifier" as const })),
    ...input.privatePaths.map((path) => ({ path, kind: "private" as const })),
  ]);
  return leakGateHintsForLayer(definition.sandbox, input.baseDir, input.file, input.ownerRoot).pipe(
    Effect.flatMap(Option.match({
      onNone: () => Effect.void,
      onSome: (hints) => Effect.tryPromise({
        try: () => assertNoHiddenInputLeaks({
          hidden,
          buildContexts: hints.buildContexts,
          bindMounts: hints.bindMounts,
          evalId: input.evalId,
        }),
        catch: (cause) => issue(
          input.file,
          "discovery.leak-gate-failed",
          causeMessage(cause),
          ["Remove hidden verifier/private inputs from the sandbox build context or bind mounts."],
        ),
      }),
    })),
  );
}

function projectExternalLoaderCapture(
  scope: EvalDiscoveryScope,
  moduleFacts: NonNullable<import("../types.ts").DiscoveredEval["moduleFacts"]>,
  captured: { readonly paths: readonly string[]; readonly criteriaPaths: readonly string[]; readonly privatePaths: readonly string[] },
): { readonly paths: readonly string[]; readonly criteriaPaths: readonly string[]; readonly privatePaths: readonly string[] } {
  const owner = resolve(scope.ownerRoot);
  const modules = new Set(moduleFacts.modules);
  const records = externalLoaderCaptures.get(owner) ?? [];
  const paths = new Set(captured.paths);
  const criteriaPaths = new Set(captured.criteriaPaths);
  const privatePaths = new Set(captured.privatePaths);
  for (const record of records) {
    if (![...record.modules].some((module) => modules.has(module))) continue;
    for (const path of record.paths) paths.add(path);
    for (const path of record.criteriaPaths) criteriaPaths.add(path);
    for (const path of record.privatePaths) privatePaths.add(path);
  }
  records.push(Object.freeze({
    modules,
    paths: Object.freeze([...captured.paths]),
    criteriaPaths: Object.freeze([...captured.criteriaPaths]),
    privatePaths: Object.freeze([...captured.privatePaths]),
  }));
  externalLoaderCaptures.set(owner, records);
  return Object.freeze({
    paths: Object.freeze([...paths].sort()),
    criteriaPaths: Object.freeze([...criteriaPaths].sort()),
    privatePaths: Object.freeze([...privatePaths].sort()),
  });
}

function discoverEvalEntry(
  entry: EvalEntry,
  scope: EvalDiscoveryScope,
): Effect.Effect<readonly DiscoveredEval[], DiscoveryError> {
  const root = scope.ownerRoot;
  const fileLabel = relative(root, entry.file).split(sep).join("/");
  return Effect.gen(function*() {
    const captured = yield* Effect.tryPromise({
      try: () => captureLoadedFiles(
        () => import(pathToFileURL(entry.file).href),
        { root: scope.ownerRoot, ownerRoot: scope.ownerRoot },
      ),
      catch: (cause) => discoveryErrorFromCause(cause, {
        file: fileLabel,
        code: "discovery.import-failed",
        actions: ["Fix module loading and loader declarations."],
      }),
    });
    const module = yield* decodeEvalModule(captured.value, fileLabel);
    const expanded = yield* expandEvalExport(module.default, entry, root);
    const definitions = expanded.filter((value): value is { readonly id: string; readonly definition: AnyEvalDefinition } =>
      "definition" in value);
    // A remote declaration is a catalog reference, not an executable local
    // definition. discoverProjectEvals resolves those references after package
    // preflight; ordinary local discovery keeps them out of the result.
    if (definitions.length === 0) return Object.freeze([]);
    const source = yield* Effect.tryPromise({
      try: () => captureEvalSource(entry.file, { root }),
      catch: (cause) => issue(
        fileLabel,
        "discovery.source-capture-failed",
        causeMessage(cause),
        ["Make the eval source file readable."],
      ),
    });
    const baseDir = dirname(entry.file);
    // Both local and mounted Evals get a transfer/module projection.  Mounted
    // owners additionally receive P4 hook facts; local Evals retain their
    // existing resolver semantics while no longer treating every upload as an
    // opaque dynamic transfer.
    const moduleFacts = yield* Effect.tryPromise({
      try: () => moduleFactsForEval(entry.file, scope.ownerRoot),
      catch: (cause) => discoveryErrorFromCause(cause, {
        file: fileLabel,
        code: "discovery.import-failed",
        actions: ["Keep static Eval module edges inside the owning project or package."],
      }),
    });
    const loaderCapture = scope.external === undefined
      ? captured
      : projectExternalLoaderCapture(scope, moduleFacts, captured);
    const loaderDataPaths = Object.freeze([...loaderCapture.paths]);
    const criteriaPaths = Object.freeze([...loaderCapture.criteriaPaths]);
    const privatePaths = Object.freeze([...loaderCapture.privatePaths]);
    const [leakErrors] = yield* Effect.partition(definitions, ({ id, definition }) => runLeakGate(definition, {
      evalId: id,
      file: fileLabel,
      baseDir,
      ownerRoot: scope.ownerRoot,
      criteriaPaths,
      privatePaths,
    }), { concurrency: 1 });
    if (leakErrors.length > 0) {
      return yield* Effect.fail(discoveryError(leakErrors.flatMap((error) => error.issues)));
    }
    return Object.freeze(definitions.map(({ id, definition }) => {
      const origin = scope.external === undefined ? undefined : originForEval(scope.external, id);
      return discoverEval(definition, {
      id: scope.external === undefined ? id : `${scope.external.mount}/${id}`,
      baseDir,
      sourcePath: entry.file,
      source,
      loaderDataPaths,
      criteriaPaths,
      privatePaths,
      ownerRoot: scope.ownerRoot,
      evalRoot: scope.evalRoot,
      ...(origin === undefined ? {} : { origin }),
      moduleFacts,
      });
    }));
  });
}

/** Effect-native discovery core; Promise conversion is restricted to discoverEvals(). */
export function discoverEvalsEffect(root: string): Effect.Effect<readonly DiscoveredEval[], DiscoveryError> {
  const dir = join(root, "evals");
  const scope: EvalDiscoveryScope = { ownerRoot: root, evalRoot: dir };
  return discoverEvalScopeEffect(scope);
}

function discoverEvalScopeEffect(scope: EvalDiscoveryScope): Effect.Effect<readonly DiscoveredEval[], DiscoveryError> {
  const external = scope.external;
  return collectEvalEntries(scope.evalRoot, scope.ownerRoot).pipe(
    Effect.mapError((error) => external === undefined
      ? error
      : discoveryError(error.issues.map((entry) => entry.code === "discovery.duplicate-id"
        ? {
            ...entry,
            code: "eval-root.duplicate-relative-id" as const,
            message: `Mounted root ${JSON.stringify(external.mount)} has duplicate relative Eval ids: ${entry.message}`,
          }
        : entry)),
    ),
    Effect.flatMap((entries) => collectAll(entries, (entry) => discoverEvalEntry(entry, scope))),
  );
}

export function discoverEvals(root: string): Promise<readonly DiscoveredEval[]> {
  return runDiscoveryPromise(discoverEvalsEffect(root));
}

interface RemoteEvalDeclaration {
  readonly id: string;
  readonly file: string;
  readonly reference: RemoteEvalReference;
}

/** Read consumer-owned remote declaration files without importing any package owner. */
async function discoverRemoteEvalDeclarations(root: string): Promise<readonly RemoteEvalDeclaration[]> {
  const entries = await runDiscoveryPromise(collectEvalEntries(join(root, "evals"), root));
  const candidates: EvalEntry[] = [];
  for (const entry of entries) {
    const source = await readFile(entry.file, "utf8");
    if (/\bdefineRemoteEval\s*\(/.test(source)) candidates.push(entry);
  }
  if (candidates.length > 0 && !supportsExternalEvalRoots()) {
    throw new EvalRootPreflightError([{
      code: "eval-root.node-unsupported",
      message: `defineRemoteEval requires Node >=22.15; current Node is ${process.versions.node}.`,
      actions: ["Use Node >=22.15, or remove the defineRemoteEval declaration."],
    }]);
  }
  const declarations: RemoteEvalDeclaration[] = [];
  for (const entry of candidates) {
    const fileLabel = relative(root, entry.file).split(sep).join("/");
    const imported = await runDiscoveryPromise(importModule(entry.file, root, "eval"));
    const module = await runDiscoveryPromise(decodeEvalModule(imported, fileLabel));
    const expanded = await runDiscoveryPromise(expandEvalExport(module.default, entry, root));
    for (const value of expanded) {
      if ("remote" in value) declarations.push(Object.freeze({ id: value.id, file: entry.file, reference: value.remote }));
    }
  }
  return Object.freeze(declarations);
}

/**
 * Shared Eval-definition consumer boundary.  Every command that needs Eval
 * definitions must call this instead of scanning project `evals/` directly:
 * preflight finishes before external code is imported, hooks get one owner map,
 * and duplicate final ids are rejected across all roots at once.
 */
export async function discoverProjectEvals(
  root: string,
  config: Pick<Config, "evalRoots">,
): Promise<readonly DiscoveredEval[]> {
  const declarations = await discoverRemoteEvalDeclarations(root);
  const configuredRoots = config.evalRoots ?? {};
  const remoteMounts: Record<string, PackageEvalRoot> = {};
  const declarationsByMount = new Map<string, RemoteEvalDeclaration[]>();
  const mountBySource = new Map<string, string>();
  const declarationBySource = new Map<string, RemoteEvalDeclaration>();
  for (const declaration of declarations) {
    const sourceKey = `${declaration.reference.package}\u0000${declaration.reference.root ?? "evals"}\u0000${declaration.reference.eval}`;
    const previous = declarationBySource.get(sourceKey);
    if (previous !== undefined) {
      throw discoveryError([{
        file: relative(root, declaration.file).split(sep).join("/"),
        code: "discovery.duplicate-id",
        message: `Remote Eval ${JSON.stringify(declaration.reference.eval)} is referenced by both ${relative(root, previous.file)} and ${relative(root, declaration.file)}.`,
        actions: ["Keep one defineRemoteEval file for each upstream Eval, or choose a different upstream Eval."],
      }]);
    }
    declarationBySource.set(sourceKey, declaration);
    const key = `${declaration.reference.package}\u0000${declaration.reference.root ?? "evals"}`;
    let mount = mountBySource.get(key);
    if (mount === undefined) {
      mount = `__remote/${String(mountBySource.size).padStart(4, "0")}`;
      mountBySource.set(key, mount);
      remoteMounts[mount] = Object.freeze({
        package: declaration.reference.package,
        ...(declaration.reference.root === undefined ? {} : { root: declaration.reference.root }),
      });
    }
    declarationsByMount.set(mount, [...(declarationsByMount.get(mount) ?? []), declaration]);
  }
  const externalRoots = await preflightEvalRoots(root, {
    evalRoots: Object.freeze({ ...configuredRoots, ...remoteMounts }),
  });
  if (externalRoots.length === 0) return discoverEvals(root);
  externalLoaderCaptures.clear();
  await preflightEvalRootSources(externalRoots);
  activateEvalRootHooks(externalRoots);
  const local = await discoverEvals(root);
  // Loader capture and the hook-observation queue are process-scoped facts.
  // Keep external owners serial here so one package cannot consume another
  // package's observed edges or registered loader files.
  const groups: (readonly DiscoveredEval[])[] = [];
  for (const external of externalRoots) {
    const group = await runDiscoveryPromise(discoverEvalScopeEffect({
      ownerRoot: external.packageRoot,
      evalRoot: external.evalRoot,
      external,
    }));
    const remoteDeclarations = declarationsByMount.get(external.mount);
    if (remoteDeclarations === undefined) {
      groups.push(group);
      continue;
    }
    const selected: DiscoveredEval[] = [];
    for (const declaration of remoteDeclarations) {
      const match = group.find((candidate) => candidate.origin?.relativeEvalId === declaration.reference.eval);
      if (match === undefined) {
        throw discoveryError([{
          file: relative(root, declaration.file).split(sep).join("/"),
          code: "eval-root.missing",
          mount: external.mount,
          dependency: declaration.reference.package,
          evalFile: declaration.file,
          message: `Remote Eval ${JSON.stringify(declaration.reference.eval)} was not found under the installed package root.`,
          actions: ["Use the exact upstream Eval id exported by the package."],
        }]);
      }
      const origin = match.origin!;
      selected.push(discoverEval(match, {
        ...match,
        id: declaration.id,
        origin: Object.freeze({ ...origin, mount: declaration.id, relativeEvalId: declaration.reference.eval }),
      }));
    }
    groups.push(Object.freeze(selected));
  }
  const all = [...local, ...groups.flat()].sort((a, b) => a.id.localeCompare(b.id));
  const byId = new Map<string, DiscoveredEval[]>();
  for (const evalDef of all) byId.set(evalDef.id, [...(byId.get(evalDef.id) ?? []), evalDef]);
  const duplicates = [...byId.entries()].flatMap(([id, owners]) => owners.length < 2 ? [] : [{
    file: owners.map((owner) => owner.sourcePath).join(", "),
    code: "discovery.duplicate-id" as const,
    message: `Duplicate final Eval id ${JSON.stringify(id)} across local and mounted Eval roots.`,
    actions: Object.freeze(["Change a mount prefix or remove the duplicate Eval entry."]),
  }]);
  if (duplicates.length > 0) throw discoveryError(duplicates);
  return Object.freeze(all);
}

function discoverExperimentFile(
  file: string,
  root: string,
  experimentsDir: string,
): Effect.Effect<readonly DiscoveredExperiment[], DiscoveryError> {
  const fileLabel = relative(root, file).split(sep).join("/");
  return Effect.gen(function*() {
    const imported = yield* importModule(file, root, "experiment");
    const module = yield* decodeExperimentModule(imported, fileLabel);
    if (module.default === undefined) return Object.freeze([]);
    const id = relative(experimentsDir, file)
      .replace(/\.ts$/, "")
      .replace(/\.experiment$/, "")
      .split(sep)
      .join("/");
    return Object.freeze([discoverExperiment(module.default, {
      id,
      baseDir: dirname(file),
      sourcePath: file,
    })]);
  });
}

export function discoverExperimentsEffect(
  root: string,
): Effect.Effect<readonly DiscoveredExperiment[], DiscoveryError> {
  const dir = join(root, "experiments");
  return walkFiles(dir, root, (name) => name.endsWith(".ts") && !name.endsWith(".d.ts")).pipe(
    Effect.flatMap((files) => Effect.partition(
      files,
      (file) => discoverExperimentFile(file, root, dir),
      { concurrency: 1 },
    )),
    Effect.flatMap(([errors, groups]) => errors.length > 0
      ? Effect.fail(discoveryError(errors.flatMap((error) => error.issues)))
      : Effect.succeed(Object.freeze(groups.flat()))),
  );
}

export function discoverExperiments(root: string): Promise<readonly DiscoveredExperiment[]> {
  return runDiscoveryPromise(discoverExperimentsEffect(root));
}

function runDiscoveryPromise<A>(effect: Effect.Effect<A, DiscoveryError>): Promise<A> {
  return Effect.runPromise(Effect.either(effect)).then((result) =>
    Either.isLeft(result) ? Promise.reject(result.left) : result.right
  );
}

/** eval id 的裸字面前缀过滤；exp / show / view 共用 shared helper。 */
export function makeFilter(patterns: string[]): (id: string) => boolean {
  return evalPrefixPredicate(patterns.length > 0 ? patterns : undefined);
}
