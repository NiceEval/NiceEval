import { command } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { evalE2E } from "./context.ts";

// @feature docs/feature/experiments/README.md
test.concurrent("Experiment 使用 adapter 并拒绝 agent 字段", async () => {
  await evalE2E.case("adapter-selection", async ({ paths }) => {
    const result = await command([process.execPath]).run(
      [
        "--input-type=module",
        "--eval",
        `
      import assert from "node:assert/strict";
      import { defineExperiment, defineAdapter } from "niceeval";
      const adapter = defineAdapter({ name: "selection", create: () => ({}) });
      assert.equal(defineExperiment({ adapter }).adapter, adapter);
      for (const agent of [undefined, adapter]) {
        assert.throws(() => defineExperiment({ adapter, agent }), /agent.*adapter/);
      }
    `,
      ],
      { cwd: paths.projectRoot },
    );
    expect(result.exitCode, result.diagnostic()).toBe(0);
  });
});
