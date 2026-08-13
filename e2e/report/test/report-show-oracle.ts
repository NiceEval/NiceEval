import { expect } from "vitest";

type JsonRecord = Readonly<Record<string, unknown>>;

export interface ClassicFixtureBindings {
  readonly runs: {
    readonly baseline: string;
    readonly companion: string;
    readonly main: string;
  };
  readonly attempts: {
    readonly baselineFail: string;
    readonly companion: readonly [string, string, string];
    readonly mainError: string;
    readonly mainFail: string;
    readonly mainTool: string;
  };
}

interface TranscriptEvidence {
  readonly lastRunIso: string;
  readonly runRange: string;
  readonly treeRows: readonly {
    readonly hierarchy: string;
    readonly record: string;
    readonly passRate: string;
  }[];
}

/**
 * Owner-local oracle for the 0.12.1-style dashboard surface. The fixture DSL
 * expands only expected public data; it never imports NiceEval calculations or
 * renderers. Dynamic timing is admitted at named seams and checked separately.
 */
export function classicReportShowOracle(input: { readonly transcript: string }) {
  return Object.freeze({
    expectDocument(actual: unknown, bindings: ClassicFixtureBindings): TranscriptEvidence {
      validateBindings(bindings);
      const document = asRecord(actual, "classic Report document");
      const children = asArray(document.children, "classic Report children");
      expect(children.map((child) => asRecord(child, "classic block").type)).toEqual([
        "hero",
        "summary",
        "ranked-bars",
        "scatter",
        "tree-table",
      ]);

      const summary = asRecord(children[1], "summary");
      const summaryMetrics = asArray(summary.metrics, "summary metrics").map((metric) =>
        asRecord(metric, "summary metric")
      );
      const lastRunAt = finiteInteger(summary.lastRunAt, "summary.lastRunAt");
      const runRangeMetric = summaryMetrics[6]!;
      const runRange = stringValue(runRangeMetric.display, "runRange.display");
      expect(runRangeMetric.value).toBe(lastRunAt);
      expect(runRange).toMatch(
        /^3 · \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z – \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/,
      );

      const tree = asRecord(children[4], "tree-table");
      const actualRows = asArray(tree.rows, "tree-table rows").map((row) =>
        asRecord(row, "tree-table row")
      );
      expect(actualRows).toHaveLength(15);
      const resolvedBindings: ClassicFixtureBindingsResolved = Object.freeze({
        runs: bindings.runs,
        attempts: Object.freeze({
          baselineFail: bindings.attempts.baselineFail,
          companion: bindings.attempts.companion,
          mainError: bindings.attempts.mainError,
          mainFail: bindings.attempts.mainFail,
          mainTool: bindings.attempts.mainTool,
        }),
      });
      const durations = actualRows.map((row, index) =>
        durationValue(asRecord(asRecord(row.cells, `row ${index} cells`).avgTime, `row ${index} avgTime`))
      );
      assertDurationRelationships(durations);

      const expectedRows = classicTreeRows(resolvedBindings, durations);
      const expected = classicDocument({
        lastRunAt,
        runRange,
        rows: expectedRows,
      });
      expect(actual).toEqual(expected);

      return Object.freeze({
        lastRunIso: new Date(lastRunAt).toISOString(),
        runRange,
        treeRows: Object.freeze(expectedRows.map((row) => {
          const cells = row.cells;
          return Object.freeze({
            hierarchy: `${"  ".repeat(row.depth)}${treeKind(row.kind)} · ${row.label}`,
            record: String(cells.record),
            passRate: asRecord(cells.passRate, "expected pass rate").display as string,
          });
        })),
      });
    },

    expectExplicitRunDocument(actual: unknown, bindings: ClassicFixtureBindings): void {
      validateBindings(bindings);
      const document = asRecord(actual, "explicit-run classic Report document");
      expect(Object.keys(document).sort()).toEqual([
        "children",
        "metadataOrigin",
        "presentation",
        "title",
      ]);
      expect(document.metadataOrigin).toBe("partial");
      expect(document.presentation).toBe("classic-dashboard");

      const children = asArray(document.children, "explicit-run classic Report children");
      expect(children.map((child) => asRecord(child, "explicit-run classic block").type)).toEqual([
        "status",
        "hero",
        "summary",
        "ranked-bars",
        "scatter",
        "tree-table",
      ]);
      expect(children[0]).toEqual({
        type: "status",
        tone: "warning",
        label: "this Report selection does not include a current project declaration profile",
        detail: [{ type: "text", value: "selection-profile-unavailable" }],
      });

      const summary = asRecord(children[2], "explicit-run summary");
      const metrics = asArray(summary.metrics, "explicit-run summary metrics").map((metric) =>
        asRecord(metric, "explicit-run summary metric")
      );
      expect(metrics.map((metric) => [metric.key, metric.display])).toEqual([
        ["passRate", "33.3%"],
        ["experiments", "1"],
        ["evals", "3"],
        ["attempts", "3"],
        ["evalResults", "1 passed / 1 failed / 1 errored"],
        ["totalCost", "$0.04"],
        ["runRange", expect.stringMatching(/^1 · .+ – .+$/)],
      ]);

      const bars = asRecord(children[3], "explicit-run bars");
      expect(bars.points).toEqual([{
        key: "main",
        label: "main",
        series: "unknown",
        value: 1 / 3,
        display: "33.3%",
        coverage: { basis: "eval", samples: 3, total: 3 },
      }]);

      const scatter = asRecord(children[4], "explicit-run scatter");
      const series = asRecord(asArray(scatter.series, "explicit-run scatter series")[0], "scatter series");
      expect(series.points).toEqual([{
        key: "main",
        x: 0.04,
        y: 1 / 3,
        xDisplay: "$0.04",
        yDisplay: "33.3%",
      }]);

      const tree = asRecord(children[5], "explicit-run tree-table");
      const rows = asArray(tree.rows, "explicit-run tree-table rows").map((row) =>
        asRecord(row, "explicit-run tree-table row")
      );
      expect(rows.map((row) => row.kind)).toEqual([
        "experiment",
        "eval",
        "attempt",
        "eval",
        "attempt",
        "eval",
        "attempt",
      ]);
      expect(rows.map((row) => row.label)).toEqual([
        "main",
        "deliberate-error",
        "attempt 0",
        "deliberate-fail",
        "attempt 0",
        "tool-call",
        "attempt 0",
      ]);
      for (const [index, row] of rows.entries()) {
        const cells = asRecord(row.cells, `explicit-run row ${index} cells`);
        expect(cells.model, `explicit-run row ${index} model`).toBe("unknown");
        expect(cells.agent, `explicit-run row ${index} agent`).toBe("unknown");
      }
      expect(rows.map((row) => asRecord(row.cells, "explicit-run row cells").record)).toEqual([
        bindings.runs.main,
        bindings.runs.main,
        bindings.attempts.mainError,
        bindings.runs.main,
        bindings.attempts.mainFail,
        bindings.runs.main,
        bindings.attempts.mainTool,
      ]);
    },

    expectTranscript(actual: string, evidence: TranscriptEvidence): void {
      const lines = actual.split("\n");
      const lastRunLine = onlyLine(lines, "Last run", (line) => line.startsWith("│Last run: "));
      expect(lastRunLine).toContain(evidence.lastRunIso);
      expect(Array.from(lastRunLine)).toHaveLength(120);

      const runRangeLine = onlyLine(lines, "Run range", (line) => line.startsWith("│Run range: "));
      expect(runRangeLine).toContain(evidence.runRange);
      expect(Array.from(runRangeLine)).toHaveLength(120);

      const headerIndex = lines.findIndex((line) => line.includes("│ Hierarchy") && line.includes("│ Record"));
      expect(headerIndex, "classic tree-table header").toBeGreaterThan(-1);
      const tableRows = lines.slice(headerIndex + 1).filter((line) => line.startsWith("│"));
      expect(tableRows, "classic tree-table data rows").toHaveLength(evidence.treeRows.length);

      const replacements: LiteralReplacement[] = [
        { name: "last-run-line", value: lastRunLine, occurrences: 1 },
        { name: "run-range-line", value: runRangeLine, occurrences: 1 },
      ];
      tableRows.forEach((line, index) => {
        const expectedRow = evidence.treeRows[index]!;
        expect(line, `tree row ${index} hierarchy`).toContain(expectedRow.hierarchy);
        expect(line, `tree row ${index} record`).toContain(expectedRow.record);
        expect(line, `tree row ${index} pass rate`).toContain(expectedRow.passRate);
        replacements.push({ name: `tree-row-${index}`, value: line, occurrences: 1 });
      });

      expect(applyLiteralReplacements(actual, replacements)).toBe(input.transcript);
    },
  });
}

