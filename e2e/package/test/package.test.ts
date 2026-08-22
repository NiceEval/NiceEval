// owner: docs/engineering/testing/e2e/package.md#package-commonjs-init-list
// regression: memory/tsx-dynamic-import-require-cycle.md

import { createE2EContext } from "@niceeval/testkit";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { expect, test } from "vitest";

interface InstalledPackage {
  root: string;
  packageJson: {
    name?: string;
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
// runner 注入 staging root 的隔离 Repo 根（docs/engineering/testing/testkit.md）。
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
  },
});

test("默认 CommonJS 项目可消费公开 Host SDK 并完成 init → list", async () => {
  const { root: installedRoot, packageJson } = findInstalledNiceeval();
  for (const field of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"] as const) {
    const dependencies = packageJson[field];
    expect(dependencies?.["@niceeval/testkit"], `package.json ${field}`).toBeUndefined();
  }
  expect(existsSync(join(installedRoot, "packages", "testkit")), "候选包不得携带 packages/testkit").toBe(false);

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
  for (const name of Object.keys(evalEsm)) {
    expect(evalEsm[name], `ESM/CJS eval Host identity: ${name}`).toBe(evalCommonjs[name]);
  }
  for (const name of Object.keys(projectEsm)) {
    expect(projectEsm[name], `ESM/CJS project Host identity: ${name}`).toBe(projectCommonjs[name]);
  }
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

  await e2e.case("commonjs-init-list", async ({ commands: { niceeval }, paths }) => {
    const initialized = await niceeval.run(["init"]);
    expect(initialized.exitCode, initialized.diagnostic()).toBe(0);
    expect(existsSync(join(paths.projectRoot, "niceeval.config.ts"))).toBe(true);

    const listed = await niceeval.run(["list"]);
    expect(listed.exitCode, listed.diagnostic()).toBe(0);
    expect(listed.stdout).toMatch(/cjs-default/);
  });
});
