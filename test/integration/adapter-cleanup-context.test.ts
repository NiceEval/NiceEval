import fc from "fast-check";
import { beforeAll, expect, test } from "vitest";
import { createFixtureProject, readJson, runSingleAttempt } from "./fixtures/adapter-trace-usage-harness/harness.ts";

const observations: Array<{ count: number; rows: Array<{ frozen: boolean; independent: boolean; live: boolean; shared: boolean; timeoutMs: number }> }> = [];
beforeAll(async () => {
  for (const count of [1, ...fc.sample(fc.integer({ min: 2, max: 4 }), { seed: 450027, numRuns: 2 })]) {
    const project = await createFixtureProject("cleanup-context", {
      "niceeval.config.ts": "export default {};",
      "evals/one.eval.ts": `import { adapter } from "../adapter.ts"; export default adapter.defineEval({ async test() {} });`,
      "experiments/one.ts": `import { defineExperiment } from "niceeval"; import { adapter } from "../adapter.ts"; export default defineExperiment({ evals: ["one"], adapter });`,
      "adapter.ts": `import { writeFile } from "node:fs/promises";
        import { defineAdapter } from "niceeval/adapter";
        export const adapter = defineAdapter({ name: "cleanup", cleanupTimeoutMs: 1000,
          create(ctx) { const rows = []; let first;
            for (let i = 0; i < ${count}; i++) ctx.onCleanup(async cleanup => {
              first ??= cleanup;
              rows.push({ frozen: Object.isFrozen(cleanup), independent: cleanup.signal !== ctx.signal,
                live: !cleanup.signal.aborted, shared: first === cleanup, timeoutMs: cleanup.timeoutMs });
              await writeFile(new URL("./cleanup.json", import.meta.url), JSON.stringify(rows));
            }); return {};
          } });`,
    });
    try {
      await runSingleAttempt(project.cwd, "one");
      observations.push({ count, rows: await readJson(project.cwd, "cleanup.json") });
    } finally { await project.dispose(); }
  }
}, 15_000);

// @feature docs/feature/eval/architecture.md
// Reduced regression: one successful Attempt and one cleanup callback.
test("Adapter cleanup callbacks share a frozen context with an independent live signal", () => {
  for (const { count, rows } of observations) {
    expect(rows).toEqual(Array.from({ length: count }, () => ({ frozen: true, independent: true, live: true, shared: true, timeoutMs: 1000 })));
  }
});
