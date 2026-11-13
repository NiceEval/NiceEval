import { only } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { evalE2E } from "./context.ts";
import { assertionEntry, inspectAssertionEntries, inspectAttempt } from "./inspection.ts";

// @feature docs/feature/sandbox/README.md
test.concurrent("变化内容正向匹配保留 witness，未知内容保持 unavailable 并可持久读回", async () => {
  await evalE2E.case("in-diff", async ({ paths: { projectRoot }, commands: { niceeval } }) => {
    const run = await niceeval.run(["exp", "in-diff", "--rerun", "all", "--json"]);
    const expected: Record<string, string> = {
      "added witness": "matched", "removed witness": "matched", "path witness": "matched",
      "unselected side": "mismatched", "unchanged context": "mismatched", "no witness": "mismatched",
      "legacy absence": "matched", "elided unavailable": "unavailable", "elision unselected": "mismatched",
      "path despite elision": "matched",
    };
    for (const evalId of ["in-diff", "in-diff-elided"]) {
      const event = only(run.expEvalEvents(), event => event.evalId === evalId, run.diagnostic());
      expect(event.verdict, run.diagnostic()).toBe("failed");
      const attempt = await inspectAttempt(niceeval, projectRoot, event.locator!, "attempt.get");
      expect(attempt.document.attempt.assertions.entries).toHaveLength(evalId === "in-diff" ? 7 : 3);
      for (const detail of await inspectAssertionEntries(niceeval, projectRoot, event.locator!, attempt.document.attempt.assertions.entries)) {
        const entry = assertionEntry(detail.document, detail.receipt.diagnostic());
        expect(entry.decision.result, entry.display.label).toBe(expected[entry.display.label!]);
        expect(entry.criterion).toMatchObject({ state: "available", value: { kind: "builtin", id: entry.display.label === "legacy absence" ? "sandbox-result/v1" : "sandbox-in-diff/v1" } });
        if (entry.display.label === "added witness") {
          expect(entry.materials.evidence.length).toBeGreaterThan(0);
          const shown = await niceeval.run(["show", event.locator!, "--assertions", "--entry", entry.entryId, "--full"]);
          expect(shown.exitCode, shown.diagnostic()).toBe(0);
          expect(shown.stdout).toContain("sandbox-in-diff/v1");
          expect(shown.stdout).toContain("fixture/content.txt");
          expect(shown.stdout).toContain("added-content-token");
        }
      }
    }
  });
});
