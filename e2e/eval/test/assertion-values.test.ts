// owner: docs/engineering/testing/e2e/eval.md#eval-assertion-values
// regression: memory/assertion-snapshot-shape-needs-blob-fallback.md
// rerun: pnpm e2e test --repo eval -- --run test/assertion-values.test.ts

import { only } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { evalE2E } from "./context.ts";

interface ExpEvent {
  event: string;
  evalId?: string;
  locator?: string;
  verdict?: string;
}

interface AttemptShow {
  data: {
    kind: "attempt";
    evidence: {
      entries: readonly {
        state: string;
        detail?: {
          entries: readonly { display: unknown; decision: unknown }[];
        };
      }[];
    };
  };
}

const MATCHED_LABELS = [
  "includes:matched", "excludes:matched", "pattern:matched", "includesUrl:matched",
  "hasSections:matched", "isDefined:matched", "isTrue:matched", "isFalse:matched",
  "equals:matched", "matches:matched", "satisfies:matched", "defineValueMatch:matched",
  "jsonMatch:matched", "referencesAnyPath:matched", "and:matched", "or:matched", "not:matched",
  "similarity:matched", "defineScoreMatch:matched", "commandSucceeded:matched",
  "toolMatch.name:matched", "toolMatch.input:matched", "toolMatch.output:matched",
  "toolMatch.status:matched", "toolMatch.path:matched", "toolOccurrence.exact:matched",
  "toolMatch.input-only:matched", "toolOccurrence.atLeast:matched", "notCalledTool:matched",
  "commandMatch:matched", "events.raw-value:matched", "eventOccurrence.atLeast:matched",
  "eventOccurrence.exactly:matched", "eventOccurrence.greaterThan:matched",
  "eventOccurrence.atMost:matched", "eventOccurrence.lessThan:matched", "eventMatch:matched", "eventMatch.tool:matched",
  "eventMatch.finished:matched", "eventOrder:matched",
] as const;

const MISMATCHED_LABELS = [
  "includes:mismatched", "excludes:mismatched", "pattern:mismatched", "includesUrl:mismatched",
  "hasSections:mismatched", "isDefined:mismatched", "isTrue:mismatched", "isFalse:mismatched",
  "equals:mismatched", "matches:mismatched", "satisfies:mismatched", "defineValueMatch:mismatched",
  "jsonMatch:mismatched", "referencesAnyPath:mismatched", "and:mismatched", "or:mismatched",
  "not:mismatched", "similarity:mismatched", "defineScoreMatch:mismatched",
  "commandSucceeded:mismatched", "toolMatch.name:mismatched", "toolMatch.input:mismatched",
  "toolMatch.output:mismatched", "toolMatch.status:mismatched", "toolMatch.path:mismatched",
  "toolMatch.input-only:mismatched", "toolOccurrence.exact:mismatched",
  "toolOccurrence.atLeast:mismatched", "notCalledTool:mismatched",
  "commandMatch.executable:mismatched", "commandMatch.argsStart:mismatched",
  "commandMatch.excludes:mismatched", "commandMatch.status:mismatched", "eventMatch:mismatched",
  "eventMatch.tool:mismatched", "eventMatch.finished:mismatched", "eventOrder:mismatched",
] as const;

function assertionOutcomeMap(entries: readonly { display: unknown; decision: unknown }[]): Map<string, string> {
  return new Map(entries.flatMap((entry) => {
    if (entry.display === null || typeof entry.display !== "object" || Array.isArray(entry.display)) return [];
    if (entry.decision === null || typeof entry.decision !== "object" || Array.isArray(entry.decision)) return [];
    const label = (entry.display as Record<string, unknown>).label;
    const state = (entry.decision as Record<string, unknown>).result;
    return typeof label === "string" && typeof state === "string" ? [[label, state] as const] : [];
  }));
}

test("值 Match Eval 以 passed 终态完成", async () => {
  await evalE2E.case(
    "values",
    { artifacts: [{ source: ".niceeval", target: ".niceeval", optional: true }] },
    async ({ commands: { niceeval } }) => {
      const run = await niceeval.run(["exp", "assertion-values", "--rerun", "all", "--json"]);
      expect(run.exitCode, run.diagnostic()).toBe(0);
      expect(run.expReceipt(), run.diagnostic()).toMatchObject({ completion: "completed" });
      const evaluation = only(
        run.ndjson<ExpEvent>(),
        (event) => event.event === "eval" && event.evalId === "assertion-values" && event.locator !== undefined,
        run.diagnostic(),
      );
      expect(evaluation).toMatchObject({
        event: "eval",
        evalId: "assertion-values",
        verdict: "passed",
      });

      const outcomeRun = await niceeval.run(["exp", "assertion-match-outcomes", "--rerun", "all", "--json"]);
      expect(outcomeRun.exitCode, outcomeRun.diagnostic()).toBe(0);
      expect(outcomeRun.expReceipt(), outcomeRun.diagnostic()).toMatchObject({ completion: "completed" });
      const outcomes = only(
        outcomeRun.ndjson<ExpEvent>(),
        (event) => event.event === "eval" && event.evalId === "assertion-match-outcomes" && event.locator !== undefined,
        outcomeRun.diagnostic(),
      );
      expect(outcomes).toMatchObject({ verdict: "passed" });
      const shown = await niceeval.run(["show", outcomes.locator!, "--json"]);
      expect(shown.exitCode, shown.diagnostic()).toBe(0);
      const document = shown.json<AttemptShow>();
      expect(document.data.kind).toBe("attempt");
      const evidence = only(
        document.data.evidence.entries,
        (entry) => entry.state === "available" && entry.detail !== undefined,
        shown.diagnostic(),
      );
      const states = assertionOutcomeMap(evidence.detail!.entries);
      expect([...states.keys()].sort()).toEqual([...MATCHED_LABELS, ...MISMATCHED_LABELS].sort());
      for (const label of MATCHED_LABELS) expect(states.get(label), label).toBe("matched");
      for (const label of MISMATCHED_LABELS) expect(states.get(label), label).toBe("mismatched");
    },
  );
});
