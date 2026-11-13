import { only } from "@niceeval/testkit";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { inspectionCaseArtifacts, inspectionE2E } from "./support.ts";

// @feature docs/feature/inspection/README.md
// @issue docs/issues/soft-score-pass-label.md
// @issue docs/issues/install-gate-failed-verdict-passed.md
test.concurrent("断言按 gate、计分和记录角色呈现，stop-only 不显示失败门", async () => {
  await inspectionE2E.case("assertion-roles", { artifacts: inspectionCaseArtifacts() }, async ({ commands: { niceeval }, paths: { projectRoot } }) => {
    await writeFile(join(projectRoot, "evals/roles.eval.ts"), `
import { defineScoreEval } from "niceeval";
import { equals } from "niceeval/expect";
export default defineScoreEval({ async test(t) {
  t.check(true, equals(true)).gate().label("installed");
  t.check(true, equals(true)).score(1).label("created");
  t.check(false, equals(true)).score(2).label("docs");
  t.check(false, equals(true)).gate().score(1).label("lockfile");
  t.check(true, equals(true)).label("used cli");
  await t.check(false, equals(true)).label("stop only").orStop();
} });
`);
    await writeFile(join(projectRoot, "experiments/roles.ts"), `
import { defineExperiment } from "niceeval";
import { defineAgent, completeEvidenceCoverage } from "niceeval/adapter";
export default defineExperiment({ evals: ["roles"], adapter: defineAgent({ name: "roles", evidenceCoverage: completeEvidenceCoverage, send: async () => ({ status: "completed", events: [] }) }) });
`);
    const run = await niceeval.run(["exp", "roles", "--json"]);
    expect(run.expReceipt().completion, run.diagnostic()).toBe("completed");
    const event = only(run.expEvalEvents(), item => item.evalId === "roles", run.diagnostic());
    expect(event.verdict).toBe("failed");
    const shown = await niceeval.run(["show", event.locator, "--assertions"]);
    expect(shown.exitCode, shown.diagnostic()).toBe(0);
    expect(shown.stdout).toMatch(/Verdict failed · Score 1\/4/u);
    expect(shown.stdout).toMatch(/Gates 1 pass, 1 fail · Scored 3 · Notes 1 met, 1 unmet/u);
    expect(shown.stdout).toMatch(/GATE\s+pass\s+.+installed/u);
    expect(shown.stdout).toMatch(/SCORE\s+0\/2\s+.+docs/u);
    expect(shown.stdout).toMatch(/GATE\s+fail\s+SCORE\s+0\/1\s+.+lockfile/u);
    expect(shown.stdout).toMatch(/NOTE\s+unmet\s+.+stop only/u);
    expect(shown.stdout).not.toMatch(/\[(?:PASS|FAIL)\]|Passed \d+, Failed \d+, Total/u);
    const attempt = await niceeval.run(["query", "run", "--request-json", JSON.stringify({ protocol: "niceeval.query/v3", operation: { kind: "attempt.get", locator: event.locator } })]);
    const entry = only(attempt.querySuccess("attempt.get").attempt.assertions.entries, item => item.display.label === "stop only", attempt.diagnostic());
    expect(entry.decision.gate).toBe("not-gate");
    const detail = await niceeval.run(["show", event.locator, "--assertions", "--entry", entry.entryId]);
    expect(detail.exitCode, detail.diagnostic()).toBe(0);
    expect(detail.stdout).toContain("Verdict failed · Score 1/4");
    expect(detail.stdout).toMatch(/NOTE\s+unmet\s+.+stop only/u);
    const feedback = await niceeval.run(["exp", "roles", "--rerun", "all"]);
    expect(feedback.exitCode, feedback.diagnostic()).not.toBe(0);
    expect(feedback.stdout).toContain("Verdict failed · Score 1/4");
    expect(feedback.stdout).toContain("Gates 1 pass, 1 fail · Scored 3 · Notes 1 met, 1 unmet");
    expect(feedback.stdout).toMatch(/NOTE\s+unmet\s+stop only/u);
  });
});
