import { command } from "@niceeval/testkit";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { evalE2E } from "./context.ts";

// @feature docs/feature/adapters/README.md
test.concurrent("内建 Agent 工厂只接受 before 与 after 生命周期声明", async () => {
  await evalE2E.case("agent-lifecycle-authoring", async ({ paths }) => {
    await writeFile(
      join(paths.projectRoot, "agent-lifecycle-authoring.mjs"),
      `
      import assert from "node:assert/strict";
      import { codexAgent, claudeCodeAgent, bubAgent } from "niceeval/adapter";
      for (const factory of [codexAgent, claudeCodeAgent, bubAgent]) {
        assert.doesNotThrow(() => factory({ before: [() => {}], after: [() => {}] }));
        for (const [oldName, newName] of [["postSetup", "before"], ["preTeardown", "after"]]) {
          for (const value of [undefined, [], [() => {}]]) {
            assert.throws(() => factory({ [oldName]: value }), (error) => {
              assert.ok(error instanceof TypeError);
              assert.match(error.message, new RegExp(oldName));
              assert.match(error.message, new RegExp(newName));
              return true;
            }, factory.name + " must reject " + oldName);
          }
        }
      }
    `,
    );
    const result = await command([process.execPath]).run(["agent-lifecycle-authoring.mjs"], {
      cwd: paths.projectRoot,
    });
    expect(result.exitCode, result.diagnostic()).toBe(0);
  });
});

// @feature docs/feature/experiments/README.md
test.concurrent("Experiment 与自定义 Agent 明确拒绝旧生命周期字段", async () => {
  await evalE2E.case("author-lifecycle-names", async ({ paths }) => {
    await writeFile(
      join(paths.projectRoot, "author-lifecycle-names.mjs"),
      `
      import assert from "node:assert/strict";
      import { defineExperiment } from "niceeval";
      import { defineAgent, defineSandboxAgent, completeEvidenceCoverage } from "niceeval/adapter";
      const spec = { name: "lifecycle", evidenceCoverage: completeEvidenceCoverage,
        send: async () => ({ status: "completed", events: [] }) };
      const agent = defineAgent({ ...spec, before: () => {}, after: () => {} });
      assert.equal(typeof agent.before, "function");
      assert.equal(typeof agent.after, "function");
      const experiment = defineExperiment({ adapter: agent, before: () => {}, after: () => {} });
      assert.equal(typeof experiment.before, "function");
      assert.equal(typeof experiment.after, "function");
      for (const factory of [defineAgent, defineSandboxAgent, defineExperiment]) {
        for (const [previous, current] of [["setup", "before"], ["teardown", "after"]]) {
          for (const value of [undefined, () => {}]) {
            assert.throws(() => factory({ ...spec, adapter: agent, [previous]: value }), (error) => {
              assert.ok(error instanceof TypeError);
              assert.match(error.message, new RegExp(previous));
              assert.match(error.message, new RegExp(current));
              return true;
            });
          }
        }
      }
    `,
    );
    const result = await command([process.execPath]).run(["author-lifecycle-names.mjs"], { cwd: paths.projectRoot });
    expect(result.exitCode, result.diagnostic()).toBe(0);
  });
});
