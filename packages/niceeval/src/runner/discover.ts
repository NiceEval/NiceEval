// Discovery is the only boundary where executable modules enter the typed runner.
// Dynamic imports are decoded immediately; every later stage receives branded, immutable definitions.

import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Data, Effect, Option, Schema } from "effect";
import { pad4 } from "../util.ts";
import {
  assertNoHiddenInputLeaks,
  captureEvalSource,
  folderEntryBaseId,
  type HiddenInput,
  type LeakGateHints,
} from "./eval-source.ts";
import { evalPrefixPredicate } from "../shared/aggregate.ts";
import {
  captureLoadedFiles,
  type LoaderCaptureOrigin,
  type LoaderCapturePaths,
} from "../loaders/index.ts";
import { createFreshImportGeneration, type FreshImportGeneration } from "../fresh-import.ts";
import { sandboxLayerStateOf, type SandboxLayer } from "../sandbox/layer.ts";
import { sandboxLayerDefinitionIdentity } from "../sandbox/link.ts";
import {
  discoverEval,
  discoverExperiment,
  isEvalDefinition,
  isExperimentDefinition,
  isEvalGroupDefinition,
} from "../types.ts";
import type {
  AnyEvalDefinition,
  DiscoveredEval,
  DiscoveredExperiment,
  ExperimentDefinition,
  EvalGroupDefinition,
} from "../types.ts";
import { digestOf } from "../sandbox/identity.ts";
import { captureSourceClosure } from "./source-closure.ts";
import { splitByEvaluationKind } from "./eval-selection.ts";

const SKIP_DIRS = new Set(["node_modules", ".git", ".niceeval", "dist", ".next"]);

export type DiscoveryIssueCode =
  | "discovery.filesystem"
  | "discovery.duplicate-id"
  | "discovery.import-failed"
  | "discovery.invalid-export"
  | "eval-group-member-unresolved"
  | "eval-group-member-overlap"
  | "eval-group-member-layer"
  | "eval-group-evaluation-kind-mixed"
  | "discovery.invalid-dataset-key"
  | "discovery.source-capture-failed"
  | "discovery.leak-gate-failed";

