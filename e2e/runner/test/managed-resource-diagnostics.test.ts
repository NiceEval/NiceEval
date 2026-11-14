import { only } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { runnerE2E } from "./context.ts";

// @feature docs/feature/run/README.md
test.concurrent("managed resource 清理失败的各子错误可从公开诊断读回", async () => {
  await runnerE2E.case("managed-resource-diagnostics", async ({ commands: { niceeval } }) => {
    const result = await niceeval.run(["exp", "diagnostic-fidelity", "--json"], { env: { NICEEVAL_DIAGNOSTIC_SCENARIO: "aggregate" } });
    const locator = only(result.expEvalEvents(), () => true).locator;
    const trace = await niceeval.run(["query", "run", "--request-json", JSON.stringify({ protocol: "niceeval.query/v3", operation: { kind: "attempt.trace", locator } })]);
    expect(trace.exitCode, trace.diagnostic()).toBe(0);
    const diagnostic = only(trace.attemptTrace().trace.diagnostics.items, item => item.code === "teardown-failed");
    for (const detail of ["FixtureTransportError", "E_RUNNER", "runner release transport unavailable", "E_JSONL", "jsonl release transport unavailable"]) {
      expect(diagnostic.summary).toContain(detail);
    }
    const shown = await niceeval.run(["show", locator]);
    expect(shown.exitCode, shown.diagnostic()).toBe(0);
    expect(shown.stdout).toContain("E_RUNNER");
    expect(shown.stdout).toContain("E_JSONL");
  });
});
