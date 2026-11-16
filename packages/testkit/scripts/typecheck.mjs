import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const productRoot = resolve(root, "../niceeval");
const require = createRequire(import.meta.url);
const compiler = require.resolve("typescript/bin/tsc6");

function tsc(args) {
  const result = spawnSync(process.execPath, [compiler, ...args], { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`TypeScript terminated by ${result.signal}`);
  return result.status;
}

const scratch = await mkdtemp(join(tmpdir(), "niceeval-testkit-typecheck-"));
try {
  const declarations = join(scratch, "types");
  // Use the product's own options; Testkit's stricter options apply only to its
  // source, consuming the complete public declaration graph as a dependency.
  process.exitCode = tsc([
    "-p",
    join(productRoot, "tsconfig.package-types.json"),
    "--outDir",
    declarations,
    "--noEmitOnError",
  ]);
  if (process.exitCode === 0) {
    const manifest = JSON.parse(await readFile(join(productRoot, "package.json"), "utf8"));
    const paths = { "@niceeval/*": [join(declarations, "*")] };
    for (const [entry, target] of Object.entries(manifest.exports)) {
      if (typeof target.types !== "string" || !target.types.startsWith("./dist/")) {
        throw new Error(`Missing product declaration export for ${entry}`);
      }
      paths[entry === "." ? manifest.name : `${manifest.name}${entry.slice(1)}`] = [
        join(declarations, target.types.slice("./dist/".length)),
      ];
    }
    // Declarations retain ESM identity and resolve the product's dependencies
    // without installing anything or consulting the shared product dist.
    await writeFile(join(scratch, "package.json"), '{"type":"module"}\n');
    await symlink(join(productRoot, "node_modules"), join(scratch, "node_modules"), "junction");
    const config = join(scratch, "tsconfig.json");
    await writeFile(
      config,
      JSON.stringify({ extends: join(root, "tsconfig.json"), compilerOptions: { paths } }, null, 2),
    );
    process.exitCode = tsc(["-p", config, "--noEmit"]);
  }
} finally {
  await rm(scratch, { recursive: true, force: true });
}
