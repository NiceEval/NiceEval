import { command } from "@niceeval/testkit";
import { build, type Metafile } from "esbuild";
import { realpathSync } from "node:fs";
import { createRequire, findPackageJSON } from "node:module";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "vitest";

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error ? String(error.code) : undefined;
}

async function unavailableHostCode(moduleSystem: "esm" | "commonjs"): Promise<string | undefined> {
  const load =
    moduleSystem === "esm" ? 'await import("niceeval/inspection/host")' : 'require("niceeval/inspection/host")';
  const script = `
    try { ${load}; process.exitCode = 2 }
    catch (error) { process.stdout.write(JSON.stringify({ code: error?.code })) }
  `;
  const result = await command([process.execPath]).run(
    [...(moduleSystem === "esm" ? ["--input-type=module"] : []), "--eval", script],
    { timeoutMs: 10_000 },
  );
  expect(result.exitCode, result.diagnostic()).toBe(0);
  const receipt = result.json<unknown>();
  return errorCode(receipt);
}

function niceevalPackagePath(input: string, packageRoot: string): string | undefined {
  const packagePath = relative(packageRoot, resolve(input)).replaceAll("\\", "/");
  if (isAbsolute(packagePath) || packagePath === ".." || packagePath.startsWith("../")) return undefined;
  return packagePath.startsWith("dist/") ? packagePath : undefined;
}

function forbiddenClosureEntries(metafile: Metafile, packageRoot: string): string[] {
  const forbiddenNiceevalBoundary =
    /(?:^|\/)(?:cli|host|sqlite|[^/]*projection|scope|service|layer)(?:[./-]|\/|$)|^dist\/inspection\/(?:source|select|facts)(?:[./-]|\/|$)/i;
  const forbiddenPackage = /(?:^|\/)(?:better-sqlite3|sql\.js|sqlite-wasm)(?:\/|$)/i;
  const forbiddenEffectRuntime =
    /\/node_modules\/effect\/dist\/(?:Layer|Scope|ServiceMap|internal\/(?:layer|scope|service-map))\.js$/i;
  const violations = new Set<string>();
  const emittedInputs = new Set(
    Object.values(metafile.outputs).flatMap((output) =>
      Object.entries(output.inputs)
        .filter(([, contribution]) => contribution.bytesInOutput > 0)
        .map(([input]) => input),
    ),
  );

  for (const input of emittedInputs) {
    const normalized = input.replaceAll("\\", "/");
    const packagePath = niceevalPackagePath(normalized, packageRoot);
    if (packagePath && forbiddenNiceevalBoundary.test(packagePath)) violations.add(`niceeval:${packagePath}`);
    if (forbiddenPackage.test(normalized)) violations.add(`package:${normalized}`);
    if (forbiddenEffectRuntime.test(normalized)) violations.add(`effect-runtime:${normalized}`);
  }

  for (const output of Object.values(metafile.outputs)) {
    for (const imported of output.imports) {
      const path = imported.path.replaceAll("\\", "/");
      if (path.startsWith("node:") || (imported.external && /^[a-z][a-z0-9_-]*$/i.test(path))) {
        violations.add(`builtin:${path}`);
      }
      if (forbiddenPackage.test(path)) violations.add(`package:${path}`);
    }
  }

  return [...violations].sort();
}
// @feature docs/feature/inspection/README.md

test("安装后的 Inspection 入口在 ESM、CommonJS 与浏览器模块图中只交付纯协议", async () => {
  const identities = await command([process.execPath]).run(
    [
      "--input-type=module",
      "--eval",
      `
    import { strictEqual } from "node:assert";
    import { createRequire } from "node:module";
    const inspection = await import("niceeval/inspection");
    const commonjs = createRequire(import.meta.url)("niceeval/inspection");
    for (const name of Object.keys(inspection)) strictEqual(inspection[name], commonjs[name], name);
  `,
    ],
    { timeoutMs: 10_000 },
  );
  expect(identities.exitCode, identities.diagnostic()).toBe(0);
  const inspection = await import("niceeval/inspection");
  const require = createRequire(import.meta.url);
  const commonjsInspection = require("niceeval/inspection") as typeof inspection;
  const packageJsonPath = findPackageJSON(pathToFileURL(require.resolve("niceeval/inspection")));
  if (!packageJsonPath) throw new Error("cannot find the installed niceeval package root");
  const packageRoot = realpathSync(dirname(packageJsonPath));

  expect(inspection).not.toHaveProperty("QUERY_PROTOCOL");
  const request = { operation: { kind: "run.list" } };
  expect(inspection.decodeInspectionRequest(request)._tag).toBe("Success");
  expect(commonjsInspection.decodeInspectionRequest(request)._tag).toBe("Success");
  const oldDocument = { outcome: "discovery", operations: [] };
  expect(inspection.decodeInspectionDocument(oldDocument).success).toBe(false);
  expect(commonjsInspection.decodeInspectionDocument(oldDocument).success).toBe(false);

  expect(inspection.INSPECTION_OPERATION_IDS).toContain("project.get");
  expect(inspection.INSPECTION_OPERATION_IDS).toContain("attempt.assertion.image");
  expect(inspection.INSPECTION_OPERATION_IDS).toContain("attempt.artifact");
  expect(commonjsInspection.INSPECTION_OPERATION_IDS).toEqual(inspection.INSPECTION_OPERATION_IDS);
  expect(inspection.decodeInspectionDocument({ protocol: "not-niceeval" }).success).toBe(false);
  expect(commonjsInspection.decodeInspectionDocument({ protocol: "not-niceeval" }).success).toBe(false);

  expect(await unavailableHostCode("esm")).toBe("ERR_PACKAGE_PATH_NOT_EXPORTED");
  expect(await unavailableHostCode("commonjs")).toBe("ERR_PACKAGE_PATH_NOT_EXPORTED");

  const bundled = await build({
    bundle: true,
    format: "esm",
    metafile: true,
    platform: "browser",
    target: "es2022",
    write: false,
    stdin: {
      contents: `
        import { INSPECTION_OPERATION_IDS, decodeInspectionDocument } from "niceeval/inspection";
        export function probe() {
          return {
            operations: INSPECTION_OPERATION_IDS,
            invalidDocumentAccepted: decodeInspectionDocument({ protocol: "not-niceeval" }).success,
          };
        }
      `,
      resolveDir: process.cwd(),
      sourcefile: "inspection-browser-consumer.mjs",
    },
  });

  expect(
    Object.keys(bundled.metafile.inputs).some((input) => niceevalPackagePath(input, packageRoot) !== undefined),
    "browser module graph must include the resolved installed package",
  ).toBe(true);
  expect(forbiddenClosureEntries(bundled.metafile, packageRoot)).toEqual([]);
  const javascript = bundled.outputFiles.find((output) => output.path.endsWith(".js")) ?? bundled.outputFiles[0];
  expect(javascript, "esbuild did not emit a JavaScript browser bundle").toBeDefined();
  if (!javascript) throw new Error("esbuild did not emit a JavaScript browser bundle");

  const executed = (await import(
    `data:text/javascript;base64,${Buffer.from(javascript.contents).toString("base64")}`
  )) as {
    probe(): { operations: readonly string[]; invalidDocumentAccepted: boolean };
  };
  expect(executed.probe()).toEqual({
    operations: inspection.INSPECTION_OPERATION_IDS,
    invalidDocumentAccepted: false,
  });
});
