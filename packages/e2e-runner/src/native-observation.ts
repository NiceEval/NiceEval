import { Predicate, Schema } from "effect";

import { matchesTitlePath, titleTemplate } from "./title-template.ts";
import type { InventoryExecutor } from "./inventory.ts";

export interface NativeTestObservation {
  readonly caseCount: number;
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly retries: number;
  readonly items?: readonly { readonly titlePath: readonly string[]; readonly outcome: "passed" | "failed" }[];
}

const NonNegativeInteger = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const VitestAssertion = Schema.Struct({
  fullName: Schema.String,
  status: Schema.String,
  retryReasons: Schema.optional(Schema.Array(Schema.Unknown)),
});
const VitestResult = Schema.Struct({ name: Schema.String, assertionResults: Schema.Array(VitestAssertion) });
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
  file: Schema.optional(Schema.String),
  suites: Schema.optional(Schema.Array(Schema.Unknown)),
  specs: Schema.optional(Schema.Array(Schema.Struct({ title: Schema.String, file: Schema.optional(Schema.String), tests: Schema.Array(PlaywrightTest) }))),
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

export interface NativeSelection {
  readonly only: boolean;
  readonly file?: string;
  readonly titlePath: readonly string[];
  readonly members?: readonly (readonly string[])[];
}
const selectedObservation = (observed: readonly { readonly file?: string | undefined; readonly titlePath: readonly string[]; readonly outcome: string; readonly retries: number }[], selection: NativeSelection): NativeTestObservation => {
  const matches = observed.filter(entry => matchesTitlePath(selection.titlePath, entry.titlePath) && (selection.file === undefined || entry.file === selection.file || entry.file?.replaceAll("\\", "/").endsWith(`/${selection.file}`)));
  const parameterized = titleTemplate(selection.titlePath.at(-1) ?? "").parameterized;
  if (matches.length === 0 || !parameterized && matches.length !== 1) throw new Error(`NativeSelectionInvalid: expected ${parameterized ? "at least one" : "exactly one"} selected case ${JSON.stringify(selection.titlePath)}, found ${matches.length}`);
  const keys = matches.map(entry => JSON.stringify(entry.titlePath));
  if (new Set(keys).size !== keys.length) throw new Error("NativeSelectionInvalid: duplicate expanded native title");
  if (selection.members !== undefined) {
    const expected = selection.members.map(path => JSON.stringify(path));
    if (expected.length !== keys.length || expected.some(key => !keys.includes(key))) throw new Error("NativeSelectionInvalid: expanded members differ from collection");
  }
  if (matches.some(entry => entry.retries !== 0)) throw new Error("NativeSelectionInvalid: selected case retried");
  if (matches.some(entry => entry.outcome !== "passed" && entry.outcome !== "failed")) throw new Error("NativeSelectionInvalid: selected case skipped or has unknown status");
  if (selection.only && observed.some(entry => !matches.includes(entry) && !["skipped", "pending", "todo"].includes(entry.outcome))) throw new Error("NativeSelectionInvalid: execution ran a non-target assertion");
  const items = matches.map(entry => ({ titlePath: entry.titlePath, outcome: entry.outcome as "passed" | "failed" }));
  return { caseCount: items.length, passed: items.filter(entry => entry.outcome === "passed").length, failed: items.filter(entry => entry.outcome === "failed").length, skipped: 0, retries: 0, items };
};
const selectedVitest = (input: unknown, selection: NativeSelection): NativeTestObservation => {
  const report = Schema.decodeUnknownSync(VitestReport)(input);
  return selectedObservation(report.testResults.flatMap(result => result.assertionResults.map(assertion => ({ file: result.name, titlePath: [assertion.fullName], outcome: assertion.status, retries: assertion.retryReasons?.length ?? 0 }))), selection);
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

const selectedPlaywright = (input: unknown, selection: NativeSelection): NativeTestObservation => {
  const report = Schema.decodeUnknownSync(PlaywrightReport)(input);
  const observed: Array<{ readonly file?: string | undefined; readonly titlePath: readonly string[]; readonly outcome: string; readonly retries: number }> = [];
  const visit = (value: unknown, parents: readonly string[], inheritedFile?: string): void => {
    const suite = Schema.decodeUnknownSync(PlaywrightSuite)(value);
    const path = suite.title === undefined || suite.title.length === 0 ? parents : [...parents, suite.title];
    for (const spec of suite.specs ?? []) for (const test of spec.tests) observed.push({ ...(spec.file ?? suite.file ?? inheritedFile ? { file: spec.file ?? suite.file ?? inheritedFile } : {}), titlePath: [...path, spec.title], outcome: test.status === "expected" ? "passed" : test.status === "unexpected" ? "failed" : test.status, retries: Math.max(0, ...test.results.map(result => result.retry)) });
    for (const child of suite.suites ?? []) visit(child, path, suite.file ?? inheritedFile);
  };
  for (const suite of report.suites) visit(suite, []);
  return selectedObservation(observed, selection);
};

export const VITEST_JSON_REPORTER_PATH = ".e2e-artifacts/niceeval-json-reporter.mjs";
// Vitest 5 defaults to a report file. Configure its public reporter explicitly
// so native evidence remains on stdout for both Concord and takeover.
export const VITEST_JSON_REPORTER_SOURCE = `import { JsonReporter } from "vitest/node";
export default class extends JsonReporter {
  constructor() { super({ stdout: true }); }
}
`;
export const nativeReporterArgs = (executor: InventoryExecutor): readonly string[] =>
  executor === "vitest" ? [`--reporter=./${VITEST_JSON_REPORTER_PATH}`] : ["--reporter=json"];

export function observeNativeTestResult(executor: InventoryExecutor, stdout: string, selection: NativeSelection): NativeTestObservation {
  const input = decodeJson(stdout);
  if (!Predicate.isObject(input)) throw new Error("native JSON reporter output must be an object");
  if (selection.only) return executor === "vitest" ? selectedVitest(input, selection) : selectedPlaywright(input, selection);
  // A default-load run must also include every expansion of its selected owner.
  const selected = executor === "vitest" ? selectedVitest(input, selection) : selectedPlaywright(input, selection);
  const total = executor === "vitest" ? observeVitest(input) : observePlaywright(input);
  return { ...total, ...(selected.items === undefined ? {} : { items: selected.items }) };
}
