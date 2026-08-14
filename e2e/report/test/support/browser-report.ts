import { expect, type Locator, type Page } from "@playwright/test";

export interface OverviewStatExpectation {
  readonly label: string;
  readonly lines: readonly string[];
}

export interface ScatterPointExpectation {
  readonly experimentId: string;
  readonly cost: string;
  readonly passRate: string;
}

export interface BarExpectation {
  readonly label: string;
  readonly value: string;
}

export interface ExperimentRowExpectation {
  readonly id: string;
  readonly model: string;
  readonly agent: string;
  readonly passRate: string;
  readonly cost: string;
  readonly costCoverage: string;
  readonly record: readonly string[];
}

export interface OverviewExpectation {
  readonly title: string;
  readonly stats: readonly OverviewStatExpectation[];
  readonly bars: readonly BarExpectation[];
  readonly scatter: readonly ScatterPointExpectation[];
  readonly experiments: readonly ExperimentRowExpectation[];
}

interface PresentationBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function exactLines(value: string): readonly string[] {
  return value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

async function directCellLines(card: Locator): Promise<readonly string[]> {
  return (await card.locator(":scope > *").allInnerTexts()).flatMap(exactLines);
}

/**
 * Browser Journey adapter. It deliberately speaks in roles, accessible names,
 * native table/disclosure elements, and exact visible text — never report CSS
 * implementation classes.
 */
export function browserReport(page: Page): BrowserReport {
  return new BrowserReport(page);
}

export class BrowserReport {
  constructor(private readonly page: Page) {}

  async expectOverview(expectation: OverviewExpectation, options: { navigation?: boolean } = {}): Promise<void> {
    const title = this.page.getByRole("heading", { name: expectation.title, exact: true });
    await expect(title, "report.hero.title").toBeVisible();
    await expect(
      this.page.getByRole("banner").getByRole("link", { name: "NiceEval", exact: true }),
      "report.shell.brandLink",
    ).toBeVisible();
    if (options.navigation !== false) await this.expectTabs();
    const leaderboard = this.page.getByRole("heading", { name: "Leaderboard", exact: true });
    await expect(leaderboard, "report.leaderboard.heading").toBeVisible();
    const stats: Locator[] = [];
    for (const stat of expectation.stats) stats.push(await this.expectExactStat(stat));
    await this.expectBars(expectation.bars);
    const scatter = this.page.getByRole("img", { name: "costUSD × passRate", exact: true });
    await expect(scatter, "report.scatter.image").toBeVisible();
    for (const point of expectation.scatter) {
      await expect(this.experimentLink(point), `report.scatter.link[${point.experimentId}]`).toBeVisible();
    }
    const table = await this.expectExperimentTable(expectation.experiments);
    await this.expectOverviewPresentation(title, stats, leaderboard, scatter, table, expectation.scatter);
  }

  async visitAttemptsThenOverview(): Promise<void> {
    const attempts = this.page.getByRole("tab", { name: "Attempts", exact: true });
    await attempts.click();
    await expect(attempts, "report.nav.attempts.selected").toHaveAttribute("aria-selected", "true");
    const overview = this.page.getByRole("tab", { name: "Overview", exact: true });
    await overview.click();
    await expect(overview, "report.nav.overview.selected").toHaveAttribute("aria-selected", "true");
  }

  async openExperiment(point: ScatterPointExpectation): Promise<void> {
    await this.experimentLink(point).click();
    const dialog = this.page.getByRole("dialog");
    await expect(dialog, `report.experiment.dialog[${point.experimentId}]`).toBeVisible();
    await this.expectExactCell(dialog, "Experiment", ["Experiment", point.experimentId], "report.experiment");
    await this.closeDialog(dialog);
  }

