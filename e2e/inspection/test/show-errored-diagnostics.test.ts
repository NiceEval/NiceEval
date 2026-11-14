import { only } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { inspectionE2E } from "./support.ts";

// @use-case docs/feature/error-classification/use-case/reading-errored.md
// @issue docs/issues/show-errored-diagnostics-hidden.md
test.concurrent("错误 Attempt 概览直接显示已保存的阶段与错误并链接执行诊断", async () => {
  await inspectionE2E.case("show-errored-diagnostics", async ({ commands: { niceeval } }) => {
    const run = await niceeval.run(["exp", "usage-unsealed", "--rerun", "all", "--json"]);
    expect(run.exitCode, run.diagnostic()).toBe(1);
    const event = only(run.expEvalEvents(), (item) => item.evalId === "usage-unsealed", run.diagnostic());
    expect(event.verdict).toBe("errored");
    const read = await niceeval.run(["query", "run", "--request-json", JSON.stringify({ protocol: "niceeval.query/v3", operation: { kind: "attempt.get", locator: event.locator } })]);
    expect(read.exitCode, read.diagnostic()).toBe(0);
    expect(read.querySuccess("attempt.get").attempt.diagnostics.items).toEqual(expect.arrayContaining([expect.objectContaining({ summary: expect.stringContaining("JOURNAL_NOT_SEALED") })]));
    const diagnostic = only(read.querySuccess("attempt.get").attempt.diagnostics.items, item => item.summary.includes("JOURNAL_NOT_SEALED"));
    expect(diagnostic).toMatchObject({ evidenceId: expect.any(String), summaryTruncated: expect.any(Boolean), phase: "eval.run" });
    const expanded = await niceeval.run(["show", event.locator, "--execution", "--expand", diagnostic.evidenceId, "--json"]);
    expect(expanded.exitCode, expanded.diagnostic()).toBe(0);
    expect(expanded.querySuccess("attempt.trace.detail").detail).toMatchObject({ kind: "diagnostic", evidenceId: diagnostic.evidenceId, summary: expect.stringContaining("JOURNAL_NOT_SEALED") });
    const shown = await niceeval.run(["show", event.locator]);
    expect(shown.exitCode, shown.diagnostic()).toBe(0);
    expect(shown.stdout, shown.diagnostic()).toContain("JOURNAL_NOT_SEALED");
    expect(shown.stdout).toMatch(/Phase\s+eval/u);
    expect(shown.stdout).toMatch(/Diagnostics\s+available/u);
    expect(shown.stdout).toContain(`niceeval show ${event.locator} --execution`);
    const execution = await niceeval.run(["show", event.locator, "--execution"]);
    expect(execution.exitCode, execution.diagnostic()).toBe(0);
    expect(execution.stdout).toContain("Diagnostics");
    expect(execution.stdout).toContain("JOURNAL_NOT_");
  });
});
