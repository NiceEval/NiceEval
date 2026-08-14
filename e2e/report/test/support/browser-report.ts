import { expect, type Locator, type Page } from "@playwright/test";
import type { ExpEvalEvent } from "./exp.ts";
import type {
  ReportBarExpectation,
  ReportExperimentExpectation,
  ReportScatterPointExpectation,
  ReportStatExpectation,
} from "./classic-report-contract.ts";

interface HierarchyRowSnapshot {
  readonly depth: number;
  readonly cells: readonly string[];
  readonly path: readonly string[];
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function expectContains(actual: string, expected: string, path: string): void {
  const compact = (value: string) => normalizeText(value).replace(/[\s·]/g, "");
  expect(compact(actual), path).toContain(compact(expected));
}

export function browserReport(page: Page): BrowserReport {
  return new BrowserReport(page);
}

export class BrowserReport {
  constructor(private readonly page: Page) {}

  async expectStats(expected: readonly ReportStatExpectation[]): Promise<void> {
    for (const item of expected) {
      const stat = this.page
        .locator(".niceeval-stat:visible")
        .filter({ has: this.page.getByText(item.label, { exact: true }) })
        .first();
      await expect(stat, `report.stat[${JSON.stringify(item.label)}]`).toBeVisible();
      expectContains(
        await stat.locator(".niceeval-stat-value").innerText(),
        item.value,
        `report.stat[${JSON.stringify(item.label)}].value`,
      );
      if (item.detail !== undefined) {
        expectContains(await stat.innerText(), item.detail, `report.stat[${JSON.stringify(item.label)}].detail`);
      }
    }
  }

  bars(heading: string): BrowserBars {
    return new BrowserBars(this.page, heading);
  }

  scatter(accessibleName: string): BrowserScatter {
    return new BrowserScatter(this.page, accessibleName);
  }

  experimentTable(headers: readonly string[]): BrowserHierarchyTable {
    return new BrowserHierarchyTable(this.page, headers);
  }

  attemptDetails(): BrowserAttemptDetails {
    return new BrowserAttemptDetails(this.page);
  }
}

export class BrowserAttemptDetails {
  private readonly summary: Locator;

  constructor(private readonly page: Page) {
    this.summary = page.locator(".niceeval-attempt-summary:visible").first();
  }

  async expectSummary(attempt: ExpEvalEvent): Promise<void> {
    await expect(this.summary, "report.attemptDetails.summary").toBeVisible();
    await expect(this.summary.locator(".niceeval-verdict-pill"), "report.attemptDetails.verdict").toHaveText(
      attempt.verdict,
    );
    await expect(this.summary.locator(".niceeval-attempt-summary-locator"), "report.attemptDetails.locator").toHaveText(
      attempt.locator,
    );
    await this.expectKpi("Experiment", attempt.experimentId);
    await this.expectKpi("Eval", attempt.evalId);
    await this.expectKpi("Attempt", "1");
  }

  private async expectKpi(label: string, value: string): Promise<void> {
    const kpi = this.summary
      .locator(".niceeval-kpi")
      .filter({ has: this.page.getByText(label, { exact: true }) })
      .first();
    await expect(kpi, `report.attemptDetails.${label}`).toBeVisible();
    await expect(kpi.locator(".niceeval-kpi-value"), `report.attemptDetails.${label}.value`).toHaveText(value);
  }
}

export class BrowserBars {
  private readonly chart: Locator;

  constructor(private readonly page: Page, private readonly heading: string) {
    this.chart = page
      .locator(".niceeval-chart--bars-horizontal:visible")
      .filter({ has: page.getByText(heading, { exact: true }) })
      .first();
  }

  async expectRows(expected: readonly ReportBarExpectation[]): Promise<void> {
    await expect(this.chart, `report.bars[${JSON.stringify(this.heading)}]`).toBeVisible();
    const rows = this.chart.locator(".niceeval-chart-bar-row");
    await expect(rows, `report.bars[${JSON.stringify(this.heading)}].rows`).toHaveCount(expected.length);

    for (const [index, item] of expected.entries()) {
      const row = rows.nth(index);
      await expect(row.locator(".niceeval-chart-bar-label"), `report.bars.rows[${index}].label`).toHaveText(item.label);
      await expect(row.locator(".niceeval-chart-bar-value"), `report.bars.rows[${index}].value`).toHaveText(item.display);

      const [track, fill] = await Promise.all([
        row.locator(".niceeval-chart-bar-track").boundingBox(),
        row.locator(".niceeval-chart-bar-fill").boundingBox(),
      ]);
      expect(track, `report.bars.rows[${index}].track`).not.toBeNull();
      expect(fill, `report.bars.rows[${index}].fill`).not.toBeNull();
      const ratio = fill!.width / track!.width;
      expect(Math.abs(ratio - item.value), `report.bars.rows[${index}].fillRatio`).toBeLessThan(0.03);
    }
  }
}

export class BrowserScatter {
  private readonly svg: Locator;
  private readonly chart: Locator;

