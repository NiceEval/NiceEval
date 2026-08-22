// Trusted Node-side Report / Theme loading. Author modules are project code,
// so the loader always uses the namespaced fresh project graph. In packaged
// NiceEval, that graph resolves this exact install's `niceeval/*` imports to
// the canonical CJS graph; the versioned Symbol.for descriptors below remain
// the final authority even when a trusted module reaches another package copy.

import { readFile, stat } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { Data, Effect } from "effect";
import { freshImportModule } from "../../../fresh-import.ts";
import { isReport, type ReportDefinition } from "../../definition/report.ts";
import {
  isThemeDefinition,
  registerThemeSourceBase,
  themeAssetInputs,
  type ThemeDefinition,
} from "../../theme.ts";

export type ReportModuleLoadStage = "config" | "report" | "theme";

export type ReportModuleLoadCode =
  | "report-module-load-failed"
  | "report-module-invalid-default-export"
  | "report-module-invalid-report"
  | "report-module-invalid-theme";

/**
 * A recoverable, bounded failure at the trusted author-module boundary. A
 * Report definitions use a versioned Symbol.for descriptor, so the same
 * contract remains recognizable through an ESM/CJS or duplicate-package
 * boundary without accepting an arbitrary report-shaped object.
 */
export class ReportModuleLoadError extends Data.TaggedError("ReportModuleLoadError")<{
  readonly code: ReportModuleLoadCode;
  readonly stage: ReportModuleLoadStage;
  readonly reason: string;
}> {}

export interface LoadedTrustedConfig {
  /** Validated host products retained from config without structural casts. */
  readonly report?: ReportDefinition;
  readonly theme?: ThemeDefinition;
  /** The config entry and its project-relative static import closure. */
  readonly watchInputs: readonly string[];
}

export interface LoadedTrustedReport {
  readonly report: ReportDefinition;
  /** The report entry and its project-relative static import closure. */
  readonly watchInputs: readonly string[];
}

export interface LoadedTrustedTheme {
  readonly theme: ThemeDefinition;
  /** The theme entry and its project-relative static import closure. */
  readonly watchInputs: readonly string[];
}

interface ModuleNamespace {
  readonly default?: unknown;
  readonly [name: string]: unknown;
}

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs", ".jsx"] as const;

/** Fresh-loads optional `<cwd>/niceeval.config.ts` and validates its Report-facing fields. */
export function loadTrustedReportConfig(
  cwd: string,
  options: { readonly includeTheme?: boolean } = {},
): Effect.Effect<LoadedTrustedConfig, ReportModuleLoadError> {
  const path = join(cwd, "niceeval.config.ts");
  return Effect.gen(function* () {
    const exists = yield* regularFile(path, "config", true);
    if (!exists) {
      return Object.freeze({ watchInputs: Object.freeze([path]) });
    }
    const value = yield* loadSingleDefault(path, "config");
    if (!isPlainObject(value)) {
      return yield* Effect.fail(moduleError(
        "report-module-invalid-default-export",
        "config",
        "config default export must be an object",
      ));
    }
    const report = value.report === undefined ? undefined : yield* validateReport(value.report, "config");
    const theme = options.includeTheme === false || value.theme === undefined
      ? undefined
      : yield* validateTheme(value.theme, "config");
    if (report?.theme !== undefined) registerThemeSourceBase(report.theme, dirname(path));
    if (theme !== undefined) registerThemeSourceBase(theme, dirname(path));
    const watchInputs = withThemeInputs(
      yield* staticModuleClosure(path, "config"),
      report?.theme,
      theme,
    );
    return Object.freeze({
      ...(report === undefined ? {} : { report }),
      ...(theme === undefined ? {} : { theme }),
      watchInputs,
    });
  });
}

/** Fresh-loads one trusted author Report module and accepts exactly one default Report export. */
export function loadTrustedReportModule(path: string): Effect.Effect<LoadedTrustedReport, ReportModuleLoadError> {
  return Effect.gen(function* () {
    yield* regularFile(path, "report", false);
    const value = yield* loadSingleDefault(path, "report");
    const report = yield* validateReport(value, "report");
    if (report.theme !== undefined) registerThemeSourceBase(report.theme, dirname(path));
    const watchInputs = withThemeInputs(yield* staticModuleClosure(path, "report"), report.theme);
    return Object.freeze({ report, watchInputs });
  });
}

/** Fresh-loads one trusted author Theme module and accepts exactly one default closed Theme export. */
export function loadTrustedThemeModule(path: string): Effect.Effect<LoadedTrustedTheme, ReportModuleLoadError> {
  return Effect.gen(function* () {
    yield* regularFile(path, "theme", false);
    const value = yield* loadSingleDefault(path, "theme");
    const theme = yield* validateTheme(value, "theme");
    registerThemeSourceBase(theme, dirname(path));
    const watchInputs = withThemeInputs(yield* staticModuleClosure(path, "theme"), theme);
    return Object.freeze({ theme, watchInputs });
  });
}

function withThemeInputs(
  inputs: readonly string[],
  ...themes: readonly (ThemeDefinition | undefined)[]
): readonly string[] {
  return Object.freeze([...new Set([
    ...inputs,
    ...themes.flatMap((theme) => themeAssetInputs(theme)),
  ])].sort());
}

/** Resolve a trusted CLI module path against the project; loader callers never receive a URL string. */
export function resolveTrustedModulePath(cwd: string, value: string): string {
  return resolve(cwd, value);
}

