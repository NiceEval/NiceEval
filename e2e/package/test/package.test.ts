// Regression note: memory/tsx-dynamic-import-require-cycle.md

import { command, createE2EContext } from "@niceeval/testkit";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { expect, test } from "vitest";

interface InstalledPackage {
  root: string;
  packageJson: {
    name?: string;
    version?: string;
    dependencies?: Record<string, unknown>;
    devDependencies?: Record<string, unknown>;
    optionalDependencies?: Record<string, unknown>;
    peerDependencies?: Record<string, unknown>;
  };
}

function findInstalledNiceeval(): InstalledPackage {
  const require = createRequire(import.meta.url);
  let directory = dirname(require.resolve("niceeval"));

  for (;;) {
    const packageJsonPath = join(directory, "package.json");
    if (existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as InstalledPackage["packageJson"];
      if (packageJson.name === "niceeval") return { root: directory, packageJson };
    }

    const parent = dirname(directory);
    if (parent === directory) throw new Error("cannot find the installed niceeval package root");
    directory = parent;
  }
}

function rejectedLoads(
  labels: readonly string[],
  results: readonly PromiseSettledResult<unknown>[],
): string {
  return results.flatMap((result, index) => result.status === "rejected"
    ? [`${labels[index]}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`]
    : []).join("\n");
}

// 特例：case 项目源是签入的 CommonJS 消费者 fixture；sourceRoot 才是承载
// runner 注入 staging root 的隔离 Repo 根（docs/engineering/testing/library.md）。
const e2e = createE2EContext({
  repoId: "package",
  sourceRoot: process.cwd(),
  project: {
    from: join(process.cwd(), "fixtures", "commonjs-init-list"),
    prefix: "niceeval-e2e-package-commonjs-",
    omitTopLevel: ["node_modules"],
    links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
  },
  commands: {
    niceeval: [join(process.cwd(), "node_modules", ".bin", "niceeval")],
    tsc: [join(process.cwd(), "node_modules", ".bin", "tsc")],
  },
});
// @feature docs/feature/eval/README.md
// @regression memory/duplicate-public-entrypoints.md
// @regression memory/published-package-runtime-dependencies-missing.md

