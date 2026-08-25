// owner: docs/engineering/testing/e2e/eval.md#eval-assertion-scopes
// regression: memory/assertion-diagnostic-tree-overflows-record.md
// rerun: pnpm e2e test --repo eval -- --run test/assertion-scopes.test.ts

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
  readonly value?: unknown;
  readonly fields?: readonly { readonly label: string; readonly value: AssertionSegment }[];
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
}

interface ShowAssertion {
  readonly entryId: string;
  readonly display: { readonly label?: string };
  readonly source: AssertionSegment;
  readonly check: AssertionSegment;
  readonly observed: AssertionSegment;
  readonly expected: AssertionSegment;
  readonly explanation: AssertionSegment;
  readonly decision: { readonly result: string };
  readonly matcherDebugger?: unknown;
}

interface ShowDocument {
  readonly data: {
    readonly kind: string;
    readonly evidence: {
      readonly entries: readonly {
        readonly state: string;
        readonly detail?: {
          readonly entries: readonly ShowAssertion[];
        };
      }[];
    };
  };
}

function field(value: AssertionSegment | undefined, label: string): AssertionSegment | undefined {
  return value?.fields?.find((entry) => entry.label === label)?.value;
}

function stringField(value: AssertionSegment | undefined, label: string): string | undefined {
  const found = field(value, label);
  return found?.kind === "value" && typeof found.value === "string" ? found.value : undefined;
}

function criterionId(entry: ShowAssertion): string | undefined {
  return stringField(entry.check, "id");
}

function criterionData(entry: ShowAssertion): AssertionSegment | undefined {
  return field(entry.check, "data");
}

function labeled(assertions: readonly ShowAssertion[], label: string, diagnostic: string): ShowAssertion {
  return only(assertions, (entry) => entry.display.label === label, diagnostic);
}

function expectNumeric(entry: ShowAssertion, result: "matched" | "unavailable"): void {
  expect(criterionId(entry)).toBe("numeric-comparison/v1");
  expect(entry.decision.result).toBe(result);
  expect(entry.observed.receipt).toBeUndefined();
  expect(entry.matcherDebugger).toBeUndefined();
}

