import { command } from "@niceeval/testkit";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { evalE2E } from "./context.ts";

// @feature docs/feature/plugins/README.md
test.concurrent("Plugin 实例与工厂按挂载范围校验条件声明", async () => {
  await evalE2E.case("plugin-authoring", async ({ paths }) => {
    await writeFile(
      join(paths.projectRoot, "plugin-authoring.mjs"),
      `
      import assert from "node:assert/strict";
      import { definePlugin } from "niceeval/plugin";
      import { defineEval, defineExperiment } from "niceeval";
      import { defineAgent, completeEvidenceCoverage } from "niceeval/adapter";
      const adapter = defineAgent({ name: "direct", evidenceCoverage: completeEvidenceCoverage,
        send: async () => ({ status: "completed", events: [] }) });
      const plugin = definePlugin({ name: "condition", identity: {},
        experiment: { before: [() => {}], after: () => {} }, attempt: { after: () => {} } });
      assert.equal(typeof plugin, "object");
      assert.ok(Object.isFrozen(plugin));
      assert.doesNotThrow(() => defineExperiment({ adapter, plugins: [plugin] }));
      assert.throws(() => defineEval({ test() {}, plugins: [plugin] }), /experiment.*eval/);
      const factory = definePlugin((options) => ({ name: "parameter", key: options.key,
        identity: { version: options.version }, attempt: { before() {} } }));
      const instance = factory({ key: "a", version: 1 });
      assert.doesNotThrow(() => defineEval({ test() {}, plugins: [instance] }));
      assert.throws(() => factory(), /exactly one/);
      assert.throws(() => factory({}, {}), /exactly one/);
      for (const oldName of ["behaviorRevision", "instanceKey", "eval"]) {
        assert.throws(() => definePlugin({ name: "old", identity: {}, attempt: { before() {} }, [oldName]: undefined }), new RegExp(oldName));
      }
      for (const oldName of ["setup", "teardown"]) {
        assert.throws(() => definePlugin({ name: "old", identity: {}, experiment: { [oldName]() {} } }), /before.*after/);
      }
      for (const identity of [undefined, [], null, { secret: undefined }, { value: Infinity }]) {
        assert.throws(() => definePlugin({ name: "invalid", identity, attempt: { before() {} } }), /identity/);
      }
      assert.throws(() => definePlugin({ name: "empty", identity: {} }), /behavior/);
    `,
    );
    const result = await command([process.execPath]).run(["plugin-authoring.mjs"], { cwd: paths.projectRoot });
    expect(result.exitCode, result.diagnostic()).toBe(0);
  });
});
