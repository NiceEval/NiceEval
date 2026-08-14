import { expect } from "vitest";

export interface ReportStatExpectation {
  readonly label: string;
  readonly value: string;
  readonly detail?: string;
}

export interface ReportBarExpectation {
  readonly label: string;
  readonly value: number;
  readonly display: string;
}

export interface ReportScatterPointExpectation {
  readonly label: string;
  readonly key: string;
  readonly xDisplay: string;
  readonly yDisplay: string;
}

export interface ReportExperimentExpectation {
  readonly id: string;
  readonly model: string;
  readonly agent: string;
  readonly passRate: string;
}

export interface AttemptExpectation {
  readonly experimentId: string;
  readonly evalId: string;
  readonly verdict: "passed" | "failed";
  /** The public @locator captured by the frozen World's producer. */
  readonly locator: string;
}

export interface AttemptIdentity extends AttemptExpectation {
  readonly locator: string;
}

export interface ReportTimingExpectation {
  readonly locator: string;
  readonly evalId: string;
  readonly experimentId: string;
  readonly verdict: "passed" | "failed";
  readonly phases: readonly {
    readonly name: string;
    readonly children: readonly string[];
  }[];
}

export interface RawCellFragment {
  /** Zero-based physical line index in the terminal transcript. */
  readonly line: number;
  /** Zero-based column at which this named cell begins. */
  readonly column: number;
  readonly text: string;
}

interface SemanticCell {
  readonly label: string;
  readonly fragments: readonly RawCellFragment[];
}

interface HeaderLayout {
  readonly line: number;
  readonly labels: readonly string[];
  readonly starts: readonly number[];
}

interface TableRow {
  readonly cells: ReadonlyMap<string, SemanticCell>;
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "").replace(/\r\n?/g, "\n");
}

function describe(cell: SemanticCell | undefined): string {
  const first = cell?.fragments[0];
  return first === undefined ? "at <missing cell>" : `at L${first.line + 1}:C${first.column + 1}`;
}

function fragmentText(cell: SemanticCell | undefined): readonly string[] {
  return cell?.fragments.map((fragment) => fragment.text) ?? [];
}

function primaryText(cell: SemanticCell | undefined): string | undefined {
  return fragmentText(cell)[0];
}

/** A wrapped table value is one semantic cell, not several unrelated strings. */
function continuationText(cell: SemanticCell | undefined): string {
  return fragmentText(cell).slice(1).join(" ");
}

function tableCellText(cell: SemanticCell | undefined): string {
  return fragmentText(cell).map((part) => part.trim()).join("");
}

function rawTableCellText(cell: SemanticCell | undefined): string {
  return fragmentText(cell).join("");
}

function orderedStarts(line: string, labels: readonly string[]): readonly number[] | undefined {
  const starts: number[] = [];
  let cursor = 0;
  for (const label of labels) {
    const start = line.indexOf(label, cursor);
    if (start < 0) return undefined;
    starts.push(start);
    cursor = start + label.length;
  }
  return starts;
}

function findHeader(lines: readonly string[], labels: readonly string[], path: string, from = 0): HeaderLayout {
  const matches = lines.flatMap((line, index) => {
    if (index < from) return [];
    const starts = orderedStarts(line, labels);
    return starts === undefined ? [] : [{ line: index, labels, starts }];
  });
  expect(matches, `${path}.header`).toHaveLength(1);
  return matches[0]!;
}

function readCells(line: string, lineIndex: number, layout: HeaderLayout, preserveFirstIndent = false): ReadonlyMap<string, SemanticCell> {
  const cells = new Map<string, SemanticCell>();
  for (const [index, label] of layout.labels.entries()) {
    const start = layout.starts[index]!;
    const end = layout.starts[index + 1];
    const source = line.slice(start, end);
    const text = index === 0 && preserveFirstIndent ? source.trimEnd() : source.trim();
    cells.set(label, {
      label,
      fragments: text.length === 0 ? [] : [{ line: lineIndex, column: start, text }],
    });
  }
  return cells;
}

