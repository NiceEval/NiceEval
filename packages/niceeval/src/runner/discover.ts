// @concord-file
// @concord-implements docs/feature/experiments/architecture/README.md
// @concord-implements docs/feature/eval-groups/architecture/README.md
// @concord-implements docs/feature/eval-groups/library.md
// @concord-implements docs/feature/eval/use-case/dataset-fanout.md

// Discovery is the only boundary where executable modules enter the typed runner.
// Dynamic imports are decoded immediately; every later stage receives branded, immutable definitions.

import { readdir } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Data, Effect, Option, Schema } from "effect";
import { pad4 } from "../util.ts";
import { assertNoHiddenInputLeaks, folderEntryBaseId, type HiddenInput, type LeakGateHints } from "./eval-source.ts";
import { evalPrefixPredicate } from "../shared/aggregate.ts";
import {
  captureLoadedFiles,
  enterLoaderDiscoveryHost,
  type LoaderCaptureOrigin,
  type LoaderCapturePaths,
} from "../loaders/runtime.ts";
import { acquireFreshImportGeneration, importProjectModule, type FreshImportGeneration } from "../fresh-import.ts";
import { sandboxLayerStateOf, type SandboxLayer } from "../sandbox/layer.ts";
import { sandboxLayerDefinitionIdentity } from "../sandbox/link.ts";
import { withSandboxScriptRoot } from "../sandbox/script.ts";
import {
  discoverEval,
  discoverExperiment,
  isEvalDefinition,
  isExperimentDefinition,
  isEvalGroupDefinition,
  isDatasetDefinition,
} from "../types.ts";
import type {
  AnyEvalDefinition,
  DiscoveredEval,
  DiscoveredExperiment,
  ExperimentDefinition,
  EvalGroupDefinition,
  DatasetDefinition,
} from "../types.ts";
import { defineEvalForContext } from "../define.ts";
import { hashEvalSource, normalizeEvalSource } from "../record/source-hash.ts";
import { digestOf } from "../sandbox/identity.ts";
import { ProjectModuleGraph, attachEvalModules, evalModules } from "./module-graph.ts";
import { normalizedIdentity } from "./source-normalization.ts";
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
  /** Retained in-process for structured error assistance; never persisted. */
  readonly cause?: unknown;
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
  | Readonly<globalThis.Record<string, AnyEvalDefinition>>
  | DatasetDefinition;

interface EvalModule {
  readonly default: EvalModuleExport;
}

interface ExperimentModule {
  readonly default?: ExperimentDefinition;
}

interface EvalGroupModule {
  readonly default: EvalGroupDefinition;
}

