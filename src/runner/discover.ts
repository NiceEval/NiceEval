// Discovery is the only boundary where executable modules enter the typed runner.
// Dynamic imports are decoded immediately; every later stage receives branded, immutable definitions.

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
import { captureLoadedFiles } from "../loaders/index.ts";
import { freshImportModule } from "../fresh-import.ts";
import { sandboxLayerStateOf, type SandboxLayer } from "../sandbox/layer.ts";
import {
  discoverEval,
  discoverExperiment,
  isEvalDefinition,
  isExperimentDefinition,
} from "../types.ts";
import type {
  AnyEvalDefinition,
  DiscoveredEval,
  DiscoveredExperiment,
  ExperimentDefinition,
} from "../types.ts";

const SKIP_DIRS = new Set(["node_modules", ".git", ".niceeval", "dist", ".next"]);

export type DiscoveryIssueCode =
  | "discovery.filesystem"
  | "discovery.duplicate-id"
  | "discovery.import-failed"
  | "discovery.invalid-export"
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

const EvalDefinitionSchema = Schema.declare(isEvalDefinition, {
  identifier: "EvalDefinition",
  description: "a value returned by defineEval() or defineScoreEval()",
});
const EvalModuleSchema: Schema.Schema<EvalModule> = Schema.Struct({
  default: Schema.Union(
    EvalDefinitionSchema,
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

function importModule(
  file: string,
  root: string,
  kind: "eval" | "experiment",
  freshImport = false,
): Effect.Effect<unknown, DiscoveryError> {
  return Effect.tryPromise({
    try: () => freshImport ? freshImportModule(file) : import(pathToFileURL(file).href),
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
      ["Default-export defineEval()/defineScoreEval() output, an array of those outputs, or a keyed record of those outputs."],
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

function discoverEvalEntry(
  entry: EvalEntry,
  root: string,
  freshImport = false,
): Effect.Effect<readonly DiscoveredEval[], DiscoveryError> {
  const fileLabel = relative(root, entry.file).split(sep).join("/");
  return Effect.gen(function*() {
    const captured = yield* Effect.tryPromise({
      try: () => captureLoadedFiles(() => freshImport ? freshImportModule(entry.file) : import(pathToFileURL(entry.file).href)),
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
    const [leakErrors] = yield* Effect.partition(expanded, ({ id, definition }) => runLeakGate(definition, {
      evalId: id,
      file: fileLabel,
      baseDir,
      criteriaPaths,
      privatePaths,
    }), { concurrency: 1 });
    if (leakErrors.length > 0) {
      return yield* Effect.fail(discoveryError(leakErrors.flatMap((error) => error.issues)));
    }
    return Object.freeze(expanded.map(({ id, definition }) => discoverEval(definition, {
      id,
      baseDir,
      sourcePath: entry.file,
      source,
      loaderDataPaths,
      criteriaPaths,
      privatePaths,
    })));
  });
}

/** Discovery remains in Effect through selection/planning; an application host closes it. */
export function discoverEvals(
  root: string,
  options: { freshImport?: boolean } = {},
): Effect.Effect<readonly DiscoveredEval[], DiscoveryError> {
  const dir = join(root, "evals");
  return collectEvalEntries(dir, root).pipe(
    Effect.flatMap((entries) => collectAll(entries, (entry) => discoverEvalEntry(entry, root, options.freshImport))),
  );
}

function discoverExperimentFile(
  file: string,
  root: string,
  experimentsDir: string,
  freshImport = false,
): Effect.Effect<readonly DiscoveredExperiment[], DiscoveryError> {
  const fileLabel = relative(root, file).split(sep).join("/");
  return Effect.gen(function*() {
    const imported = yield* importModule(file, root, "experiment", freshImport);
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
  return walkFiles(dir, root, (name) => name.endsWith(".ts") && !name.endsWith(".d.ts")).pipe(
    Effect.flatMap((files) => Effect.partition(
      files,
      (file) => discoverExperimentFile(file, root, dir, options.freshImport),
      { concurrency: 1 },
    )),
    Effect.flatMap(([errors, groups]) => errors.length > 0
      ? Effect.fail(discoveryError(errors.flatMap((error) => error.issues)))
      : Effect.succeed(Object.freeze(groups.flat()))),
  );
}

/** eval id 的裸字面前缀过滤；exp / show / view 共用 shared helper。 */
export function makeFilter(patterns: string[]): (id: string) => boolean {
  return evalPrefixPredicate(patterns.length > 0 ? patterns : undefined);
}
