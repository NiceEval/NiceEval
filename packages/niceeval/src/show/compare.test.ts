import { expect, test } from "vitest";
import { comparisonGateExitCode } from "./contribution.ts";
import { comparisonTransition, renderComparison, type ComparisonAttempt } from "./render.ts";
import type { AttemptView } from "./model.ts";
import type { InspectionSuccessDocumentFor } from "../inspection/index.ts";

// @use-case docs/feature/experiments/use-case/machine-output-ci-gate.md
test.concurrent("comparison distinguishes regressions and applies an inclusive allowance", () => {
  const attempt = (verdict: AttemptView["verdict"]) => ({ verdict }) satisfies Pick<AttemptView, "verdict">;
  expect(comparisonTransition(attempt("passed"), attempt("failed"))).toBe("regressed");
  expect(comparisonTransition(attempt("failed"), attempt("passed"))).toBe("improved");
  expect(comparisonTransition(attempt("passed"), attempt("errored"))).toBe("incomparable");
  expect(comparisonGateExitCode(1, 0)).toBe(1);
  expect(comparisonGateExitCode(1, 1)).toBe(0);
  expect(comparisonGateExitCode(1, undefined)).toBe(0);
});

// @feature docs/feature/inspection/README.md
test.concurrent("comparison renders paired quality and exact decimal cost deltas", () => {
  const member = (locator: string) => ({
    key: "key",
    runId: locator,
    plannedAttemptId: "slot",
    evalId: "task",
    attemptOrdinal: 0,
    locator,
  });
  const left = member("@LEFT");
  const right = member("@RIGHT");
  const comparison: InspectionSuccessDocumentFor<"runs.compare">["comparison"] = {
    mode: "paired",
    left: { runs: [], members: [left] },
    right: { runs: [], members: [right] },
    exactMemberSet: true,
    pairs: [{ key: "key", left, right }],
  };
  const attempt = (verdict: AttemptView["verdict"], earned: number, cost: string) =>
    ({
      verdict,
      score: { state: "complete", earned, possible: 1 },
      totalCosts: {
        state: "complete",
        values: [{ currency: "USD", value: cost, source: "reported" }],
        missingSources: [],
        gaps: [],
      },
    }) satisfies ComparisonAttempt;
  const attempts = new Map([
    [left.locator, attempt("passed", 1, "0.10")],
    [right.locator, attempt("failed", 0, "0.30")],
  ]);
  const rendered = renderComparison(comparison, attempts);
  expect(rendered).toContain("regressed");
  expect(rendered).toContain("-1");
  expect(rendered).toContain("USD +0.20");
  expect(rendered).toContain("Regressed");
  const sideBySide = renderComparison({ ...comparison, mode: "side-by-side", pairs: [] }, attempts);
  expect(sideBySide).toContain("Baseline");
  expect(sideBySide).toContain("Candidate");
  expect(sideBySide).toContain("not evaluated");
});