const EvalDefinitionSchema = Schema.declare(isEvalDefinition, {
  identifier: "EvalDefinition",
  description: "a value returned by defineEval() or defineScoreEval()",
});
const DatasetDefinitionSchema = Schema.declare(isDatasetDefinition, {
  identifier: "DatasetDefinition",
  description: "a value returned by defineDataset() or defineScoreDataset()",
});
const EvalModuleSchema: Schema.Schema<EvalModule> = Schema.Struct({
  default: Schema.Union([
    Schema.toType(EvalDefinitionSchema),
    Schema.Array(Schema.toType(EvalDefinitionSchema)),
    Schema.Record(Schema.String, Schema.toType(EvalDefinitionSchema)),
    Schema.toType(DatasetDefinitionSchema),
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
  const frozenIssues = Object.freeze(
    issues.map((issue) =>
      Object.freeze({
        ...issue,
        actions: Object.freeze([...issue.actions]),
      }),
    ),
  );
  return new DiscoveryError({
    message: frozenIssues
      .map((issue) => `${issue.code} ${issue.file}: ${issue.message} Actions: ${issue.actions.join(" ")}`)
      .join("\n"),
    issues: frozenIssues,
  });
}

function issue(
  file: string,
  code: DiscoveryIssueCode,
  message: string,
  actions: readonly string[],
  cause?: unknown,
): DiscoveryError {
  return discoveryError([{ file, code, message, actions, ...(cause === undefined ? {} : { cause }) }]);
}

function causeMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

type DiscoveryModuleLoader = (file: string) => Promise<unknown>;

const cachedModuleLoader: DiscoveryModuleLoader = importProjectModule;

function importModule(
  file: string,
  root: string,
  kind: "eval" | "experiment",
  load: DiscoveryModuleLoader = cachedModuleLoader,
): Effect.Effect<unknown, DiscoveryError> {
  return Effect.tryPromise({
    try: () => withSandboxScriptRoot(root, () => load(file)),
    catch: (cause) =>
      issue(
        relative(root, file),
        "discovery.import-failed",
        `Top-level ${kind} module evaluation failed: ${causeMessage(cause)}`,
        [`Move resource work into the selected ${kind} body.`, "Fix the reported top-level exception."],
        cause,
      ),
  });
}

function decodeEvalModule(value: unknown, file: string): Effect.Effect<EvalModule, DiscoveryError> {
  return Schema.decodeUnknownEffect(Schema.toType(EvalModuleSchema), { errors: "all" })(value).pipe(
    Effect.mapError((error) =>
      issue(file, "discovery.invalid-export", String(error), [
        "Default-export defineEval()/defineScoreEval() output, an array of those outputs, or a keyed record of those outputs.",
      ]),
    ),
  );
}

function decodeExperimentModule(value: unknown, file: string): Effect.Effect<ExperimentModule, DiscoveryError> {
  return Schema.decodeUnknownEffect(Schema.toType(ExperimentModuleSchema), { errors: "all" })(value).pipe(
    Effect.mapError((error) =>
      issue(file, "discovery.invalid-export", String(error), [
        "Default-export defineExperiment({...}) instead of a plain object.",
      ]),
    ),
  );
}

function decodeEvalGroupModule(value: unknown, file: string): Effect.Effect<EvalGroupModule, DiscoveryError> {
  return Schema.decodeUnknownEffect(Schema.toType(EvalGroupModuleSchema), { errors: "all" })(value).pipe(
    Effect.mapError((error) =>
      issue(file, "discovery.invalid-export", String(error), [
        "Default-export defineEvalGroup({ evals: [definition, ...] }).",
      ]),
    ),
  );
}

function collectAll<A, B>(
  values: readonly A[],
  f: (value: A) => Effect.Effect<B, DiscoveryError>,
): Effect.Effect<readonly B[], DiscoveryError> {
  return Effect.partition(values, f, { concurrency: 1 }).pipe(
    Effect.flatMap(([groups, errors]) =>
      errors.length > 0
        ? Effect.fail(discoveryError(errors.flatMap((error) => error.issues)))
        : Effect.succeed(Object.freeze(groups)),
    ),
  );
}

function walkFiles(
  dir: string,
  root: string,
  match: (name: string) => boolean,
  stopAtCase = false,
): Effect.Effect<readonly string[], DiscoveryError> {
  const readDirectory = (current: string, allowAbsent: boolean) =>
    Effect.tryPromise({
      try: async () => {
        try {
          return await readdir(current, { withFileTypes: true });
        } catch (cause) {
          if (allowAbsent && isMissingPath(cause)) return undefined;
          throw cause;
        }
      },
      catch: (cause) =>
        issue(relative(root, current) || ".", "discovery.filesystem", causeMessage(cause), [
          "Check that the discovery directory is readable.",
        ]),
    });

  const walk = (current: string, allowAbsent: boolean): Effect.Effect<readonly string[], DiscoveryError> =>
    Effect.suspend(() =>
      readDirectory(current, allowAbsent).pipe(
        Effect.flatMap((entries) => {
          if (entries === undefined) return Effect.succeed(Object.freeze([]));
          const isCase = stopAtCase && entries.some((entry) => entry.isFile() && isFolderEntryName(entry.name));
          return Effect.forEach(
            entries,
            (entry) => {
              const full = join(current, entry.name);
              if (entry.isDirectory()) {
                return isCase || SKIP_DIRS.has(entry.name) ? Effect.succeed([]) : walk(full, false);
              }
              return entry.isFile() && match(entry.name) ? Effect.succeed([full]) : Effect.succeed([]);
            },
            { concurrency: 1 },
          ).pipe(Effect.map((groups) => Object.freeze(groups.flat())));
        }),
      ),
    );

  return walk(dir, true).pipe(Effect.map((files) => Object.freeze([...files].sort())));
}

function isMissingPath(cause: unknown): boolean {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    (cause as { readonly code?: unknown }).code === "ENOENT"
  );
}

function isFolderEntryName(name: string): boolean {
  return name === "eval.ts" || name === "eval.tsx";
}

function isFileEntryName(name: string): boolean {
  return name.endsWith(".eval.ts") || name.endsWith(".eval.tsx");
}

function collectEvalEntries(evalsDir: string, root: string): Effect.Effect<readonly EvalEntry[], DiscoveryError> {
  return walkFiles(evalsDir, root, (name) => isFileEntryName(name) || isFolderEntryName(name), true).pipe(
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
          baseId: relative(evalsDir, file)
            .replace(/\.eval\.tsx?$/, "")
            .split(sep)
            .join("/"),
          kind: "file",
        };
      });
      const byId = new Map<string, EvalEntry[]>();
      for (const entry of entries) byId.set(entry.baseId, [...(byId.get(entry.baseId) ?? []), entry]);
      const duplicates = [...byId.entries()].flatMap(([id, owners]) =>
        owners.length < 2
          ? []
          : [
              {
                file: owners.map((owner) => relative(root, owner.file).split(sep).join("/")).join(", "),
                code: "discovery.duplicate-id" as const,
                message: `Duplicate eval id ${JSON.stringify(id)}: multiple entries map to the same id.`,
                actions: Object.freeze(["Keep either the file entry or the folder entry for this id."]),
              },
            ],
      );
      return duplicates.length > 0 ? Effect.fail(discoveryError(duplicates)) : Effect.succeed(Object.freeze(entries));
    }),
  );
}

