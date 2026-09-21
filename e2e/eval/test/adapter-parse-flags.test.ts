// rerun: pnpm e2e test --repo eval -- --run test/adapter-parse-flags.test.ts
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { command } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { evalE2E } from "./context.ts";

test.concurrent("Adapter flags 在资源启动前校验并交付一次解析的冻结结果 [necase_QEKQEJ7MT6QQKQW4]", async () => {
  await evalE2E.case("adapter-parse-flags", async ({ paths: { projectRoot }, commands: { niceeval } }) => {
    await writeFile(join(projectRoot, "flat-flags.mjs"), `
      import assert from 'node:assert/strict';
      import { defineAdapter, defineExperiment } from 'niceeval';
      import { completeEvidenceCoverage, defineAgent } from 'niceeval/adapter';
      const plain = defineAdapter({ name: 'flat', create() { throw new Error('must not create'); } });
      const agent = defineAgent({ name: 'flat-agent', evidenceCoverage: completeEvidenceCoverage, send() { throw new Error('must not send'); } });
      let parses = 0;
      const parser = defineAdapter({ name: 'parsed', parseFlags(value) {
        parses++;
        assert.equal(Object.isFrozen(value), true);
        return value;
      }, create() { throw new Error('must not create'); } });
      const invalid = [null, [], 1, new Date(), Object.create({ x: true }),
        { x: null }, { x: undefined }, { x: [] }, { x: {} }, { x: NaN }, { x: Infinity },
        { x() {} }, { [Symbol('x')]: true }, Object.defineProperty({}, 'x', { value: true }),
        Object.defineProperty({}, 'x', { enumerable: true, get() { throw new Error('accessor invoked'); } }),
      ];
      for (const flags of invalid) {
        for (const selection of [{ adapter: plain }, { agent }, { adapter: parser }]) {
          assert.throws(() => defineExperiment({ ...selection, flags }), /flags/);
        }
      }
      assert.equal(parses, 0, 'invalid input must not enter the parser');
      for (const value of invalid) {
        const badOutput = defineAdapter({ name: 'bad-output', parseFlags: () => value, create: () => ({}) });
        assert.throws(() => defineExperiment({ adapter: badOutput }), /flags/);
      }
      const supplied = { mode: 'baseline', count: 0, enabled: false };
      for (const selection of [{ adapter: plain }, { agent }, { adapter: parser }]) {
        const defined = defineExperiment({ ...selection, flags: supplied });
        assert.deepEqual(defined.flags, supplied);
        assert.notEqual(defined.flags, supplied);
        assert.equal(Object.isFrozen(defined.flags), true);
      }
      assert.equal(parses, 1);
      const output = { enabled: true };
      const normalizing = defineAdapter({ name: 'copy-output', parseFlags(value) {
        assert.deepEqual(value, {});
        return output;
      }, create: () => ({}) });
      const defined = defineExperiment({ adapter: normalizing });
      output.enabled = false;
      assert.deepEqual(defined.flags, { enabled: true });
      assert.equal(Object.isFrozen(defined.flags), true);
    `);
    const flat = await command([process.execPath]).run(["flat-flags.mjs"], { cwd: projectRoot });
    expect(flat.exitCode, flat.diagnostic()).toBe(0);

    for (const [mode, input] of [
      ["", '{"strategy":"typo"}'], ["", '{"unknown":true}'],
      ...["nested", "null", "promise", "thenable", "date", "undefined", "nan", "array", "sparse", "symbol", "getter", "cycle"].map((mode) => [mode, "{}"]),
    ]) {
      const invalid = await niceeval.run(["exp", "parsed-flags", "--json"], {
        env: { NICEEVAL_E2E_FLAGS_MODE: mode, NICEEVAL_E2E_FLAGS_INPUT: input },
      });
      expect(invalid.exitCode, invalid.diagnostic()).not.toBe(0);
      expect(invalid.stdout + invalid.stderr).toContain("flags");
      await expect(readFile(join(projectRoot, "flags-lifecycle.txt"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    }
    const valid = await niceeval.run(["exp", "parsed-flags", "--json"]);
    expect(valid.exitCode, valid.diagnostic()).toBe(0);
    expect(valid.expEvalEvents()).toEqual([expect.objectContaining({ evalId: "parsed-flags", verdict: "passed" })]);
    expect(await readFile(join(projectRoot, "flags-lifecycle.txt"), "utf8")).toBe("setup\ncreate\n");

    // Keep the public Library process alive through rejection notification.
    await writeFile(join(projectRoot, "async-parser.mjs"), `
      import assert from 'node:assert/strict';
      import { defineAdapter, defineExperiment } from 'niceeval';
      const unhandled = [];
      process.on('unhandledRejection', (error) => unhandled.push(error));
      for (const validate of [
        () => Promise.reject(new Error('promise')),
        () => ({ then(resolve, reject) { reject(new Error('thenable')); } }),
        () => ({ then() { throw new Error('thenable threw'); } }),
      ]) {
        const adapter = defineAdapter({ name: 'async', parseFlags: validate, create() { throw new Error('must not create'); } });
        assert.throws(() => defineExperiment({ adapter }), /synchronous/);
      }
      await new Promise((resolve) => setImmediate(resolve));
      assert.deepEqual(unhandled, []);
    `);
    const asynchronous = await command([process.execPath]).run(["async-parser.mjs"], { cwd: projectRoot });
    expect(asynchronous.exitCode, asynchronous.diagnostic()).toBe(0);

    // An inherited or copied brand must not bypass the Experiment input boundary.
    for (const copied of [false, true]) {
      await writeFile(join(projectRoot, "experiments", "derived-flags.ts"), `
        import { defineExperiment } from 'niceeval';
        import { flagsAdapter } from '../fixtures/adapter-parse-flags.ts';
        const base = defineExperiment({ adapter: flagsAdapter, evals: ['parsed-flags'] });
        const descriptors = ${copied ? "Object.getOwnPropertyDescriptors(base)" : "Object.getOwnPropertyDescriptors({ ...base })"};
        descriptors.flags = { value: { nested: { enabled: true } }, enumerable: true };
        export default Object.create(${copied ? "Object.prototype" : "base"}, descriptors);
      `);
      const derived = await niceeval.run(["exp", "derived-flags", "--dry", "--json"]);
      expect(derived.exitCode, derived.diagnostic()).not.toBe(0);
      expect(derived.stdout + derived.stderr).toContain("defineExperiment");
    }
  });
});
