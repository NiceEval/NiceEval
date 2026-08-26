import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SRC = join(ROOT, "src");
const DIST = join(ROOT, "dist");
const TYPES_CONFIG = join(ROOT, "tsconfig.package-types.json");

// 每个公开入口的 .mjs 只从对应的 canonical .cjs 取值。它们不参与源码编译，因而无论
// import 还是 require 都观察同一份 NiceEval 模块状态。
const PUBLIC_ENTRIES = [
  [".", "index.ts"],
  ["./sandbox", "sandbox/index.ts"],
  ["./sandbox/e2b-template", "sandbox/e2b-agent-template.ts"],
  ["./adapter", "agents/index.ts"],
  ["./adapter/otel", "agents/ai-sdk-otel.ts"],
  ["./plugin", "plugin/index.ts"],
  ["./expect", "expect/index.ts"],
  ["./reporters", "runner/reporters/index.ts"],
  ["./loaders", "loaders/index.ts"],
  ["./eval/host", "eval/host/index.ts"],
  ["./experiment/host", "experiment/host/index.ts"],
  ["./coordination/host", "coordination/host/index.ts"],
  ["./record", "record/index.ts"],
  ["./record/host", "record/host/index.ts"],
  ["./inspection/host", "inspection/index.ts"],
  ["./project/host", "project/host/index.ts"],
];

async function assertPublicEntryClosure() {
  const manifest = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8"));
  const packageEntries = Object.keys(manifest.exports ?? {}).sort();
  const facadeEntries = PUBLIC_ENTRIES.map(([entry]) => entry).sort();
  const missingFacades = packageEntries.filter((entry) => !facadeEntries.includes(entry));
  const undeclaredFacades = facadeEntries.filter((entry) => !packageEntries.includes(entry));
  if (missingFacades.length > 0 || undeclaredFacades.length > 0) {
    throw new Error(
      "Public package entry closure mismatch: " +
      `missing facades [${missingFacades.join(", ")}], ` +
      `undeclared facades [${undeclaredFacades.join(", ")}].`,
    );
  }
}

function isRuntimeSource(file) {
  return (file.endsWith(".ts") || file.endsWith(".tsx")) &&
    !file.endsWith(".test.ts") &&
    !file.endsWith(".test.tsx") &&
    !file.endsWith(".harness.ts");
}

function isRuntimeAsset(relativePath) {
  return [".css", ".html", ".js", ".json"].includes(extname(relativePath));
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

function relativeRuntimeSpecifier(specifier, extension) {
  if (!specifier.startsWith(".")) return specifier;
  return specifier.replace(/\.(?:tsx?|jsx?)$/, extension);
}

function transformForCjs(source, fileName) {
  let usesImportMeta = false;
  let usesImportMetaDirname = false;
  let usesDynamicImport = false;
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.ES2022,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const transformed = ts.transform(sourceFile, [
    (context) => {
      const visit = (node) => {
        if (
          ts.isPropertyAccessExpression(node) &&
          ts.isMetaProperty(node.expression) &&
          node.expression.keywordToken === ts.SyntaxKind.ImportKeyword &&
          node.expression.name.text === "meta"
        ) {
          if (node.name.text === "url") {
            usesImportMeta = true;
            return ts.factory.createIdentifier("__niceevalImportMetaUrl");
          }
          if (node.name.text === "dirname") {
            usesImportMetaDirname = true;
            return ts.factory.createIdentifier("__niceevalImportMetaDirname");
          }
        }
        if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
          usesDynamicImport = true;
          const args = [...node.arguments];
          if (args[0] && ts.isStringLiteral(args[0])) {
            args[0] = ts.factory.createStringLiteral(relativeRuntimeSpecifier(args[0].text, ".cjs"));
          }
          return ts.factory.updateCallExpression(
            node,
            ts.factory.createIdentifier("__niceevalDynamicImport"),
            node.typeArguments,
            args,
          );
        }
        return ts.visitEachChild(node, visit, context);
      };
      return (node) => ts.visitNode(node, visit);
    },
  ]);
  const text = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed }).printFile(transformed.transformed[0]);
  transformed.dispose();
  return { text, usesImportMeta, usesImportMetaDirname, usesDynamicImport };
}

function injectPrelude(code, lines) {
  if (lines.length === 0) return code;
  const strict = '"use strict";\n';
  return code.startsWith(strict) ? `${strict}${lines.join("\n")}\n${code.slice(strict.length)}` : `${lines.join("\n")}\n${code}`;
}

function rewriteCjsRelativeRequires(code) {
  return code.replace(/require\((['"])(\.\.?\/[^'"]+)\.(?:js|jsx|ts|tsx)\1\)/g, (_all, quote, stem) => {
    return `require(${quote}${stem}.cjs${quote})`;
  });
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
  const program = ts.createProgram({ rootNames: config.fileNames, options, projectReferences: config.projectReferences });
  const diagnostics = [...ts.getPreEmitDiagnostics(program), ...program.emit(undefined, undefined, undefined, true).diagnostics]
    .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
  if (diagnostics.length > 0) {
    throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: (name) => name,
      getCurrentDirectory: () => ROOT,
      getNewLine: () => "\n",
    }));
  }
  return program;
}