function validDatasetKey(key: string): boolean {
  return (
    key.length > 0 &&
    key !== "." &&
    key !== ".." &&
    !key.includes("/") &&
    !key.includes("\\") &&
    !/[\u0000-\u001f\u007f]/.test(key)
  );
}

function isEvalDefinitionArray(exported: EvalModuleExport): exported is readonly AnyEvalDefinition[] {
  return Array.isArray(exported);
}

// @concord-code
// @concord-implements docs/feature/eval/use-case/dataset-fanout.md
function expandEvalExport(
  exported: EvalModuleExport,
  entry: EvalEntry,
  root: string,
): Effect.Effect<readonly { readonly id: string; readonly definition: AnyEvalDefinition }[], DiscoveryError> {
  if (isEvalDefinition(exported)) {
    return Effect.succeed(Object.freeze([{ id: entry.baseId, definition: exported }]));
  }
  if (isEvalDefinitionArray(exported)) {
    return Effect.succeed(
      Object.freeze(
        exported.map((definition, index) => ({
          id: `${entry.baseId}/${pad4(index)}`,
          definition,
        })),
      ),
    );
  }
  if (isDatasetDefinition(exported)) {
    return Effect.tryPromise({
      try: async () => {
        const rows = typeof exported.data === "function" ? await exported.data() : exported.data;
        if (!Array.isArray(rows)) {
          throw new TypeError("Dataset data must evaluate to an array.");
        }
        return rows.map((row, index) => {
          const key = exported.key ? exported.key(row, index) : pad4(index);
          if (!validDatasetKey(key)) {
            throw new Error(`Invalid dataset key ${JSON.stringify(key)}.`);
          }
          const kind = exported.evaluationKind ?? "pass";
          const definition = defineEvalForContext(kind, {
            description: exported.description,
            tags: exported.tags ? [...exported.tags] : undefined,
            timeoutMs: exported.timeoutMs,
            test: (t) => exported.test(t as never, row),
          });
          return {
            id: `${entry.baseId}/${key}`,
            definition,
          };
        });
      },
      catch: (cause) =>
        issue(
          relative(root, entry.file),
          "discovery.invalid-dataset-key",
          causeMessage(cause),
          ["Check that dataset data and keys are valid."],
          cause,
        ),
    }).pipe(Effect.map((items) => Object.freeze(items)));
  }
  // `Array.isArray` does not narrow readonly arrays; the array branch above has already returned.
  const dataset = exported;
  const invalidKeys = Object.keys(dataset).filter((key) => !validDatasetKey(key));
  if (invalidKeys.length > 0) {
    return Effect.fail(
      discoveryError(
        invalidKeys.map((key) => ({
          file: relative(root, entry.file),
          code: "discovery.invalid-dataset-key" as const,
          message: `Invalid keyed eval dataset key ${JSON.stringify(key)}.`,
          actions: Object.freeze([
            "Use a non-empty path segment without slash, backslash, dot segments, or control characters.",
          ]),
        })),
      ),
    );
  }
  return Effect.succeed(
    Object.freeze(
      Object.keys(dataset)
        .sort()
        .map((key) => ({
          id: `${entry.baseId}/${key}`,
          definition: dataset[key]!,
        })),
    ),
  );
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
    const contextDir =
      leakGate.context._tag === "Url"
        ? fileURLToPath(leakGate.context.value)
        : resolve(baseDir, leakGate.context.value);
    return Effect.succeed(Option.some({ buildContexts: [{ contextDir, label: "dockerfile" }] }));
  }
  const composeFile = leakGate.file._tag === "Url" ? new URL(leakGate.file.value) : leakGate.file.value;
  return Effect.tryPromise({
    try: () => import("../sandbox/compose.ts"),
    catch: (cause) =>
      issue(file, "discovery.leak-gate-failed", causeMessage(cause), [
        "Fix the Docker Compose declaration used by this eval SandboxLayer.",
      ]),
  }).pipe(
    Effect.flatMap(({ leakGateHintsFromComposeFile }) =>
      leakGateHintsFromComposeFile(composeFile, {
        mainService: leakGate.workspaceService,
        baseDir,
      }).pipe(
        Effect.mapError((cause) =>
          issue(file, "discovery.leak-gate-failed", causeMessage(cause), [
            "Fix the Docker Compose declaration used by this eval SandboxLayer.",
          ]),
        ),
      ),
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
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.void,
        onSome: (hints) =>
          assertNoHiddenInputLeaks({
            hidden,
            buildContexts: hints.buildContexts,
            bindMounts: hints.bindMounts,
            evalId: input.evalId,
          }).pipe(
            Effect.mapError((cause) =>
              issue(input.file, "discovery.leak-gate-failed", causeMessage(cause), [
                "Remove hidden verifier/private inputs from the sandbox build context or bind mounts.",
              ]),
            ),
          ),
      }),
    ),
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
  load: DiscoveryModuleLoader,
  graph: ProjectModuleGraph,
): Effect.Effect<DiscoveredEvalEntry, DiscoveryError> {
  const fileLabel = relative(root, entry.file).split(sep).join("/");
  return Effect.gen(function* () {
    const captured = yield* Effect.tryPromise({
      try: () => captureLoadedFiles(() => load(entry.file), { entryPath: entry.file }),
      catch: (cause) =>
        issue(
          fileLabel,
          "discovery.import-failed",
          causeMessage(cause),
          ["Fix module loading and loader declarations."],
          cause,
        ),
    });
    const module = yield* decodeEvalModule(captured.value, fileLabel);
    const expanded = yield* expandEvalExport(module.default, entry, root);
    const source = yield* Effect.tryPromise({
      try: async () => {
        const content = normalizeEvalSource(graph.module(entry.file).source);
        return { path: fileLabel, content, sha256: hashEvalSource(content) };
      },
      catch: (cause) =>
        issue(fileLabel, "discovery.source-capture-failed", causeMessage(cause), [
          "Make the eval source file readable.",
        ]),
    });
    const loaderDataPaths = Object.freeze([...captured.paths]);
    const criteriaPaths = Object.freeze([...captured.criteriaPaths]);
    const privatePaths = Object.freeze([...captured.privatePaths]);
    const baseDir = dirname(entry.file);
    return Object.freeze({
      sourcePath: entry.file,
      evals: Object.freeze(
        expanded.map(({ id, definition }) =>
          discoverEval(definition, {
            id,
            baseDir,
            sourcePath: entry.file,
            source,
            loaderDataPaths,
            criteriaPaths,
            privatePaths,
            definition,
          }),
        ),
      ),
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

function addLoaderPaths(target: LoaderPathBuckets, source: LoaderCapturePaths): void {
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

function withLoaderProvenance(evalDef: DiscoveredEval, paths: LoaderPathBuckets): DiscoveredEval {
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
  graph: ProjectModuleGraph,
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
        const closure = graph.capture(entry.sourcePath);
        const modules = new Set(closure.modules.map((fact) => fact.path));
        for (const [modulePath, registered] of originPaths) {
          if (modules.has(modulePath))
            addLoaderPaths(buckets, {
              paths: [...registered.data],
              criteriaPaths: [...registered.criteria],
              privatePaths: [...registered.private],
            });
        }
        evals.push(...entry.evals.map((evalDef) => attachEvalModules(withLoaderProvenance(evalDef, buckets), closure)));
      }
      return Object.freeze(evals);
    },
    catch: (cause) =>
      issue(relative(root, join(root, "evals")) || "evals", "discovery.source-capture-failed", causeMessage(cause), [
        "Make every Eval entry and its static project-local imports readable.",
      ]),
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
      if (char === "*" && next === "/") {
        blockComment = false;
        index++;
      }
      continue;
    }
    if (quote !== undefined) {
      if (!escaped && char === quote) quote = undefined;
      escaped = !escaped && char === "\\";
      continue;
    }
    if (char === "/" && next === "/") {
      lineComment = true;
      index++;
      continue;
    }
    if (char === "/" && next === "*") {
      blockComment = true;
      index++;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      escaped = false;
      continue;
    }
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
    if (lineComment) {
      if (char === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        index++;
      }
      continue;
    }
    if (quote !== undefined) {
      if (!escaped && char === quote) quote = undefined;
      escaped = !escaped && char === "\\";
      continue;
    }
    if (char === "/" && next === "/") {
      lineComment = true;
      index++;
      continue;
    }
    if (char === "/" && next === "*") {
      blockComment = true;
      index++;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      escaped = false;
      continue;
    }
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

/** Discovery remains in Effect through selection/planning; an adapter host closes it. */
// @concord-code
// @concord-implements docs/feature/eval-groups/architecture/README.md
// @concord-implements docs/feature/eval-groups/library.md
export function discoverEvals(
  root: string,
  options: { freshImport?: boolean; generation?: FreshImportGeneration } = {},
): Effect.Effect<readonly DiscoveredEval[], DiscoveryError> {
  const dir = join(root, "evals");
  const discoverWith = (
    load: DiscoveryModuleLoader,
    graph: ProjectModuleGraph,
  ): Effect.Effect<readonly DiscoveredEval[], DiscoveryError> =>
    Effect.gen(function* () {
      enterLoaderDiscoveryHost();
      const entries = yield* collectEvalEntries(dir, root);
      const discoveredEntries = yield* collectAll(entries, (entry) => discoverEvalEntry(entry, root, load, graph));
      const evals = yield* propagateLoaderProvenance(discoveredEntries, root, graph);
      const [, leakErrors] = yield* Effect.partition(
        evals,
        (evalDef) =>
          runLeakGate(evalDef.definition, {
            evalId: evalDef.id,
            file: relative(root, evalDef.sourcePath).split(sep).join("/"),
            baseDir: evalDef.baseDir,
            criteriaPaths: evalDef.criteriaPaths,
            privatePaths: evalDef.privatePaths,
          }),
        { concurrency: 1 },
      );
      if (leakErrors.length > 0) return yield* Effect.fail(discoveryError(leakErrors.flatMap((error) => error.issues)));
      const files = yield* walkFiles(dir, root, (name) => name === "eval-group.ts", true);
      const groupEntries = files.map((file) => {
        const id = relative(dir, dirname(file)).split(sep).join("/");
        return { file, id };
      });
      const groupIdIssues: DiscoveryIssue[] = [];
      const groupsById = new Map<string, typeof groupEntries>();
      for (const entry of groupEntries) groupsById.set(entry.id, [...(groupsById.get(entry.id) ?? []), entry]);
      for (const [id, owners] of groupsById) {
        if (id.length === 0) {
          groupIdIssues.push({
            file: owners.map((owner) => relative(root, owner.file).split(sep).join("/")).join(", "),
            code: "discovery.invalid-export",
            message: "Eval Group id must not be empty.",
            actions: ["Put eval-group.ts in a named subdirectory under evals/."],
          });
        } else if (owners.length > 1) {
          groupIdIssues.push({
            file: owners.map((owner) => relative(root, owner.file).split(sep).join("/")).join(", "),
            code: "discovery.duplicate-id",
            message: `Duplicate eval group id ${JSON.stringify(id)}: multiple entries map to the same id.`,
            actions: ["Keep one eval-group.ts for this group path."],
          });
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
        const resolved = module.default.evals.map((definition) =>
          evals.filter((item) => item.definition === definition),
        );
        // `evals` is a closed set, not an author-defined business sequence. The
        // scheduler and fingerprint use the normalized Eval ID order everywhere.
        const evalIds = resolved.flatMap((matches) => matches.map((item) => item.id)).toSorted();
        const evaluationKinds = splitByEvaluationKind(
          resolved.flatMap((matches) => (matches.length === 1 ? matches : [])),
        );
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
        const groupProjection = yield* Effect.try({
          try: () => graph.capture(file, { stopPaths: memberSourcePaths }),
          catch: (cause) =>
            issue(label, "discovery.source-capture-failed", causeMessage(cause), [
              "Make the Eval Group entry and its project-local helper modules readable.",
            ]),
        });
        const groupSources = yield* Effect.tryPromise({
          try: async () =>
            groupProjection.modules.map(
              (fact) =>
                [
                  relative(root, fact.path),
                  fact.path === file ? normalizedIdentity(normalizeEvalGroupSource(fact.normalized)) : fact.identity,
                ] as const,
            ),
          catch: (cause) =>
            issue(label, "discovery.source-capture-failed", causeMessage(cause), [
              "Make the Eval Group entry and its project-local helper modules readable.",
            ]),
        });
        const definitionHash = digestOf({
          // Group declaration order is deliberately not an input. The group file
          // may reorder its closed `evals` set without changing behavior. Other
          // Group source stays in the hash, so opaque command/hook behavior and
          // helper code still invalidate fingerprints when it changes.
          id,
          evalIds,
          layer: sandboxLayerDefinitionIdentity(module.default.sandbox),
          onUnavailable: module.default.onUnavailable,
          sources: groupSources.map(([path, content]) => ({ path, content })),
        });
        module.default.evals.forEach((definition, index) => {
          const matches = resolved[index]!;
          if (matches.length !== 1) {
            issues.push({
              file: label,
              code: "eval-group-member-unresolved",
              message: `Eval Group ${JSON.stringify(id)} member ${index} resolves to ${matches.length} discovered Evals.`,
              actions: ["Import the exact default definition object from an eval entry."],
            });
            return;
          }
          const member = matches[0]!;
          const prior = claimed.get(definition);
          if (prior !== undefined) {
            issues.push({
              file: label,
              code: "eval-group-member-overlap",
              message: `Eval ${JSON.stringify(member.id)} in Eval Group ${JSON.stringify(id)} is already claimed by Eval Group ${JSON.stringify(prior)}.`,
              actions: ["List each Eval exactly once in one group."],
            });
            return;
          }
          const state = member.sandbox === undefined ? undefined : sandboxLayerStateOf(member.sandbox);
          if (
            state?.kind === "template-bearing" ||
            (state?.setupHooks.length ?? 0) > 0 ||
            (state?.teardownHooks.length ?? 0) > 0
          ) {
            issues.push({
              file: label,
              code: "eval-group-member-layer",
              message: `Eval ${JSON.stringify(member.id)} in Eval Group ${JSON.stringify(id)} owns a template or lifecycle hook.`,
              actions: [
                "Move the template and lifecycle hooks to the Experiment or Eval Group; keep only prepare commands on the Eval.",
              ],
            });
            return;
          }
          claimed.set(definition, id);
          annotated.set(
            definition,
            attachEvalModules(
              discoverEval(definition, {
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
              }),
              Object.freeze({
                ...evalModules(member)!,
                unresolved: Object.freeze([...evalModules(member)!.unresolved, ...groupProjection.unresolved]),
              }),
            ),
          );
        });
      }
      if (issues.length > 0) return yield* Effect.fail(discoveryError(issues));
      return Object.freeze(evals.map((item) => annotated.get(item.definition) ?? item));
    });
  if (options.generation !== undefined) return discoverWith(options.generation.import, options.generation.modules);
  return Effect.scoped(
    acquireFreshImportGeneration(root).pipe(Effect.flatMap((fresh) => discoverWith(fresh.import, fresh.modules))),
  );
}

function experimentIdOfFile(file: string, experimentsDir: string): string {
  return relative(experimentsDir, file)
    .replace(/\.ts$/, "")
    .replace(/\.experiment$/, "")
    .split(sep)
    .join("/");
}

// @concord-code
// @concord-implements docs/feature/experiments/library/README.md
function discoverExperimentFile(
  file: string,
  root: string,
  experimentsDir: string,
  load: DiscoveryModuleLoader = cachedModuleLoader,
): Effect.Effect<readonly DiscoveredExperiment[], DiscoveryError> {
  const fileLabel = relative(root, file).split(sep).join("/");
  return Effect.gen(function* () {
    const imported = yield* importModule(file, root, "experiment", load);
    const module = yield* decodeExperimentModule(imported, fileLabel);
    if (module.default === undefined) return Object.freeze([]);
    return Object.freeze([
      discoverExperiment(module.default, {
        id: experimentIdOfFile(file, experimentsDir),
        baseDir: dirname(file),
        sourcePath: file,
      }),
    ]);
  });
}

export interface ExperimentDiscoveryOptions {
  readonly freshImport?: boolean;
  readonly generation?: FreshImportGeneration;
  /**
   * Chooses the Experiments to load from every candidate id, which comes from
   * the file path alone. Unselected files are never imported, so a broken or
   * slow Experiment file cannot fail a command that targets another one.
   * Omit it to load every Experiment.
   */
  readonly select?: (ids: readonly string[]) => readonly string[];
}

export interface ExperimentDiscovery {
  readonly experiments: readonly DiscoveredExperiment[];
  /** Every Experiment id, including files that were not imported because they were not selected. */
  readonly experimentIds: readonly string[];
}

/** Discovery remains in Effect through selection/planning; an adapter host closes it. */
// @concord-code
// @concord-implements docs/feature/experiments/README.md
// @concord-implements docs/feature/experiments/library/README.md
export function discoverExperimentSelection(
  root: string,
  options: ExperimentDiscoveryOptions = {},
): Effect.Effect<ExperimentDiscovery, DiscoveryError> {
  const dir = join(root, "experiments");
  const discoverWith = (load: DiscoveryModuleLoader): Effect.Effect<ExperimentDiscovery, DiscoveryError> =>
    walkFiles(dir, root, (name) => name.endsWith(".ts") && !name.endsWith(".d.ts")).pipe(
      Effect.flatMap((files) => {
        const ids = files.map((file) => experimentIdOfFile(file, dir));
        const chosen = options.select === undefined ? undefined : new Set(options.select(ids));
        const selectedFiles = chosen === undefined ? files : files.filter((_, index) => chosen.has(ids[index]!));
        return Effect.partition(
          selectedFiles,
          (file) =>
            discoverExperimentFile(file, root, dir, load).pipe(Effect.map((experiments) => ({ file, experiments }))),
          { concurrency: 1 },
        ).pipe(
          Effect.flatMap(([loaded, errors]) => {
            if (errors.length > 0) return Effect.fail(discoveryError(errors.flatMap((error) => error.issues)));
            // A loaded file without a default export is not an Experiment; unloaded files keep their path id.
            const notExperiments = new Set(
              loaded.filter(({ experiments }) => experiments.length === 0).map(({ file }) => file),
            );
            return Effect.succeed(
              Object.freeze({
                experiments: Object.freeze(loaded.flatMap(({ experiments }) => experiments)),
                experimentIds: Object.freeze(
                  files.flatMap((file, index) => (notExperiments.has(file) ? [] : [ids[index]!])),
                ),
              }),
            );
          }),
        );
      }),
    );
  if (options.generation !== undefined) return discoverWith(options.generation.import);
  if (!options.freshImport) return discoverWith(cachedModuleLoader);
  return Effect.scoped(acquireFreshImportGeneration(root).pipe(Effect.flatMap((fresh) => discoverWith(fresh.import))));
}

/** Loads every Experiment; use discoverExperimentSelection when a command targets only some. */
export function discoverExperiments(
  root: string,
  options: { freshImport?: boolean; generation?: FreshImportGeneration } = {},
): Effect.Effect<readonly DiscoveredExperiment[], DiscoveryError> {
  return discoverExperimentSelection(root, options).pipe(Effect.map(({ experiments }) => experiments));
}

/** eval id 的裸字面前缀过滤；exp 与固定读取面共用 shared helper。 */
export function makeFilter(patterns: string[]): (id: string) => boolean {
  return evalPrefixPredicate(patterns.length > 0 ? patterns : undefined);
}
