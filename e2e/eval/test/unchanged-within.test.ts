import { only } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { evalE2E } from "./context.ts";
import { assertionEntry, inspectAssertionEntries, inspectAttempt } from "./inspection.ts";

// @use-case docs/feature/assertions/use-case/protect-paths.md
test.concurrent("保护范围检查识别文件与子目录，保留独立 criterion 和违规路径", async () => {
  await evalE2E.case("unchanged-within", async ({ paths: { projectRoot }, commands: { niceeval } }) => {
    for (let repetition = 0; repetition < 2; repetition++) {
      const run = await niceeval.run(["exp", "unchanged-within", "--rerun", "all", "--json"]);
      const expected: Record<string, string> = {
        "protected subtree": "mismatched",
        "protected file": "mismatched",
        "component boundary and ignored": "matched",
        "zero changes protected": "matched",
      };
      for (const evalId of ["unchanged-within", "unchanged-within-empty"]) {
        const event = only(run.expEvalEvents(), (event) => event.evalId === evalId, run.diagnostic());
        expect(event.verdict, run.diagnostic()).toBe(evalId === "unchanged-within" ? "failed" : "passed");
        const attempt = await inspectAttempt(niceeval, projectRoot, event.locator!, "attempt.get");
        expect(attempt.document.attempt.assertions.entries).toHaveLength(evalId === "unchanged-within" ? 3 : 1);
        for (const detail of await inspectAssertionEntries(
          niceeval,
          projectRoot,
          event.locator!,
          attempt.document.attempt.assertions.entries,
        )) {
          const entry = assertionEntry(detail.document, detail.receipt.diagnostic());
          expect(entry.decision.result, entry.display.label).toBe(expected[entry.display.label!]);
          expect(entry.criterion).toMatchObject({
            state: "available",
            value: { kind: "builtin", id: "sandbox-unchanged-within/v1" },
          });
          if (entry.display.label === "protected subtree") {
            const shown = await niceeval.run(["show", event.locator!, "--full", entry.entryId]);
            expect(shown.exitCode, shown.diagnostic()).toBe(0);
            expect(shown.stdout).toContain("agents/a.ts");
            expect(shown.stdout).toContain("sandbox-unchanged-within/v1");
          }
        }
      }
    }
  });
});

// @use-case docs/feature/assertions/use-case/protect-paths.md
test.concurrent("变化采集不可读时保护范围保持 unavailable，持久 criterion 仍可解释", async () => {
  await evalE2E.case("unchanged-within-unavailable", async ({ paths: { projectRoot }, commands: { niceeval } }) => {
    for (let repetition = 0; repetition < 2; repetition++) {
      const run = await niceeval.run(["exp", "unchanged-within-unavailable", "--rerun", "all", "--json"]);
      const event = only(run.expEvalEvents(), (event) => event.evalId === "unchanged-within-empty", run.diagnostic());
      expect(event.verdict, run.diagnostic()).toBe("errored");
      const attempt = await inspectAttempt(niceeval, projectRoot, event.locator!, "attempt.get");
      expect(attempt.document.attempt.assertions.entries).toHaveLength(1);
      const details = await inspectAssertionEntries(
        niceeval,
        projectRoot,
        event.locator!,
        attempt.document.attempt.assertions.entries,
      );
      const entry = assertionEntry(details[0]!.document, details[0]!.receipt.diagnostic());
      expect(entry.decision.result).toBe("unavailable");
      expect(entry.criterion).toMatchObject({
        state: "available",
        value: { kind: "builtin", id: "sandbox-unchanged-within/v1" },
      });
    }
  });
});