test("pnpm 11 默认 CommonJS 项目无需补运行依赖即可完成安装后 CLI Journey", async () => {
  // Vite can transform linked candidates into its own module cache. Exercise
  // import and require together in Node, where consumers share require(esm).
  const identities = await command([process.execPath]).run(["--input-type=module", "--eval", `
    import { strictEqual } from "node:assert";
    import { createRequire } from "node:module";
    const require = createRequire(import.meta.url);
    for (const specifier of ["niceeval", "niceeval/expect", "niceeval/eval/host", "niceeval/project/host"]) {
      const esm = await import(specifier);
      const commonjs = require(specifier);
      for (const name of Object.keys(esm)) strictEqual(esm[name], commonjs[name], specifier + ": " + name);
    }
  `], { timeoutMs: 10_000 });
  expect(identities.exitCode, identities.diagnostic()).toBe(0);
  const { root: installedRoot, packageJson } = findInstalledNiceeval();
  for (const field of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"] as const) {
    const dependencies = packageJson[field];
    expect(dependencies?.["@niceeval/testkit"], `package.json ${field}`).toBeUndefined();
  }
  expect(existsSync(join(installedRoot, "packages", "testkit")), "候选包不得携带 packages/testkit").toBe(false);

  const rootEntry = await import("niceeval");
  const adapterEntry = await import("niceeval/adapter");
  expect(Reflect.get(adapterEntry, "createSessionKey")).toBeTypeOf("function");
  expect(Object.hasOwn(adapterEntry, "createSessionSlot")).toBe(false);
  const expectEntry = await import("niceeval/expect");
  const inspectionEntry = await import("niceeval/inspection");
  const sandboxEntry = await import("niceeval/sandbox");
  const publicRequire = createRequire(import.meta.url);
  const rootCommonjs = publicRequire("niceeval");
  const expectCommonjs = publicRequire("niceeval/expect");
  for (const name of ["defineJudge", "defineScoreMatch", "defineMaterialMatch", "defineContextMatch",
    "factuality", "faithfulness", "instructionFollowing", "pairwisePreference"] as const) {
    expect(typeof expectEntry[name], name).toBe("function");
    expect(typeof expectCommonjs[name], name).toBe("function");
    expect(Object.hasOwn(rootEntry, name), `root alias: ${name}`).toBe(false);
    expect(Object.hasOwn(rootCommonjs, name), `CommonJS root alias: ${name}`).toBe(false);
  }
  for (const name of ["requireEnv", "getEnv", "stripComments", "readScoreMatchAudit"]) {
    expect(Object.hasOwn(rootEntry, name), name).toBe(false);
    expect(Object.hasOwn(rootCommonjs, name), name).toBe(false);
  }
  expect(typeof inspectionEntry.readScoreMatchAudit).toBe("function");
  for (const value of [undefined, {}, { manifest: { schemaVersion: 999 } }]) {
    expect(inspectionEntry.readScoreMatchAudit(value)).toEqual(
      publicRequire("niceeval/inspection").readScoreMatchAudit(value),
    );
  }
  expect(inspectionEntry.readScoreMatchAudit({})).toEqual({ state: "invalid" });
  expect(typeof sandboxEntry.resolveDockerProfile).toBe("function");
  expect(Object.hasOwn(sandboxEntry, "resolveDockerProfileAlias")).toBe(false);
  for (const name of ["computeBuildKey", "computeCaseKey", "credentialIdentityContribution",
    "assertPureDataIdentity", "looksLikeDigestRef", "COMPOSE_MATERIALIZER_REVISION",
    "collectComposeBuilds", "leakGateHintsFromComposeFile", "assertComposeBlacklist",
    "findComposeBlacklistViolations", "buildComposeOverlay", "materializeDockerComposeProviderCase",
    "SANDBOX_BUILD_ACTIVITY", "prepareSandboxBuilds", "startSandboxBuilds", "buildFailureOrigin",
    "materializationScopeId", "sandboxBuildRef", "normalizeSandboxCapture",
    "parseDockerExecutionProfile", "parseDockerExecutionProfileV1", "decodeDockerExecutionProfileV1",
    "makeDockerExecutionProfileV1", "createDockerExecutionProfileV1", "createDockerProfileRegistry",
    "parseDockerProfileRegistry", "resolveDockerExecutionProfile", "DOCKER_PROFILE_SCHEMA_VERSION",
    "DOCKER_PROFILE_NETWORK_POLICY_VERSION", "DOCKER_PROFILE_NETWORK_DENY_CIDRS"]) {
    expect(Object.hasOwn(sandboxEntry, name), `internal sandbox export: ${name}`).toBe(false);
    expect(Object.hasOwn(publicRequire("niceeval/sandbox"), name), `CommonJS sandbox export: ${name}`).toBe(false);
  }
  for (const name of ["decodeDockerExecutionProfile", "defineDockerExecutionProfile", "indexDockerProfiles", "resolveDockerProfile"]) {
    expect(Reflect.get(sandboxEntry, name), name).toBeTypeOf("function");
  }
  for (const name of ["canonicalInspectionJson", "canonicalJsonValue", "closeInspectionJson"]) {
    expect(Object.hasOwn(inspectionEntry, name), name).toBe(false);
  }
  const loadersEntry = await import("niceeval/loaders");
  expect(Object.hasOwn(loadersEntry, "captureLoadedFiles")).toBe(false);

  const labels = ["niceeval/eval/host", "niceeval/project/host"] as const;
  const esm = await Promise.allSettled(labels.map((specifier) => import(specifier)));
  const require = createRequire(import.meta.url);
  const commonjs = await Promise.allSettled(
    labels.map((specifier) => Promise.resolve().then(() => require(specifier))),
  );

  const loads = [...esm, ...commonjs];
  const loadLabels = [
    ...labels.map((specifier) => `ESM ${specifier}`),
    ...labels.map((specifier) => `CommonJS ${specifier}`),
  ];
  expect(loads.map(({ status }) => status), rejectedLoads(loadLabels, loads)).toEqual([
    "fulfilled",
    "fulfilled",
    "fulfilled",
    "fulfilled",
  ]);
  if (
    esm[0].status !== "fulfilled" || esm[1].status !== "fulfilled" ||
    commonjs[0].status !== "fulfilled" || commonjs[1].status !== "fulfilled"
  ) {
    throw new Error("public Host SDK entries did not load");
  }

  const [evalEsm, projectEsm] = [esm[0].value, esm[1].value];
  const [evalCommonjs, projectCommonjs] = [commonjs[0].value, commonjs[1].value];
  expect(Object.keys(evalEsm).sort()).toEqual(["EvalCatalogError", "evalHost"]);
  expect(Object.keys(projectEsm).sort()).toEqual([
    "ProjectFileSystem",
    "ProjectManifestFacts",
    "ProjectPlatformError",
    "ProjectProcessFacts",
    "projectHost",
  ]);
  expect(Object.keys(evalCommonjs).sort()).toEqual(Object.keys(evalEsm).sort());
  expect(Object.keys(projectCommonjs).sort()).toEqual(Object.keys(projectEsm).sort());
  expect(Object.isFrozen(evalEsm.evalHost)).toBe(true);
  expect(Object.keys(evalEsm.evalHost)).toEqual(["catalog"]);
  expect(Object.isFrozen(projectEsm.projectHost)).toBe(true);
  expect(Object.keys(projectEsm.projectHost)).toEqual(["initialize"]);
  expect([
    projectEsm.ProjectFileSystem.key,
    projectEsm.ProjectManifestFacts.key,
    projectEsm.ProjectProcessFacts.key,
  ]).toEqual([
    "niceeval/project/ProjectFileSystem",
    "niceeval/project/ProjectManifestFacts",
    "niceeval/project/ProjectProcessFacts",
  ]);

  await e2e.case("commonjs-init-list", async ({ commands: { niceeval, tsc }, paths }) => {
    for (const extension of ["mts", "cts"]) {
      writeFileSync(join(paths.projectRoot, `public-surface.${extension}`), `
        import { defineScoreEval, type ScoreMatch } from "niceeval";
        import { defineScoreMatch, defineJudge, defineMaterialMatch, defineContextMatch } from "niceeval/expect";
        import { readScoreMatchAudit } from "niceeval/inspection";
        const score: ScoreMatch<number> = defineScoreMatch({ name: "fraction", score: (value: number) => value });
        void [defineScoreEval, defineJudge, defineMaterialMatch, defineContextMatch, readScoreMatchAudit, score];
      `);
    }
    const declarations = await tsc.run(["--noEmit", "--strict", "--skipLibCheck", "--target", "ES2022",
      "--module", "NodeNext", "public-surface.mts", "public-surface.cts"]);
    expect(declarations.exitCode, declarations.diagnostic()).toBe(0);
    const version = await niceeval.run(["--version"]);
    expect(version.exitCode, version.diagnostic()).toBe(0);
    expect(version.stdout.trim()).toBe(packageJson.version);

    const initialized = await niceeval.run(["init"]);
    expect(initialized.exitCode, initialized.diagnostic()).toBe(0);
    expect(existsSync(join(paths.projectRoot, "niceeval.config.ts"))).toBe(true);

    const listed = await niceeval.run(["list"]);
    expect(listed.exitCode, listed.diagnostic()).toBe(0);
    expect(listed.stdout).toMatch(/cjs-default/);
    expect(listed.stdout).toMatch(/tsx-default/);

    const planned = await niceeval.run(["exp", "smoke", "--dry"]);
    expect(planned.exitCode, planned.diagnostic()).toBe(0);
    expect(planned.stdout).toMatch(/smoke/);
  });
});
