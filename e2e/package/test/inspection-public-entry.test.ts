
import { build, type Metafile } from "esbuild";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { expect, test } from "vitest";

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : undefined;
}

function unavailableHostCode(moduleSystem: "esm" | "commonjs"): string | undefined {
  const load = moduleSystem === "esm"
    ? 'await import("niceeval/inspection/host")'
    : 'require("niceeval/inspection/host")';
  const script = `
    try { ${load}; process.exitCode = 2 }
    catch (error) { process.stdout.write(JSON.stringify({ code: error?.code })) }
  `;
  const result = spawnSync(process.execPath, [
    ...(moduleSystem === "esm" ? ["--input-type=module"] : []),
    "--eval",
    script,
  ], { cwd: process.cwd(), encoding: "utf8" });
  expect(result.status, result.stderr).toBe(0);
  const receipt = JSON.parse(result.stdout) as unknown;
  return errorCode(receipt);
}

function niceevalPackagePath(input: string): string | undefined {
  const normalized = input.replaceAll("\\", "/");
  const marker = "/node_modules/niceeval/";
  const markerIndex = normalized.indexOf(marker);
  if (markerIndex >= 0) {
    const packagePath = normalized.slice(markerIndex + marker.length);
    return packagePath.startsWith("dist/") ? packagePath : undefined;
  }
  if (normalized.startsWith("node_modules/niceeval/dist/")) return normalized.slice("node_modules/niceeval/".length);
  return undefined;
}

function forbiddenClosureEntries(metafile: Metafile): string[] {
  const forbiddenNiceevalBoundary = /(?:^|\/)(?:cli|source|select|facts|sqlite|[^/]*projection|scope|service|layer)(?:[./-]|\/|$)/i;
  const forbiddenPackage = /(?:^|\/)(?:better-sqlite3|sql\.js|sqlite-wasm)(?:\/|$)/i;
  const forbiddenEffectRuntime = /\/node_modules\/effect\/dist\/(?:Layer|Scope|ServiceMap|internal\/(?:layer|scope|service-map))\.js$/i;
  const violations = new Set<string>();
  const emittedInputs = new Set(Object.values(metafile.outputs).flatMap((output) =>
    Object.entries(output.inputs)
      .filter(([, contribution]) => contribution.bytesInOutput > 0)
      .map(([input]) => input)));

  for (const input of emittedInputs) {
    const normalized = input.replaceAll("\\", "/");
    const packagePath = niceevalPackagePath(normalized);
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

test("安装后的 Inspection 入口在 ESM、CommonJS 与浏览器模块图中只交付纯协议 [necase_C29N05SASPNVJDNN]", async () => {
  const inspection = await import("niceeval/inspection");
  const require = createRequire(import.meta.url);
  const commonjsInspection = require("niceeval/inspection") as typeof inspection;

  expect(inspection.INSPECTION_OPERATION_IDS).toHaveLength(16);
  expect(commonjsInspection.INSPECTION_OPERATION_IDS).toEqual(inspection.INSPECTION_OPERATION_IDS);
  expect(inspection.decodeInspectionDocument({ protocol: "not-niceeval" }).success).toBe(false);
  expect(commonjsInspection.decodeInspectionDocument({ protocol: "not-niceeval" }).success).toBe(false);

  expect(unavailableHostCode("esm")).toBe("ERR_PACKAGE_PATH_NOT_EXPORTED");
  expect(unavailableHostCode("commonjs")).toBe("ERR_PACKAGE_PATH_NOT_EXPORTED");

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

  expect(forbiddenClosureEntries(bundled.metafile)).toEqual([]);
  const javascript = bundled.outputFiles.find((output) => output.path.endsWith(".js")) ?? bundled.outputFiles[0];
  expect(javascript, "esbuild did not emit a JavaScript browser bundle").toBeDefined();
  if (!javascript) throw new Error("esbuild did not emit a JavaScript browser bundle");

  const executed = await import(`data:text/javascript;base64,${Buffer.from(javascript.contents).toString("base64")}`) as {
    probe(): { operations: readonly string[]; invalidDocumentAccepted: boolean };
  };
  expect(executed.probe()).toEqual({
    operations: inspection.INSPECTION_OPERATION_IDS,
    invalidDocumentAccepted: false,
  });
});