  async openMemoryAFailedAttempt(expectedLocator: string): Promise<void> {
    const dialog = await this.openMemoryAAttempt({
      evalSummary: "recall-entity",
      evalId: "classic/recall-entity",
      locator: expectedLocator,
      verdict: "failed",
      inClassicGroup: true,
    });
    await this.expectAttemptPresentation(dialog, expectedLocator);
    await this.expectCapabilities(dialog, ["source", "execution", "timing"], ["diff"]);
    await this.expectSourceBlock(dialog, "evals/classic.eval.ts", 'includes("RECALL_OK")', "report.attempt.failed.source");
    const assertion = await this.nativeDisclosureWithMarker(dialog, "failed");
    await expect(assertion, "report.attempt.failed.assertion.defaultOpen").toHaveAttribute("open", "");
    const assertionSummary = assertion.locator(":scope > summary");
    await this.expectVisibleBox(assertionSummary, "report.attempt.failed.assertion.summary");
    await this.expectStatePaint(assertionSummary, "report.attempt.failed.assertion.paint");
    await assertionSummary.click();
    await expect(assertion, "report.attempt.failed.assertion.closed").not.toHaveAttribute("open", "");
    await assertionSummary.click();
    await expect(assertion, "report.attempt.failed.assertion.reopened").toHaveAttribute("open", "");
    await expect(
      assertion.locator(":scope > summary").getByRole("img", { name: "failed", exact: true }),
      "report.attempt.failed.assertion.marker",
    ).toBeVisible();
    expect(
      exactLines(await assertion.locator(":scope > div").innerText()),
      "report.attempt.failed.assertion.detail",
    ).toEqual([
      'includes("RECALL_OK") · gate failed',
      'expected: contains "RECALL_OK"',
      "received: I do not remember this. RECALL_MISS for classic/recall-entity.",
    ]);
    await this.expectTiming(dialog, ["eval.run", "turn1", "assertions.evaluate"], "report.attempt.failed.timing");
    await this.closeDialog(dialog);
  }

  async openMemoryAToolAttempt(expectedLocator: string): Promise<void> {
    const dialog = await this.openMemoryAAttempt({
      evalSummary: "tool-note",
      evalId: "classic/tool-note",
      locator: expectedLocator,
      verdict: "passed",
      inClassicGroup: true,
    });
    await this.expectAttemptPresentation(dialog, expectedLocator);
    await this.expectCapabilities(dialog, ["source", "execution", "timing"], ["diff"]);
    await this.expectSourceBlock(
      dialog,
      "evals/classic.eval.ts",
      't.send("Write a memory note, then recall it.")',
      "report.attempt.tool.source",
    );
    const send = await this.nativeDisclosureWithMarker(dialog, "send");
    await expect(send, "report.attempt.tool.send.closed").not.toHaveAttribute("open", "");
    const sendSummary = send.locator(":scope > summary");
    await this.expectVisibleBox(sendSummary, "report.attempt.tool.send.summary");
    await this.expectStatePaint(sendSummary, "report.attempt.tool.send.paint");
    await sendSummary.click();
    await expect(send, "report.attempt.tool.send.open").toHaveAttribute("open", "");
    const tool = send.locator("details");
    await expect(tool, "report.attempt.tool.call.count").toHaveCount(1);
    await expect(tool, "report.attempt.tool.call.closed").not.toHaveAttribute("open", "");
    expect(exactLines(await tool.locator(":scope > summary").innerText()), "report.attempt.tool.call.input").toEqual([
      "TOOL",
      'write_note({"path":"memory-note.txt","topic":"classic/tool-note","recalled":true})',
    ]);
    await tool.locator(":scope > summary").click();
    await expect(tool, "report.attempt.tool.call.open").toHaveAttribute("open", "");
    expect(exactLines(await tool.locator(":scope > div").innerText()), "report.attempt.tool.call.output").toEqual([
      'completed {"written":true,"recalled":true}',
    ]);
    await expect(send.getByText("assistant", { exact: true }), "report.attempt.tool.response.role").toBeVisible();
    await expect(
      send.getByText("I remember this. RECALL_OK for classic/tool-note.", { exact: true }),
      "report.attempt.tool.response.content",
    ).toBeVisible();
    await this.expectTiming(dialog, ["eval.run", "turn1", "assertions.evaluate"], "report.attempt.tool.timing");
    await this.closeDialog(dialog);
  }