function classicDocument(input: {
  readonly lastRunAt: number;
  readonly runRange: string;
  readonly rows: readonly TreeRow[];
}): JsonRecord {
  return {
    title: "Classic Report fixture",
    children: [
      {
        type: "hero",
        description: "Classic Report acceptance fixture",
        links: [{
          label: "Read the Report contract",
          target: { kind: "external", href: "https://github.com/CorrectRoadH/niceeval" },
        }],
      },
      {
        type: "summary",
        lastRunAt: input.lastRunAt,
        metrics: [
          displayMetric("passRate", "Pass rate", 0.2, "20.0%", 5, 5, "ratio"),
          displayMetric("experiments", "Experiments", 3, "3", 3, 3),
          displayMetric("evals", "Evals", 5, "5", 5, 5),
          displayMetric("attempts", "Attempts", 7, "7", 7, 7),
          displayMetric(
            "evalResults",
            "Eval results",
            "1 passed / 3 failed / 1 errored",
            "1 passed / 3 failed / 1 errored",
            5,
            5,
          ),
          displayMetric("totalCost", "Total cost", 0.1, "$0.10", 6, 7, "USD"),
          displayMetric("runRange", "Run range", input.lastRunAt, input.runRange, 3, 3),
        ],
      },
      {
        type: "ranked-bars",
        title: "Pass rate(%)",
        layout: "horizontal",
        points: [
          barPoint("codex", "codex", "baseline", 0.25, "25.0%", 4, 4),
          barPoint("bub", "bub", "baseline", 0, "0.0%", 1, 1),
        ],
        better: "higher",
      },
      {
        type: "scatter",
        title: "Experiments",
        xLabel: "Cost",
        yLabel: "Pass rate",
        connect: false,
        series: [{
          label: "Experiments",
          points: [
            { key: "classic-baseline", x: 0.03, y: 0, xDisplay: "$0.03", yDisplay: "0.0%" },
            { key: "classic-companion", x: 0.03, y: 0, xDisplay: "$0.03", yDisplay: "0.0%" },
            { key: "main", x: 0.04, y: 1 / 3, xDisplay: "$0.04", yDisplay: "33.3%" },
          ],
        }],
      },
      {
        type: "tree-table",
        caption: "Experiments",
        columns: [
          { key: "model", label: "Model" },
          { key: "agent", label: "Agent" },
          { key: "avgTime", label: "Avg time", align: "end" },
          { key: "passRate", label: "Pass rate", align: "end" },
          { key: "tokens", label: "Tokens", align: "end" },
          { key: "cost", label: "Cost", align: "end" },
          { key: "record", label: "Record" },
        ],
        rows: input.rows,
      },
    ],
    presentation: "classic-dashboard",
    metadataOrigin: "current-declaration",
  };
}

