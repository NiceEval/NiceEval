import { Predicate, Schema } from "effect";

import type { InventoryExecutor } from "./inventory.ts";

export interface NativeTestObservation {
  readonly caseCount: number;
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly retries: number;
}

const NonNegativeInteger = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const VitestAssertion = Schema.Struct({
  fullName: Schema.String,
  status: Schema.String,
  retryReasons: Schema.optional(Schema.Array(Schema.Unknown)),
});
const VitestResult = Schema.Struct({ assertionResults: Schema.Array(VitestAssertion) });
const VitestReport = Schema.Struct({
  numTotalTests: NonNegativeInteger,
  numPassedTests: NonNegativeInteger,
  numFailedTests: NonNegativeInteger,
  numPendingTests: NonNegativeInteger,
  testResults: Schema.Array(VitestResult),
});
const PlaywrightResult = Schema.Struct({ retry: NonNegativeInteger });
const PlaywrightTest = Schema.Struct({
  status: Schema.String,
  results: Schema.Array(PlaywrightResult),
});
const PlaywrightSuite = Schema.Struct({
  title: Schema.optional(Schema.String),
  suites: Schema.optional(Schema.Array(Schema.Unknown)),
  specs: Schema.optional(Schema.Array(Schema.Struct({ title: Schema.String, tests: Schema.Array(PlaywrightTest) }))),
});
const PlaywrightReport = Schema.Struct({ suites: Schema.Array(Schema.Unknown) });

const decodeJson = (stdout: string): unknown => {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) throw new Error("native JSON reporter produced no output");
  return JSON.parse(trimmed) as unknown;
};

const observeVitest = (input: unknown): NativeTestObservation => {
  const report = Schema.decodeUnknownSync(VitestReport)(input);
  const retries = report.testResults.reduce(
    (total, result) => total + result.assertionResults.reduce(
      (subtotal, assertion) => subtotal + (assertion.retryReasons?.length ?? 0),
      0,
    ),
    0,
  );
  if (report.numTotalTests !== report.numPassedTests + report.numFailedTests + report.numPendingTests) {
    throw new Error("Vitest native counts do not sum to the reported total");
  }
  return {
    caseCount: report.numTotalTests,
    passed: report.numPassedTests,
    failed: report.numFailedTests,
    skipped: report.numPendingTests,
    retries,
  };
};

const sameTitlePath = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((part, index) => part === right[index]);

const selectedVitest = (input: unknown, titlePath: readonly string[]): NativeTestObservation => {
  const report = Schema.decodeUnknownSync(VitestReport)(input);
  const assertions = report.testResults.flatMap((result) => result.assertionResults);
  const expected = titlePath.join(" ");
  const matches = assertions.filter((assertion) => assertion.fullName === expected);
  if (matches.length !== 1) throw new Error(`Vitest native report must contain exactly one selected assertion ${JSON.stringify(expected)}, found ${matches.length}`);
  const target = matches[0]!;
  const retries = target.retryReasons?.length ?? 0;
  if (retries !== 0) throw new Error("selected Vitest case retried");
  if (assertions.some((assertion) => assertion !== target && assertion.status !== "skipped" && assertion.status !== "pending" && assertion.status !== "todo")) {
    throw new Error("Vitest exact-case execution ran a non-target assertion");
  }
  if (target.status === "skipped" || target.status === "pending" || target.status === "todo") throw new Error("selected Vitest case was skipped");
  if (target.status !== "passed" && target.status !== "failed") throw new Error(`selected Vitest case has unknown status ${JSON.stringify(target.status)}`);
  return { caseCount: 1, passed: target.status === "passed" ? 1 : 0, failed: target.status === "failed" ? 1 : 0, skipped: 0, retries: 0 };
};

const observePlaywright = (input: unknown): NativeTestObservation => {
  const report = Schema.decodeUnknownSync(PlaywrightReport)(input);
  const tests: Array<typeof PlaywrightTest.Type> = [];
  const visit = (value: unknown): void => {
    const suite = Schema.decodeUnknownSync(PlaywrightSuite)(value);
    for (const spec of suite.specs ?? []) tests.push(...spec.tests);
    for (const child of suite.suites ?? []) visit(child);
  };
  for (const suite of report.suites) visit(suite);
  const passed = tests.filter((test) => test.status === "expected").length;
  const skipped = tests.filter((test) => test.status === "skipped").length;
  const failed = tests.length - passed - skipped;
  const retries = tests.reduce(
    (total, test) => total + Math.max(0, ...test.results.map((result) => result.retry)),
    0,
  );
  if (tests.some((test) => !["expected", "unexpected", "flaky", "skipped"].includes(test.status))) {
    throw new Error("Playwright native report contains an unknown test status");
  }
  return { caseCount: tests.length, passed, failed, skipped, retries };
};

const selectedPlaywright = (input: unknown, titlePath: readonly string[]): NativeTestObservation => {
  const report = Schema.decodeUnknownSync(PlaywrightReport)(input);
  const observed: Array<{ readonly titlePath: readonly string[]; readonly test: typeof PlaywrightTest.Type }> = [];
  const visit = (value: unknown, parents: readonly string[]): void => {
    const suite = Schema.decodeUnknownSync(PlaywrightSuite)(value);
    const suiteTitle = suite.title === undefined || suite.title.length === 0 ? parents : [...parents, suite.title];
    for (const spec of suite.specs ?? []) for (const test of spec.tests) observed.push({ titlePath: [...suiteTitle, spec.title], test });
    for (const child of suite.suites ?? []) visit(child, suiteTitle);
  };
  for (const suite of report.suites) visit(suite, []);
  const matches = observed.filter((entry) => sameTitlePath(entry.titlePath, titlePath));
  if (matches.length !== 1) throw new Error(`Playwright native report must contain exactly one selected test ${JSON.stringify(titlePath)}, found ${matches.length}`);
  const target = matches[0]!.test;
  const retries = Math.max(0, ...target.results.map((result) => result.retry));
  if (retries !== 0) throw new Error("selected Playwright case retried");
  if (observed.some((entry) => entry.test !== target && entry.test.status !== "skipped")) throw new Error("Playwright exact-case execution ran a non-target test");
  if (target.status === "skipped") throw new Error("selected Playwright case was skipped");
  if (!["expected", "unexpected", "flaky"].includes(target.status)) throw new Error(`selected Playwright case has unknown status ${JSON.stringify(target.status)}`);
  return { caseCount: 1, passed: target.status === "expected" ? 1 : 0, failed: target.status === "expected" ? 0 : 1, skipped: 0, retries: 0 };
};

export const nativeReporterArgs = (executor: InventoryExecutor): readonly string[] =>
  executor === "vitest" ? ["--reporter=json"] : ["--reporter=json"];

export function observeNativeTestResult(executor: InventoryExecutor, stdout: string, selection: { readonly only: boolean; readonly titlePath: readonly string[] }): NativeTestObservation {
  const input = decodeJson(stdout);
  if (!Predicate.isObject(input)) throw new Error("native JSON reporter output must be an object");
  if (selection.only) return executor === "vitest" ? selectedVitest(input, selection.titlePath) : selectedPlaywright(input, selection.titlePath);
  return executor === "vitest" ? observeVitest(input) : observePlaywright(input);
}
