import { decodeInspectionDocument } from "niceeval/inspection";
import { only } from "@niceeval/testkit";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { inspectionE2E } from "./support.ts";

// @feature docs/feature/inspection/README.md
test.concurrent("只停不 gate 的计分检查保留 passed 并指明未继续执行的位置", async () => {
  await inspectionE2E.case("show-stopped", async ({ commands: { niceeval }, paths: { projectRoot } }) => {
    await writeFile(join(projectRoot, "evals/stopped.eval.ts"), `
import { defineScoreEval } from "niceeval";
import { equals } from "niceeval/expect";
export default defineScoreEval({ async test(t) {
  t.score(1).label("earned");
  await t.check(false, equals(true)).label("stop only").orStop();
  t.check(false, equals(true)).gate().label("must not run");
} });`);
    await writeFile(join(projectRoot, "experiments/stopped.ts"), `
import { defineExperiment } from "niceeval";
import { defineAgent, completeEvidenceCoverage } from "niceeval/adapter";
export default defineExperiment({ evals: ["stopped"], adapter: defineAgent({ name: "stopped", evidenceCoverage: completeEvidenceCoverage, send: async () => ({ status: "completed", events: [] }) }) });`);
    const run = await niceeval.run(["exp", "stopped", "--json"]);
    expect(run.exitCode, run.diagnostic()).toBe(0);
    const event = only(run.expEvalEvents(), item => item.evalId === "stopped");
    expect(event.verdict).toBe("passed");
    const shown = await niceeval.run(["show", event.locator, "--json"]);
    const decoded = decodeInspectionDocument(JSON.parse(shown.stdout.trim().split("\n")[0]!));
    if (!decoded.success || decoded.value.outcome !== "success") throw new Error(shown.diagnostic());
    const attempt = decoded.value;
    expect(attempt.operation).toBe("attempt.get");
    if (attempt.operation !== "attempt.get") throw new Error("Expected attempt.get");
    const entry = only(attempt.attempt.assertions.entries, item => item.display.label === "stop only");
    expect(attempt.attempt).toMatchObject({ verdict: "passed", stoppedAt: { state: "available", value: { entryId: entry.entryId, label: "stop only" } }, diagnostics: { items: [] } });
    expect(attempt.attempt.assertions.entries.map(item => item.display.label)).not.toContain("must not run");
    const human = await niceeval.run(["show", event.locator]);
    expect(human.stdout).toContain("Stopped at stop only; later steps did not run");
    const old = await niceeval.run(["show", "@1HH2VVYRB69FW", "--record", join(projectRoot, "fixtures/assertions-v4/record.sqlite")]);
    expect(old.exitCode, old.diagnostic()).not.toBe(0);
    expect(old.stderr).toContain("unsupported-format");
    expect(old.stderr).toContain("older NiceEval");
    expect(old.stderr).toContain("Rerun");
    const experiment = await niceeval.run(["show", `exp:${"stopped"}`]);
    expect(experiment.stdout).toContain("passed stopped");
  });
});
