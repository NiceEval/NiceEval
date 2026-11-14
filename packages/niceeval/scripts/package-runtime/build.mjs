import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build as viteBuild } from "vite";

import { validateInitGuide } from "./check-ai-docs.mjs";
import { checkPublicUsage } from "./check-public-usage.mjs";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SRC = join(ROOT, "src");
const DIST = join(ROOT, "dist");
const TYPES_CONFIG = join(ROOT, "tsconfig.package-types.json");
const VIEW_VITE_CONFIG = join(ROOT, "vite.config.ts");

function isRuntimeSource(file) {
  return (
    (file.endsWith(".ts") || file.endsWith(".tsx")) &&
    !file.endsWith(".d.ts") &&
    !file.startsWith(
      `view${process.platform === "win32" ? "\\" : "/"}app${process.platform === "win32" ? "\\" : "/"}`,
    ) &&
    !file.endsWith(".test.ts") &&
    !file.endsWith(".test.tsx") &&
    !file.endsWith(".harness.ts")
  );
}

function isRuntimeAsset(relativePath) {
  return (
    [".css", ".html", ".js", ".json"].includes(extname(relativePath)) ||
    (relativePath.startsWith("migrations/") && extname(relativePath) === ".md")
  );
}

async function walk(dir, files = []) {
  for (const name of await readdir(dir)) {
    const absolute = join(dir, name);
    const info = await stat(absolute);
    if (info.isDirectory()) await walk(absolute, files);
    else files.push(absolute);
  }
  return files;
}

function runtimePath(relativeSource, extension) {
  return relativeSource.replace(/\.(?:tsx?|jsx?)$/, extension);
}