  async openMemoryASourceSnapshotAttempt(expectedLocator: string): Promise<void> {
    const dialog = await this.openMemoryAAttempt({
      evalSummary: "source-snapshot",
      evalId: "source-snapshot",
      locator: expectedLocator,
      verdict: "passed",
      inClassicGroup: false,
    });
    await this.expectAttemptPresentation(dialog, expectedLocator);
    await this.expectCapabilities(dialog, ["source", "timing"], ["execution", "diff"]);
    await this.expectSourceBlock(
      dialog,
      "evals/source-snapshot.eval.ts",
      "ENTRY_SNAPSHOT_BEFORE",
      "report.attempt.sourceSnapshot.source.entry",
    );
    const importedSourceLine = await this.nativeDisclosureWithExactText(dialog, "checkImportedSnapshot(t);");
    await expect(importedSourceLine, "report.attempt.sourceSnapshot.source.callLine.closed").not.toHaveAttribute("open", "");
    await importedSourceLine.locator(":scope > summary").click();
    await expect(importedSourceLine, "report.attempt.sourceSnapshot.source.callLine.open").toHaveAttribute("open", "");
    const importedCallSummary = dialog.getByText("1 checks · 1 ✓ · 0 ✗", { exact: true });
    await expect(importedCallSummary, "report.attempt.sourceSnapshot.source.importedCall.summary").toHaveCount(1);
    const importedCall = importedCallSummary.locator("..");
    await expect(importedCall, "report.attempt.sourceSnapshot.source.importedCall.count").toHaveCount(1);
    await expect(importedCall, "report.attempt.sourceSnapshot.source.importedCall.closed").not.toHaveAttribute("open", "");
    await importedCallSummary.click();
    await expect(importedCall, "report.attempt.sourceSnapshot.source.importedCall.open").toHaveAttribute("open", "");
    await this.expectSourceBlock(
      dialog,
      "evals/source-snapshot/assertions.ts",
      "IMPORTED_ASSERTION_SNAPSHOT_BEFORE",
      "report.attempt.sourceSnapshot.source.imported",
    );
    await expect(
      dialog.getByText("Execution evidence unavailable · 1 warnings", { exact: true }),
      "report.attempt.sourceSnapshot.execution.unavailable",
    ).toBeVisible();
    await this.expectTiming(dialog, ["eval.run", "assertions.evaluate"], "report.attempt.sourceSnapshot.timing");
    await this.closeDialog(dialog);
  }

  private async expectTabs(): Promise<void> {
    for (const name of ["Overview", "Attempts", "Traces"] as const) {
      await expect(this.page.getByRole("tab", { name, exact: true }), `report.nav.${name}`).toBeVisible();
    }
    await expect(this.page.getByRole("tab", { name: "Overview", exact: true }), "report.nav.overview.selected").toHaveAttribute(
      "aria-selected",
      "true",
    );
  }

  private async expectExactStat(expectation: OverviewStatExpectation): Promise<Locator> {
    const labels = this.page.getByText(expectation.label, { exact: true });
    const matchingCards: Locator[] = [];
    const count = await labels.count();
    for (let index = 0; index < count; index++) {
      const card = labels.nth(index).locator("..");
      if (JSON.stringify(await directCellLines(card)) === JSON.stringify(expectation.lines)) matchingCards.push(card);
    }
    expect(matchingCards, `report.stat[${expectation.label}].cellAffiliation`).toHaveLength(1);
    await expect(matchingCards[0]!, `report.stat[${expectation.label}]`).toBeVisible();
    return matchingCards[0]!;
  }

  private async expectBars(expected: readonly BarExpectation[]): Promise<void> {
    const section = this.page.getByRole("heading", { name: "Leaderboard", exact: true }).locator("..");
    const list = section.getByRole("list");
    await expect(list, "report.bars.list").toBeVisible();
    const rows = list.getByRole("listitem");
    await expect(rows, "report.bars.rows").toHaveCount(expected.length);
    for (const [index, item] of expected.entries()) {
      expect(exactLines(await rows.nth(index).innerText()), `report.bars.rows[${index}]`).toEqual([item.label, item.value]);
    }
  }

  private experimentLink(point: ScatterPointExpectation): Locator {
    return this.page.getByRole("img", { name: "costUSD × passRate", exact: true }).getByRole("link", {
      name: new RegExp(
        `^${escapeRegExp(point.experimentId)}\\s+costUSD: ${escapeRegExp(point.cost)}\\s+passRate: ${escapeRegExp(point.passRate)}$`,
      ),
    });
  }

