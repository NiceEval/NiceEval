import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

import { Effect, Schema } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { compileDiffCode } from "./diff-code-compiler.js";
import { DocsFileError, type DocsDomainError, DocsProcessError, errorMessage } from "./internal/errors.js";
import type { CommandReceipt } from "./model.js";
import {
  BUNDLED_INDEX_REGION,
  ENGLISH_REFERENCE_TRANSLATIONS_PATH,
  REFERENCE_FILES,
  SOURCE_FILES,
  type SourceMap,
  type ZhPage,
  regenerateBundledIndex,
  compileEnglishReferenceRegions,
  regenerateEnglishReferenceDoc,
  regenerateReferenceDoc,
} from "./reference-compiler.js";
import { absolutePath, atomicWriteText, REPOSITORY_ROOT } from "./internal/runtime.js";

const REFERENCE_OUTPUTS = REFERENCE_FILES.flatMap(({ file }) => [
  `apps/docs-site/zh/reference/${file}`,
  `apps/docs-site/reference/${file}`,
]);
const BUNDLED_INDEX_OUTPUT = "packages/niceeval/INDEX.md";
export const MINT_VERSION = "4.2.812";

interface GeneratedOutput {
  readonly path: string;
  readonly content: string;
  readonly original: string | undefined;
}

function writeChangedOutputs(
  generated: readonly GeneratedOutput[],
  dryRun: boolean,
): Effect.Effect<readonly string[], DocsFileError> {
  const changed = generated.filter(({ content, original }) => content !== original);
  if (dryRun) return Effect.succeed(changed.map(({ path }) => path));
  return Effect.forEach(changed, ({ content, original, path }) =>
    atomicWriteText(path, content, original).pipe(Effect.as(path)), { concurrency: 1 });
}

export function loadReferenceSources(): SourceMap {
  const sources = {} as SourceMap;
  for (const path of SOURCE_FILES) {
    sources[path] = readFileSync(absolutePath(`packages/niceeval/${path}`), "utf8");
  }
  return sources;
}

export function loadEnglishReferenceTranslations() {
  return Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Record(Schema.String, Schema.String)))(
    readFileSync(absolutePath(ENGLISH_REFERENCE_TRANSLATIONS_PATH), "utf8"),
  );
}

function compileReferenceOutputs(): readonly GeneratedOutput[] {
  const sources = loadReferenceSources();
  const englishRegions = compileEnglishReferenceRegions(sources, loadEnglishReferenceTranslations());
  return REFERENCE_FILES.flatMap(({ file }) => {
    const zhPath = `apps/docs-site/zh/reference/${file}`;
    const zhOriginal = readFileSync(absolutePath(zhPath), "utf8");
    const enPath = `apps/docs-site/reference/${file}`;
    const enOriginal = readFileSync(absolutePath(enPath), "utf8");
    return [
      { path: zhPath, original: zhOriginal, content: regenerateReferenceDoc(file, zhOriginal, sources) },
      { path: enPath, original: enOriginal, content: regenerateEnglishReferenceDoc(file, enOriginal, englishRegions) },
    ];
  });
}

export function loadBundledPages(): readonly ZhPage[] {
  const root = absolutePath("apps/docs-site/zh");
  return (readdirSync(root, { recursive: true }) as string[])
    .filter((path) => path.endsWith(".mdx"))
    .sort()
    .map((path) => ({
      path: `docs-site/zh/${path.split("\\").join("/")}`,
      content: readFileSync(join(root, path), "utf8"),
    }));
}

/** Generate only public reference regions; package INDEX.md has a separate owner. */
export function generateReference(dryRun = false): Effect.Effect<CommandReceipt, DocsDomainError> {
  return Effect.try({
    try: compileReferenceOutputs,
    catch: (error) => new DocsFileError({
      operation: "compile public reference",
      path: REFERENCE_OUTPUTS.join(","),
      message: errorMessage(error),
    }),
  }).pipe(
    Effect.flatMap((generated) => writeChangedOutputs(generated, dryRun)),
    Effect.map((changedPaths) => ({
      format: "niceeval.docs-command-receipt/v1" as const,
      command: "pnpm run repo docs reference",
      status: "completed" as const,
      changedPaths,
      summary: dryRun
        ? `${changedPaths.length} public reference output(s) would change.`
        : `${changedPaths.length} public reference output(s) changed.`,
    })),
  );
}