function regularFile(
  path: string,
  stage: ReportModuleLoadStage,
  optional: boolean,
): Effect.Effect<boolean, ReportModuleLoadError> {
  return Effect.tryPromise({
    try: async () => {
      try {
        return (await stat(path)).isFile();
      } catch (cause) {
        if (optional && isMissing(cause)) return false;
        throw cause;
      }
    },
    catch: (cause) => moduleError("report-module-load-failed", stage, loadReason(cause)),
  }).pipe(
    Effect.flatMap((isFile) => isFile
      ? Effect.succeed(true)
      : optional
        ? Effect.succeed(false)
        : Effect.fail(moduleError("report-module-load-failed", stage, "module path is not a file"))),
  );
}

function loadSingleDefault(
  path: string,
  stage: ReportModuleLoadStage,
): Effect.Effect<unknown, ReportModuleLoadError> {
  return Effect.tryPromise({
    try: () => freshImportModule(path) as Promise<ModuleNamespace>,
    catch: (cause) => moduleError("report-module-load-failed", stage, loadReason(cause)),
  }).pipe(
    Effect.flatMap((module) => {
      // Node's ESM-CJS interop surfaces a `module.exports` alias and
      // static-analyzed re-export names (value undefined) on CommonJS
      // wrappers. Only when that marker exists are they namespace artifacts,
      // never author exports; the default Report remains the single real
      // export. A pure ESM namespace has no such marker, so a genuine named
      // export of undefined still fails the exact one-default-export check.
      const names = Object.keys(module);
      const cjsInterop = Object.hasOwn(module, "module.exports");
      const realExports = cjsInterop
        ? names.filter((name) => name !== "__esModule" && name !== "module.exports" && module[name] !== undefined)
        : names;
      if (realExports.length !== 1 || realExports[0] !== "default" || !Object.hasOwn(module, "default")) {
        return Effect.fail(moduleError(
          "report-module-invalid-default-export",
          stage,
          "module must export exactly one default value",
        ));
      }
      return Effect.succeed(module.default);
    }),
  );
}

function validateReport(
  value: unknown,
  stage: ReportModuleLoadStage,
): Effect.Effect<ReportDefinition, ReportModuleLoadError> {
  if (isReport(value)) return Effect.succeed(value);
  return Effect.fail(moduleError(
    "report-module-invalid-report",
    stage,
    looksLikeReport(value)
      ? "Report has no supported niceeval.report.definition/v2 descriptor"
      : "default export must be a Report created by defineReport",
  ));
}

function validateTheme(
  value: unknown,
  stage: ReportModuleLoadStage,
): Effect.Effect<ThemeDefinition, ReportModuleLoadError> {
  return isThemeDefinition(value)
    ? Effect.succeed(value)
    : Effect.fail(moduleError(
      "report-module-invalid-theme",
      stage,
      "default export must be a closed Theme created by defineTheme",
    ));
}

/**
 * The watcher only needs static project edges. This deliberately recognizes
 * the trusted TS/ESM static import and re-export grammar used by Report
 * modules (including multi-line clauses); it is not an arbitrary JavaScript
 * parser. Bare package imports remain package-owned; relative / absolute
 * author imports are walked recursively. The loader remains the source of
 * truth, and a watch event is only a hint.
 */
function staticModuleClosure(
  entry: string,
  stage: ReportModuleLoadStage,
): Effect.Effect<readonly string[], ReportModuleLoadError> {
  return Effect.tryPromise({
    try: async () => {
      const visited = new Set<string>();
      const visit = async (path: string): Promise<void> => {
        const absolute = resolve(path);
        if (visited.has(absolute)) return;
        visited.add(absolute);
        const source = await readFile(absolute, "utf8");
        for (const specifier of staticSpecifiers(source)) {
          const imported = await resolveStaticImport(absolute, specifier);
          if (imported !== undefined) await visit(imported);
        }
      };
      await visit(entry);
      return Object.freeze([...visited].sort());
    },
    catch: (cause) => moduleError("report-module-load-failed", stage, loadReason(cause)),
  });
}

function staticSpecifiers(source: string): readonly string[] {
  const result = new Set<string>();
  // Static `import ... from`, side-effect `import`, and all `export ... from`
  // forms. Dynamic import() intentionally stays outside the declared closure.
  const patterns = [
    /\bimport\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g,
    /\bexport\s+(?:type\s+)?[\s\S]*?\s+from\s+["']([^"']+)["']/g,
  ] as const;
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier !== undefined) result.add(specifier);
    }
  }
  return Object.freeze([...result]);
}

async function resolveStaticImport(from: string, specifier: string): Promise<string | undefined> {
  if (!specifier.startsWith(".") && !specifier.startsWith("/")) return undefined;
  const base = resolve(dirname(from), specifier);
  const candidates = extname(base) === ""
    ? [
      ...SOURCE_EXTENSIONS.map((extension) => `${base}${extension}`),
      ...SOURCE_EXTENSIONS.map((extension) => join(base, `index${extension}`)),
    ]
    : [base];
  for (const candidate of candidates) {
    try {
      if ((await stat(candidate)).isFile()) return candidate;
    } catch {
      // A loader evaluation will surface a real unresolved import. Closure
      // discovery only reports files that can actually be watched.
    }
  }
  return undefined;
}

function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function looksLikeReport(value: unknown): boolean {
  return isPlainObject(value) && Object.hasOwn(value, "pages");
}

function isMissing(cause: unknown): boolean {
  return typeof cause === "object" && cause !== null &&
    Reflect.get(cause, "code") === "ENOENT";
}

function loadReason(cause: unknown): string {
  const raw = cause instanceof Error ? cause.message : "module evaluation failed";
  const bounded = raw.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").slice(0, 512).trim();
  return bounded || "module evaluation failed";
}

function moduleError(
  code: ReportModuleLoadCode,
  stage: ReportModuleLoadStage,
  reason: string,
): ReportModuleLoadError {
  return new ReportModuleLoadError({ code, stage, reason });
}