  private async expectExperimentTable(expected: readonly ExperimentRowExpectation[]): Promise<Locator> {
    const table = this.page.getByRole("table");
    await expect(table, "report.table.count").toHaveCount(1);
    expect(await table.getByRole("columnheader").allTextContents(), "report.table.headers").toEqual([
      "Experiment",
      "Model",
      "Agent",
      "Avg. time",
      "Pass rate",
      "Tokens",
      "Cost",
      "Record",
    ]);
    for (const item of expected) {
      const summaries = table.locator("summary");
      const matches: Locator[] = [];
      for (let index = 0; index < (await summaries.count()); index += 1) {
        const summary = summaries.nth(index);
        if ((await summary.getByText(item.id, { exact: true }).count()) === 1) matches.push(summary);
      }
      expect(matches, `report.table.experiment[${item.id}].row`).toHaveLength(1);
      const cells = matches[0]!.locator(":scope > span");
      await expect(cells, `report.table.experiment[${item.id}].cells`).toHaveCount(8);
      const lines = await cells.allInnerTexts();
      expect(exactLines(lines[0]!), `report.table.experiment[${item.id}].Experiment`).toEqual([item.id]);
      expect(exactLines(lines[1]!), `report.table.experiment[${item.id}].Model`).toEqual([item.model]);
      expect(exactLines(lines[2]!), `report.table.experiment[${item.id}].Agent`).toEqual([item.agent]);
      expect(exactLines(lines[4]!), `report.table.experiment[${item.id}].PassRate`).toEqual([item.passRate]);
      await expect(cells.nth(6).getByText(item.cost, { exact: true }), `report.table.experiment[${item.id}].Cost`).toHaveCount(1);
      await expect(
        cells.nth(6).getByText(item.costCoverage, { exact: true }),
        `report.table.experiment[${item.id}].CostCoverage`,
      ).toHaveCount(1);
      expect(exactLines(lines[7]!), `report.table.experiment[${item.id}].Record`).toEqual(item.record);
      const boxes: PresentationBox[] = [];
      for (let index = 0; index < 8; index += 1) {
        boxes.push(await this.expectVisibleBox(cells.nth(index), `report.presentation.table.experiment[${item.id}].cell[${index}]`));
      }
      for (let index = 1; index < boxes.length; index += 1) {
        expect(boxes[index]!.x, `report.presentation.table.experiment[${item.id}].cellOrder[${index}]`).toBeGreaterThan(
          boxes[index - 1]!.x,
        );
      }
    }
    return table;
  }

  private async expand(identity: string, scope: Page | Locator = this.page): Promise<Locator> {
    const summaries = scope.locator("summary");
    const matching: Locator[] = [];
    const count = await summaries.count();
    for (let index = 0; index < count; index++) {
      const summary = summaries.nth(index);
      if ((await summary.getByText(identity, { exact: true }).count()) === 1) matching.push(summary);
    }
    expect(matching, `report.hierarchy.summary[${identity}]`).toHaveLength(1);
    const summary = matching[0]!;
    await expect(summary, `report.hierarchy.summary[${identity}].visible`).toBeVisible();
    await this.expectVisibleBox(summary, `report.hierarchy.summary[${identity}].presentation`);
    const details = summary.locator("..");
    if (!(await details.evaluate((element) => (element as HTMLDetailsElement).open))) await summary.click();
    await expect(details, `report.hierarchy.summary[${identity}].expanded`).toHaveAttribute("open", "");
    return details;
  }

  private async expectExactKeyValue(scope: Locator, label: string, value: string): Promise<void> {
    await this.expectExactCell(scope, label, [label.toUpperCase(), value], `report.attempt.${label}`);
  }

  private async expectExactCell(scope: Locator, anchor: string, expectedLines: readonly string[], path: string): Promise<void> {
    const labels = scope.getByText(anchor, { exact: true });
    const matchingCards: Locator[] = [];
    const count = await labels.count();
    for (let index = 0; index < count; index++) {
      const card = labels.nth(index).locator("..");
      const lines = await directCellLines(card);
      if (JSON.stringify(lines) === JSON.stringify(expectedLines)) matchingCards.push(card);
    }
    expect(matchingCards, `${path}.cellAffiliation`).toHaveLength(1);
  }

  private async closeDialog(dialog: Locator): Promise<void> {
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(dialog, "report.dialog.closed").toBeHidden();
  }

