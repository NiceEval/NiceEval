// rerun: pnpm e2e test --repo eval -- --run test/adapter-parse-flags.test.ts
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { command } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { evalE2E } from "./context.ts";

test.concurrent("Adapter flags 在资源启动前校验并交付一次解析的冻结结果 [necase_QEKQEJ7MT6QQKQW4]", async () => {
  await evalE2E.case("adapter-parse-flags", async ({ paths: { projectRoot }, commands: { niceeval } }) => {
    for (const [mode, input] of [
      ["", '{"strategy":"typo"}'], ["", '{"unknown":true}'],
      ...["promise", "thenable", "date", "undefined", "nan", "array", "sparse", "symbol", "getter", "cycle"].map((mode) => [mode, "{}"]),
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
  });
});