/** Package-build owner composed directly by the parent CLI, apart from the Docs reference contribution. */
export function generateBundledIndex(dryRun = false): Effect.Effect<CommandReceipt, DocsDomainError> {
  return Effect.try({
    try: (): GeneratedOutput => {
      const template = readFileSync(absolutePath("packages/niceeval/docs-source/INDEX.template.md"), "utf8");
      const output = absolutePath(BUNDLED_INDEX_OUTPUT);
      const original = existsSync(output) ? readFileSync(output, "utf8") : undefined;
      return {
        path: BUNDLED_INDEX_OUTPUT,
        original,
        content: regenerateBundledIndex(template, [...loadBundledPages()]),
      };
    },
    catch: (error) => new DocsFileError({
      operation: "compile bundled docs index",
      path: BUNDLED_INDEX_OUTPUT,
      message: errorMessage(error),
    }),
  }).pipe(
    Effect.flatMap((generated) => writeChangedOutputs([generated], dryRun)),
    Effect.map((changedPaths) => ({
      format: "niceeval.docs-command-receipt/v1" as const,
      command: "pnpm build:index",
      status: "completed" as const,
      changedPaths,
      summary: dryRun
        ? `${changedPaths.length} bundled index output(s) would change.`
        : `${changedPaths.length} bundled index output(s) changed.`,
    })),
  );
}

export function generateDiffCode(dryRun = false): Effect.Effect<CommandReceipt, DocsDomainError> {
  return Effect.tryPromise({
    try: () => compileDiffCode(REPOSITORY_ROOT),
    catch: (error) => new DocsFileError({
      operation: "compile code diff",
      path: "apps/docs-site",
      message: errorMessage(error),
    }),
  }).pipe(
    Effect.flatMap((outputs) => Effect.try({
      try: () => outputs.map(({ content, path }) => ({
        path,
        content,
        original: readFileSync(absolutePath(path), "utf8"),
      })),
      catch: (error) => new DocsFileError({
        operation: "read code diff output",
        path: "apps/docs-site",
        message: errorMessage(error),
      }),
    })),
    Effect.flatMap((generated) => writeChangedOutputs(generated, dryRun)),
    Effect.map((changedPaths) => ({
      format: "niceeval.docs-command-receipt/v1" as const,
      command: "pnpm run repo docs diff-code",
      status: "completed" as const,
      changedPaths,
      summary: dryRun
        ? `${changedPaths.length} diff output(s) would change.`
        : `${changedPaths.length} diff output(s) changed.`,
    })),
  );
}

interface DocsSitePreparation {
  readonly path: string | undefined;
  readonly summary: string;
}

const findDocsNodeBin = Effect.fn("findDocsNodeBin")(function*() {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const executable = process.platform === "win32" ? "node.exe" : "node";
  const output = (command: string, args: readonly string[]) => spawner.string(
    ChildProcess.make(command, args),
  ).pipe(
    Effect.timeout("3 seconds"),
    Effect.catch(() => Effect.succeed("")),
    Effect.map((value) => value.trim()),
  );
  const candidates = new Set([
    process.env.NICEEVAL_DOCS_NODE_BIN,
    "/opt/homebrew/opt/node@24/bin",
    "/usr/local/opt/node@24/bin",
    ...(process.env.PATH ?? "").split(delimiter).filter(Boolean),
  ]);
  for (const candidate of candidates) {
    if (candidate === undefined) continue;
    const version = yield* output(join(candidate, executable), ["--version"]);
    if (/^v24\.\d+\.\d+$/.test(version)) return candidate;
  }
  // Ask mise for its installed version instead of assuming its data directory.
  const miseRoot = yield* output("mise", ["where", "node@24"]);
  if (miseRoot !== "") {
    const candidate = join(miseRoot, "bin");
    const version = yield* output(join(candidate, executable), ["--version"]);
    if (/^v24\.\d+\.\d+$/.test(version)) return candidate;
  }
  return undefined;
});