  private async openMemoryAAttempt(options: {
    readonly evalSummary: string;
    readonly evalId: string;
    readonly locator: string;
    readonly verdict: "passed" | "failed";
    readonly inClassicGroup: boolean;
  }): Promise<Locator> {
    const memoryA = await this.expand("classic/memory-a");
    const evalParent = options.inClassicGroup ? await this.expand("classic (8 evals)", memoryA) : memoryA;
    const evaluation = await this.expand(options.evalSummary, evalParent);
    const link = evaluation.getByRole("link", { name: options.locator, exact: true });
    await expect(link, `report.attempt[${options.locator}].link`).toHaveCount(1);
    expect(exactLines(await link.innerText()), `report.attempt[${options.locator}].identity`).toEqual([
      options.verdict === "passed" ? "✓" : "✗",
      options.locator,
    ]);
    await link.click();
    const dialog = this.page.getByRole("dialog");
    await expect(dialog, `report.attempt.dialog[${options.locator}]`).toBeVisible();
    await this.expectExactCell(dialog, options.locator, [options.verdict, options.locator], "report.attempt.summary");
    await this.expectExactKeyValue(dialog, "Experiment", "classic/memory-a");
    await this.expectExactKeyValue(dialog, "Eval", options.evalId);
    await this.expectExactKeyValue(dialog, "Attempt", "1");
    return dialog;
  }

  private async expectOverviewPresentation(
    title: Locator,
    stats: readonly Locator[],
    leaderboard: Locator,
    scatter: Locator,
    table: Locator,
    points: readonly ScatterPointExpectation[],
  ): Promise<void> {
    const titleBox = await this.expectVisibleBox(title, "report.presentation.overview.title");
    const leaderboardBox = await this.expectVisibleBox(leaderboard, "report.presentation.overview.leaderboard");
    expect(leaderboardBox.y, "report.presentation.overview.leaderboard.afterTitle").toBeGreaterThan(
      titleBox.y + titleBox.height,
    );
    for (const [index, stat] of stats.entries()) {
      const box = await this.expectVisibleBox(stat, `report.presentation.stat[${index}]`);
      expect(box.y, `report.presentation.stat[${index}].afterTitle`).toBeGreaterThan(titleBox.y);
      expect(box.y + box.height, `report.presentation.stat[${index}].beforeLeaderboard`).toBeLessThanOrEqual(leaderboardBox.y);
    }
    const scatterBox = await this.expectVisibleBox(scatter, "report.presentation.scatter");
    expect(scatterBox.y, "report.presentation.scatter.afterLeaderboard").toBeGreaterThan(leaderboardBox.y);
    await this.expectLocalHorizontalContainment(scatter, "report.presentation.scatter.overflow");
    const tableBox = await this.expectVisibleBox(table, "report.presentation.table");
    expect(tableBox.y, "report.presentation.table.afterScatter").toBeGreaterThan(scatterBox.y + scatterBox.height);
    await this.expectLocalHorizontalContainment(table, "report.presentation.table.overflow");

    const pointBoxes: PresentationBox[] = [];
    const scatterLinks = scatter.getByRole("link");
    await expect(scatterLinks, "report.presentation.scatter.pointCount").toHaveCount(points.length);
    for (const point of points) {
      const link = this.experimentLink(point);
      const pointBox = await this.expectVisibleBox(link, `report.presentation.scatter.point[${point.experimentId}]`);
      expect(pointBox.x, `report.presentation.scatter.point[${point.experimentId}].left`).toBeGreaterThanOrEqual(scatterBox.x);
      expect(pointBox.y, `report.presentation.scatter.point[${point.experimentId}].top`).toBeGreaterThanOrEqual(scatterBox.y);
      expect(pointBox.x + pointBox.width, `report.presentation.scatter.point[${point.experimentId}].right`).toBeLessThanOrEqual(
        scatterBox.x + scatterBox.width,
      );
      expect(pointBox.y + pointBox.height, `report.presentation.scatter.point[${point.experimentId}].bottom`).toBeLessThanOrEqual(
        scatterBox.y + scatterBox.height,
      );
      await this.expectPaintedScatterMark(link, point.experimentId);
      pointBoxes.push(pointBox);
    }
    for (let index = 1; index < pointBoxes.length; index += 1) {
      expect(pointBoxes[index]!.x, `report.presentation.scatter.rightToLeft[${index - 1}→${index}]`).toBeLessThan(
        pointBoxes[index - 1]!.x,
      );
      expect(pointBoxes[index]!.y, `report.presentation.scatter.topToBottom[${index - 1}→${index}]`).toBeLessThan(
        pointBoxes[index - 1]!.y,
      );
    }
  }

