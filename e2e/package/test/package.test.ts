// feature: docs/engineering/testing/e2e/README.md
//
// 候选包由根 runner 安装在这个仓库外场景 Repo；子目录消费者只通过包名与
// package exports 进入，不引用 NiceEval 源码路径或构建目录。

import { command } from "@niceeval/testkit";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { findInstalledPackageRoot } from "../fixtures/traverse-entries.mjs";

interface ConsumerResult {
  moduleKind: string;
  defineEval: string;
  defineExperiment: string;
}

it.each([
  ["ESM", "esm", "consume.mjs"],
  ["CJS", "cjs", "consume.cjs"],
  ["无 type", "no-type", "consume.js"],
])("安装后的根 export 可由仓库外 %s 消费者加载", async (_label, fixture, entry) => {
  const cwd = join(process.cwd(), "fixtures", fixture);
  const receipt = await command([process.execPath]).run([entry], { cwd });

  expect(receipt.exitCode, receipt.diagnostic()).toBe(0);
  expect(receipt.stderr).toBe("");
  expect(receipt.json<ConsumerResult>()).toEqual({
    moduleKind: fixture,
    defineEval: "function",
    defineExperiment: "function",
  });
});

it("公开 subpath exports 在 optional peers 缺席时仍可加载", async () => {
  const source = [
    'const names = ["niceeval/record", "niceeval/sample", "niceeval/reporters", "niceeval/loaders"];',
    "const loaded = {};",
    "for (const name of names) loaded[name] = Object.keys(await import(name)).length > 0;",
    "console.log(JSON.stringify(loaded));",
  ].join("\n");
  const receipt = await command([process.execPath]).run(["--input-type=module", "--eval", source]);

  expect(receipt.exitCode, receipt.diagnostic()).toBe(0);
  expect(receipt.stderr).toBe("");
  expect(receipt.json<Record<string, boolean>>()).toEqual({
    "niceeval/record": true,
    "niceeval/sample": true,
    "niceeval/reporters": true,
    "niceeval/loaders": true,
  });
});

interface TraversalError {
  code: string;
  message: string;
}

interface TraversalEntry {
  specifier: string;
  exportKey: string;
  status: "loaded" | "dependencyGated" | "failed";
  keysEqual?: boolean;
  importKeys?: string[];
  requireKeys?: string[];
  identity?: { checked: boolean; mismatches: string[] };
  error?: TraversalError;
}

interface TraversalAsset {
  specifier: string;
  exportKey: string;
  status: "ok" | "failed";
  error?: TraversalError;
}

interface TraversalCli {
  status: "ok" | "failed";
  command?: string;
  exitCode?: number;
  cwd?: string;
  stdoutHasUsage?: boolean;
  error?: TraversalError;
}

interface TraversalReport {
  packageName: string;
  packageVersion: string;
  ok: boolean;
  entries: TraversalEntry[];
  assets: TraversalAsset[];
  cli: TraversalCli | null;
  failures: { kind: string; specifier?: string; detail: TraversalError }[];
}

it("raw Node 双面装载安装后 exports 的每个 runtime subpath：keys 一致、根 identity 共享、asset 公开可达、外部 cwd 的 --help 可用", async () => {
  const traversal = join(process.cwd(), "fixtures", "traverse-entries.mjs");
  const receipt = await command([process.execPath]).run([traversal], { cwd: process.cwd() });

  expect(receipt.exitCode, receipt.diagnostic()).toBe(0);
  expect(receipt.stderr).toBe("");
  const report = receipt.json<TraversalReport>();

  expect(report.ok).toBe(true);
  expect(report.packageName).toBe("niceeval");
  expect(report.packageVersion.length).toBeGreaterThan(0);
  expect(report.entries.length).toBeGreaterThan(0);
  expect(report.failures).toEqual([]);

  for (const entry of report.entries) {
    expect(entry.status, entry.specifier).toMatch(/^(loaded|dependencyGated)$/);
    if (entry.status === "loaded") {
      expect(entry.keysEqual, `${entry.specifier} import/require keys`).toBe(true);
    }
  }

  const root = report.entries.find((entry) => entry.specifier === "niceeval");
  expect(root?.status).toBe("loaded");
  expect(root?.keysEqual).toBe(true);
  expect(root?.identity?.checked).toBe(true);
  expect(root?.identity?.mismatches, "根入口 ESM/CJS 函数与类身份").toEqual([]);

  for (const asset of report.assets) {
    expect(asset.status, asset.specifier).toBe("ok");
  }

  expect(report.cli?.status).toBe("ok");
  expect(report.cli?.exitCode).toBe(0);
  expect(report.cli?.stdoutHasUsage).toBe(true);
});

it("import.meta.resolve 不可用时 require.resolve fallback 仍完成同一遍历（filesystem path 统一消费）", async () => {
  const traversal = join(process.cwd(), "fixtures", "traverse-entries.mjs");
  const receipt = await command([process.execPath]).run([traversal], {
    cwd: process.cwd(),
    env: { NICEEVAL_TRAVERSE_USE_REQUIRE_RESOLVE: "1" },
  });

  expect(receipt.exitCode, receipt.diagnostic()).toBe(0);
  expect(receipt.stderr).toBe("");
  const report = receipt.json<TraversalReport>();

  expect(report.ok).toBe(true);
  expect(report.failures).toEqual([]);
  for (const asset of report.assets) {
    expect(asset.status, asset.specifier).toBe("ok");
  }
  const root = report.entries.find((entry) => entry.specifier === "niceeval");
  expect(root?.status).toBe("loaded");
  expect(root?.keysEqual).toBe(true);
  expect(report.cli?.status).toBe("ok");
});

it("仓库外 NodeNext ESM 与 CJS consumer 对根入口与全部公开 runtime subpath 类型检查通过", async () => {
  const receipt = await command(["pnpm"]).run(
    ["exec", "tsc", "-p", "fixtures/type-consumers", "--noEmit"],
    { cwd: process.cwd() },
  );

  expect(receipt.exitCode, receipt.diagnostic()).toBe(0);
  expect(receipt.stderr).toBe("");
});

it("type-consumers 静态 import 清单与安装后 exports 的 object runtime subpath 集合一致", async () => {
  const { packageJson } = findInstalledPackageRoot("niceeval", import.meta.url);
  const objectSubpaths = Object.keys(packageJson.exports ?? {})
    .filter((key) => typeof packageJson.exports[key] === "object" && !key.includes("*"))
    .map((key) => (key === "." ? "niceeval" : `niceeval${key.slice(1)}`))
    .sort();

  const specifiers = new Set<string>();
  for (const file of ["consumer.mts", "consumer.cts"]) {
    const source = readFileSync(join(process.cwd(), "fixtures", "type-consumers", file), "utf8");
    for (const match of source.matchAll(/(?:from\s+["']|require\(\s*["'])(niceeval[^"']*)["']/g)) {
      specifiers.add(match[1]);
    }
  }

  expect([...specifiers].sort()).toEqual(objectSubpaths);
});

it("安装后的候选包不包含也不声明私有 Testkit", () => {
  const { root, packageJson } = findInstalledPackageRoot("niceeval", import.meta.url);
  for (const field of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"] as const) {
    const dependencies = packageJson[field] as Record<string, unknown> | undefined;
    expect(dependencies?.["@niceeval/testkit"], `package.json ${field}`).toBeUndefined();
  }
  expect(existsSync(join(root, "packages", "testkit")), "候选包不得携带 packages/testkit").toBe(false);
});
