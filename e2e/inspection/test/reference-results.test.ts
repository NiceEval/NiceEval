import { writeFile, mkdir, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { inspectionCaseArtifacts, inspectionE2E } from "./support.ts";

// @feature docs/feature/inspection/README.md
// @issue docs/issues/show-overview-hides-previous-results-on-identity-gap.md
test.concurrent("身份缺口的参照摘要显示判定分布、通过率和得分", async () => {
  await inspectionE2E.case("reference-results", { artifacts: inspectionCaseArtifacts() }, async ({ commands: { niceeval }, paths: { projectRoot } }) => {
    for (const dir of ["evals", "experiments"]) {
      await rm(join(projectRoot, dir), { recursive: true });
      await mkdir(join(projectRoot, dir));
    }
    for (const [kind, evals] of [["pass", ["pass", "fail"]], ["score", ["score"]]] as const) await writeFile(join(projectRoot, `experiments/reference-${kind}.ts`), `
import { defineExperiment } from "niceeval";
import { defineAgent, completeEvidenceCoverage } from "niceeval/adapter";
export default defineExperiment({ evals: ${JSON.stringify(evals)}, adapter: defineAgent({ name: "reference", evidenceCoverage: completeEvidenceCoverage, send: async () => ({ status: "completed", events: [] }) }) });
`);
    for (const [id, body] of [["pass", 'defineEval({ test(t) { t.check(true, equals(true)); } })'], ["fail", 'defineEval({ test(t) { t.check(false, equals(true)); } })'], ["score", 'defineScoreEval({ test(t) { t.score(3); t.check(false, equals(true)).score(1); } })']]) {
      await writeFile(join(projectRoot, `evals/${id}.eval.ts`), `import { defineEval, defineScoreEval } from "niceeval";\nimport { equals } from "niceeval/expect";\nexport default ${body};\n`);
    }
    const run = await niceeval.run(["exp", "reference-pass", "reference-score", "--json"]);
    expect(run.expReceipt().completion, run.diagnostic()).toBe("completed");
    expect(run.expEvalEvents()).toHaveLength(3);
    for (const id of ["pass", "fail", "score"]) {
      const path = join(projectRoot, `evals/${id}.eval.ts`);
      await writeFile(path, (await readFile(path, "utf8")).replace('test(t) {', 'test(t) { const changed = 1;'));
    }
    for (const argv of [["show"], ["show", "--reference"]]) {
      const shown = await niceeval.run(argv);
      expect(shown.exitCode, shown.diagnostic()).toBe(0);
      const summary = shown.stdout.split("Reference results (from previous recorded attempts)")[1];
      expect(summary, shown.diagnostic()).toBeDefined();
      expect(summary).toMatch(/Previous attempts\s+3 of 3 gaps/u);
      expect(summary).toMatch(/Verdicts\s+2 passed; 1 failed; 0 errored; 0 skipped/u);
      expect(summary).toMatch(/Pass rate\s+50%/u);
      expect(summary).toMatch(/Score\s+3\/4/u);
      for (const event of run.expEvalEvents()) {
        const locator = event.locator.startsWith("@") ? event.locator : `@${event.locator}`;
        expect(shown.stdout).toContain(`Previous result ${locator} (${event.verdict}${event.evalId === "score" ? ", 3/4" : ""})`);
      }
    }
  });
});