  private async expectAttemptPresentation(dialog: Locator, locator: string): Promise<void> {
    const dialogBox = await this.expectVisibleBox(dialog, `report.presentation.attempt[${locator}].dialog`);
    const dialogStyle = await dialog.evaluate((element) => {
      const style = getComputedStyle(element);
      return { position: style.position, overflowX: style.overflowX, overflowY: style.overflowY };
    });
    expect(dialogStyle.position, `report.presentation.attempt[${locator}].dialog.overlay`).toBe("fixed");
    expect(["hidden", "clip"], `report.presentation.attempt[${locator}].dialog.overflowX`).toContain(dialogStyle.overflowX);
    const content = dialog.locator(":scope > *").last();
    const contentBox = await this.expectVisibleBox(content, `report.presentation.attempt[${locator}].content`);
    expect(contentBox.width, `report.presentation.attempt[${locator}].content.withinDialog`).toBeLessThanOrEqual(dialogBox.width);
    const contentStyle = await content.evaluate((element) => getComputedStyle(element).overflowY);
    expect(["auto", "scroll"], `report.presentation.attempt[${locator}].content.scroll`).toContain(contentStyle);
    await this.expectLocalHorizontalContainment(dialog, `report.presentation.attempt[${locator}].overflow`);
  }

  private async expectCapabilities(
    dialog: Locator,
    available: readonly string[],
    unavailable: readonly string[],
  ): Promise<void> {
    await expect(
      dialog.getByText(available.join(" · "), { exact: true }),
      `report.attempt.capabilities.available[${available.join(",")}]`,
    ).toBeVisible();
    for (const capability of unavailable) {
      await expect(
        dialog.getByText(capability, { exact: true }),
        `report.attempt.capabilities.${capability}.unavailable`,
      ).toHaveCount(0);
    }
  }

  private async expectSourceBlock(dialog: Locator, file: string, content: string, path: string): Promise<void> {
    const labels = dialog.getByText(file, { exact: true });
    const matches: Locator[] = [];
    for (let index = 0; index < (await labels.count()); index += 1) {
      const block = labels.nth(index).locator("..");
      if ((await block.innerText()).includes(content)) matches.push(block);
    }
    expect(matches, `${path}.affiliation`).toHaveLength(1);
    await this.expectVisibleBox(matches[0]!, path);
    await this.expectLocalHorizontalContainment(matches[0]!, `${path}.overflow`);
  }

  private async expectTiming(dialog: Locator, names: readonly string[], path: string): Promise<void> {
    const heading = dialog.getByText("Execution timeline", { exact: true });
    await expect(heading, `${path}.timeline`).toBeVisible();
    const timeline = heading.locator("..");
    const actualNames = (await timeline.locator("[title]").allInnerTexts()).flatMap(exactLines);
    expect(actualNames, `${path}.node.sequence`).toEqual(names);
    for (const name of names) {
      const node = timeline.getByText(name, { exact: true });
      await expect(node, `${path}.node[${name}].count`).toHaveCount(1);
      await expect(node, `${path}.node[${name}].visible`).toBeVisible();
      await expect(node.locator("..").getByText(/^\d+ms$/), `${path}.node[${name}].duration`).toHaveCount(1);
    }
    await this.expectLocalHorizontalContainment(timeline, `${path}.overflow`);
  }

  private async nativeDisclosureWithMarker(scope: Locator, accessibleName: string): Promise<Locator> {
    const disclosures = scope.locator("details");
    const matches: Locator[] = [];
    for (let index = 0; index < (await disclosures.count()); index += 1) {
      const disclosure = disclosures.nth(index);
      if ((await disclosure.locator(":scope > summary").getByRole("img", { name: accessibleName, exact: true }).count()) === 1) {
        matches.push(disclosure);
      }
    }
    expect(matches, `report.attempt.disclosure.marker[${accessibleName}]`).toHaveLength(1);
    return matches[0]!;
  }

  private async nativeDisclosureWithExactText(scope: Locator, text: string): Promise<Locator> {
    const disclosures = scope.locator("details");
    const matches: Locator[] = [];
    for (let index = 0; index < (await disclosures.count()); index += 1) {
      const disclosure = disclosures.nth(index);
      if ((await disclosure.locator(":scope > summary").getByText(text, { exact: true }).count()) === 1) {
        matches.push(disclosure);
      }
    }
    expect(matches, `report.attempt.disclosure.text[${text}]`).toHaveLength(1);
    return matches[0]!;
  }