// require(esm) must be able to load every published module synchronously.
// Inspect syntax rather than text so async functions retain ordinary await.
function assertNoTopLevelAwait(source, fileName) {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const visit = (node) => {
    if (ts.isAwaitExpression(node) || (ts.isForOfStatement(node) && node.awaitModifier)) {
      const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      throw new Error(
        `Top-level await is not supported by require(esm): ${relative(ROOT, fileName)}:${line + 1}:${character + 1}`,
      );
    }
    if (ts.isFunctionLike(node)) {
      // A method's computed name and decorators execute outside its body.
      if (node.name && ts.isComputedPropertyName(node.name)) visit(node.name.expression);
      if (ts.canHaveDecorators(node)) for (const decorator of ts.getDecorators(node) ?? []) visit(decorator);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

function withoutSourceMapComment(code) {
  return code.replace(/\n\/\/# sourceMappingURL=.*?(?:\r?\n)?$/, "\n");
}

async function writeRuntimeModule(outputFile, code, mapText) {
  await mkdir(dirname(outputFile), { recursive: true });
  const mapName = `${basename(outputFile)}.map`;
  await writeFile(outputFile, `${withoutSourceMapComment(code)}//# sourceMappingURL=${mapName}\n`);
  await writeFile(`${outputFile}.map`, mapText);
}

async function emitDeclarations(tempRoot) {
  const config = ts.getParsedCommandLineOfConfigFile(TYPES_CONFIG, {}, ts.sys);
  if (!config) throw new Error(`Unable to read ${TYPES_CONFIG}`);
  const options = {
    ...config.options,
    noEmit: false,
    emitDeclarationOnly: true,
    declaration: true,
    declarationMap: false,
    outDir: tempRoot,
  };
  const program = ts.createProgram({
    rootNames: config.fileNames,
    options,
    projectReferences: config.projectReferences,
  });
  const diagnostics = [
    ...ts.getPreEmitDiagnostics(program),
    ...program.emit(undefined, undefined, undefined, true).diagnostics,
  ].filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
  if (diagnostics.length > 0) {
    throw new Error(
      ts.formatDiagnosticsWithColorAndContext(diagnostics, {
        getCanonicalFileName: (name) => name,
        getCurrentDirectory: () => ROOT,
        getNewLine: () => "\n",
      }),
    );
  }
}

function rewriteDeclarationSpecifiers(text, extension) {
  return text.replace(
    /(['"])(\.\.?\/[^'"]+)\.(?:js|jsx|ts|tsx)\1/g,
    (_all, quote, stem) => `${quote}${stem}.${extension}${quote}`,
  );
}

async function writeDeclarations(rawTypes, outputRoot) {
  for (const file of await walk(rawTypes)) {
    if (!file.endsWith(".d.ts")) continue;
    const target = join(outputRoot, relative(rawTypes, file));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, rewriteDeclarationSpecifiers(await readFile(file, "utf8"), "js"));
  }
}

async function copyRuntimeAssets(outputRoot) {
  for (const file of await walk(SRC)) {
    const rel = relative(SRC, file);
    if (
      rel.startsWith(`view${process.platform === "win32" ? "\\" : "/"}app${process.platform === "win32" ? "\\" : "/"}`)
    )
      continue;
    if (!isRuntimeAsset(rel)) continue;
    const target = join(outputRoot, rel);
    await mkdir(dirname(target), { recursive: true });
    await cp(file, target);
  }
}

async function buildViewApp(outputRoot) {
  await viteBuild({
    configFile: VIEW_VITE_CONFIG,
    build: {
      outDir: join(outputRoot, "view", "app-dist"),
      emptyOutDir: true,
    },
  });
}

async function build() {
  // The final publish is an atomic rename, so staging must live on the same
  // filesystem as dist. CI checkouts and the system temp directory are often
  // separate mounts (Vercel/Netlify), where rename would otherwise fail with
  // EXDEV after the full build has completed.
  const temp = await mkdtemp(join(ROOT, ".niceeval-package-runtime-"));
  const outputRoot = join(temp, "dist");
  const rawTypes = join(temp, "types");
  try {
    await mkdir(outputRoot, { recursive: true });
    const sourceFiles = await walk(SRC);
    for (const file of [...sourceFiles, ...(await walk(join(ROOT, "bin")))]) {
      if (!/\.(?:[cm]?[jt]sx?)$/.test(file) || /\.(?:test|harness|d)\.tsx?$/.test(file)) continue;
      assertNoTopLevelAwait(await readFile(file, "utf8"), file);
    }
    await buildViewApp(outputRoot);
    await emitDeclarations(rawTypes);
    const runtimeSources = sourceFiles.map((file) => relative(SRC, file)).filter((rel) => isRuntimeSource(rel));
    for (const rel of runtimeSources) {
      const file = join(SRC, rel);
      const output = join(outputRoot, runtimePath(rel, ".js"));
      const input = await readFile(file, "utf8");
      const compiled = ts.transpileModule(input, {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
          moduleResolution: ts.ModuleResolutionKind.Bundler,
          jsx: ts.JsxEmit.ReactJSX,
          esModuleInterop: true,
          sourceMap: true,
          inlineSourceMap: false,
          inlineSources: true,
          rewriteRelativeImportExtensions: true,
          allowImportingTsExtensions: true,
          verbatimModuleSyntax: false,
        },
        fileName: file,
        reportDiagnostics: true,
      });
      const errors = (compiled.diagnostics ?? []).filter(
        (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
      );
      if (errors.length > 0) {
        throw new Error(
          ts.formatDiagnosticsWithColorAndContext(errors, {
            getCanonicalFileName: (name) => name,
            getCurrentDirectory: () => ROOT,
            getNewLine: () => "\n",
          }),
        );
      }
      await writeRuntimeModule(output, compiled.outputText, compiled.sourceMapText ?? "{}");
    }

    await copyRuntimeAssets(outputRoot);
    await writeDeclarations(rawTypes, outputRoot);
    await checkPublicUsage(ROOT, outputRoot);

    await rm(DIST, { recursive: true, force: true });
    await rename(outputRoot, DIST);
    process.stdout.write(`build:package: wrote ${relative(ROOT, DIST)} single ESM graph and declarations\n`);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

validateInitGuide(await readFile(join(ROOT, "../../INIT.md"), "utf8"));
await build();