function appendCells(target: Map<string, SemanticCell>, source: ReadonlyMap<string, SemanticCell>): void {
  for (const [label, cell] of source) {
    if (cell.fragments.length === 0) continue;
    const current = target.get(label);
    target.set(label, {
      label,
      fragments: [...(current?.fragments ?? []), ...cell.fragments],
    });
  }
}

function firstBlankAfter(lines: readonly string[], start: number): number {
  let index = start;
  while (index < lines.length && lines[index]!.trim().length > 0) index += 1;
  return index;
}

function gridCells(lines: readonly string[], layout: HeaderLayout): ReadonlyMap<string, SemanticCell> {
  const rowsEnd = firstBlankAfter(lines, layout.line + 1);
  const cells = new Map<string, SemanticCell>(layout.labels.map((label) => [label, { label, fragments: [] }]));
  for (let lineIndex = layout.line + 1; lineIndex < rowsEnd; lineIndex++) {
    appendCells(cells, readCells(lines[lineIndex]!, lineIndex, layout));
  }
  return cells;
}

function exactTrimmedLine(lines: readonly string[], expected: string, path: string): number {
  const matches = lines.flatMap((line, index) => (line.trim() === expected ? [index] : []));
  expect(matches, path).toHaveLength(1);
  return matches[0]!;
}

function unwrapOuterFrame(line: string): string {
  return line.replace(/^\s*│\s?/, "").replace(/\s?│\s*$/, "");
}

export function terminalReport(stdout: string): TerminalReport {
  return new TerminalReport(stdout);
}

/**
 * Public-terminal semantic reader. It discovers named grid columns from their
 * labels and retains every raw source coordinate; whitespace only determines a
 * column boundary and is never compacted into a cross-cell assertion.
 */
export class TerminalReport {
  readonly text: string;
  readonly lines: readonly string[];

  constructor(stdout: string) {
    this.text = stripAnsi(stdout);
    this.lines = this.text.split("\n");
  }

  expectTitle(expected: string): void {
    const first = this.lines.find((line) => line.trim().length > 0);
    expect(first, "report.title at L1").toBe(expected);
  }

  expectComposition(expectedRuns: number): void {
    const matches = this.lines.flatMap((line, index) => {
      const match = /^Last run .+ · composed from (\d+) runs$/.exec(line.trim());
      return match === null ? [] : [{ index, match }];
    });
    expect(matches, "report.composition").toHaveLength(1);
    expect(Number(matches[0]!.match[1]), `report.composition.runs at L${matches[0]!.index + 1}`).toBe(expectedRuns);
  }

  expectStats(expected: readonly ReportStatExpectation[]): void {
    expect(expected.map((item) => item.label), "report.stats.contract").toEqual([
      "Pass rate",
      "Experiments",
      "Evals",
      "Attempts",
      "Eval results",
      "Total cost",
    ]);
    const byLabel = new Map(expected.map((item) => [item.label, item]));
    this.expectStatGrid(["Pass rate", "Experiments", "Evals"], byLabel, "report.stats.primary");
    this.expectStatGrid(["Attempts", "Eval results", "Total cost"], byLabel, "report.stats.secondary");
  }

  bars(heading: string): TerminalBars {
    return new TerminalBars(this.lines, heading);
  }

  scatter(accessibleName: string): TerminalScatter {
    return new TerminalScatter(this.lines, accessibleName);
  }

  experimentTable(headers: readonly string[]): TerminalHierarchyTable {
    return new TerminalHierarchyTable(this.lines, headers);
  }

