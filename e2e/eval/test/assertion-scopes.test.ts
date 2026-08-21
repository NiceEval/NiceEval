// owner: docs/engineering/testing/e2e/eval.md#eval-assertion-scopes
// regression: memory/assertion-diagnostic-tree-overflows-record.md
// rerun: pnpm e2e --repo eval -- --run test/assertion-scopes.test.ts

import { only } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { evalE2E } from "./context.ts";

interface ExpEvent {
  event: string;
  evalId?: string;
  locator?: string;
  verdict?: string;
}

interface AssertionSegment {
  readonly kind: string;
}

interface ShowDocument {
  readonly data: {
    readonly kind: string;
    readonly evidence: {
      readonly entries: readonly {
        readonly state: string;
        readonly detail?: {
          readonly entries: readonly {
            readonly entryId: string;
            readonly display: { readonly label?: string };
            readonly source: AssertionSegment;
            readonly check: AssertionSegment;
            readonly observed: AssertionSegment & {
              readonly receipt?: {
                readonly examined: number;
                readonly matched: number;
                readonly mismatched: number;
                readonly unavailable: number;
                readonly knownTotal: number | null;
                readonly complete: boolean;
                readonly exhaustive: boolean;
                readonly decisive: boolean;
              };
            };
            readonly expected: AssertionSegment;
            readonly explanation: AssertionSegment;
            readonly decision: { readonly result: string };
          }[];
        };
      }[];
    };
  };
}

test("大量真实工具事件的 scope Assertion 仍以 passed 终态发布", async () => {
  await evalE2E.case(
    "scopes",
    { artifacts: [{ source: ".niceeval", target: ".niceeval", optional: true }] },
    async ({ commands: { niceeval } }) => {
      const run = await niceeval.run(["exp", "assertion-scopes", "--rerun", "all", "--json"]);
      expect(run.exitCode, run.diagnostic()).toBe(0);
      expect(run.expReceipt(), run.diagnostic()).toMatchObject({ completion: "completed" });
      const evaluation = only(
        run.ndjson<ExpEvent>(),
        (event) => event.event === "eval" && event.evalId === "assertion-scopes" && event.locator !== undefined,
        run.diagnostic(),
      );
      expect(evaluation).toMatchObject({
        event: "eval",
        evalId: "assertion-scopes",
        verdict: "passed",
      });
      const shown = await niceeval.run(["show", evaluation.locator!, "--json"]);
      expect(shown.exitCode, shown.diagnostic()).toBe(0);
      const document = shown.json<ShowDocument>();
      expect(document.data.kind).toBe("attempt");
      const available = only(
        document.data.evidence.entries,
        (entry) => entry.state === "available" && entry.detail !== undefined,
        shown.diagnostic(),
      );
      const assertions = available.detail!.entries;
      for (const assertion of assertions) {
        expect(assertion.source.kind).toBeTruthy();
        expect(assertion.check.kind).toBeTruthy();
        expect(assertion.observed.kind).toBeTruthy();
        expect(assertion.expected.kind).toBeTruthy();
        expect(assertion.explanation.kind).toBeTruthy();
        expect(assertion.decision.result).toBeTruthy();
      }
      const partialAbsence = only(
        assertions,
        (entry) => entry.display.label === "partial source absence remains unavailable",
        shown.diagnostic(),
      );
      const partialExact = only(
        assertions,
        (entry) => entry.display.label === "partial source exact count remains unavailable",
        shown.diagnostic(),
      );
      expect(partialAbsence.decision.result).toBe("unavailable");
      expect(partialExact.decision.result).toBe("unavailable");
      const receipt = partialExact.observed.receipt;
      expect(receipt).toMatchObject({
        examined: 1,
        matched: 1,
        mismatched: 0,
        unavailable: 0,
        knownTotal: 1,
        complete: false,
        exhaustive: false,
        decisive: false,
      });
      const terminalWitness = only(
        assertions,
        (entry) => JSON.stringify(entry.check).includes("argsStart") && JSON.stringify(entry.check).includes("show"),
        shown.diagnostic(),
      );
      expect(terminalWitness.observed.receipt).toMatchObject({
        examined: 10_003,
        matched: 1,
        mismatched: 10_002,
        knownTotal: 10_005,
        complete: false,
        exhaustive: false,
        decisive: true,
      });
      expect(JSON.stringify(terminalWitness.explanation)).toContain(
        '\"label\":\"index\",\"value\":{\"kind\":\"value\",\"value\":10002}',
      );
      const closedAssertions = JSON.stringify(assertions);
      expect(Buffer.byteLength(closedAssertions), shown.diagnostic()).toBeLessThan(256 * 1024);
      expect(closedAssertions).not.toContain("scope-filler-9999");
    },
  );
});