export interface DiscoveryIssue {
  readonly file: string;
  readonly code: DiscoveryIssueCode;
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

type EvalModuleExport =
  | AnyEvalDefinition
  | readonly AnyEvalDefinition[]
  | Readonly<globalThis.Record<string, AnyEvalDefinition>>;

interface EvalModule {
  readonly default: EvalModuleExport;
}

interface ExperimentModule {
  readonly default?: ExperimentDefinition;
}

interface EvalGroupModule { readonly default: EvalGroupDefinition }

const EvalDefinitionSchema = Schema.declare(isEvalDefinition, {
  identifier: "EvalDefinition",
  description: "a value returned by defineEval() or defineScoreEval()",
});
const EvalModuleSchema: Schema.Schema<EvalModule> = Schema.Struct({
  default: Schema.Union([
    Schema.toType(EvalDefinitionSchema),
    Schema.Array(Schema.toType(EvalDefinitionSchema)),
    Schema.Record(Schema.String, Schema.toType(EvalDefinitionSchema)),
  ]),
});
const ExperimentDefinitionSchema = Schema.declare(isExperimentDefinition, {
  identifier: "ExperimentDefinition",
  description: "a value returned by defineExperiment()",
});
const ExperimentModuleSchema: Schema.Schema<ExperimentModule> = Schema.Struct({
  default: Schema.optional(Schema.toType(ExperimentDefinitionSchema)),
});
const EvalGroupModuleSchema: Schema.Schema<EvalGroupModule> = Schema.Struct({
  default: Schema.toType(Schema.declare(isEvalGroupDefinition, { identifier: "EvalGroupDefinition" })),
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

type DiscoveryModuleLoader = (file: string) => Promise<unknown>;

const cachedModuleLoader: DiscoveryModuleLoader = (file) => import(pathToFileURL(file).href);

function importModule(
  file: string,
  root: string,
  kind: "eval" | "experiment",
  load: DiscoveryModuleLoader = cachedModuleLoader,
): Effect.Effect<unknown, DiscoveryError> {
  return Effect.tryPromise({
    try: () => load(file),
    catch: (cause) => issue(
      relative(root, file),
      "discovery.import-failed",
      `Top-level ${kind} module evaluation failed: ${causeMessage(cause)}`,
      [`Move resource work into the selected ${kind} body.`, "Fix the reported top-level exception."],
    ),
  });
}

function decodeEvalModule(value: unknown, file: string): Effect.Effect<EvalModule, DiscoveryError> {
  return Schema.decodeUnknownEffect(Schema.toType(EvalModuleSchema), { errors: "all" })(value).pipe(
    Effect.mapError((error) => issue(
      file,
      "discovery.invalid-export",
      String(error),
      ["Default-export defineEval()/defineScoreEval() output, an array of those outputs, or a keyed record of those outputs."],
    )),
  );
}

function decodeExperimentModule(value: unknown, file: string): Effect.Effect<ExperimentModule, DiscoveryError> {
  return Schema.decodeUnknownEffect(Schema.toType(ExperimentModuleSchema), { errors: "all" })(value).pipe(
    Effect.mapError((error) => issue(
      file,
      "discovery.invalid-export",
      String(error),
      ["Default-export defineExperiment({...}) instead of a plain object."],
    )),
  );
}

function decodeEvalGroupModule(value: unknown, file: string): Effect.Effect<EvalGroupModule, DiscoveryError> {
  return Schema.decodeUnknownEffect(Schema.toType(EvalGroupModuleSchema), { errors: "all" })(value).pipe(
    Effect.mapError((error) => issue(file, "discovery.invalid-export", String(error), [
      "Default-export defineEvalGroup({ evals: [definition, ...] }).",
    ])),
  );
}

function collectAll<A, B>(
  values: readonly A[],
  f: (value: A) => Effect.Effect<B, DiscoveryError>,
): Effect.Effect<readonly B[], DiscoveryError> {
  return Effect.partition(values, f, { concurrency: 1 }).pipe(
    Effect.flatMap(([errors, groups]) => errors.length > 0
      ? Effect.fail(discoveryError(errors.flatMap((error) => error.issues)))
      : Effect.succeed(Object.freeze(groups))),
  );
}

function walkFiles(
  dir: string,
  root: string,
  match: (name: string) => boolean,
): Effect.Effect<readonly string[], DiscoveryError> {
  const readDirectory = (current: string, allowAbsent: boolean) => Effect.tryPromise({
    try: async () => {
      try {
        return await readdir(current, { withFileTypes: true });
      } catch (cause) {
        if (allowAbsent && isMissingPath(cause)) return undefined;
        throw cause;
      }
    },
    catch: (cause) => issue(
      relative(root, current) || ".",
      "discovery.filesystem",
      causeMessage(cause),
      ["Check that the discovery directory is readable."],
    ),
  });

  const walk = (current: string, allowAbsent: boolean): Effect.Effect<readonly string[], DiscoveryError> =>
    Effect.suspend(() => readDirectory(current, allowAbsent).pipe(
      Effect.flatMap((entries) => {
        if (entries === undefined) return Effect.succeed(Object.freeze([]));
        return Effect.forEach(entries, (entry) => {
          const full = join(current, entry.name);
          if (entry.isDirectory()) {
            return SKIP_DIRS.has(entry.name)
              ? Effect.succeed([])
              : walk(full, false);
          }
          return entry.isFile() && match(entry.name)
            ? Effect.succeed([full])
            : Effect.succeed([]);
        }, { concurrency: 1 }).pipe(
          Effect.map((groups) => Object.freeze(groups.flat())),
        );
      }),
    ));

  return walk(dir, true).pipe(
    Effect.map((files) => Object.freeze([...files].sort())),
  );
}

function isMissingPath(cause: unknown): boolean {
  return typeof cause === "object" && cause !== null && "code" in cause &&
    (cause as { readonly code?: unknown }).code === "ENOENT";
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
  return Array.isArray(exported);
}

function expandEvalExport(
  exported: EvalModuleExport,
  entry: EvalEntry,
  root: string,
): Effect.Effect<readonly { readonly id: string; readonly definition: AnyEvalDefinition }[], DiscoveryError> {
  if (isEvalDefinition(exported)) {
    return Effect.succeed(Object.freeze([{ id: entry.baseId, definition: exported }]));
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
    return Effect.succeed(Option.some({ buildContexts: [{ contextDir, label: "dockerfile" }] }));
  }
  const composeFile = leakGate.file._tag === "Url" ? new URL(leakGate.file.value) : leakGate.file.value;
  return Effect.tryPromise({
    try: () => import("../sandbox/compose.ts"),
    catch: (cause) => issue(
      file,
      "discovery.leak-gate-failed",
      causeMessage(cause),
      ["Fix the Docker Compose declaration used by this eval SandboxLayer."],
    ),
  }).pipe(
    Effect.flatMap(({ leakGateHintsFromComposeFile }) =>
      leakGateHintsFromComposeFile(composeFile, {
        mainService: leakGate.workspaceService,
        baseDir,
      }).pipe(Effect.mapError((cause) => issue(
        file,
        "discovery.leak-gate-failed",
        causeMessage(cause),
        ["Fix the Docker Compose declaration used by this eval SandboxLayer."],
      ))),
    ),
    Effect.map(({ hints }) => Option.some(hints)),
  );
}

function runLeakGate(
  definition: AnyEvalDefinition,
  input: {
    readonly evalId: string;
    readonly file: string;
    readonly baseDir: string;
    readonly criteriaPaths: readonly string[];
    readonly privatePaths: readonly string[];
  },
): Effect.Effect<void, DiscoveryError> {
  const hidden: readonly HiddenInput[] = Object.freeze([
    ...input.criteriaPaths.map((path) => ({ path, kind: "verifier" as const })),
    ...input.privatePaths.map((path) => ({ path, kind: "private" as const })),
  ]);
  if (hidden.length === 0) return Effect.void;
  return leakGateHintsForLayer(definition.sandbox, input.baseDir, input.file).pipe(
    Effect.flatMap(Option.match({
      onNone: () => Effect.void,
      onSome: (hints) => assertNoHiddenInputLeaks({
          hidden,
          buildContexts: hints.buildContexts,
          bindMounts: hints.bindMounts,
          evalId: input.evalId,
        }).pipe(Effect.mapError((cause) => issue(
          input.file,
          "discovery.leak-gate-failed",
          causeMessage(cause),
          ["Remove hidden verifier/private inputs from the sandbox build context or bind mounts."],
        ))),
    })),
  );
}

interface DiscoveredEvalEntry {
  readonly sourcePath: string;
  readonly evals: readonly DiscoveredEval[];
  readonly origins: readonly LoaderCaptureOrigin[];
  readonly unattributed: LoaderCapturePaths;
}

function discoverEvalEntry(
  entry: EvalEntry,
  root: string,
  load: DiscoveryModuleLoader = cachedModuleLoader,
): Effect.Effect<DiscoveredEvalEntry, DiscoveryError> {
  const fileLabel = relative(root, entry.file).split(sep).join("/");
  return Effect.gen(function*() {
    const captured = yield* Effect.tryPromise({
      try: () => captureLoadedFiles(() => load(entry.file)),
      catch: (cause) => issue(
        fileLabel,
        "discovery.import-failed",
        causeMessage(cause),
        ["Fix module loading and loader declarations."],
      ),
    });
    const module = yield* decodeEvalModule(captured.value, fileLabel);
    const expanded = yield* expandEvalExport(module.default, entry, root);
    const source = yield* Effect.tryPromise({
      try: () => captureEvalSource(entry.file, { root }),
      catch: (cause) => issue(
        fileLabel,
        "discovery.source-capture-failed",
        causeMessage(cause),
        ["Make the eval source file readable."],
      ),
    });
    const loaderDataPaths = Object.freeze([...captured.paths]);
    const criteriaPaths = Object.freeze([...captured.criteriaPaths]);
    const privatePaths = Object.freeze([...captured.privatePaths]);
    const baseDir = dirname(entry.file);
    return Object.freeze({
      sourcePath: entry.file,
      evals: Object.freeze(expanded.map(({ id, definition }) => discoverEval(definition, {
      id,
      baseDir,
      sourcePath: entry.file,
      source,
      loaderDataPaths,
      criteriaPaths,
      privatePaths,
      definition,
      }))),
      origins: captured.origins,
      unattributed: captured.unattributed,
    });
  });
}

interface LoaderPathBuckets {
  readonly data: Set<string>;
  readonly criteria: Set<string>;
  readonly private: Set<string>;
}

function emptyLoaderPathBuckets(): LoaderPathBuckets {
  return { data: new Set<string>(), criteria: new Set<string>(), private: new Set<string>() };
}

function addLoaderPaths(
  target: LoaderPathBuckets,
  source: LoaderCapturePaths,
): void {
  source.paths.forEach((path) => target.data.add(path));
  source.criteriaPaths.forEach((path) => target.criteria.add(path));
  source.privatePaths.forEach((path) => target.private.add(path));
}

function directLoaderPaths(evalDef: DiscoveredEval): LoaderCaptureOrigin {
  return {
    sourcePath: evalDef.sourcePath,
    paths: evalDef.loaderDataPaths,
    criteriaPaths: evalDef.criteriaPaths,
    privatePaths: evalDef.privatePaths,
  };
}

function withLoaderProvenance(
  evalDef: DiscoveredEval,
  paths: LoaderPathBuckets,
): DiscoveredEval {
  return discoverEval(evalDef.definition, {
    id: evalDef.id,
    baseDir: evalDef.baseDir,
    sourcePath: evalDef.sourcePath,
    source: evalDef.source,
    loaderDataPaths: Object.freeze([...paths.data].sort()),
    criteriaPaths: Object.freeze([...paths.criteria].sort()),
    privatePaths: Object.freeze([...paths.private].sort()),
    definition: evalDef.definition,
  });
}

/**
 * A namespaced fresh graph evaluates a shared helper just once. Attribute the
 * helper's loader registrations to every entry whose static closure contains
 * that helper, so later entries retain the same data/criteria/private surface
 * without evaluating the module again.
 */
function propagateLoaderProvenance(
  entries: readonly DiscoveredEvalEntry[],
  root: string,
): Effect.Effect<readonly DiscoveredEval[], DiscoveryError> {
  return Effect.tryPromise({
    try: async () => {
      const originPaths = new Map<string, LoaderPathBuckets>();
      const conservative = emptyLoaderPathBuckets();
      for (const entry of entries) {
        addLoaderPaths(conservative, entry.unattributed);
        for (const origin of entry.origins) {
          const buckets = originPaths.get(resolve(origin.sourcePath)) ?? emptyLoaderPathBuckets();
          originPaths.set(resolve(origin.sourcePath), buckets);
          addLoaderPaths(buckets, origin);
        }
      }
      const evals: DiscoveredEval[] = [];
      for (const entry of entries) {
        const buckets = emptyLoaderPathBuckets();
        // A host may omit user frames from Error.stack. Conservative union is
        // deliberate: extra invalidation/leak checks are safe; lost provenance
        // is not.
        addLoaderPaths(buckets, {
          paths: [...conservative.data],
          criteriaPaths: [...conservative.criteria],
          privatePaths: [...conservative.private],
        });
        // Keep the old direct capture as a conservative fallback when a host
        // omits call-site frames from Error.stack.
        for (const evalDef of entry.evals) addLoaderPaths(buckets, directLoaderPaths(evalDef));
        const closure = await captureSourceClosure(entry.sourcePath, { root });
        const modules = new Set(closure.map(([path]) => resolve(root, path)));
        for (const [modulePath, registered] of originPaths) {
          if (modules.has(modulePath)) addLoaderPaths(buckets, {
            paths: [...registered.data],
            criteriaPaths: [...registered.criteria],
            privatePaths: [...registered.private],
          });
        }
        evals.push(...entry.evals.map((evalDef) => withLoaderProvenance(evalDef, buckets)));
      }
      return Object.freeze(evals);
    },
    catch: (cause) => issue(
      relative(root, join(root, "evals")) || "evals",
      "discovery.source-capture-failed",
      causeMessage(cause),
      ["Make every Eval entry and its static project-local imports readable."],
    ),
  });
}

function matchingArrayClose(source: string, start: number): number | undefined {
  let depth = 0;
  let quote: "'" | '"' | "`" | undefined;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = start; index < source.length; index++) {
    const char = source[index]!;
    const next = source[index + 1];
    if (lineComment) {
      if (char === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") { blockComment = false; index++; }
      continue;
    }
    if (quote !== undefined) {
      if (!escaped && char === quote) quote = undefined;
      escaped = !escaped && char === "\\";
      continue;
    }
    if (char === "/" && next === "/") { lineComment = true; index++; continue; }
    if (char === "/" && next === "*") { blockComment = true; index++; continue; }
    if (char === "'" || char === '"' || char === "`") { quote = char; escaped = false; continue; }
    if (char === "[") depth++;
    if (char === "]") {
      depth--;
      if (depth === 0) return index;
    }
  }
  return undefined;
}

function splitArrayElements(source: string): readonly string[] | undefined {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: "'" | '"' | "`" | undefined;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index]!;
    const next = source[index + 1];
    if (lineComment) { if (char === "\n") lineComment = false; continue; }
    if (blockComment) { if (char === "*" && next === "/") { blockComment = false; index++; } continue; }
    if (quote !== undefined) {
      if (!escaped && char === quote) quote = undefined;
      escaped = !escaped && char === "\\";
      continue;
    }
    if (char === "/" && next === "/") { lineComment = true; index++; continue; }
    if (char === "/" && next === "*") { blockComment = true; index++; continue; }
    if (char === "'" || char === '"' || char === "`") { quote = char; escaped = false; continue; }
    if (char === "(" || char === "{" || char === "[") depth++;
    if (char === ")" || char === "}" || char === "]") depth--;
    if (char === "," && depth === 0) {
      const part = source.slice(start, index).trim();
      if (part === "") return undefined;
      parts.push(part);
      start = index + 1;
    }
  }
  const last = source.slice(start).trim();
  if (last !== "") parts.push(last);
  return parts;
}

/**
 * `evals` is a closed set. Normalize only inline array spelling in the Group
 * entry before its source participates in the definition hash; all other
 * source remains byte-sensitive, including opaque commands and hooks.
 */
function normalizeEvalGroupSource(content: string): string {
  let output = "";
  let cursor = 0;
  const property = /\bevals\s*:\s*\[/g;
  for (let found = property.exec(content); found !== null; found = property.exec(content)) {
    const bracket = found.index + found[0].lastIndexOf("[");
    const close = matchingArrayClose(content, bracket);
    if (close === undefined) return content;
    const elements = splitArrayElements(content.slice(bracket + 1, close));
    if (elements === undefined) return content;
    output += content.slice(cursor, bracket + 1);
    output += elements.toSorted((left, right) => left.localeCompare(right)).join(",");
    cursor = close;
    property.lastIndex = close + 1;
  }
  return output === "" ? content : output + content.slice(cursor);
}

/** Discovery remains in Effect through selection/planning; an application host closes it. */
export function discoverEvals(
  root: string,
  options: { freshImport?: boolean } = {},
): Effect.Effect<readonly DiscoveredEval[], DiscoveryError> {
  const dir = join(root, "evals");
  const discoverWith = (load: DiscoveryModuleLoader): Effect.Effect<readonly DiscoveredEval[], DiscoveryError> => Effect.gen(function*() {
    const entries = yield* collectEvalEntries(dir, root);
    const discoveredEntries = yield* collectAll(entries, (entry) => discoverEvalEntry(entry, root, load));
    const evals = yield* propagateLoaderProvenance(discoveredEntries, root);
    const [leakErrors] = yield* Effect.partition(evals, (evalDef) => runLeakGate(evalDef.definition, {
      evalId: evalDef.id,
      file: relative(root, evalDef.sourcePath).split(sep).join("/"),
      baseDir: evalDef.baseDir,
      criteriaPaths: evalDef.criteriaPaths,
      privatePaths: evalDef.privatePaths,
    }), { concurrency: 1 });
    if (leakErrors.length > 0) return yield* Effect.fail(discoveryError(leakErrors.flatMap((error) => error.issues)));
    const files = yield* walkFiles(dir, root, (name) => name === "eval-group.ts");
    const groupEntries = files.map((file) => {
      const id = relative(dir, dirname(file)).split(sep).join("/");
      return { file, id };
    });
    const groupIdIssues: DiscoveryIssue[] = [];
    const groupsById = new Map<string, typeof groupEntries>();
    for (const entry of groupEntries) groupsById.set(entry.id, [...(groupsById.get(entry.id) ?? []), entry]);
    for (const [id, owners] of groupsById) {
      if (id.length === 0) {
        groupIdIssues.push({ file: owners.map((owner) => relative(root, owner.file).split(sep).join("/")).join(", "), code: "discovery.invalid-export", message: "Eval Group id must not be empty.", actions: ["Put eval-group.ts in a named subdirectory under evals/."] });
      } else if (owners.length > 1) {
        groupIdIssues.push({ file: owners.map((owner) => relative(root, owner.file).split(sep).join("/")).join(", "), code: "discovery.duplicate-id", message: `Duplicate eval group id ${JSON.stringify(id)}: multiple entries map to the same id.`, actions: ["Keep one eval-group.ts for this group path."] });
      }
    }
    if (groupIdIssues.length > 0) return yield* Effect.fail(discoveryError(groupIdIssues));
    const claimed = new Map<AnyEvalDefinition, string>();
    const annotated = new Map<AnyEvalDefinition, DiscoveredEval>();
    const issues: DiscoveryIssue[] = [];
    const memberSourcePaths = new Set(evals.map((item) => item.sourcePath));
    for (const { file, id } of groupEntries) {
      const label = relative(root, file).split(sep).join("/");
      const imported = yield* importModule(file, root, "eval", load);
      const module = yield* decodeEvalGroupModule(imported, label);
      const resolved = module.default.evals.map((definition) => evals.filter((item) => item.definition === definition));
      // `evals` is a closed set, not an author-defined business sequence. The
      // scheduler and fingerprint use the normalized Eval ID order everywhere.
      const evalIds = resolved.flatMap((matches) => matches.map((item) => item.id)).toSorted();
      const evaluationKinds = splitByEvaluationKind(resolved.flatMap((matches) => matches.length === 1 ? matches : []));
      if (evaluationKinds.pass.length > 0 && evaluationKinds.score.length > 0) {
        issues.push({
          file: label,
          code: "eval-group-evaluation-kind-mixed",
          message:
            `Eval Group ${JSON.stringify(id)} contains both pass and score Evals. ` +
            `pass (${evaluationKinds.pass.length}): ${evaluationKinds.pass.join(", ")}; ` +
            `score (${evaluationKinds.score.length}): ${evaluationKinds.score.join(", ")}.`,
          actions: ["Split the Eval Group into one pass Group and one score Group."],
        });
      }
      const groupSources = yield* Effect.tryPromise({
        try: async () => (await captureSourceClosure(file, { root, stopPaths: memberSourcePaths })).map(([path, content]) => [
          path,
          path === label ? normalizeEvalGroupSource(content) : content,
        ] as const),
        catch: (cause) => issue(
          label,
          "discovery.source-capture-failed",
          causeMessage(cause),
          ["Make the Eval Group entry and its project-local helper modules readable."],
        ),
      });
      const definitionHash = digestOf({
        // Group declaration order is deliberately not an input. The group file
        // may reorder its closed `evals` set without changing behavior. Other
        // Group source stays in the hash, so opaque command/hook behavior and
        // helper code still invalidate fingerprints when it changes.
        version: 5,
        id,
        evalIds,
        layer: sandboxLayerDefinitionIdentity(module.default.sandbox),
        onUnavailable: module.default.onUnavailable,
        sources: groupSources.map(([path, content]) => ({ path, content })),
      });
      module.default.evals.forEach((definition, index) => {
        const matches = resolved[index]!;
        if (matches.length !== 1) {
          issues.push({ file: label, code: "eval-group-member-unresolved", message: `Eval Group ${JSON.stringify(id)} member ${index} resolves to ${matches.length} discovered Evals.`, actions: ["Import the exact default definition object from an eval entry."] });
          return;
        }
        const member = matches[0]!;
        const prior = claimed.get(definition);
        if (prior !== undefined) {
          issues.push({ file: label, code: "eval-group-member-overlap", message: `Eval ${JSON.stringify(member.id)} in Eval Group ${JSON.stringify(id)} is already claimed by Eval Group ${JSON.stringify(prior)}.`, actions: ["List each Eval exactly once in one group."] });
          return;
        }
        const state = member.sandbox === undefined ? undefined : sandboxLayerStateOf(member.sandbox);
        if (state?.kind === "template-bearing" || (state?.setupHooks.length ?? 0) > 0 || (state?.teardownHooks.length ?? 0) > 0) {
          issues.push({ file: label, code: "eval-group-member-layer", message: `Eval ${JSON.stringify(member.id)} in Eval Group ${JSON.stringify(id)} owns a template or lifecycle hook.`, actions: ["Move the template and lifecycle hooks to the Experiment or Eval Group; keep only prepare commands on the Eval."] });
          return;
        }
        claimed.set(definition, id);
        annotated.set(definition, discoverEval(definition, {
          ...member,
          evalGroup: Object.freeze({
            id,
            evalIds: Object.freeze(evalIds),
            definitionHash,
            sandbox: module.default.sandbox,
            onUnavailable: module.default.onUnavailable,
            plugins: Object.freeze([...(module.default.plugins ?? [])]),
            sourcePath: file,
            baseDir: dirname(file),
          }),
        }));
      });
    }
    if (issues.length > 0) return yield* Effect.fail(discoveryError(issues));
    return Object.freeze(evals.map((item) => annotated.get(item.definition) ?? item));
  });
  if (!options.freshImport) return discoverWith(cachedModuleLoader);
  const acquire = Effect.tryPromise({
    try: () => createFreshImportGeneration(),
    catch: (cause) => issue(
      relative(root, dir) || "evals",
      "discovery.import-failed",
      `Could not create fresh import generation: ${causeMessage(cause)}`,
      ["Fix the loader setup or retry discovery."],
    ),
  });
  return Effect.acquireUseRelease(
    acquire,
    (fresh) => discoverWith((file) => fresh.import(file)),
    (fresh: FreshImportGeneration) => Effect.promise(() => fresh.close()).pipe(Effect.catchCause(() => Effect.void)),
  );
}

function discoverExperimentFile(
  file: string,
  root: string,
  experimentsDir: string,
  load: DiscoveryModuleLoader = cachedModuleLoader,
): Effect.Effect<readonly DiscoveredExperiment[], DiscoveryError> {
  const fileLabel = relative(root, file).split(sep).join("/");
  return Effect.gen(function*() {
    const imported = yield* importModule(file, root, "experiment", load);
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

/** Discovery remains in Effect through selection/planning; an application host closes it. */
export function discoverExperiments(
  root: string,
  options: { freshImport?: boolean } = {},
): Effect.Effect<readonly DiscoveredExperiment[], DiscoveryError> {
  const dir = join(root, "experiments");
  const discoverWith = (load: DiscoveryModuleLoader): Effect.Effect<readonly DiscoveredExperiment[], DiscoveryError> =>
    walkFiles(dir, root, (name) => name.endsWith(".ts") && !name.endsWith(".d.ts")).pipe(
    Effect.flatMap((files) => Effect.partition(
      files,
      (file) => discoverExperimentFile(file, root, dir, load),
      { concurrency: 1 },
    )),
    Effect.flatMap(([errors, groups]) => errors.length > 0
      ? Effect.fail(discoveryError(errors.flatMap((error) => error.issues)))
      : Effect.succeed(Object.freeze(groups.flat()))),
  );
  if (!options.freshImport) return discoverWith(cachedModuleLoader);
  const acquire = Effect.tryPromise({
    try: () => createFreshImportGeneration(),
    catch: (cause) => issue(
      relative(root, dir) || "experiments",
      "discovery.import-failed",
      `Could not create fresh import generation: ${causeMessage(cause)}`,
      ["Fix the loader setup or retry discovery."],
    ),
  });
  return Effect.acquireUseRelease(
    acquire,
    (fresh) => discoverWith((file) => fresh.import(file)),
    (fresh: FreshImportGeneration) => Effect.promise(() => fresh.close()).pipe(Effect.catchCause(() => Effect.void)),
  );
}

/** eval id 的裸字面前缀过滤；exp 与固定读取面共用 shared helper。 */
export function makeFilter(patterns: string[]): (id: string) => boolean {
  return evalPrefixPredicate(patterns.length > 0 ? patterns : undefined);
}