  expectTiming(expected: ReportTimingExpectation): void {
    const nonBlank = this.lines.flatMap((line, index) => (line.trim().length === 0 ? [] : [{ line, index }]));
    const identity = nonBlank[0];
    expect(identity, "report.timing.identity").toBeDefined();
    expect(identity!.line.trim().split(" · "), `report.timing.identity at L${identity!.index + 1}`).toEqual([
      expected.locator,
      expected.evalId,
      expected.experimentId,
      expected.verdict,
    ]);

    const totalMatches = nonBlank.flatMap(({ line, index }) => {
      const match = /^total (\d+)ms$/.exec(line.trim());
      return match === null ? [] : [{ durationMs: Number(match[1]), index }];
    });
    expect(totalMatches, "report.timing.total").toHaveLength(1);
    expect(totalMatches[0]!.durationMs, `report.timing.total.duration at L${totalMatches[0]!.index + 1}`).toBeGreaterThanOrEqual(0);

    const actual: { name: string; durationMs: number; children: { name: string; durationMs: number }[] }[] = [];
    for (const { line, index } of nonBlank.filter(({ index }) => index > totalMatches[0]!.index)) {
      const child = /^\s+└─\s+(.+?)\s+(\d+)ms\s*$/.exec(line);
      if (child !== null) {
        expect(actual.length, `report.timing.child.parent at L${index + 1}`).toBeGreaterThan(0);
        actual.at(-1)!.children.push({ name: child[1]!, durationMs: Number(child[2]) });
        continue;
      }
      const phase = /^(\S(?:.*?\S)?)\s+(\d+)ms\s*$/.exec(line);
      expect(phase, `report.timing.phase at L${index + 1}`).not.toBeNull();
      actual.push({ name: phase![1]!, durationMs: Number(phase![2]), children: [] });
    }

    expect(
      actual.map(({ name, children }) => ({ name, children: children.map((item) => item.name) })),
      "report.timing.phaseTree",
    ).toEqual(expected.phases);
    for (const phase of actual) {
      expect(phase.durationMs, `report.timing.phase[${phase.name}].duration`).toBeGreaterThanOrEqual(0);
      for (const child of phase.children) {
        expect(child.durationMs, `report.timing.phase[${phase.name}].child[${child.name}].duration`).toBeGreaterThanOrEqual(0);
      }
    }
  }

  private expectStatGrid(labels: readonly string[], expected: ReadonlyMap<string, ReportStatExpectation>, path: string): void {
    const layout = findHeader(this.lines, labels, path);
    const cells = gridCells(this.lines, layout);
    for (const label of labels) {
      const expectation = expected.get(label)!;
      const cell = cells.get(label);
      expect(primaryText(cell), `${path}.${label}.value ${describe(cell)}`).toBe(expectation.value);
      if (expectation.detail !== undefined) {
        expect(continuationText(cell), `${path}.${label}.detail ${describe(cell)}`).toBe(expectation.detail);
      } else {
        expect(continuationText(cell), `${path}.${label}.unexpectedContinuation ${describe(cell)}`).toBe("");
      }
    }
  }
}

export class TerminalBars {
  constructor(private readonly lines: readonly string[], private readonly heading: string) {}

  expectRows(expected: readonly ReportBarExpectation[]): void {
    const headerIndex = exactTrimmedLine(this.lines, this.heading, "report.bars.header");
    const rows = this.lines.slice(headerIndex + 1, headerIndex + 1 + expected.length).map((line, offset) => {
      const match = /^\s*(\S+)\s+([█░]+)\s+(\d+(?:\.\d+)?%)\s*$/.exec(unwrapOuterFrame(line));
      expect(match, `report.bars.row at L${headerIndex + offset + 2}`).not.toBeNull();
      return match!;
    });
    for (const [index, item] of expected.entries()) {
      const row = rows[index]!;
      expect(row[1], `report.bars.rows[${index}].label at L${headerIndex + index + 2}`).toBe(item.label);
      expect(row[3], `report.bars.rows[${index}].value at L${headerIndex + index + 2}`).toBe(item.display);
      const glyphs = [...row[2]!];
      const fill = glyphs.filter((glyph) => glyph === "█").length / glyphs.length;
      expect(Math.abs(fill - item.value), `report.bars.rows[${index}].fillRatio at L${headerIndex + index + 2}`).toBeLessThan(0.06);
    }
  }
}

export class TerminalScatter {
  constructor(private readonly lines: readonly string[], private readonly accessibleName: string) {}