function expectOccurrence(
  entry: ShowAssertion,
  result: "matched" | "unavailable",
  assertion: "present" | "absent" | "count" | "order",
  quantifierKind?: string,
): void {
  expect(criterionId(entry)).toBe("occurrence/v2");
  expect(entry.decision.result).toBe(result);
  expect(entry.matcherDebugger).toBeDefined();
  expect(stringField(criterionData(entry), "assertion")).toBe(assertion);
  if (quantifierKind !== undefined) {
    expect(stringField(field(criterionData(entry), "quantifier"), "kind")).toBe(quantifierKind);
  }
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
      const partialAbsence = labeled(
        assertions,
        "partial source absence remains unavailable",
        shown.diagnostic(),
      );
      const partialExact = labeled(
        assertions,
        "partial source exact count remains unavailable",
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

      const turnCount = labeled(assertions, "turn explicit cardinality", shown.diagnostic());
      const turnMax = labeled(assertions, "turn maxToolCalls", shown.diagnostic());
      const cutFromSubject = labeled(assertions, "cut from subject", shown.diagnostic());
      const attemptCount = labeled(assertions, "attempt explicit cardinality", shown.diagnostic());
      const attemptMax = labeled(assertions, "attempt maxToolCalls", shown.diagnostic());
      const authorArray = labeled(assertions, "author array cardinality", shown.diagnostic());
      const spreadCount = labeled(assertions, "spread cardinality still works", shown.diagnostic());
      for (const entry of [turnCount, turnMax, cutFromSubject, authorArray, spreadCount]) {
        expectNumeric(entry, "matched");
      }
      for (const entry of [attemptCount, attemptMax]) {
        expectNumeric(entry, "unavailable");
      }
      expect(criterionData(turnCount)).toEqual(criterionData(turnMax));
      expect(criterionData(attemptCount)).toEqual(criterionData(attemptMax));
      expect(stringField(field(criterionData(turnCount), "subject"), "kind")).toBe("collection-cardinality");
      expect(stringField(field(criterionData(turnCount), "subject"), "scope")).toBe("turn");
      expect(stringField(field(criterionData(cutFromSubject), "subject"), "scope")).toBe("turn");
      expect(stringField(field(criterionData(attemptCount), "subject"), "kind")).toBe("collection-cardinality");
      expect(stringField(field(criterionData(attemptCount), "subject"), "scope")).toBe("attempt");
      expect(stringField(field(criterionData(authorArray), "subject"), "kind")).toBe("explicit-value");
      expect(stringField(field(criterionData(spreadCount), "subject"), "kind")).toBe("explicit-value");

      const turnMatching = labeled(assertions, "turn explicit occurrence", shown.diagnostic());
      const turnCalled = labeled(assertions, "turn calledTool", shown.diagnostic());
      const unusedExplicit = labeled(assertions, "unused session explicit occurrence zero", shown.diagnostic());
      const unusedSugar = labeled(assertions, "unused session usedNoTools", shown.diagnostic());
      for (const entry of [turnMatching, turnCalled]) {
        expectOccurrence(entry, "matched", "present", "at-least");
      }
      for (const entry of [unusedExplicit, unusedSugar]) {
        expectOccurrence(entry, "matched", "absent");
      }
      expect(criterionData(turnMatching)).toEqual(criterionData(turnCalled));
      expect(criterionData(unusedExplicit)).toEqual(criterionData(unusedSugar));

      const bareToolMatch = labeled(assertions, "turn bare toolMatch", shown.diagnostic());
      const bareCalledTool = labeled(assertions, "turn calledTool bare", shown.diagnostic());
      const occurrenceExactly = labeled(assertions, "turn occurrence exactly", shown.diagnostic());
      const occurrenceAtMost = labeled(assertions, "turn occurrence atMost", shown.diagnostic());
      const occurrenceLessThan = labeled(assertions, "turn occurrence lessThan", shown.diagnostic());
      const occurrenceGreaterThan = labeled(assertions, "turn occurrence greaterThan", shown.diagnostic());
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
        shown.diagnostic(),
      );
      const partialOccurrenceUpperBound = labeled(
        assertions,
        "partial source occurrence upper bound remains unavailable",
        shown.diagnostic(),
      );
      expectOccurrence(partialLowerBound, "matched", "present", "at-least");
      expectOccurrence(partialOccurrenceUpperBound, "unavailable", "count", "at-most");

      const compositeSugar = labeled(assertions, "attempt calledTool composite", shown.diagnostic());
      const compositeExplicit = labeled(assertions, "attempt explicit composite occurrence", shown.diagnostic());
      expectOccurrence(compositeExplicit, "matched", "present", "at-least");
      expectOccurrence(compositeSugar, "matched", "present");
      expect(criterionData(compositeExplicit)).toEqual(criterionData(compositeSugar));

      const sessionOrder = labeled(assertions, "session explicit inOrder", shown.diagnostic());
      const sessionOrderSugar = labeled(assertions, "session toolOrder", shown.diagnostic());
      for (const entry of [sessionOrder, sessionOrderSugar]) {
        expectOccurrence(entry, "matched", "order");
        expect(stringField(criterionData(entry), "scope")).toBe("session");
      }
      expect(criterionData(sessionOrder)).toEqual(criterionData(sessionOrderSugar));

      expect(labeled(assertions, "spread occurrence rejected", shown.diagnostic()).decision.result).toBe("matched");
      expect(labeled(assertions, "spread inOrder rejected", shown.diagnostic()).decision.result).toBe("matched");
      expect(labeled(assertions, "root inOrder rejected", shown.diagnostic()).decision.result).toBe("matched");
      expect(labeled(assertions, "quantified inOrder step rejected", shown.diagnostic()).decision.result).toBe("matched");

      const partialCount = labeled(assertions, "partial source cardinality remains unavailable", shown.diagnostic());
      expectNumeric(partialCount, "unavailable");
      expect(stringField(field(criterionData(partialCount), "subject"), "kind")).toBe("collection-cardinality");
    },
  );
});
