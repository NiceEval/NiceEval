import { only } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { evalE2E } from "./context.ts";
import { assertionEntry, inspectAssertionEntries, inspectAttempt } from "./inspection.ts";

// @feature docs/feature/sandbox/README.md
// @issue docs/issues/change-scope-settled-before-diff.md
test.concurrent("允许范围检查遵循组件边界并将独立 criterion 读成 available", async () => {
  await evalE2E.case("change-scope", async ({ paths: { projectRoot }, commands: { niceeval } }) => {
    const run = await niceeval.run(["exp", "change-scope", "--rerun", "all", "--json"]);
    const expected: Record<string, string> = {
      "allowed subtrees": "matched", "component boundary": "mismatched", "legacy exact set": "matched",
      "later stop barrier": "matched",
      "zero changes allowed": "matched", "legacy exact requires change": "mismatched", "legacy no changes": "matched",
    };
    for (const evalId of ["change-scope", "change-scope-empty"]) {
      const event = only(run.expEvalEvents(), event => event.evalId === evalId, run.diagnostic());
      expect(event.verdict, run.diagnostic()).not.toBe("errored");
      const attempt = await inspectAttempt(niceeval, projectRoot, event.locator!, "attempt.get");
      expect(attempt.document.attempt.assertions.entries).toHaveLength(evalId === "change-scope" ? 4 : 3);
      for (const detail of await inspectAssertionEntries(niceeval, projectRoot, event.locator!, attempt.document.attempt.assertions.entries)) {
        const entry = assertionEntry(detail.document, detail.receipt.diagnostic());
        expect(entry.decision.result, entry.display.label).toBe(expected[entry.display.label!]);
        expect(entry.criterion.state).toBe("available");
        if (["allowed subtrees", "component boundary", "zero changes allowed"].includes(entry.display.label!)) {
          expect(entry.criterion).toMatchObject({ state: "available", value: { kind: "builtin", id: "sandbox-change-scope/v1" } });
        }
        if (entry.display.label === "component boundary") {
          const shown = await niceeval.run(["show", event.locator!, "--assertions", "--entry", entry.entryId, "--full"]);
          expect(shown.exitCode, shown.diagnostic()).toBe(0);
          expect(shown.stdout).toContain("agents-old/outside.ts");
          expect(shown.stdout).toContain("sandbox-change-scope/v1");
        }
      }
    }
  });
});