  constructor(private readonly page: Page, private readonly accessibleName: string) {
    this.svg = page.getByRole("img", { name: accessibleName, exact: true }).filter({ visible: true }).first();
    this.chart = this.svg.locator("xpath=..");
  }

  async expectAxes(options: { xLabel: string; yLabel: string; betterHint: string }): Promise<void> {
    await expect(this.svg, `report.scatter[${JSON.stringify(this.accessibleName)}]`).toBeVisible();
    await expect(this.chart.getByText(options.xLabel, { exact: true })).toBeVisible();
    await expect(this.chart.getByText(options.yLabel, { exact: true })).toBeVisible();
    await expect(this.chart.getByText(options.betterHint, { exact: true })).toBeVisible();
  }

  async expectPoints(expected: readonly ReportScatterPointExpectation[]): Promise<void> {
    const points = this.chart.locator(".niceeval-chart-point");
    await expect(points, "report.scatter.points").toHaveCount(expected.length);
    for (const item of expected) {
      const point = points.filter({ has: this.page.getByText(item.label, { exact: true }) }).first();
      await expect(point, `report.scatter.point[${JSON.stringify(item.label)}]`).toBeVisible();
      await expect(point.locator("a"), `report.scatter.point[${JSON.stringify(item.label)}].target`).toHaveAttribute(
        "href",
        item.href,
      );
      await expect(point.locator("title"), `report.scatter.point[${JSON.stringify(item.label)}].values`).toContainText(
        item.key,
      );
      await expect(point.locator("title")).toContainText(`costUSD: ${item.xDisplay}`);
      await expect(point.locator("title")).toContainText(`passRate: ${item.yDisplay}`);
    }
  }

  async expectVisualOrder(options: {
    leftToRight: readonly string[];
    topToBottom: readonly string[];
  }): Promise<void> {
    const positions = new Map<string, { x: number; y: number }>();
    for (const label of new Set([...options.leftToRight, ...options.topToBottom])) {
      const point = this.chart
        .locator(".niceeval-chart-point")
        .filter({ has: this.page.getByText(label, { exact: true }) })
        .first();
      const box = await point.locator(".niceeval-chart-dot").boundingBox();
      expect(box, `report.scatter.point[${JSON.stringify(label)}].geometry`).not.toBeNull();
      positions.set(label, { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 });
    }
    expectOrdered(options.leftToRight, positions, "x", "leftToRight");
    expectOrdered(options.topToBottom, positions, "y", "topToBottom");
  }
}

export class BrowserHierarchyTable {
  private readonly table: Locator;

  constructor(private readonly page: Page, private readonly headers: readonly string[]) {
    this.table = page
      .locator("table:visible")
      .filter({ has: page.getByRole("columnheader", { name: headers[0], exact: true }) })
      .first();
  }

  async expectHeaders(): Promise<void> {
    await expect(this.table, "report.experimentTable").toBeVisible();
    const actual = await this.table.getByRole("columnheader").allTextContents();
    expect(actual.map(normalizeText), "report.experimentTable.headers").toEqual(this.headers);
  }

  async expectExperiments(expected: readonly ReportExperimentExpectation[]): Promise<void> {
    const rows = await this.rows();
    for (const item of expected) {
      const row = onlyRow(rows, item.id);
      expect(row.depth, `report.experimentTable.row[${JSON.stringify(item.id)}].depth`).toBe(0);
      this.expectCell(row, "Model", item.model, item.id);
      this.expectCell(row, "Agent", item.agent, item.id);
      this.expectCell(row, "Pass rate", item.passRate, item.id);
      this.expectCell(row, "Tokens", item.tokens, item.id);
      this.expectCell(row, "Cost", item.cost, item.id);
      this.expectCell(row, "Record", item.record, item.id);
    }
  }

