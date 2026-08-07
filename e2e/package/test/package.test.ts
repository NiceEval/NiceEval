// feature: docs/engineering/testing/e2e/README.md
//
// 候选包由根 runner 安装在这个仓库外场景 Repo；子目录消费者只通过包名与
// package exports 进入，不引用 NiceEval 源码路径或构建目录。

import { command } from "@niceeval/testkit";
import { join } from "node:path";
import { expect, it } from "vitest";

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
