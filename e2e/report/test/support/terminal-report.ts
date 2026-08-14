import { expect } from "vitest";
import type { ExpEvalEvent } from "./exp.ts";
import type {
  ReportBarExpectation,
  ReportExperimentExpectation,
  ReportScatterPointExpectation,
  ReportStatExpectation,
} from "./classic-report-contract.ts";

interface TerminalTableRow {
  readonly cells: readonly string[];
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function compact(value: string): string {
  return normalizeText(value).replace(/[\s·]/g, "");
}

function expectContains(actual: string, expected: string, path: string): void {
  expect(compact(actual), path).toContain(compact(expected));
}

export function terminalReport(stdout: string): TerminalReport {
  return new TerminalReport(stdout);
}

export class TerminalReport {
  readonly text: string;
  readonly lines: readonly string[];

  constructor(stdout: string) {
    this.text = stripAnsi(stdout).replace(/\r\n?/g, "\n");
    this.lines = this.text.split("\n");
  }

  expectStats(expected: readonly ReportStatExpectation[]): void {
    for (const item of expected) {
      const index = this.lines.findIndex((line) => line.includes(item.label));
      expect(index, `report.stat[${JSON.stringify(item.label)}]`).toBeGreaterThanOrEqual(0);
      const window = this.lines.slice(index, index + 6).join(" ");
      expectContains(window, item.value, `report.stat[${JSON.stringify(item.label)}].value`);
      if (item.detail !== undefined) {
        expectContains(window, item.detail, `report.stat[${JSON.stringify(item.label)}].detail`);
      }
    }
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
}

export class TerminalBars {
  constructor(private readonly lines: readonly string[], private readonly heading: string) {}

  expectRows(expected: readonly ReportBarExpectation[]): void {
    const headingIndex = this.lines.findIndex((line) => line.includes(this.heading));
    expect(headingIndex, `report.bars[${JSON.stringify(this.heading)}]`).toBeGreaterThanOrEqual(0);
    const rows = this.lines
      .slice(headingIndex + 1)
      .map(unwrapOuterFrame)
      .map((line) => line.match(/^\s*(\S+)\s+([█░]+)\s+(\d+(?:\.\d+)?%)\s*$/))
      .filter((match): match is RegExpMatchArray => match !== null)
      .slice(0, expected.length);
    expect(rows, `report.bars[${JSON.stringify(this.heading)}].rows`).toHaveLength(expected.length);

    for (const [index, item] of expected.entries()) {
      const match = rows[index]!;
      expect(match[1], `report.bars.rows[${index}].label`).toBe(item.label);
      expect(match[3], `report.bars.rows[${index}].value`).toBe(item.display);
      const glyphs = match[2]!;
      const ratio = [...glyphs].filter((glyph) => glyph === "█").length / [...glyphs].length;
      expect(Math.abs(ratio - item.value), `report.bars.rows[${index}].fillRatio`).toBeLessThan(0.06);
    }
  }
}

function unwrapOuterFrame(line: string): string {
  const withoutLeft = line.replace(/^\s*│\s?/, "");
  return withoutLeft.replace(/\s?│\s*$/, "");
}

export class TerminalScatter {
  constructor(private readonly lines: readonly string[], private readonly accessibleName: string) {}

  expectAxes(options: { xLabel: string; yLabel: string; betterHint: string }): void {
    const [x, y] = this.accessibleName.split(" × ");
    expect(this.lines.some((line) => line.includes(x ?? "")), "report.scatter.xAxis").toBe(true);
    expect(this.lines.some((line) => line.includes(y ?? "")), "report.scatter.yAxis").toBe(true);
    expect(this.lines.some((line) => line.includes(options.betterHint)), "report.scatter.betterHint").toBe(true);
  }

  expectPoints(expected: readonly ReportScatterPointExpectation[]): void {
    const rows = this.valueRows();
    expect(rows, "report.scatter.points").toHaveLength(expected.length);
    for (const item of expected) {
      const row = rows.find((candidate) => candidate.key === item.key);
      expect(row, `report.scatter.point[${JSON.stringify(item.label)}]`).toBeDefined();
      expect(row!.x, `report.scatter.point[${JSON.stringify(item.label)}].x`).toBe(item.xDisplay);
      expect(row!.y, `report.scatter.point[${JSON.stringify(item.label)}].y`).toBe(item.yDisplay);
    }
  }

