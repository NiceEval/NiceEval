// rerun: pnpm e2e test --candidate source --repo runner -- --run test/attachment-publication.test.ts
import { expect, test } from "vitest";
import { runnerE2E } from "./context.ts";

// @feature docs/feature/run/README.md
test.concurrent("large multi-turn conversations retain the Attempt and bounded agent-turns", async () => {
  await runnerE2E.case("large-turns-publication", {}, async ({ commands: { niceeval } }) => {
    const run = await niceeval.run(["exp", "large-turns", "--rerun", "all", "--json"]);
    expect(run.exitCode, run.diagnostic()).toBe(0);
    expect(run.expReceipt().completion).toBe("completed");
    expect(run.expEvalEvents()).toEqual([expect.objectContaining({ verdict: "passed" })]);
    const locator = run.expEvalEvents()[0]!.locator!;
    const shown = await niceeval.run(["show", locator, "execution", "--json"]);
    expect(shown.exitCode, shown.diagnostic()).toBe(0);
    const trace = shown.attemptTrace().trace;
    expect(trace.conversation.state).toBe("partial");
    expect(trace.conversation.turns).toHaveLength(2);
    expect(trace.conversation.items.length).toBeGreaterThan(0);
    expect(trace.diagnostics.items).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "attachment-encode-failed" })]),
    );
  });
});

// @feature docs/feature/run/README.md
test.concurrent("an unencodable observability family leaves a diagnostic while publishing the Attempt", async () => {
  await runnerE2E.case("attachment-failure-publication", {}, async ({ commands: { niceeval } }) => {
    const run = await niceeval.run(["exp", "large-usage", "--rerun", "all", "--json"]);
    expect(run.exitCode, run.diagnostic()).toBe(0);
    expect(run.expReceipt().completion).toBe("completed");
    expect(run.expEvalEvents()).toEqual([expect.objectContaining({ verdict: "passed" })]);
    const locator = run.expEvalEvents()[0]!.locator!;
    const shown = await niceeval.run(["show", locator, "execution", "--json"]);
    expect(shown.exitCode, shown.diagnostic()).toBe(0);
    const diagnostic = shown
      .attemptTrace()
      .trace.diagnostics.items.find((item) => item.code === "attachment-encode-failed");
    expect(diagnostic).toMatchObject({ kind: "advisory", phase: "attempt.teardown" });
    expect(diagnostic?.summary).toContain("niceeval.adapter-usage");
    expect(diagnostic?.causes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "record-attachment-schema-invalid",
          summary: expect.stringContaining("value"),
        }),
      ]),
    );
    expect(JSON.stringify(diagnostic)).not.toContain("fixture-model");
  });
});
