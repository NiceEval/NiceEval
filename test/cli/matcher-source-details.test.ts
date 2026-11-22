import fc from "fast-check";
import { beforeAll, expect, test } from "vitest";
import { createFixtureProject, runSingleAttempt } from "../integration/fixtures/adapter-trace-usage-harness/harness.ts";
import { decodeInspectionDocument, narrowInspectionSuccess } from "../integration/fixtures/judge-harness/harness.ts";
import { runCli } from "../integration/fixtures/lifecycle-sandbox/harness.ts";

const observed: Array<{ laterTurns: number; detail: Awaited<ReturnType<typeof runCli>> }> = [];
beforeAll(async () => {
  for (const laterTurns of [1, ...fc.sample(fc.integer({ min: 1, max: 3 }), { seed: 450027, numRuns: 2 })]) {
    const project = await createFixtureProject("matcher-source-details", {
      "niceeval.config.ts": "export default {};",
      "evals/one.eval.ts": `import { defineEval } from "niceeval"; import { eventMatch, includes } from "niceeval/expect";
        export default defineEval({ async test(t) {
          await t.send("initial");
          t.eventOrder([eventMatch("message", { text: includes("reply") }), eventMatch("message", { text: includes("reply") })]).label("empty snapshot");
          for (let i = 0; i < ${laterTurns}; i++) await t.send("next");
        } });`,
      "experiments/one.ts": `import { defineExperiment } from "niceeval"; import { defineAgent, completeEvidenceCoverage } from "niceeval/adapter";
        export default defineExperiment({ evals: ["one"], adapter: defineAgent({ name: "messages", evidenceCoverage: completeEvidenceCoverage,
          send: async () => ({ status: "completed", events: [{ type: "message", role: "assistant", text: "reply" }] }) }) });`,
    });
    try {
      const locator = await runSingleAttempt(project.cwd, "one");
      const outline = await runCli(project.cwd, ["show", locator, "--json"]);
      expect(outline.code, outline.stderr).toBe(0);
      const decoded = decodeInspectionDocument(JSON.parse(outline.stdout.trim().split("\n")[0]!));
      if (!decoded.success) throw new Error(decoded.reason);
      const document = narrowInspectionSuccess(decoded.value, "attempt.get");
      if (!document.success) throw new Error(document.reason);
      expect(document.value.attempt.assertions.entries, outline.stdout).toHaveLength(1);
      const entry = document.value.attempt.assertions.entries[0]!;
      const detail = await runCli(project.cwd, ["show", locator, entry.entryId, "--full", "--json"]);
      observed.push({ laterTurns, detail });
    } finally { await project.dispose(); }
  }
}, 15_000);

// @feature docs/feature/assertions/README.md#scope-and-completeness
test("matcher details encode source rows outside their frozen snapshot without changing the decision", () => {
  for (const { laterTurns, detail } of observed) {
    expect(detail.code, detail.stderr).toBe(0);
    const decoded = decodeInspectionDocument(JSON.parse(detail.stdout));
    if (!decoded.success) throw new Error(decoded.reason);
    const document = narrowInspectionSuccess(decoded.value, "attempt.assertion.detail");
    if (!document.success) throw new Error(document.reason);
    const assertion = document.value.assertion;
    expect(assertion.check.state).toBe("mismatched");
    const debuggerResult = assertion.matcher.debugger;
    if (debuggerResult === undefined || debuggerResult === null || debuggerResult.state !== "current" || debuggerResult.source.final.state === "unavailable")
      throw new Error("Missing current source rows");
    const rows = debuggerResult.source.final.rows;
    expect(rows.filter((row) => row.phase === "outside-evaluation-snapshot" && row.summary === "assistant: reply")).toHaveLength(laterTurns);
  }
});
