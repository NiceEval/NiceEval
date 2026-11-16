import { writeFile, mkdir, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import { inspectionCaseArtifacts, inspectionE2E } from "./support.ts";

// @use-case docs/feature/inspection/use-case/inspection-results-after-identity-change.md
// @issue docs/issues/show-overview-hides-previous-results-on-identity-gap.md
test.concurrent("身份缺口的参照摘要显示判定分布、通过率和得分", async ({ expect }) => {
  await inspectionE2E.case(
    "reference-results",
    { artifacts: inspectionCaseArtifacts() },
    async ({ commands: { niceeval }, paths: { projectRoot } }) => {
      for (const dir of ["evals", "experiments"]) {
        await rm(join(projectRoot, dir), { recursive: true });
        await mkdir(join(projectRoot, dir));
      }
      for (const [kind, evals] of [
        ["pass", ["pass", "fail"]],
        ["score", ["score"]],
      ] as const)
        await writeFile(
          join(projectRoot, `experiments/reference-${kind}.ts`),
          `
import { defineExperiment } from "niceeval";
import { defineAgent, completeEvidenceCoverage } from "niceeval/adapter";
export default defineExperiment({ evals: ${JSON.stringify(evals)}, flags: { alpha: "before", beta: "before", removed: "gone", zeta: "before" }, adapter: defineAgent({ name: "reference", evidenceCoverage: completeEvidenceCoverage, send: async () => ({ status: "completed", events: [] }) }) });
`,
        );
      for (const [id, body] of [
        ["pass", "defineEval({ test(t) { t.check(true, equals(true)); } })"],
        ["fail", "defineEval({ test(t) { t.check(false, equals(true)); } })"],
        ["score", "defineScoreEval({ test(t) { t.score(3); t.check(false, equals(true)).score(1); } })"],
      ]) {
        await writeFile(
          join(projectRoot, `evals/${id}.eval.ts`),
          `import { defineEval, defineScoreEval } from "niceeval";\nimport { equals } from "niceeval/expect";\nexport default ${body};\n`,
        );
      }
      const run = await niceeval.run([
        "exp",
        "--experiment",
        "reference-pass",
        "--experiment",
        "reference-score",
        "--json",
      ]);
      expect(run.expReceipt().completion, run.diagnostic()).toBe("completed");
      expect(run.expEvalEvents()).toHaveLength(3);
      for (const kind of ["pass", "score"]) {
        const path = join(projectRoot, `experiments/reference-${kind}.ts`);
        await writeFile(
          path,
          (await readFile(path, "utf8")).replace(
            'alpha: "before", beta: "before", removed: "gone", zeta: "before"',
            'added: "new", alpha: "after", beta: "after", zeta: "after"',
          ),
        );
      }
      const overview = await niceeval.run(["show"]);
      expect(overview.exitCode, overview.diagnostic()).toBe(0);
      expect(overview.stdout).toContain("Earlier results for these");
      expect(overview.stdout).toMatch(/reference-pass  2 need a run · Needs rerun: config:flags.added/u);
      expect(overview.stdout).not.toMatch(/\bgaps?\b/iu);
      expect(overview.stdout).not.toContain("Previous result @");
      const shared = await niceeval.run(["show", "exp:reference-pass"]);
      expect(shared.exitCode, shared.diagnostic()).toBe(0);
      expect(shared.stdout).toMatch(/Changed\s+config:flags.added \(new; added\) · all 2 attempts/u);
      expect(shared.stdout).toMatch(/Changed\s+config:flags.alpha \(before → after\)/u);
      expect(shared.stdout).toMatch(/Changed\s+config:flags.beta \(before → after\)/u);
      expect(shared.stdout).toContain("+2 more");
      expect(shared.stdout.match(/Changed\s+config:flags.alpha/gu)).toHaveLength(1);
      for (const id of ["pass", "fail", "score"]) {
        const path = join(projectRoot, `evals/${id}.eval.ts`);
        await writeFile(path, (await readFile(path, "utf8")).replace("test(t) {", "test(t) { const changed = 1;"));
      }
      for (const argv of [["show", "exp:reference-pass", "exp:reference-score"]]) {
        const shown = await niceeval.run(argv);
        expect(shown.exitCode, shown.diagnostic()).toBe(0);
        if (argv.length > 1) {
          expect(shown.stdout).not.toContain("all 2 attempts");
          expect(shown.stdout.match(/Changed\s+config:flags.alpha/gu)).toHaveLength(3);
          expect(shown.stdout).toContain("+3 more");
        }
        const summary = shown.stdout.split("Earlier results for these")[1];
        expect(summary, shown.diagnostic()).toBeDefined();
        expect(summary).toMatch(/Previous attempts\s+3 of 3 needing a run/u);
        expect(summary).toMatch(/Verdicts\s+2 passed; 1 failed; 0 errored; 0 skipped/u);
        expect(summary).toMatch(/Pass rate\s+50%/u);
        expect(summary).toMatch(/Score\s+3\/4/u);
        for (const event of run.expEvalEvents()) {
          const locator = event.locator.startsWith("@") ? event.locator : `@${event.locator}`;
          expect(shown.stdout).toContain(
            `Previous result ${locator} (${event.verdict}${event.evalId === "score" ? ", 3/4" : ""})`,
          );
        }
      }
      for (const kind of ["pass", "score"]) {
        const path = join(projectRoot, `experiments/reference-${kind}.ts`);
        await writeFile(
          path,
          (await readFile(path, "utf8")).replace(
            'added: "new", alpha: "after", beta: "after", zeta: "after"',
            'alpha: "before", beta: "before", removed: "gone", zeta: "before"',
          ),
        );
      }
      const sourceOnly = await niceeval.run(["show", "exp:reference-pass"]);
      expect(sourceOnly.exitCode, sourceOnly.diagnostic()).toBe(0);
      expect(sourceOnly.stdout).toMatch(/Changed\s+source:evals\/pass.eval.ts \([a-f0-9]{8} → [a-f0-9]{8}\)/u);
      for (const kind of ["pass", "score"]) {
        const path = join(projectRoot, `experiments/reference-${kind}.ts`);
        await writeFile(
          path,
          (await readFile(path, "utf8")).replace(
            'alpha: "before", beta: "before", removed: "gone", zeta: "before"',
            'zeta: "before"',
          ),
        );
      }
      const removed = await niceeval.run(["show", "exp:reference-pass"]);
      expect(removed.exitCode, removed.diagnostic()).toBe(0);
      expect(removed.stdout).toMatch(/Changed\s+config:flags.removed \(gone; removed\)/u);
    },
  );
});

// @use-case docs/feature/inspection/use-case/inspection-results-after-identity-change.md
test.concurrent("Score 身份缺口保持有界概览并在 Experiment 中合并结构化变更路径", async ({ expect }) => {
  await inspectionE2E.case(
    "score-gap-overview",
    { artifacts: inspectionCaseArtifacts() },
    async ({ commands: { niceeval }, paths: { projectRoot } }) => {
      for (const dir of ["evals", "experiments"]) {
        await rm(join(projectRoot, dir), { recursive: true });
        await mkdir(join(projectRoot, dir));
      }
      for (const id of ["one", "two", "three", "four"]) {
        await writeFile(
          join(projectRoot, `evals/${id}.eval.ts`),
          'import { defineScoreEval } from "niceeval"; export default defineScoreEval({ test(t) { t.score(3); } });\n',
        );
      }
      for (const [id, evals] of [
        ["small", ["one"]],
        ["medium", ["one", "two"]],
        ["large", ["one", "two", "three"]],
        ["largest", ["one", "two", "three", "four"]],
      ] as const) {
        await writeFile(
          join(projectRoot, `experiments/${id}.ts`),
          `import { defineExperiment } from "niceeval";
import { shell } from "niceeval/sandbox";
import { deterministicAgent, deterministicSandbox } from "../agents/deterministic.ts";
export default defineExperiment({ evals: ${JSON.stringify(evals)}, flags: { candidate: "before" },
sandbox: deterministicSandbox.before(shell({ id: "prepare-reference", command: "true # before ${"x".repeat(600)}" })),
adapter: deterministicAgent() });\n`,
        );
      }
      const run = await niceeval.run(["exp", "--json"]);
      expect(run.expReceipt().completion, run.diagnostic()).toBe("completed");
      expect(run.expEvalEvents()).toHaveLength(10);
      for (const id of ["small", "medium", "large", "largest"]) {
        const path = join(projectRoot, `experiments/${id}.ts`);
        await writeFile(
          path,
          (await readFile(path, "utf8"))
            .replace('candidate: "before"', 'candidate: "after"')
            .replace("true # before ", "true # after "),
        );
      }
      const overview = await niceeval.run(["show"]);
      expect(overview.exitCode, overview.diagnostic()).toBe(0);
      expect(overview.stdout).toMatch(/Previous attempts\s+10 of 10 needing a run/u);
      expect(overview.stdout).toMatch(/Score\s+30\/30/u);
      expect.soft(overview.stdout).not.toContain("Pass rate");
      expect.soft(overview.stdout).not.toMatch(/\bgaps?\b/iu);
      expect.soft(overview.stdout).not.toContain("Changed");
      expect.soft(overview.stdout).not.toContain("Previous result @");
      expect.soft(overview.stdout).not.toContain('"template"');
      for (const [id, count] of [
        ["small", 1],
        ["medium", 2],
        ["large", 3],
        ["largest", 4],
      ] as const) {
        expect
          .soft(overview.stdout)
          .toMatch(new RegExp(`${id}  ${count} need a run · .*config:flags.candidate.*plan:physical`, "u"));
      }
      const next = overview.stdout.split("\n").filter((line) => /^(?:Next:|\s*\+\d+ more:|\s+niceeval )/u.test(line));
      expect
        .soft(next)
        .toEqual(["  niceeval exp largest --dry", "  niceeval exp large --dry", "  +2 more: niceeval show exp:medium"]);
      const detailed = await niceeval.run(["show", "exp:largest"]);
      expect(detailed.exitCode, detailed.diagnostic()).toBe(0);
      expect.soft(detailed.stdout).toMatch(/Changed\s+config:flags.candidate \(before → after\) · all 4 attempts/u);
      expect.soft(detailed.stdout).toMatch(/Changed\s+plan:physical \([^\n]*command/u);
      expect.soft(detailed.stdout.match(/Changed\s+plan:physical/gu)).toHaveLength(1);
      expect.soft(detailed.stdout.match(/Previous result @/gu)).toHaveLength(4);
      expect.soft(detailed.stdout).not.toContain('"template"');
      const dry = await niceeval.run(["exp", "largest", "--dry"]);
      expect(dry.exitCode, dry.diagnostic()).toBe(0);
      expect.soft(dry.stdout).toMatch(/plan:physical[^\n]*command/u);
      expect.soft(dry.stdout).not.toContain('"template"');
    },
  );
});