function rewriteDeclarationSpecifiers(text, extension) {
  return text.replace(/(['"])(\.\.?\/[^'"]+)\.(?:js|jsx|ts|tsx)\1/g, (_all, quote, stem) => `${quote}${stem}.${extension}${quote}`);
}

async function writeDualDeclarations(rawTypes, outputRoot) {
  for (const file of await walk(rawTypes)) {
    if (!file.endsWith(".d.ts")) continue;
    const rel = relative(rawTypes, file);
    const base = rel.slice(0, -".d.ts".length);
    const text = await readFile(file, "utf8");
    for (const [suffix, extension] of [[".d.cts", "cjs"], [".d.mts", "mjs"], [".d.ts", "js"]]) {
      const target = join(outputRoot, `${base}${suffix}`);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, rewriteDeclarationSpecifiers(text, extension));
    }
  }
}

function publicValueExports(program, relativeSource) {
  const sourceFile = program.getSourceFile(join(SRC, relativeSource));
  if (!sourceFile) throw new Error(`Missing public source ${relativeSource}`);
  const checker = program.getTypeChecker();
  const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
  if (!moduleSymbol) throw new Error(`Missing module symbol for ${relativeSource}`);
  return checker
    .getExportsOfModule(moduleSymbol)
    .filter((symbol) => {
      const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
      return (target.flags & ts.SymbolFlags.Value) !== 0;
    })
    .map((symbol) => symbol.name)
    .sort();
}

async function writeEsmFacade(outputRoot, source, valueNames, extension = ".mjs") {
  const cjsFile = runtimePath(source, ".cjs");
  const facadeFile = runtimePath(source, extension);
  const output = join(outputRoot, facadeFile);
  const cjsSpecifier = `./${basename(cjsFile)}`;
  // Both ESM facades read the canonical CJS cache so import() and require()
  // observe one runtime identity. Vite's static CJS default interop can turn
  // the default export into undefined, so use an explicit createRequire bridge.
  const lines = [
    'import { createRequire as __niceevalCreateRequire } from "node:module";',
    "const __niceevalRequire = __niceevalCreateRequire(import.meta.url);",
    `const __niceevalCanonical = __niceevalRequire(${JSON.stringify(cjsSpecifier)});`,
  ];
  let index = 0;
  for (const name of valueNames) {
    if (name === "default") {
      lines.push("export default __niceevalCanonical.default;");
      continue;
    }
    const local = `__niceevalExport${index++}`;
    lines.push(`const ${local} = __niceevalCanonical[${JSON.stringify(name)}];`);
    lines.push(`export { ${local} as ${name} };`);
  }
  const map = JSON.stringify({ version: 3, file: basename(output), sources: [], names: [], mappings: "" });
  await writeRuntimeModule(output, `${lines.join("\n")}\n`, map);
}

async function copyRuntimeAssets(outputRoot) {
  for (const file of await walk(SRC)) {
    const rel = relative(SRC, file);
    if (!isRuntimeAsset(rel)) continue;
    const target = join(outputRoot, rel);
    await mkdir(dirname(target), { recursive: true });
    await cp(file, target);
  }
}

async function build() {
  await assertPublicEntryClosure();
  // The final publish is an atomic rename, so staging must live on the same
  // filesystem as dist. CI checkouts and the system temp directory are often
  // separate mounts (Vercel/Netlify), where rename would otherwise fail with
  // EXDEV after the full build has completed.
  const temp = await mkdtemp(join(ROOT, ".niceeval-package-runtime-"));
  const outputRoot = join(temp, "dist");
  const rawTypes = join(temp, "types");
  try {
    const program = await emitDeclarations(rawTypes);
    await mkdir(outputRoot, { recursive: true });
    const runtimeSources = (await walk(SRC))
      .map((file) => relative(SRC, file))
      .filter((rel) => isRuntimeSource(rel));
    for (const rel of runtimeSources) {
      const file = join(SRC, rel);
      const output = join(outputRoot, runtimePath(rel, ".cjs"));
      const input = await readFile(file, "utf8");
      const transformed = transformForCjs(input, file);
      const compiled = ts.transpileModule(transformed.text, {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.CommonJS,
          moduleResolution: ts.ModuleResolutionKind.Node10,
          ignoreDeprecations: "6.0",
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
      const errors = (compiled.diagnostics ?? []).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
      if (errors.length > 0) {
        throw new Error(ts.formatDiagnosticsWithColorAndContext(errors, {
          getCanonicalFileName: (name) => name,
          getCurrentDirectory: () => ROOT,
          getNewLine: () => "\n",
        }));
      }
      const prelude = [];
      if (transformed.usesImportMeta) {
        prelude.push('const { pathToFileURL: __niceevalPathToFileURL } = require("node:url");');
        prelude.push("const __niceevalImportMetaUrl = __niceevalPathToFileURL(__filename).href;");
      }
      if (transformed.usesImportMetaDirname) {
        prelude.push('const { dirname: __niceevalDirname } = require("node:path");');
        prelude.push("const __niceevalImportMetaDirname = __niceevalDirname(__filename);");
      }
      if (transformed.usesDynamicImport) {
        prelude.push("const __niceevalDynamicImport = (specifier) => import(specifier);");
      }
      let code = injectPrelude(compiled.outputText, prelude);
      code = rewriteCjsRelativeRequires(code);
      await writeRuntimeModule(output, code, compiled.sourceMapText ?? "{}");
    }

    await copyRuntimeAssets(outputRoot);
    await writeDualDeclarations(rawTypes, outputRoot);
    // Internal tools that read dist source paths receive ESM facades over the
    // same canonical CJS graph; public entries receive explicit .mjs facades.
    for (const source of runtimeSources) {
      await writeEsmFacade(outputRoot, source, publicValueExports(program, source), ".js");
    }
    for (const [, source] of PUBLIC_ENTRIES) {
      await writeEsmFacade(outputRoot, source, publicValueExports(program, source));
    }

    await rm(DIST, { recursive: true, force: true });
    await rename(outputRoot, DIST);
    process.stdout.write(`build:package: wrote ${relative(ROOT, DIST)} canonical CJS graph and ESM facades\n`);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

await build();
