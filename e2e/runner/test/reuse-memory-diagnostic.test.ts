import { only } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { runnerE2E } from "./context.ts";

// @feature docs/feature/sandbox/README.md
// @regression memory/sandbox-reuse-memory-misattribution.md
test.concurrent("复用失败聚集保留诊断且不把有意记忆归因为污染", async () => {
  await runnerE2E.case("reuse-memory-diagnostic", {}, async ({ commands: { niceeval } }) => {
    const result = await niceeval.run(["exp", "reuse-memory", "--rerun", "all", "--json"], { timeoutMs: 120_000 });
    expect(result.exitCode, result.diagnostic()).toBe(0);
    expect(result.expReceipt().completion, result.diagnostic()).toBe("completed");
    expect(result.expEvalEvents()).toEqual([expect.objectContaining({ attempts: 3, passed: 1, verdict: "errored" })]);
    const diagnostic = only(
      result.expEvents(),
      (event) => event.event === "warning" && event.message.includes("handoff 2-3"),
      result.diagnostic(),
    );
    expect(diagnostic).toMatchObject({ code: "sandbox-reuse-failure-cluster" });
    expect(diagnostic).toMatchObject({ message: expect.stringContaining("Intentional persistent memory") });
    expect(JSON.stringify(diagnostic)).not.toContain("likely cause");
    expect(JSON.stringify(diagnostic)).not.toContain("must not depend");
  });
});
