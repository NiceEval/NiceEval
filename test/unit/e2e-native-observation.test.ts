import { describe, expect, test } from "vitest";

import { observeNativeTestResult } from "../../packages/e2e-runner/src/native-observation.ts";

const vitestReport = (assertionResults: readonly object[]) => ({
  numTotalTests: assertionResults.length,
  numPassedTests: assertionResults.filter((entry) => (entry as { status: string }).status === "passed").length,
  numFailedTests: assertionResults.filter((entry) => (entry as { status: string }).status === "failed").length,
  numPendingTests: assertionResults.filter((entry) => ["skipped", "pending", "todo"].includes((entry as { status: string }).status)).length,
  testResults: [{ assertionResults }],
});

describe("native test observations", () => {
  test("an exact Vitest case ignores runner-filtered siblings", () => {
    const report = vitestReport([
      { fullName: "suite target", status: "passed" },
      { fullName: "suite sibling", status: "skipped" },
    ]);

    expect(observeNativeTestResult("vitest", JSON.stringify(report), { only: true, titlePath: ["suite target"] })).toEqual({
      caseCount: 1,
      passed: 1,
      failed: 0,
      skipped: 0,
      retries: 0,
    });
    expect(observeNativeTestResult("vitest", JSON.stringify(report), { only: false, titlePath: ["suite target"] })).toEqual({
      caseCount: 2,
      passed: 1,
      failed: 0,
      skipped: 1,
      retries: 0,
    });
  });

  test.each([
    {
      name: "selected skip",
      assertions: [{ fullName: "target", status: "skipped" }],
      message: "selected Vitest case was skipped",
    },
    {
      name: "selected retry",
      assertions: [{ fullName: "target", status: "passed", retryReasons: [{}] }],
      message: "selected Vitest case retried",
    },
    {
      name: "non-target execution",
      assertions: [{ fullName: "target", status: "passed" }, { fullName: "sibling", status: "passed" }],
      message: "ran a non-target assertion",
    },
  ])("rejects $name in an exact Vitest observation", ({ assertions, message }) => {
    expect(() => observeNativeTestResult("vitest", JSON.stringify(vitestReport(assertions)), { only: true, titlePath: ["target"] })).toThrow(message);
  });

  test("an exact Playwright case ignores runner-filtered sibling specs", () => {
    const report = {
      suites: [{
        title: "group",
        specs: [
          { title: "target", tests: [{ status: "expected", results: [{ retry: 0 }] }] },
          { title: "sibling", tests: [{ status: "skipped", results: [] }] },
        ],
      }],
    };

    expect(observeNativeTestResult("playwright", JSON.stringify(report), { only: true, titlePath: ["group", "target"] })).toEqual({
      caseCount: 1,
      passed: 1,
      failed: 0,
      skipped: 0,
      retries: 0,
    });
  });
});
