import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const ts = require("typescript");

// Inspect the emitted declarations, resolving re-exports to their declaration owner.
export async function missingPublicUsage(packageRoot, distRoot) {
  const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
  const entries = Object.values(manifest.exports).flatMap((entry) => [entry.import.types, entry.require.types].map((path) => join(distRoot, path.replace("./dist/", ""))));
  const program = ts.createProgram(entries, { module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, skipLibCheck: true });
  const checker = program.getTypeChecker();
  const missing = new Set();
  for (const entry of entries) {
    const file = program.getSourceFile(entry);
    const module = file && checker.getSymbolAtLocation(file);
    if (!module) throw new Error(`Missing published declaration entry: ${entry}`);
    for (let symbol of checker.getExportsOfModule(module)) {
      if (symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
      const callable = checker.getTypeOfSymbolAtLocation(symbol, symbol.declarations?.[0] ?? file).getCallSignatures().length > 0;
      if (!(symbol.flags & (ts.SymbolFlags.Function | ts.SymbolFlags.Interface | ts.SymbolFlags.TypeAlias | ts.SymbolFlags.Class | ts.SymbolFlags.Enum)) && !callable) continue;
      if (ts.displayPartsToString(symbol.getDocumentationComment(checker)).trim()) continue;
      const declaration = symbol.declarations?.[0];
      if (!declaration) throw new Error(`No declaration for ${symbol.name}`);
      const path = relative(distRoot, declaration.getSourceFile().fileName).replaceAll("\\", "/");
      if (path.startsWith("../")) throw new Error(`Public usage owner is outside the published package: ${symbol.name}`);
      missing.add(`${path.replace(/\.d\.cts$/, ".d.mts")}#${symbol.name}`);
    }
  }
  return [...missing].sort();
}

export async function checkPublicUsage(packageRoot, distRoot) {
  const actual = await missingPublicUsage(packageRoot, distRoot);
  const baseline = JSON.parse(await readFile(join(packageRoot, "scripts/package-runtime/public-usage-baseline.json"), "utf8"));
  const expected = new Set(baseline.missing);
  const unexpected = actual.filter((item) => !expected.has(item));
  const present = new Set(actual);
  const stale = baseline.missing.filter((item) => !present.has(item));
  if (unexpected.length || stale.length) {
    throw new Error(`Published declaration usage: add source documentation for [${unexpected.join(", ")}]; remove resolved baseline entries [${stale.join(", ")}]`);
  }
}