  async expectAttempts(events: readonly ExpEvalEvent[]): Promise<void> {
    const rows = await this.rows();
    for (const event of events) {
      const row = rows.find((candidate) => candidate.path.at(-1)?.includes(event.locator));
      expect(row, `report.experimentTable.attempt[${event.locator}]`).toBeDefined();
      expectContains(row!.cells[1] ?? "", "—", `report.experimentTable.attempt[${event.locator}].Model`);
      expectContains(row!.cells[2] ?? "", "—", `report.experimentTable.attempt[${event.locator}].Agent`);
      expectContains(
        row!.cells[7] ?? "",
        event.verdict === "passed" ? "✓ passed" : event.verdict === "failed" ? "✗ failed" : event.verdict,
        `report.experimentTable.attempt[${event.locator}].Record`,
      );
    }
  }

  async expandPath(identities: readonly string[]): Promise<void> {
    for (let index = 0; index < identities.length; index++) {
      const path = identities.slice(0, index + 1);
      const row = await this.rowLocator(path);
      if ((await row.evaluate((element) => element.tagName)) === "DETAILS") {
        const details = row;
        if (!(await details.evaluate((element) => (element as HTMLDetailsElement).open))) {
          await details.locator(":scope > summary").click();
        }
        expect(await details.evaluate((element) => (element as HTMLDetailsElement).open), `expand ${path.join(" → ")}`).toBe(true);
      }
    }
  }

  async expectAttemptVisible(locator: string): Promise<Locator> {
    const row = await this.rowLocatorByCellText(locator);
    await expect(row, `report.experimentTable.attempt[${locator}]`).toBeVisible();
    const link = row.getByRole("link", { name: new RegExp(locator.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) });
    await expect(link, `report.experimentTable.attempt[${locator}].link`).toBeVisible();
    return link;
  }

  private expectCell(row: HierarchyRowSnapshot, header: string, value: string, identity: string): void {
    const index = this.headers.indexOf(header);
    expect(index, `unknown table header ${header}`).toBeGreaterThanOrEqual(0);
    expectContains(row.cells[index] ?? "", value, `report.experimentTable.row[${JSON.stringify(identity)}].${header}`);
  }

  private async rows(): Promise<readonly HierarchyRowSnapshot[]> {
    return this.table.locator(".niceeval-table-hierarchy-row").evaluateAll((elements) =>
      elements.map((element) => {
        const direct =
          element.tagName === "DETAILS"
            ? element.querySelector(":scope > summary")
            : element;
        const cells = Array.from(direct?.children ?? [])
          .filter((child) => child.classList.contains("niceeval-table-hierarchy-cell"))
          .map((child) => (child.textContent ?? "").replace(/\s+/g, " ").trim());
        const path: string[] = [];
        let cursor: Element | null = element;
        while (cursor?.classList.contains("niceeval-table-hierarchy-row")) {
          const rowFace = cursor.tagName === "DETAILS" ? cursor.querySelector(":scope > summary") : cursor;
          const identity = rowFace?.querySelector(":scope > .niceeval-table-hierarchy-cell")?.textContent;
          if (identity !== undefined && identity !== null) path.unshift(identity.replace(/\s+/g, " ").trim());
          const container: Element | null = cursor.parentElement;
          cursor = container?.classList.contains("niceeval-table-hierarchy-children") ? container.parentElement : null;
        }
        return {
          depth: Number(element.getAttribute("data-depth") ?? 0),
          cells,
          path,
        };
      }),
    );
  }

  private async rowLocator(path: readonly string[]): Promise<Locator> {
    const rows = await this.rows();
    const index = rows.findIndex((row) => row.path.length === path.length && row.path.every((part, i) => part === path[i]));
    expect(index, `report.experimentTable.path[${path.join(" → ")}]`).toBeGreaterThanOrEqual(0);
    return this.table.locator(".niceeval-table-hierarchy-row").nth(index);
  }

  private async rowLocatorByCellText(text: string): Promise<Locator> {
    const rows = await this.rows();
    const index = rows.findIndex((row) => row.path.at(-1)?.includes(text));
    expect(index, `report.experimentTable.rowContaining[${JSON.stringify(text)}]`).toBeGreaterThanOrEqual(0);
    return this.table.locator(".niceeval-table-hierarchy-row").nth(index);
  }
}

function onlyRow(rows: readonly HierarchyRowSnapshot[], identity: string): HierarchyRowSnapshot {
  const matches = rows.filter((row) => row.cells[0] === identity);
  expect(matches, `report.experimentTable.row[${JSON.stringify(identity)}]`).toHaveLength(1);
  return matches[0]!;
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
    expect(current[axis], `report.scatter.${path}[${index - 1}→${index}]`).toBeGreaterThan(previous[axis] + 1);
  }
}
