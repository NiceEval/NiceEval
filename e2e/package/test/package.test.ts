// owner: docs/engineering/testing/e2e/package.md#package-commonjs-init-list
// regression: memory/tsx-dynamic-import-require-cycle.md

import { command, withProjectCopy } from "@niceeval/testkit";
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

const niceeval = command([join(process.cwd(), "node_modules", ".bin", "niceeval")]);
const projectCopy = {
  from: join(process.cwd(), "fixtures", "commonjs-init-list"),
  prefix: "niceeval-e2e-package-commonjs-",
  omitTopLevel: ["node_modules"],
  links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
} as const;

test("默认 CommonJS 项目用安装后的候选包完成 init → list", async () => {
  const { root: installedRoot, packageJson } = findInstalledNiceeval();
  for (const field of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"] as const) {
    const dependencies = packageJson[field];
    expect(dependencies?.["@niceeval/testkit"], `package.json ${field}`).toBeUndefined();
  }
  expect(existsSync(join(installedRoot, "packages", "testkit")), "候选包不得携带 packages/testkit").toBe(false);

  await withProjectCopy(projectCopy, async ({ root }) => {
    const initialized = await niceeval.run(["init"], { cwd: root });
    expect(initialized.exitCode, initialized.diagnostic()).toBe(0);
    expect(existsSync(join(root, "niceeval.config.ts"))).toBe(true);

    const listed = await niceeval.run(["list"], { cwd: root });
    expect(listed.exitCode, listed.diagnostic()).toBe(0);
    expect(listed.stdout).toMatch(/cjs-default/);
  });
});