  expectAxes(options: { xLabel: string; yLabel: string; betterHint: string }): void {
    const [xField, yField] = this.accessibleName.split(" × ");
    expect(xField, "report.scatter.accessibleName.x").toBe(options.xLabel);
    expect(yField, "report.scatter.accessibleName.y").toBe(options.yLabel);
    const yLine = this.lines.findIndex((line) => line.trim() === `${yField} ↑`);
    expect(yLine, "report.scatter.yAxis").toBeGreaterThanOrEqual(0);
    const xLine = this.lines.findIndex((line) => line.trimEnd().endsWith(`→ ${xField}`));
    expect(xLine, "report.scatter.xAxis").toBeGreaterThanOrEqual(0);
    exactTrimmedLine(this.lines, options.betterHint, "report.scatter.betterHint");
  }

  expectPoints(expected: readonly ReportScatterPointExpectation[]): void {
    const rows = this.valueRows();
    expect(rows, "report.scatter.values.rows").toHaveLength(expected.length);
    for (const [index, item] of expected.entries()) {
      const row = rows[index]!;
      expect(row.mark, `report.scatter.points[${index}].mark at L${row.line + 1}`).toBe(item.key);
      expect(row.experiment, `report.scatter.points[${index}].experiment at L${row.line + 1}`).toBe(item.label);
      expect(row.cost, `report.scatter.points[${index}].cost at L${row.line + 1}`).toBe(item.xDisplay);
      expect(row.passRate, `report.scatter.points[${index}].passRate at L${row.line + 1}`).toBe(item.yDisplay);
    }
  }

  expectVisualOrder(options: {
    points: readonly ReportScatterPointExpectation[];
    leftToRight: readonly string[];
    topToBottom: readonly string[];
  }): void {
    const values = this.valueRows();
    const marks = new Map(values.map((value) => [value.experiment.split("/").at(-1)!, value.mark]));
    const plotEnd = exactTrimmedLine(this.lines, "better → upper right", "report.scatter.plot.end");
    const [_, yField] = this.accessibleName.split(" × ");
    const plotStart = this.lines.findIndex((line) => line.trim() === `${yField} ↑`);
    expect(plotStart, "report.scatter.plot.start").toBeGreaterThanOrEqual(0);
    const plot = this.lines.slice(plotStart, plotEnd);
    const positions = new Map<string, { x: number; y: number }>();
    for (const label of new Set([...options.leftToRight, ...options.topToBottom])) {
      const mark = marks.get(label);
      expect(mark, `report.scatter.plot.mark[${label}]`).toBeDefined();
      const y = plot.findIndex((line) => line.indexOf(mark!) >= 0);
      expect(y, `report.scatter.plot.row[${label}]`).toBeGreaterThanOrEqual(0);
      positions.set(label, { x: plot[y]!.indexOf(mark!), y });
    }
    expectOrder(options.leftToRight, positions, "x", "leftToRight");
    expectOrder(options.topToBottom, positions, "y", "topToBottom");
  }

  private valueRows(): readonly { line: number; mark: string; experiment: string; cost: string; passRate: string }[] {
    const layout = findHeader(this.lines, ["key", "costUSD", "passRate"], "report.scatter.values");
    const rows: { line: number; mark: string; experiment: string; cost: string; passRate: string }[] = [];
    for (let lineIndex = layout.line + 1; lineIndex < this.lines.length; lineIndex++) {
      const line = this.lines[lineIndex]!;
      if (line.trim().length === 0) break;
      const mark = line.slice(0, layout.starts[0]).trim();
      if (!/^[A-Z]$/.test(mark)) break;
      const cells = readCells(line, lineIndex, layout);
      rows.push({
        line: lineIndex,
        mark,
        experiment: primaryText(cells.get("key")) ?? "",
        cost: primaryText(cells.get("costUSD")) ?? "",
        passRate: primaryText(cells.get("passRate")) ?? "",
      });
    }
    return rows;
  }
}

export class TerminalHierarchyTable {
  private readonly rows: readonly TableRow[];
  private readonly headers: readonly string[];

