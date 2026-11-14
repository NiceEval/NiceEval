import { command } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { evalE2E } from "./context.ts";

// @feature docs/feature/experiments/README.md
test.concurrent("作者定义拒绝撤销字段并提供替代方式", async () => {
  await evalE2E.case("retired-author-fields", async ({ paths }) => {
    const result = await command([process.execPath]).run(
      [
        "--input-type=module",
        "--eval",
        `
      import assert from "node:assert/strict";
      import { createRequire } from "node:module";
      import * as api from "niceeval";
      import { defineConfig, defineExperiment, defineEval, defineAdapter } from "niceeval";
      const require = createRequire(import.meta.url);
      assert.equal("defineModelSlots" in api, false);
      assert.equal(typeof require("niceeval").defineModelRoles, "function");
      const adapter = defineAdapter({ name: "retired-fields", create: () => ({}) });
      const { bubAgent } = await import("niceeval/adapter");
      for (const value of [undefined, "old"]) {
        assert.throws(() => defineConfig({ judgeRuntime: value }), /judgeRuntime.*judgeProvider/);
        assert.throws(() => defineExperiment({ adapter, judgeRuntime: value }), /judgeRuntime.*judge/);
        assert.throws(() => defineConfig({ sandboxCache: { setup: value } }), /sandboxCache.setup.*sandboxCache.before/);
        assert.throws(() => bubAgent({ apiBase: value }), /apiBase.*baseUrl/);
      }
      assert.equal(defineConfig({ sandboxCache: { before: "bypass" } }).sandboxCache.before, "bypass");
      for (const value of [undefined, []]) {
        assert.throws(() => defineEval({ reporters: value, test() {} }), /reporters.*Config.reporters/);
        assert.throws(() => defineConfig({ workspace: value }), /workspace.*project/);
        assert.throws(() => defineExperiment({ adapter, classifyFailure: value }), /classifyFailure.*ExperimentFatalError.*EvalFatalError/);
      }
    `,
      ],
      { cwd: paths.projectRoot },
    );
    expect(result.exitCode, result.diagnostic()).toBe(0);
  });
});