interface TreeRow extends JsonRecord {
  readonly key: string;
  readonly kind: "experiment" | "eval" | "attempt";
  readonly depth: 0 | 1 | 2;
  readonly label: string;
  readonly target?: JsonRecord;
  readonly cells: JsonRecord;
}

function classicTreeRows(
  binding: ClassicFixtureBindingsResolved,
  duration: readonly number[],
): readonly TreeRow[] {
  const baseline = groupCells("report-fixture-baseline", duration[0]!, 0, "0.0%", 1, 1, 15, 1, 1, 0.03, 1, 1, binding.runs.baseline);
  const companion = groupCells("report-fixture-companion", duration[3]!, 0, "0.0%", 1, 1, 45, 3, 3, 0.03, 3, 3, binding.runs.companion);
  const main = groupCells("report-fixture", duration[8]!, 1 / 3, "33.3%", 3, 3, 30, 2, 3, 0.04, 2, 3, binding.runs.main);
  return [
    treeRow("classic-baseline", "experiment", 0, "bub", baseline),
    treeRow("classic-baseline/deliberate-fail", "eval", 1, "deliberate-fail", {
      ...baseline,
      avgTime: durationMetric(duration[1]!, 1, 1),
    }),
    attemptRow(binding.attempts.baselineFail, 0, "bub", "report-fixture-baseline", duration[2]!, 0, "0.0%", 15, 0.03),
    treeRow("classic-companion", "experiment", 0, "codex", companion),
    treeRow("classic-companion/deliberate-fail", "eval", 1, "deliberate-fail", {
      ...companion,
      avgTime: durationMetric(duration[4]!, 1, 1),
    }),
    ...binding.attempts.companion.map((locator, attempt) =>
      attemptRow(locator, attempt, "codex", "report-fixture-companion", duration[5 + attempt]!, 0, "0.0%", 15, 0.01)
    ),
    treeRow("main", "experiment", 0, "codex", main),
    treeRow("main/deliberate-error", "eval", 1, "deliberate-error", groupCells(
      "report-fixture", duration[9]!, 0, "0.0%", 1, 1, null, 0, 1, null, 0, 1, binding.runs.main,
    )),
    attemptRow(binding.attempts.mainError, 0, "codex", "report-fixture", duration[10]!, 0, "0.0%", null, null),
    treeRow("main/deliberate-fail", "eval", 1, "deliberate-fail", groupCells(
      "report-fixture", duration[11]!, 0, "0.0%", 1, 1, 15, 1, 1, 0.02, 1, 1, binding.runs.main,
    )),
    attemptRow(binding.attempts.mainFail, 0, "codex", "report-fixture", duration[12]!, 0, "0.0%", 15, 0.02),
    treeRow("main/tool-call", "eval", 1, "tool-call", groupCells(
      "report-fixture", duration[13]!, 1, "100.0%", 1, 1, 15, 1, 1, 0.02, 1, 1, binding.runs.main,
    )),
    attemptRow(binding.attempts.mainTool, 0, "codex", "report-fixture", duration[14]!, 1, "100.0%", 15, 0.02),
  ];
}

