// owner: docs/engineering/testing/e2e/eval.md#eval-assertion-scopes
// Regression note: memory/assertion-diagnostic-tree-overflows-record.md
// rerun: pnpm e2e test --repo eval -- --run test/assertion-scopes.test.ts

import { only } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { evalE2E } from "./context.ts";
import { assertionEntry, inspectAssertionEntries, inspectAttempt } from "./inspection.ts";

interface AssertionReceipt {
  readonly examined: number;
  readonly matched: number;
  readonly mismatched: number;
  readonly unavailable: number;
  readonly knownTotal: number | null;
  readonly complete: boolean;
  readonly exhaustive: boolean;
  readonly decisive: boolean;
}

interface InspectedAssertion {
  readonly entryId: string;
  readonly display: { readonly label?: string };
  readonly criterion: { readonly state: string; readonly value?: { readonly id?: string; readonly data?: unknown } };
  readonly materials: unknown;
  readonly evaluation: {
    readonly kind: string;
    readonly receipt?: AssertionReceipt;
    readonly artifact?: { readonly receipt?: AssertionReceipt; readonly retainedRows?: unknown[] };
  };
  readonly decision: { readonly result: string };
  readonly policy: unknown;
  readonly contribution: unknown;
  readonly explanationRetention: unknown;
}


function criterionId(entry: InspectedAssertion): string | undefined {
  return entry.criterion.state === "available" ? entry.criterion.value?.id : undefined;
}