const prepareDocsSite = Effect.fn("prepareDocsSite")(function*(): Effect.fn.Return<
  DocsSitePreparation, DocsFileError, ChildProcessSpawner.ChildProcessSpawner
> {
  const cacheSummary = yield* Effect.try({
    try: () => {
      const mintCache = join(homedir(), ".mintlify", "mint");
      const versionMarker = join(mintCache, "mint-version.txt");
      const previewBuild = join(mintCache, "apps", "client", ".next", "required-server-files.json");
      let cacheSummary = "Mintlify preview cache is valid.";
      if (existsSync(versionMarker) && !existsSync(previewBuild)) {
        rmSync(mintCache, { recursive: true, force: true });
        cacheSummary = "Removed an incomplete Mintlify-managed preview cache.";
      }

      return cacheSummary;
    },
    catch: (error) => new DocsFileError({
      operation: "prepare docs site",
      path: join(homedir(), ".mintlify", "mint"),
      message: errorMessage(error),
    }),
  });
  if (Number(process.versions.node.split(".")[0]) === 24) {
    return { path: undefined, summary: cacheSummary };
  }
  const supportedNodeBin = yield* findDocsNodeBin();
  if (supportedNodeBin === undefined) {
    return yield* new DocsFileError({
      operation: "prepare docs site",
      path: join(homedir(), ".mintlify", "mint"),
      message: `NiceEval docs require Node 24; current version is ${process.versions.node}. ` +
        "Install Node 24 or set NICEEVAL_DOCS_NODE_BIN to its bin directory.",
    });
  }
  return {
    path: `${supportedNodeBin}${delimiter}${process.env.PATH ?? ""}`,
    summary: `${cacheSummary} Using Node 24 from ${supportedNodeBin}.`,
  };
});

export type DocsSiteOperation = "prepare" | "dev" | "validate" | "links";

const siteArgs = (
  operation: DocsSiteOperation,
  forwardedArgs: readonly string[],
): readonly string[] => {
  switch (operation) {
    case "prepare":
      return ["--version"];
    case "dev":
      return ["dev", ...forwardedArgs];
    case "validate":
      return ["validate"];
    case "links":
      return ["broken-links", "--check-anchors", "--check-redirects"];
  }
};

export function runDocsSite(
  operation: DocsSiteOperation,
  forwardedArgs: readonly string[] = [],
): Effect.Effect<CommandReceipt, DocsDomainError, ChildProcessSpawner.ChildProcessSpawner> {
  return Effect.gen(function*() {
    const preparation = yield* prepareDocsSite();
    const executable = process.platform === "win32" ? "npx.cmd" : "npx";
    const args = siteArgs(operation, forwardedArgs);
    const command = ChildProcess.make(executable, ["--yes", `mint@${MINT_VERSION}`, ...args], {
      cwd: absolutePath("apps/docs-site"),
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
      ...(preparation.path === undefined ? {} : { env: { PATH: preparation.path }, extendEnv: true }),
    });
    const exitCode = yield* Effect.scoped(command.pipe(
      Effect.flatMap((child) => child.exitCode),
      Effect.map(Number),
      Effect.mapError((error) => new DocsProcessError({
        command: `npx --yes mint@${MINT_VERSION} ${args.join(" ")}`,
        message: error instanceof Error ? error.message : String(error),
      })),
    ));
    if (exitCode !== 0) {
      return yield* new DocsProcessError({
        command: `npx --yes mint@${MINT_VERSION} ${args.join(" ")}`,
        exitCode,
        message: `Mintlify exited with status ${exitCode}`,
      });
    }
    return {
      format: "niceeval.docs-command-receipt/v1",
      command: `pnpm run repo docs site ${operation}`,
      status: "completed",
      changedPaths: [],
      summary: `${preparation.summary} Mintlify ${operation} completed.`,
    };
  });
}

export function referenceOutputPaths(): readonly string[] {
  return REFERENCE_OUTPUTS;
}

export function bundledIndexOutputPath(): string {
  return BUNDLED_INDEX_OUTPUT;
}

export { BUNDLED_INDEX_REGION };