function groupCells(
  agent: string,
  duration: number,
  rate: number,
  rateDisplay: string,
  rateSamples: number,
  rateTotal: number,
  tokens: number | null,
  tokenSamples: number,
  tokenTotal: number,
  cost: number | null,
  costSamples: number,
  costTotal: number,
  record: string,
): JsonRecord {
  return {
    model: "report-fixture-v1",
    agent,
    avgTime: durationMetric(duration, rateTotal, rateTotal),
    passRate: valueMetric(rate, rateDisplay, rateSamples, rateTotal, "ratio"),
    tokens: valueMetric(tokens, tokens === null ? "—" : String(tokens), tokenSamples, tokenTotal),
    cost: valueMetric(cost, cost === null ? "—" : usd(cost), costSamples, costTotal, "USD"),
    record,
  };
}

function attemptRow(
  locator: string,
  attempt: number,
  _experiment: string,
  agent: string,
  duration: number,
  rate: number,
  rateDisplay: string,
  tokens: number | null,
  cost: number | null,
): TreeRow {
  const attemptId = locator.slice(1);
  return treeRow(attemptId, "attempt", 2, `attempt ${attempt}`, {
    model: "report-fixture-v1",
    agent,
    avgTime: durationMetric(duration, 1, 1),
    passRate: valueMetric(rate, rateDisplay, 1, 1, "ratio"),
    tokens: valueMetric(tokens, tokens === null ? "—" : String(tokens), tokens === null ? 0 : 1, 1),
    cost: valueMetric(cost, cost === null ? "—" : usd(cost), cost === null ? 0 : 1, 1, "USD"),
    record: locator,
  }, { kind: "attempt", locator });
}

function treeRow(
  key: string,
  kind: TreeRow["kind"],
  depth: TreeRow["depth"],
  label: string,
  cells: JsonRecord,
  target?: JsonRecord,
): TreeRow {
  return {
    key,
    kind,
    depth,
    label,
    ...(target === undefined ? {} : { target }),
    cells,
  };
}

function displayMetric(
  key: string,
  label: string,
  value: string | number | null,
  display: string,
  samples: number,
  total: number,
  unit?: string,
): JsonRecord {
  return {
    key,
    label,
    value,
    display,
    ...(unit === undefined ? {} : { unit }),
    coverage: coverage(samples, total),
  };
}

function valueMetric(
  value: number | null,
  display: string,
  samples: number,
  total: number,
  unit?: string,
): JsonRecord {
  return {
    value,
    display,
    ...(unit === undefined ? {} : { unit }),
    coverage: coverage(samples, total),
  };
}

function durationMetric(value: number, samples: number, total: number): JsonRecord {
  return valueMetric(value, `${Math.round(value)}ms`, samples, total, "ms");
}

