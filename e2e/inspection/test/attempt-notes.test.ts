import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { inspectionE2E } from "./support.ts";

// @feature docs/feature/inspection/README.md
test.concurrent("实验按标签和单位聚合数值 Note，忽略空值与非数值", async () => {
  await inspectionE2E.case("attempt-notes", async ({ paths: { projectRoot }, commands: { niceeval } }) => {
    await writeFile(join(projectRoot, "adapters", "notes.ts"), `
      import { defineAdapter } from "niceeval";
      export const adapter = defineAdapter({ name: "notes", create: () => ({}) });
    `);
    await writeFile(join(projectRoot, "experiments", "notes.ts"), `
      import { defineExperiment } from "niceeval";
      import { adapter } from "../adapters/notes.ts";
      export default defineExperiment({ adapter, evals: (evaluation) => evaluation.id.startsWith("notes/") });
    `);
    await writeFile(join(projectRoot, "evals", "notes.eval.ts"), `
      import { adapter } from "../adapters/notes.ts";
      import { ms, seconds } from "niceeval/expect";
      export default {
        fast: adapter.defineEval({ test(t) { t.note("latency", ms(100)); t.note("load", 2); t.note("metadata", { ready: true }); } }),
        slow: adapter.defineEval({ test(t) { t.note("latency", ms(300)); t.note("load", 4); } }),
        otherUnit: adapter.defineEval({ test(t) { t.note("latency", seconds(2)); } }),
        noUnit: adapter.defineEval({ test(t) { t.note("latency", 50); } }),
        missing: adapter.defineEval({ test(t) { t.note("latency", null); t.note("metadata", "missing"); } }),
      };
    `);
    const run = await niceeval.run(["exp", "notes", "--rerun", "all", "--json"]);
    expect(run.exitCode, run.diagnostic()).toBe(0);
    expect(run.expEvalEvents()).toHaveLength(5);

    const read = await niceeval.run(["show", `exp:${"notes"}`, "--json"]);
    expect(read.exitCode, read.diagnostic()).toBe(0);
    const notes = read.inspectionSuccess("experiment.get").experiment.notes;
    expect(notes).toHaveLength(4);
    expect(notes).toEqual(expect.arrayContaining([
      { label: "latency", unit: "ms", count: 2, min: 100, median: 200, p90: 280, max: 300 },
      { label: "latency", unit: "seconds", count: 1, min: 2, median: 2, p90: 2, max: 2 },
      { label: "latency", count: 1, min: 50, median: 50, p90: 50, max: 50 },
      { label: "load", count: 2, min: 2, median: 3, p90: 3.8, max: 4 },
    ]));
    const show = await niceeval.run(["show", `exp:${"notes"}`]);
    expect(show.exitCode, show.diagnostic()).toBe(0);
    expect(show.stdout).toContain("Notes");
    expect(show.stdout).toContain("Median");
    expect(show.stdout).toContain("280 ms");
  });
});
