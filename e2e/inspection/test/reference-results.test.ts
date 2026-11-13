import { writeFile, mkdir, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { inspectionCaseArtifacts, inspectionE2E } from "./support.ts";

// @use-case docs/feature/inspection/use-case/inspection-results-after-identity-change.md
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
export default defineExperiment({ evals: ${JSON.stringify(evals)}, flags: { alpha: "before", beta: "before", removed: "gone", zeta: "before" }, adapter: defineAgent({ name: "reference", evidenceCoverage: completeEvidenceCoverage, send: async () => ({ status: "completed", events: [] }) }) });
`);
    for (const [id, body] of [["pass", 'defineEval({ test(t) { t.check(true, equals(true)); } })'], ["fail", 'defineEval({ test(t) { t.check(false, equals(true)); } })'], ["score", 'defineScoreEval({ test(t) { t.score(3); t.check(false, equals(true)).score(1); } })']]) {
      await writeFile(join(projectRoot, `evals/${id}.eval.ts`), `import { defineEval, defineScoreEval } from "niceeval";\nimport { equals } from "niceeval/expect";\nexport default ${body};\n`);
    }
    const run = await niceeval.run(["exp", "--experiment", "reference-pass", "--experiment", "reference-score", "--json"]);
    expect(run.expReceipt().completion, run.diagnostic()).toBe("completed");
    expect(run.expEvalEvents()).toHaveLength(3);
    for (const kind of ["pass", "score"]) {
      const path = join(projectRoot, `experiments/reference-${kind}.ts`);
      await writeFile(path, (await readFile(path, "utf8")).replace('alpha: "before", beta: "before", removed: "gone", zeta: "before"', 'added: "new", alpha: "after", beta: "after", zeta: "after"'));
    }
    const shared = await niceeval.run(["show"]);
    expect(shared.exitCode, shared.diagnostic()).toBe(0);
    expect(shared.stdout).toMatch(/Changed\s+config:flags.added \(new; added\) · all 2 gaps/u);
    expect(shared.stdout).toMatch(/Changed\s+config:flags.alpha \(before → after\)/u);
    expect(shared.stdout).toMatch(/Changed\s+config:flags.beta \(before → after\)/u);
    expect(shared.stdout).toContain("+2 more");
    expect(shared.stdout.match(/config:flags.alpha/gu)).toHaveLength(2);
    for (const id of ["pass", "fail", "score"]) {
      const path = join(projectRoot, `evals/${id}.eval.ts`);
      await writeFile(path, (await readFile(path, "utf8")).replace('test(t) {', 'test(t) { const changed = 1;'));
    }
    for (const argv of [["show"], ["show", "--reference"]]) {
      const shown = await niceeval.run(argv);
      expect(shown.exitCode, shown.diagnostic()).toBe(0);
      expect(shown.stdout).not.toContain("all 2 gaps");
      expect(shown.stdout.match(/config:flags.alpha/gu)).toHaveLength(3);
      expect(shown.stdout).toContain("+3 more");
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
