import { command } from "@niceeval/testkit";
import { access, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { evalE2E } from "./context.ts";

// @feature docs/feature/adapters/README.md
// @regression memory/shared-model-purpose-requirements.md
test.concurrent("共享用途要求在计划前拒绝缺失且同一 Eval 可复用不同模型", async () => {
  await evalE2E.case("required-model-roles", async ({ paths, commands: { niceeval } }) => {
    await writeFile(
      join(paths.projectRoot, "fixtures/required-purposes.ts"),
      `
      import { defineAdapter, defineModelRoles } from "niceeval";
      export const purposes = defineModelRoles({ mind: { model: "fixture/mind" }, speech: { model: "fixture/speech" } });
      export const adapter = defineAdapter({ name: "required-purposes", create() { return { observed: () => true }; } });
    `,
    );
    await writeFile(
      join(paths.projectRoot, "evals/required-purposes.eval.ts"),
      `
      import { isTrue } from "niceeval/expect";
      import { adapter, purposes } from "../fixtures/required-purposes.ts";
      export default adapter.defineEval({ requires: { models: purposes }, test(t) { t.check(t.observed(), isTrue()).gate(); } });
    `,
    );
    const experiment = join(paths.projectRoot, "experiments/required-purposes.ts");
    await writeFile(
      experiment,
      `
      import { defineExperiment } from "niceeval";
      import { adapter } from "../fixtures/required-purposes.ts";
      export default defineExperiment({ adapter, models: { mind: { model: "fixture/mind" } }, evals: ["required-purposes"] });
    `,
    );
    const missing = await niceeval.run(["exp", "required-purposes", "--dry", "--json"]);
    expect(missing.exitCode, missing.diagnostic()).not.toBe(0);
    expect(missing.stdout + missing.stderr).toContain("speech");
    expect(missing.stdout + missing.stderr).toContain("required-purposes");
    const filtered = await niceeval.run(["exp", "required-purposes", "--dry", "--tag", "not-selected", "--json"]);
    expect(filtered.exitCode, filtered.diagnostic()).not.toBe(0);
    expect(filtered.stdout + filtered.stderr).toContain("speech");
    await writeFile(
      join(paths.projectRoot, "required-purposes-sdk.mjs"),
      `
      import assert from "node:assert/strict";
      import { Cause, Effect, Exit } from "effect";
      import { experimentHost } from "niceeval/experiment/host";
      import { defineAdapter, defineModelRoles } from "niceeval";
      const input = { mind: { model: "fixture/mind" } };
      const shared = defineModelRoles(input);
      assert.ok(Object.isFrozen(shared) && Object.isFrozen(shared.mind));
      assert.equal(Object.isFrozen(input), false);
      input.mind.model = "fixture/changed";
      assert.equal(shared.mind.model, "fixture/mind");
      for (const requires of [null, {}, { models: {} }, { models: shared, extra: true }]) {
        assert.throws(() => defineAdapter({ name: "invalid", requires, create: () => ({}) }));
      }
      const bound = defineAdapter({ name: "valid", create: () => ({}) });
      assert.throws(() => bound.defineEval({ requires: { models: shared, extra: true }, test() {} }));
      const exit = await Effect.runPromiseExit(experimentHost.invocation.plan({
        cwd: process.cwd(), experimentSelector: "required-purposes", config: {},
      }));
      assert.ok(Exit.isFailure(exit));
      assert.match(Cause.pretty(exit.cause), /speech/);
    `,
    );
    const sdk = await command([process.execPath]).run(["required-purposes-sdk.mjs"], { cwd: paths.projectRoot });
    expect(sdk.exitCode, sdk.diagnostic()).toBe(0);
    await expect(access(join(paths.projectRoot, ".niceeval/record.sqlite"))).rejects.toThrow();
    await writeFile(
      experiment,
      `
      import { defineExperiment } from "niceeval";
      import { adapter, purposes } from "../fixtures/required-purposes.ts";
      export default defineExperiment({ adapter, models: purposes, evals: ["required-purposes"] });
    `,
    );
    const first = await niceeval.run(["exp", "required-purposes", "--json"]);
    expect(first.exitCode, first.diagnostic()).toBe(0);
    expect(first.expEvalEvents().map((event) => event.verdict)).toEqual(["passed"]);
    await writeFile(
      experiment,
      `
      import { defineExperiment } from "niceeval";
      import { adapter } from "../fixtures/required-purposes.ts";
      export default defineExperiment({ adapter, models: { mind: { model: "fixture/other" }, speech: { model: "fixture/other-speech" } }, evals: ["required-purposes"] });
    `,
    );
    const second = await niceeval.run(["exp", "required-purposes", "--json"]);
    expect(second.exitCode, second.diagnostic()).toBe(0);
    expect(second.expEvalEvents().map((event) => event.verdict)).toEqual(["passed"]);
  });
});
