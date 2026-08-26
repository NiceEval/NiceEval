import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

import { Command } from "@effect/platform";
import type * as CommandExecutor from "@effect/platform/CommandExecutor";
import { Effect } from "effect";

import { compileDiffCode } from "./diff-code-compiler.js";
import { DocsFileError, type DocsDomainError, DocsProcessError, errorMessage } from "./errors.js";
import type { CommandReceipt } from "./model.js";
import {
  BUNDLED_INDEX_REGION,
  REFERENCE_FILES,
  SOURCE_FILES,
  type SourceMap,
  type ZhPage,
  regenerateBundledIndex,
  regenerateEnglishReferenceProvenance,
  regenerateReferenceDoc,
} from "./reference-compiler.js";
import { absolutePath, atomicWriteText, REPOSITORY_ROOT } from "./runtime.js";

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

function compileReferenceOutputs(): readonly GeneratedOutput[] {
  const sources = loadReferenceSources();
  return REFERENCE_FILES.flatMap(({ file }) => {
    const zhPath = `apps/docs-site/zh/reference/${file}`;
    const zhOriginal = readFileSync(absolutePath(zhPath), "utf8");
    const enPath = `apps/docs-site/reference/${file}`;
    const enOriginal = readFileSync(absolutePath(enPath), "utf8");
    return [
      { path: zhPath, original: zhOriginal, content: regenerateReferenceDoc(file, zhOriginal, sources) },
      { path: enPath, original: enOriginal, content: regenerateEnglishReferenceProvenance(enOriginal) },
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
      const template = readFileSync(absolutePath("packages/niceeval/INDEX.template.md"), "utf8");
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

function prepareDocsSite(): Effect.Effect<DocsSitePreparation, DocsFileError> {
  return Effect.try({
    try: () => {
      const mintCache = join(homedir(), ".mintlify", "mint");
      const versionMarker = join(mintCache, "mint-version.txt");
      const previewBuild = join(mintCache, "apps", "client", ".next", "required-server-files.json");
      let cacheSummary = "Mintlify preview cache is valid.";
      if (existsSync(versionMarker) && !existsSync(previewBuild)) {
        rmSync(mintCache, { recursive: true, force: true });
        cacheSummary = "Removed an incomplete Mintlify-managed preview cache.";
      }

      const nodeMajor = Number(process.versions.node.split(".")[0]);
      if (nodeMajor === 24) return { path: undefined, summary: cacheSummary };
      const executable = process.platform === "win32" ? "node.exe" : "node";
      const supportedNodeBin = [
        process.env.NICEEVAL_DOCS_NODE_BIN,
        "/opt/homebrew/opt/node@24/bin",
        "/usr/local/opt/node@24/bin",
      ].find((candidate) => candidate !== undefined && existsSync(join(candidate, executable)));
      if (supportedNodeBin === undefined) {
        throw new Error(
          `NiceEval docs require Node 24; current version is ${process.versions.node}. ` +
          "Install Node 24 or set NICEEVAL_DOCS_NODE_BIN to its bin directory.",
        );
      }
      return {
        path: `${supportedNodeBin}${delimiter}${process.env.PATH ?? ""}`,
        summary: `${cacheSummary} Using Node 24 from ${supportedNodeBin}.`,
      };
    },
    catch: (error) => new DocsFileError({
      operation: "prepare docs site",
      path: join(homedir(), ".mintlify", "mint"),
      message: errorMessage(error),
    }),
  });
}

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
): Effect.Effect<CommandReceipt, DocsDomainError, CommandExecutor.CommandExecutor> {
  return Effect.gen(function*() {
    const preparation = yield* prepareDocsSite();
    const executable = process.platform === "win32" ? "npx.cmd" : "npx";
    const args = siteArgs(operation, forwardedArgs);
    let command = Command.make(executable, "--yes", `mint@${MINT_VERSION}`, ...args).pipe(
      Command.workingDirectory(absolutePath("apps/docs-site")),
      Command.stdin("inherit"), Command.stdout("inherit"), Command.stderr("inherit"),
    );
    if (preparation.path !== undefined) command = command.pipe(Command.env({ PATH: preparation.path }));
    const exitCode = yield* Command.exitCode(command).pipe(
      Effect.map(Number),
      Effect.mapError((error) => new DocsProcessError({
        command: `npx --yes mint@${MINT_VERSION} ${args.join(" ")}`,
        message: error.message,
      })),
    );
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
