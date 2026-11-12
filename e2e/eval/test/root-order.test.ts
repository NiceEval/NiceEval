import { only } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { evalE2E } from "./context.ts";
import { assertionEntry, inspectAssertionEntries, inspectAttempt } from "./inspection.ts";

// @feature docs/feature/assertions/README.md
test.concurrent("根顺序断言冻结各会话前缀且只在单一会话内寻找见证", async () => {
  await evalE2E.case("root-order", async ({ paths: { projectRoot }, commands: { niceeval } }) => {
    const run = await niceeval.run(["exp", "root-order", "--rerun", "all", "--json"]);
    const event = only(run.expEvalEvents(), event => event.evalId === "root-order", run.diagnostic());
    expect(event.verdict, run.diagnostic()).not.toBe("errored");
    const locator = event.locator!;
    const attempt = await inspectAttempt(niceeval, projectRoot, locator, "attempt.get");
    const entries = attempt.document.attempt.assertions.entries;
    expect(entries).toHaveLength(8);
    const expected: Record<string, string> = {
      empty: "mismatched", "frozen before second": "mismatched", "main across turns": "matched",
      "main events across turns": "matched", "no cross session tools": "mismatched",
      "no cross session events": "mismatched", "matched beats unavailable": "matched", "unavailable beats mismatch": "unavailable",
    };
    for (const detail of await inspectAssertionEntries(niceeval, projectRoot, locator, entries)) {
      const entry = assertionEntry(detail.document, detail.receipt.diagnostic());
      expect(entry.decision.result, entry.display.label).toBe(expected[entry.display.label!]);
      expect(entry.criterion.state).toBe("available");
      if (entry.display.label === "main across turns") {
        expect(entry.evaluation.kind).toBe("matcher-current");
        expect(JSON.stringify(entry.evaluation)).toContain("sessionId");
        expect(JSON.stringify(entry.evaluation)).toContain("witnessPath");
      }
    }
  });
});