function criterionData(entry: InspectedAssertion): Record<string, unknown> | undefined {
  const value = entry.criterion.state === "available" ? entry.criterion.value?.data : undefined;
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function dataString(entry: InspectedAssertion, path: readonly string[]): string | undefined {
  let value: unknown = criterionData(entry);
  for (const key of path) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return typeof value === "string" ? value : undefined;
}

function receiptOf(entry: InspectedAssertion): AssertionReceipt | undefined {
  return entry.evaluation.receipt ?? entry.evaluation.artifact?.receipt;
}

function labeled(assertions: readonly InspectedAssertion[], label: string, diagnostic: string): InspectedAssertion {
  return only(assertions, (entry) => entry.display.label === label, diagnostic);
}

function expectNumeric(entry: InspectedAssertion, result: "matched" | "unavailable"): void {
  expect(criterionId(entry)).toBe("numeric-comparison/v1");
  expect(entry.decision.result).toBe(result);
  expect(entry.evaluation.kind).toBe("ordinary");
  expect(entry.evaluation.artifact).toBeUndefined();
}

function expectOccurrence(
  entry: InspectedAssertion,
  result: "matched" | "unavailable",
  assertion: "present" | "absent" | "count" | "order",
  quantifierKind?: string,
): void {
  expect(criterionId(entry)).toBe("occurrence/v2");
  expect(entry.decision.result).toBe(result);
  expect(entry.evaluation.kind).toBe("matcher-current");
  expect(dataString(entry, ["assertion"])).toBe(assertion);
  if (quantifierKind !== undefined) {
    expect(dataString(entry, ["quantifier", "kind"])).toBe(quantifierKind);
  }
}

test("大量真实工具事件的 scope Assertion 仍以 passed 终态发布", async () => {
  await evalE2E.case(
    "scopes",
    { artifacts: [{ source: ".niceeval", target: ".niceeval", optional: true }] },
    async ({ paths: { projectRoot }, commands: { niceeval } }) => {
      const run = await niceeval.run(["exp", "assertion-scopes", "--rerun", "all", "--json"]);
      expect(run.exitCode, run.diagnostic()).toBe(0);
      expect(run.expReceipt(), run.diagnostic()).toMatchObject({ completion: "completed" });
      const evaluation = only(
        run.expEvalEvents(),
        (event) => event.event === "eval" && event.evalId === "assertion-scopes" && event.locator !== undefined,
        run.diagnostic(),
      );
      expect(evaluation).toMatchObject({
        event: "eval",
        evalId: "assertion-scopes",
        verdict: "passed",
      });
      const inspected = await inspectAttempt(niceeval, projectRoot, evaluation.locator!, "attempt.get");
      expect(inspected.receipt.exitCode, inspected.receipt.diagnostic()).toBe(0);
      const document = inspected.document;
      expect(document.attempt, inspected.receipt.diagnostic()).toMatchObject({
        locator: evaluation.locator,
        verdict: "passed",
        assertions: { state: "available" },
      });
      const details = await inspectAssertionEntries(
        niceeval,
        projectRoot,
        evaluation.locator!,
        document.attempt.assertions.entries,
      );
      const assertions = details.map((detail) => {
        expect(detail.receipt.exitCode, detail.receipt.diagnostic()).toBe(0);
        expect(detail.document).toMatchObject({
          protocol: "niceeval.query/v1",
          operation: "attempt.assertion.detail",
          assertion: { entryId: detail.entry.entryId, display: detail.entry.display },
        });
        return assertionEntry(detail.document, detail.receipt.diagnostic());
      });
      for (const assertion of assertions) {
        expect(assertion.criterion.state).toBeTruthy();
        expect(assertion.materials).toBeTruthy();
        expect(assertion.evaluation.kind).toBeTruthy();
        expect(assertion.decision.result).toBeTruthy();
        expect(assertion.policy).toBeTruthy();
        expect(assertion.contribution).toBeTruthy();
        expect(assertion.explanationRetention).toBeTruthy();
      }
      const partialAbsence = labeled(
        assertions,
        "partial source absence remains unavailable",
        inspected.receipt.diagnostic(),
      );
      const partialExact = labeled(
        assertions,
        "partial source exact count remains unavailable",
        inspected.receipt.diagnostic(),
      );
      expect(partialAbsence.decision.result).toBe("unavailable");
      expect(partialExact.decision.result).toBe("unavailable");
      const receipt = receiptOf(partialExact);
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
        (entry) => JSON.stringify(entry.criterion).includes("argsStart") && JSON.stringify(entry.criterion).includes("query"),
        inspected.receipt.diagnostic(),
      );
      expect(receiptOf(terminalWitness)).toMatchObject({
        examined: 10_003,
        matched: 1,
        mismatched: 10_002,
        knownTotal: 10_005,
        complete: false,
        exhaustive: false,
        decisive: true,
      });
      expect(JSON.stringify(terminalWitness.evaluation)).toContain("10002");
      const assertionIndex = JSON.stringify(document.attempt.assertions.entries);
      expect(Buffer.byteLength(assertionIndex), inspected.receipt.diagnostic()).toBeLessThan(256 * 1024);
      expect(assertionIndex).not.toContain("scope-filler-9999");

      const turnCount = labeled(assertions, "turn explicit cardinality", inspected.receipt.diagnostic());
      const turnMax = labeled(assertions, "turn maxToolCalls", inspected.receipt.diagnostic());
      const cutFromSubject = labeled(assertions, "cut from subject", inspected.receipt.diagnostic());
      const attemptCount = labeled(assertions, "attempt explicit cardinality", inspected.receipt.diagnostic());
      const attemptMax = labeled(assertions, "attempt maxToolCalls", inspected.receipt.diagnostic());
      const authorArray = labeled(assertions, "author array cardinality", inspected.receipt.diagnostic());
      const spreadCount = labeled(assertions, "spread cardinality still works", inspected.receipt.diagnostic());
      for (const entry of [turnCount, turnMax, cutFromSubject, authorArray, spreadCount]) {
        expectNumeric(entry, "matched");
      }
      for (const entry of [attemptCount, attemptMax]) {
        expectNumeric(entry, "unavailable");
      }
      expect(criterionData(turnCount)).toEqual(criterionData(turnMax));
      expect(criterionData(attemptCount)).toEqual(criterionData(attemptMax));
      expect(dataString(turnCount, ["subject", "kind"])).toBe("collection-cardinality");
      expect(dataString(turnCount, ["subject", "scope"])).toBe("turn");
      expect(dataString(cutFromSubject, ["subject", "scope"])).toBe("turn");
      expect(dataString(attemptCount, ["subject", "kind"])).toBe("collection-cardinality");
      expect(dataString(attemptCount, ["subject", "scope"])).toBe("attempt");
      expect(dataString(authorArray, ["subject", "kind"])).toBe("explicit-value");
      expect(dataString(spreadCount, ["subject", "kind"])).toBe("explicit-value");

      const turnMatching = labeled(assertions, "turn explicit occurrence", inspected.receipt.diagnostic());
      const turnCalled = labeled(assertions, "turn calledTool", inspected.receipt.diagnostic());
      const unusedExplicit = labeled(assertions, "unused session explicit occurrence zero", inspected.receipt.diagnostic());
      const unusedSugar = labeled(assertions, "unused session usedNoTools", inspected.receipt.diagnostic());
      for (const entry of [turnMatching, turnCalled]) {
        expectOccurrence(entry, "matched", "present", "at-least");
      }
      for (const entry of [unusedExplicit, unusedSugar]) {
        expectOccurrence(entry, "matched", "absent");
      }
      expect(criterionData(turnMatching)).toEqual(criterionData(turnCalled));
      expect(criterionData(unusedExplicit)).toEqual(criterionData(unusedSugar));

      const bareToolMatch = labeled(assertions, "turn bare toolMatch", inspected.receipt.diagnostic());
      const bareCalledTool = labeled(assertions, "turn calledTool bare", inspected.receipt.diagnostic());
      const occurrenceExactly = labeled(assertions, "turn occurrence exactly", inspected.receipt.diagnostic());
      const occurrenceAtMost = labeled(assertions, "turn occurrence atMost", inspected.receipt.diagnostic());
      const occurrenceLessThan = labeled(assertions, "turn occurrence lessThan", inspected.receipt.diagnostic());
      const occurrenceGreaterThan = labeled(assertions, "turn occurrence greaterThan", inspected.receipt.diagnostic());
      expectOccurrence(bareToolMatch, "matched", "present");
      expectOccurrence(bareCalledTool, "matched", "present");
      expectOccurrence(occurrenceExactly, "matched", "count", "exact");
      expectOccurrence(occurrenceAtMost, "matched", "count", "at-most");
      expectOccurrence(occurrenceLessThan, "matched", "count", "less-than");
      expectOccurrence(occurrenceGreaterThan, "matched", "count", "greater-than");
      expect(criterionData(bareToolMatch)).toEqual(criterionData(bareCalledTool));

      const partialLowerBound = labeled(
        assertions,
        "partial source lower bound can match",
        inspected.receipt.diagnostic(),
      );
      const partialOccurrenceUpperBound = labeled(
        assertions,
        "partial source occurrence upper bound remains unavailable",
        inspected.receipt.diagnostic(),
      );
      expectOccurrence(partialLowerBound, "matched", "present", "at-least");
      expectOccurrence(partialOccurrenceUpperBound, "unavailable", "count", "at-most");

      const compositeSugar = labeled(assertions, "attempt calledTool composite", inspected.receipt.diagnostic());
      const compositeExplicit = labeled(assertions, "attempt explicit composite occurrence", inspected.receipt.diagnostic());
      expectOccurrence(compositeExplicit, "matched", "present", "at-least");
      expectOccurrence(compositeSugar, "matched", "present");
      expect(criterionData(compositeExplicit)).toEqual(criterionData(compositeSugar));

      const sessionOrder = labeled(assertions, "session explicit inOrder", inspected.receipt.diagnostic());
      const sessionOrderSugar = labeled(assertions, "session toolOrder", inspected.receipt.diagnostic());
      for (const entry of [sessionOrder, sessionOrderSugar]) {
        expectOccurrence(entry, "matched", "order");
        expect(dataString(entry, ["scope"])).toBe("session");
      }
      expect(criterionData(sessionOrder)).toEqual(criterionData(sessionOrderSugar));

      expect(labeled(assertions, "spread occurrence rejected", inspected.receipt.diagnostic()).decision.result).toBe("matched");
      expect(labeled(assertions, "spread inOrder rejected", inspected.receipt.diagnostic()).decision.result).toBe("matched");
      expect(labeled(assertions, "root inOrder rejected", inspected.receipt.diagnostic()).decision.result).toBe("matched");
      expect(labeled(assertions, "quantified inOrder step rejected", inspected.receipt.diagnostic()).decision.result).toBe("matched");

      const partialCount = labeled(assertions, "partial source cardinality remains unavailable", inspected.receipt.diagnostic());
      expectNumeric(partialCount, "unavailable");
      expect(dataString(partialCount, ["subject", "kind"])).toBe("collection-cardinality");
    },
  );
});