  private async expectPaintedScatterMark(link: Locator, experimentId: string): Promise<void> {
    const mark = link.locator("path, circle, rect").first();
    await expect(mark, `report.presentation.scatter.point[${experimentId}].mark`).toHaveCount(1);
    const paint = await mark.evaluate((element) => {
      const style = getComputedStyle(element);
      const alpha = (color: string): number => {
        if (color === "transparent" || color === "none") return 0;
        const match = /^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)$/.exec(color);
        return match === null ? 1 : Number(match[1]);
      };
      return {
        fill: style.fill,
        stroke: style.stroke,
        opacity: Number(style.opacity),
        fillOpacity: Number(style.fillOpacity),
        strokeOpacity: Number(style.strokeOpacity),
        painted:
          Number(style.opacity) > 0 &&
          ((alpha(style.fill) > 0 && Number(style.fillOpacity) > 0) ||
            (alpha(style.stroke) > 0 && Number(style.strokeOpacity) > 0)),
      };
    });
    expect(paint.painted, `report.presentation.scatter.point[${experimentId}].painted ${JSON.stringify(paint)}`).toBe(true);
    const legendMark = this.page
      .getByRole("img", { name: "costUSD × passRate", exact: true })
      .locator("..")
      .locator("ul path, ul circle, ul rect")
      .first();
    await expect(legendMark, "report.presentation.scatter.legend.mark").toHaveCount(1);
    const legendFill = await legendMark.evaluate((element) => getComputedStyle(element).fill);
    expect(paint.fill, `report.presentation.scatter.point[${experimentId}].legendPaint`).toBe(legendFill);
  }

  private async expectStatePaint(summary: Locator, path: string): Promise<void> {
    const paintedRow = summary.locator(":scope > *").first();
    await expect(paintedRow, `${path}.row`).toHaveCount(1);
    const paint = await paintedRow.evaluate((element) => {
      const style = getComputedStyle(element);
      return { backgroundColor: style.backgroundColor, boxShadow: style.boxShadow };
    });
    expect(
      paint.backgroundColor !== "transparent" && paint.backgroundColor !== "rgba(0, 0, 0, 0)",
      `${path}.background ${JSON.stringify(paint)}`,
    ).toBe(true);
    expect(paint.boxShadow, `${path}.edge`).not.toBe("none");
  }

  private async expectVisibleBox(locator: Locator, path: string): Promise<PresentationBox> {
    await expect(locator, path).toBeVisible();
    const box = await locator.boundingBox();
    expect(box, `${path}.boundingBox`).not.toBeNull();
    expect(box!.width, `${path}.boundingBox.width`).toBeGreaterThan(0);
    expect(box!.height, `${path}.boundingBox.height`).toBeGreaterThan(0);
    const style = await locator.evaluate((element) => {
      const computed = getComputedStyle(element);
      return { display: computed.display, visibility: computed.visibility };
    });
    expect(style.display, `${path}.computedStyle.display`).not.toBe("none");
    expect(style.visibility, `${path}.computedStyle.visibility`).toBe("visible");
    return box!;
  }

  private async expectLocalHorizontalContainment(locator: Locator, path: string): Promise<void> {
    const layout = await locator.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const root = document.scrollingElement ?? document.documentElement;
      return {
        boxWidth: box.width,
        viewportWidth: window.innerWidth,
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
        overflowX: getComputedStyle(element).overflowX,
        pageScrollWidth: root.scrollWidth,
        pageClientWidth: root.clientWidth,
      };
    });
    expect(layout.boxWidth, `${path}.withinViewport`).toBeLessThanOrEqual(layout.viewportWidth + 1);
    expect(layout.pageScrollWidth, `${path}.notEscapedToPage`).toBeLessThanOrEqual(layout.pageClientWidth + 1);
    if (layout.scrollWidth > layout.clientWidth + 1) {
      expect(["auto", "scroll", "hidden", "clip"], `${path}.localOverflowMode`).toContain(layout.overflowX);
    } else {
      expect(layout.scrollWidth, `${path}.noLocalOverflow`).toBeLessThanOrEqual(layout.clientWidth + 1);
    }
  }
}