function barPoint(
  key: string,
  label: string,
  series: string,
  value: number,
  display: string,
  samples: number,
  total: number,
): JsonRecord {
  return { key, label, series, value, display, coverage: coverage(samples, total) };
}

function coverage(samples: number, total: number): JsonRecord {
  return { basis: "eval", samples, total };
}

function usd(value: number): string {
  return `$${value.toFixed(value === 0 || Math.abs(value) >= 0.01 ? 2 : 4)}`;
}

function durationValue(metric: JsonRecord): number {
  expect(Object.keys(metric).sort()).toEqual(["coverage", "display", "unit", "value"]);
  const value = finiteNumber(metric.value, "avgTime.value");
  expect(value).toBeGreaterThanOrEqual(0);
  expect(metric.display).toBe(`${Math.round(value)}ms`);
  expect(metric.unit).toBe("ms");
  return value;
}

function assertDurationRelationships(duration: readonly number[]): void {
  expect(duration).toHaveLength(15);
  expect(duration[0]).toBe(duration[1]);
  expect(duration[1]).toBe(duration[2]);
  expect(duration[3]).toBe(duration[4]);
  expect(duration[3]).toBeCloseTo(mean(duration.slice(5, 8)), 10);
  expect(duration[8]).toBeCloseTo(mean([duration[9]!, duration[11]!, duration[13]!]), 10);
  expect(duration[9]).toBe(duration[10]);
  expect(duration[11]).toBe(duration[12]);
  expect(duration[13]).toBe(duration[14]);
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function validateBindings(binding: ClassicFixtureBindings): void {
  for (const runId of Object.values(binding.runs)) {
    expect(runId).toMatch(/^[0-9a-f]{8}-[0-9a-f-]{27}$/);
  }
  for (const locator of [
    binding.attempts.baselineFail,
    ...binding.attempts.companion,
    binding.attempts.mainError,
    binding.attempts.mainFail,
    binding.attempts.mainTool,
  ]) {
    expect(locator).toMatch(/^@[0-9a-f]{8}-[0-9a-f-]{27}$/);
  }
  expect(new Set(binding.attempts.companion).size).toBe(3);
}

interface ClassicFixtureBindingsResolved {
  readonly runs: ClassicFixtureBindings["runs"];
  readonly attempts: {
    readonly baselineFail: string;
    readonly companion: readonly [string, string, string];
    readonly mainError: string;
    readonly mainFail: string;
    readonly mainTool: string;
  };
}

function treeKind(kind: TreeRow["kind"]): string {
  return kind === "experiment" ? "Experiment" : kind === "eval" ? "Eval" : "Attempt";
}

function onlyLine(
  lines: readonly string[],
  label: string,
  predicate: (line: string) => boolean,
): string {
  const found = lines.filter(predicate);
  expect(found, `${label} line count`).toHaveLength(1);
  return found[0]!;
}

function applyLiteralReplacements(
  input: string,
  replacements: readonly LiteralReplacement[],
): string {
  let normalized = input;
  for (const replacement of replacements) {
    const occurrences = normalized.split(replacement.value).length - 1;
    expect(occurrences, `literal replacement ${replacement.name} occurrence audit`).toBe(
      replacement.occurrences,
    );
    normalized = normalized.split(replacement.value).join(`<${replacement.name}>`);
  }
  return normalized;
}

interface LiteralReplacement {
  readonly name: string;
  readonly value: string;
  readonly occurrences: number;
}

function asRecord(value: unknown, label: string): JsonRecord {
  expect(value, label).toBeTypeOf("object");
  expect(value, label).not.toBeNull();
  expect(Array.isArray(value), label).toBe(false);
  return value as JsonRecord;
}

function asArray(value: unknown, label: string): readonly unknown[] {
  expect(Array.isArray(value), label).toBe(true);
  return value as readonly unknown[];
}

function finiteNumber(value: unknown, label: string): number {
  expect(typeof value, label).toBe("number");
  expect(Number.isFinite(value), label).toBe(true);
  return value as number;
}

function finiteInteger(value: unknown, label: string): number {
  const number = finiteNumber(value, label);
  expect(Number.isSafeInteger(number), label).toBe(true);
  expect(number, label).toBeGreaterThanOrEqual(0);
  return number;
}

function stringValue(value: unknown, label: string): string {
  expect(typeof value, label).toBe("string");
  return value as string;
}