  expectVisualOrder(options: {
    points: readonly ReportScatterPointExpectation[];
    leftToRight: readonly string[];
    topToBottom: readonly string[];
  }): void {
    const valueRows = this.valueRows();
    const markByLabel = new Map(
      options.points.map((point) => [point.label, valueRows.find((row) => row.key === point.key)?.mark]),
    );
    const betterIndex = this.lines.findIndex((line) => line.includes("better → upper right"));
    expect(betterIndex, "report.scatter.plot").toBeGreaterThanOrEqual(0);
    const plotStart = this.lines.findIndex((line, index) => index < betterIndex && line.includes("passRate"));
    const plot = this.lines.slice(Math.max(0, plotStart), betterIndex);
    const positions = new Map<string, { x: number; y: number }>();
    for (const label of new Set([...options.leftToRight, ...options.topToBottom])) {
      const mark = markByLabel.get(label);
      expect(mark, `report.scatter.point[${JSON.stringify(label)}].mark`).toBeDefined();
      const y = plot.findIndex((line) => line.includes(mark!));
      expect(y, `report.scatter.point[${JSON.stringify(label)}].plotRow`).toBeGreaterThanOrEqual(0);
      positions.set(label, { x: plot[y]!.indexOf(mark!), y });
    }
    expectOrdered(options.leftToRight, positions, "x", "leftToRight");
    expectOrdered(options.topToBottom, positions, "y", "topToBottom");
  }

  private valueRows(): readonly { mark: string; key: string; x: string; y: string }[] {
    const betterIndex = this.lines.findIndex((line) => line.includes("better → upper right"));
    const headerIndex = this.lines.findIndex(
      (line, index) => index > betterIndex && line.includes("key") && line.includes("costUSD") && line.includes("passRate"),
    );
    expect(headerIndex, "report.scatter.values.header").toBeGreaterThanOrEqual(0);
    const rows: { mark: string; key: string; x: string; y: string }[] = [];
    for (const line of this.lines.slice(headerIndex + 1)) {
      const match = line.match(/^\s*([A-Z])\s+(\S+)\s+(\$\S+)\s+(\S+%)\s*$/);
      if (match === null) {
        if (rows.length > 0) break;
        continue;
      }
      rows.push({ mark: match[1]!, key: match[2]!, x: match[3]!, y: match[4]! });
    }
    return rows;
  }
}

export class TerminalHierarchyTable {
  private readonly rows: readonly TerminalTableRow[];

  constructor(private readonly lines: readonly string[], private readonly headers: readonly string[]) {
    const headerIndex = lines.findIndex(
      (line) => line.includes("│") && headers.every((header) => line.includes(header)),
    );
    expect(headerIndex, "report.experimentTable").toBeGreaterThanOrEqual(0);
    const headerCells = splitFramedLine(lines[headerIndex]!);
    expect(headerCells.map(normalizeText), "report.experimentTable.headers").toEqual(headers);

    const physical = lines
      .slice(headerIndex + 1)
      .map(splitFramedLine)
      .filter((cells) => cells.length === headers.length);
    const logical: string[][][] = [];
    for (const cells of physical) {
      if (cells[0]!.trim().length > 0) logical.push(cells.map((cell) => [cell]));
      else if (logical.length > 0) cells.forEach((cell, index) => logical.at(-1)![index]!.push(cell));
    }
    this.rows = logical.map((row) => ({
      cells: row.map((parts) => normalizeText(parts.join(" "))),
    }));
  }

  expectExperiments(expected: readonly ReportExperimentExpectation[]): void {
    for (const item of expected) {
      const row = this.onlyRow(item.id);
      this.expectCell(row, "Model", item.model, item.id);
      this.expectCell(row, "Agent", item.agent, item.id);
      this.expectCell(row, "Pass rate", item.passRate, item.id);
      this.expectCell(row, "Tokens", item.tokens, item.id);
      this.expectCell(row, "Cost", item.cost, item.id);
      this.expectCell(row, "Record", item.record, item.id);
    }
  }

  expectAttempts(events: readonly ExpEvalEvent[]): void {
    for (const event of events) {
      const row = this.rows.find((candidate) => candidate.cells[0]?.includes(event.locator));
      expect(row, `report.experimentTable.attempt[${event.locator}]`).toBeDefined();
      this.expectCell(row!, "Model", "—", event.locator);
      this.expectCell(row!, "Agent", "—", event.locator);
      this.expectCell(
        row!,
        "Record",
        event.verdict === "passed" ? "✓ passed" : event.verdict === "failed" ? "✗ failed" : event.verdict,
        event.locator,
      );
    }
  }

  private onlyRow(identity: string): TerminalTableRow {
    const matches = this.rows.filter((row) => row.cells[0] === identity);
    expect(matches, `report.experimentTable.row[${JSON.stringify(identity)}]`).toHaveLength(1);
    return matches[0]!;
  }

  private expectCell(row: TerminalTableRow, header: string, expected: string, identity: string): void {
    const index = this.headers.indexOf(header);
    expect(index, `unknown table header ${header}`).toBeGreaterThanOrEqual(0);
    expectContains(row.cells[index] ?? "", expected, `report.experimentTable.row[${JSON.stringify(identity)}].${header}`);
  }
}

function splitFramedLine(line: string): string[] {
  if (!line.includes("│")) return [];
  const cells = line.split("│");
  if (cells[0]?.trim() === "") cells.shift();
  if (cells.at(-1)?.trim() === "") cells.pop();
  return cells;
}

function expectOrdered(
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