  constructor(private readonly lines: readonly string[], headers: readonly string[]) {
    this.headers = headers;
    expect(headers, "report.experimentTable.contract.headers").toEqual([
      "Experiment",
      "Model",
      "Agent",
      "Avg. time",
      "Pass rate",
    ]);
    const layout = findHeader(lines, headers, "report.experimentTable");
    const rows: TableRow[] = [];
    let current: Map<string, SemanticCell> | undefined;
    for (let lineIndex = layout.line + 1; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex]!;
      if (line.trim() === "(3 more columns not shown)" || line.startsWith("Other pages:")) break;
      if (line.trim().length === 0) continue;
      const cells = readCells(line, lineIndex, layout, true);
      const identity = rawTableCellText(cells.get(headers[0]!));
      if (identity.trim().length === 0) {
        if (current !== undefined) appendCells(current, cells);
        continue;
      }
      if (identity.trim() === "—") continue;
      current = new Map(cells);
      rows.push({ cells: current });
    }
    this.rows = rows;
  }

  expectExperiments(expected: readonly ReportExperimentExpectation[]): void {
    const experimentRows = this.rows.filter((row) =>
      !/^\s/.test(rawTableCellText(row.cells.get(this.headers[0]!))),
    );
    expect(
      experimentRows.map((row) => tableCellText(row.cells.get(this.headers[0]!))),
      "report.experimentTable.experiment.sequence",
    ).toEqual(expected.map((item) => item.id));
    for (const [index, item] of expected.entries()) {
      const row = experimentRows[index]!;
      this.expectCell(row, "Model", item.model, item.id);
      this.expectCell(row, "Agent", item.agent, item.id);
      this.expectCell(row, "Pass rate", item.passRate, item.id);
    }
  }

  attemptIdentities(): readonly AttemptIdentity[] {
    const identities: AttemptIdentity[] = [];
    let experimentId: string | undefined;
    let evalId: string | undefined;
    for (const row of this.rows) {
      const identityCell = row.cells.get(this.headers[0]!);
      const raw = rawTableCellText(identityCell);
      const trimmed = raw.trim();
      if (/^classic\/(?:baseline|memory-a|memory-b)$/.test(trimmed)) {
        experimentId = trimmed;
        evalId = undefined;
        continue;
      }
      if (trimmed === "source-snapshot") {
        evalId = "source-snapshot";
        continue;
      }
      if (/^classic \(\d+ evals\)$/.test(trimmed)) continue;
      if (/^(?:recall-[a-z-]+|tool-note)$/.test(trimmed)) {
        evalId = `classic/${trimmed}`;
        continue;
      }
      const attempt = /^([✓✗])\s+(@[0-9A-Z]+)$/.exec(trimmed);
      if (attempt === null) {
        throw new Error(`unrecognized report hierarchy row ${JSON.stringify(trimmed)} ${describe(identityCell)}`);
      }
      expect(experimentId, `report.hierarchy.attempt.experimentParent ${describe(identityCell)}`).toBeDefined();
      expect(evalId, `report.hierarchy.attempt.evalParent ${describe(identityCell)}`).toBeDefined();
      this.expectCell(row, "Model", "—", attempt[2]!);
      this.expectCell(row, "Agent", "—", attempt[2]!);
      identities.push({
        experimentId: experimentId!,
        evalId: evalId!,
        verdict: attempt[1] === "✓" ? "passed" : "failed",
        locator: attempt[2]!,
      });
    }
    return identities;
  }

  expectAttemptIdentity(expected: readonly AttemptExpectation[]): void {
    const actual = this.attemptIdentities();
    expect(actual, "report.hierarchy.attempts").toEqual(expected);
    expect(new Set(actual.map((item) => item.locator)).size, "report.hierarchy.locators.unique").toBe(actual.length);
  }

  private expectCell(row: TableRow, header: string, expected: string, identity: string): void {
    const cell = row.cells.get(header);
    expect(tableCellText(cell), `report.experimentTable.row[${identity}].${header} ${describe(cell)}`).toBe(expected);
  }
}

function expectOrder(
  labels: readonly string[],
  positions: ReadonlyMap<string, { x: number; y: number }>,
  axis: "x" | "y",
  path: string,
): void {
  for (let index = 1; index < labels.length; index++) {
    const previous = positions.get(labels[index - 1]!)!;
    const current = positions.get(labels[index]!)!;
    expect(current[axis], `report.scatter.${path}[${index - 1}→${index}]`).toBeGreaterThan(previous[axis]);
  }
}
