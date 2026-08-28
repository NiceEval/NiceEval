// owner: docs/engineering/testing/e2e/report.md#operational-browser-journey
// regression: memory/report-match-details-obscure-score-and-collection.md
// regression: memory/report-result-cell-exposes-float-noise-and-unlabeled-coverage.md
// regression: memory/report-header-experiment-selector-regression.md
// regression: memory/view-renderer-flattens-debug-evidence.md
// rerun: pnpm e2e test --repo report -- --run test/view-snapshot.browser.spec.ts

import { only, type ProcessHandle } from "@niceeval/testkit";
import { expect, test } from "@playwright/test";
import {
  decodeViewLifecycle,
  expectLoopbackReadyUrl,
  reportCaseArtifacts,
  reportE2E,
  waitForViewReady,
} from "./support.ts";

test("读者从层级 Overview 在可恢复 overlay 中审阅完整 Attempt 证据，并始终读取同一 sealed cutoff", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const failedResponses: Array<{ readonly path: string; readonly status: number }> = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.hostname === "127.0.0.1" && response.status() >= 400) {
      failedResponses.push({ path: url.pathname, status: response.status() });
    }
  });

  await reportE2E.case(
    "view-snapshot-browser",
    { artifacts: reportCaseArtifacts() },
    async ({ paths: { projectRoot }, commands: { niceeval } }) => {
      const inspection = await niceeval.run(["exp", "main", "--rerun", "all", "--json"]);
      expect(inspection.exitCode, inspection.diagnostic()).toBe(0);
      expect(inspection.expReceipt(), inspection.diagnostic()).toMatchObject({ completion: "completed" });
      const inspectionRunId = only(inspection.expReceipt().createdRunIds, () => true, inspection.diagnostic());
      const inspectionAttempt = only(
        inspection.expEvalEvents(),
        (event) => event.evalId === "inspection",
        inspection.diagnostic(),
      );
      const inspectionLocator = withAt(inspectionAttempt.locator);

      const comparison = await niceeval.run(["exp", "main", "--rerun", "all", "--json"]);
      expect(comparison.exitCode, comparison.diagnostic()).toBe(0);
      const comparisonRunId = only(comparison.expReceipt().createdRunIds, () => true, comparison.diagnostic());
      const comparisonAttempt = only(
        comparison.expEvalEvents(),
        (event) => event.evalId === "inspection",
        comparison.diagnostic(),
      );
      const comparisonLocator = withAt(comparisonAttempt.locator);

      const alternate = await niceeval.run(["exp", "alternate", "--rerun", "all", "--json"]);
      expect(alternate.exitCode, alternate.diagnostic()).toBe(0);

      let recallLocator = "";
      let toolLocator = "";
      for (const experimentId of ["classic/baseline", "classic/memory-a", "classic/incompatible"] as const) {
        const result = await niceeval.run(["exp", experimentId, "--rerun", "all", "--json"]);
        expect(result.expReceipt(), result.diagnostic()).toMatchObject({ completion: "completed" });
        if (experimentId === "classic/memory-a") {
          recallLocator = withAt(only(
            result.expEvalEvents(),
            (event) => event.evalId === "classic/recall-name",
            result.diagnostic(),
          ).locator);
          toolLocator = withAt(only(
            result.expEvalEvents(),
            (event) => event.evalId === "classic/tool-note",
            result.diagnostic(),
          ).locator);
        }
      }
      expect(recallLocator).toMatch(/^@[0-9A-Z]+$/u);
      expect(toolLocator).toMatch(/^@[0-9A-Z]+$/u);

      const view = niceeval.start([
        "view",
        "--no-open",
        "--port",
        "0",
        "--json",
      ], { timeoutMs: 90_000 });

      try {
        const ready = await waitForViewReady(view);
        const response = await page.goto(expectLoopbackReadyUrl(ready.url).href);
        expect(response?.status()).toBe(200);
        await expect(page.getByRole("heading", { name: "NiceEval overview", exact: true })).toBeVisible();

        const header = page.getByRole("banner");
        const experimentSelector = header.getByRole("combobox", { name: "Experiments" });
        const languageSelector = header.getByRole("combobox", { name: "Language" });
        await expect(experimentSelector).toBeVisible();
        await expect(languageSelector).toBeVisible();
        const headerComboboxes = header.getByRole("combobox");
        await expect(headerComboboxes).toHaveCount(2);
        await expect(headerComboboxes.nth(0)).toHaveAccessibleName("Experiments");
        await expect(headerComboboxes.nth(1)).toHaveAccessibleName("Language");
        await expect(experimentSelector.getByRole("option")).toContainText([
          "named/classic",
          "singleton/alternate",
          "singleton/main",
        ]);
        await experimentSelector.selectOption("/group/named/classic");
        await expect(page).toHaveURL(/#\/group\/named\/classic$/u);

        await languageSelector.selectOption("zh-CN");
        expect(new URL(page.url()).hash).toBe("#/group/named/classic");
        await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
        await page.getByRole("combobox", { name: "实验" }).selectOption("/group/named/classic");
        await page.getByRole("combobox", { name: "Language" }).selectOption("en");

        const experimentSummary = page.locator("summary.niceeval-table-hierarchy-summary").filter({
          hasText: /^classic\/memory-a /u,
        });
        await expect(experimentSummary).toHaveCount(1);
        await experimentSummary.click();
        const experimentDetails = experimentSummary.locator("xpath=..");
        await expect(experimentDetails).toHaveAttribute("open", "");

        const evalGroupSummary = experimentDetails.locator("summary.niceeval-table-hierarchy-summary").filter({
          hasText: /^classic \(8 evals\)/u,
        });
        await expect(evalGroupSummary).toHaveCount(1);
        await evalGroupSummary.click();
        await expect(evalGroupSummary.locator("xpath=..")).toHaveAttribute("open", "");

        const recallSummary = experimentDetails.locator("summary.niceeval-table-hierarchy-summary").filter({
          hasText: /^recall-name/u,
        });
        await expect(recallSummary).toHaveCount(1);
        await recallSummary.click();
        await expect(recallSummary.locator("xpath=..")).toHaveAttribute("open", "");
        const recallAttempt = experimentDetails.getByRole("link", { name: recallLocator, exact: true });
        await expect(recallAttempt).toBeVisible();

        const scoreSummary = page.locator("summary.niceeval-table-hierarchy-summary").filter({
          hasText: /^classic\/incompatible /u,
        });
        await expect(scoreSummary.locator(".niceeval-table-hierarchy-cell").first()).toHaveText(
          "classic/incompatible (1/10)",
        );
        const scoreValue = scoreSummary.locator(".niceeval-value");
        await expect(scoreValue).toHaveCount(1);
        await expect(scoreValue).toHaveText("7 points");
        await expect(scoreSummary).not.toContainText("missed check");
        await expect(scoreSummary).not.toContainText("passed");
        await expect(scoreSummary.locator(".niceeval-coverage")).toHaveCount(0);
        const missingScore = experimentDetails.locator(".niceeval-row-placeholder").filter({
          hasText: /^score/u,
        });
        await expect(missingScore.locator(".niceeval-missing-reason")).toHaveText(
          "no result for current config",
        );
        await expect(missingScore.locator(".niceeval-cell-detail")).toHaveText(
          "niceeval exp classic/memory-a",
        );
        await expect(page.locator(".niceeval-value").filter({ hasText: /^0$/u })).toHaveCount(0);

        await testInfo.attach("snapshot-overview", {
          body: await page.screenshot({ fullPage: true }),
          contentType: "image/png",
        });

        const overviewHash = new URL(page.url()).hash;
        await recallAttempt.click({ noWaitAfter: true });
        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole("status")).toContainText("Loading details…");
        const overviewHeading = page.locator("main h1");
        await expect(overviewHeading).toHaveCount(1);
        await expect(overviewHeading).toHaveText("NiceEval overview");
        await expect(overviewHeading).toBeVisible();
        const attemptSummaryLocator = dialog.locator(".niceeval-attempt-summary-locator");
        await expect(attemptSummaryLocator).toHaveCount(1);
        await expect(attemptSummaryLocator).toBeVisible();
        await expect(attemptSummaryLocator).toHaveText(recallLocator);
        await expect(experimentDetails).toHaveAttribute("open", "");
        await expect(evalGroupSummary.locator("xpath=..")).toHaveAttribute("open", "");
        await expect(recallSummary.locator("xpath=..")).toHaveAttribute("open", "");

        const assertionLine = dialog.locator("summary").filter({ hasText: "t.check(t.reply" }).first();
        await assertionLine.click();
        const rootMatch = dialog.getByLabel(/^and\(includes.+: matched$/u).first();
        await expect(rootMatch).toBeVisible();
        await rootMatch.click();
        const orMatch = dialog.getByLabel(/^or\(includes.+: matched$/u).first();
        await expect(orMatch).toBeVisible();
        await orMatch.click();
        const orNode = orMatch.locator("xpath=..");
        await expect(orNode.getByLabel('includes("RECALL_OK"): matched')).toBeVisible();
        await expect(orNode.getByLabel('includes("NEVER_PRESENT"): mismatched')).toBeVisible();
        const assertionDetail = assertionLine.locator("xpath=..").locator(":scope > .niceeval-source-line-detail");
        await expect(assertionDetail.getByText("Expected", { exact: true }).first()).toBeVisible();
        await expect(assertionDetail.getByText("Observed", { exact: true }).first()).toBeVisible();
        await expect(assertionDetail.getByText("Reason", { exact: true }).first()).toBeVisible();

        const copiedAttemptUrl = page.url();
        await dialog.getByRole("button", { name: "Close" }).click();
        await expect(dialog).not.toBeVisible();
        expect(new URL(page.url()).hash).toBe(overviewHash);
        await expect(experimentDetails).toHaveAttribute("open", "");

        await page.goForward();
        await expect(dialog).toBeVisible();
        await page.goBack();
        await expect(dialog).not.toBeVisible();
        await page.goForward();
        await expect(dialog).toBeVisible();
        await page.reload();
        expect(page.url()).toBe(copiedAttemptUrl);
        await expect(dialog).toBeVisible();

        const shared = await page.context().newPage();
        try {
          await shared.goto(copiedAttemptUrl);
          await expect(shared.getByRole("dialog")).toBeVisible();
          const sharedOverviewHeading = shared.locator("main h1");
          await expect(sharedOverviewHeading).toHaveCount(1);
          await expect(sharedOverviewHeading).toHaveText("NiceEval overview");
          await expect(sharedOverviewHeading).toBeVisible();
          await shared.getByRole("button", { name: "Close" }).click();
          await expect(shared.getByRole("dialog")).not.toBeVisible();
          await expect(shared).toHaveURL(/#\/group\/named\/classic$/u);
        } finally {
          await shared.close();
        }

        await page.mouse.click(5, 5);
        await expect(dialog).not.toBeVisible();
        await expect(page).toHaveURL(/#\/group\/named\/classic$/u);

        const toolExperiment = page.locator("summary.niceeval-table-hierarchy-summary").filter({
          hasText: /^classic\/memory-a /u,
        });
        if (await toolExperiment.locator("xpath=..").getAttribute("open") === null) await toolExperiment.click();
        const toolGroup = toolExperiment.locator("xpath=..").locator("summary.niceeval-table-hierarchy-summary").filter({
          hasText: /^classic \(8 evals\)/u,
        });
        if (await toolGroup.locator("xpath=..").getAttribute("open") === null) await toolGroup.click();
        const toolEval = toolExperiment.locator("xpath=..").locator("summary.niceeval-table-hierarchy-summary").filter({
          hasText: /^tool-note/u,
        });
        if (await toolEval.locator("xpath=..").getAttribute("open") === null) await toolEval.click();
        const toolAttempt = toolExperiment.locator("xpath=..").getByRole("link", { name: toolLocator, exact: true });
        const toolHref = await toolAttempt.getAttribute("href");
        expect(toolHref).toMatch(/^#\/attempt\//u);
        await page.goto(new URL(toolHref!, page.url()).href);
        await expect(dialog).toBeVisible();

        const usageGrid = dialog.locator(".niceeval-usage-table");
        const usageCells = usageGrid.locator(":scope > .niceeval-grid-cell");
        await expect(usageCells).toHaveCount(5);
        const firstUsageRow = await usageCells.evaluateAll((cells) => cells.slice(0, 2).map((cell) => {
          const { x, y } = cell.getBoundingClientRect();
          return { x, y };
        }));
        expect(firstUsageRow[1]!.x).toBeGreaterThan(firstUsageRow[0]!.x);
        expect(Math.abs(firstUsageRow[1]!.y - firstUsageRow[0]!.y)).toBeLessThan(1);

        const sendLine = dialog.locator("details.niceeval-source-line--send").filter({
          hasText: 'const turn = await t.send("Write a memory note, then recall it.");',
        });
        await expect(sendLine).toHaveCount(1);
        await sendLine.locator(":scope > summary").click();
        const sendDetail = sendLine.locator(":scope > .niceeval-source-line-detail");
        await expect(sendDetail.getByText("Session log", { exact: true })).toBeVisible();

        const absenceAssertion = dialog.locator("details.niceeval-source-line > summary").filter({
          hasText: 'turn.notCalledTool("forbidden_state_tool")',
        });
        await absenceAssertion.click();
        const absenceDetail = absenceAssertion.locator("xpath=..").locator(":scope > .niceeval-source-line-detail");
        const absenceMatch = absenceDetail.getByLabel(
          'notCalledTool(toolMatch("forbidden_state_tool")): matched',
        );
        await absenceMatch.click();
        const structuredObserved = absenceDetail
          .getByRole("heading", { name: "Observed", exact: true })
          .locator("xpath=..");
        await expect(structuredObserved).toBeVisible();
        await expect(structuredObserved.locator("dt")).toHaveText(["kind", "outcome"]);
        await expect(structuredObserved).toContainText("boolean");
        await expect(structuredObserved).toContainText("matched");
        await expect(absenceDetail).not.toContainText("fields: label:");

        const toolAssertion = dialog.locator("details.niceeval-source-line > summary").filter({
          hasText: 'toolMatch("write_note").exactly(1)',
        });
        const toolAssertionDetails = toolAssertion.locator("xpath=..");
        if (await toolAssertionDetails.getAttribute("open") === null) await toolAssertion.click();
        const toolDetail = toolAssertionDetails.locator(":scope > .niceeval-source-line-detail");
        await expect(toolDetail).toBeVisible();
        const toolMatcher = toolDetail.getByLabel('toolMatch("write_note").exactly(1): mismatched');
        await toolMatcher.click();
        const toolFilter = toolDetail.getByRole("region", { name: "Tool call filter" });
        await expect(toolFilter).toBeVisible();
        await expect(toolFilter.getByText('exactly 1 × toolMatch("write_note")', { exact: true })).toBeVisible();
        const toolLedger = toolFilter.locator("details.niceeval-filter-ledger");
        await toolLedger.locator(":scope > summary").click();
        await expect(toolLedger.locator(".niceeval-filter-row").first()).toBeVisible();

        const eventAssertion = dialog.locator("details.niceeval-source-line > summary").filter({
          hasText: 'turn.check(turn.eventOccurrences, eventMatch("message"',
        });
        const eventAssertionDetails = eventAssertion.locator("xpath=..");
        if (await eventAssertionDetails.getAttribute("open") === null) await eventAssertion.click();
        const eventDetail = eventAssertionDetails.locator(":scope > .niceeval-source-line-detail");
        await expect(eventDetail).toBeVisible();
        await eventDetail.getByLabel("Assistant message event: matched").click();
        await expect(eventDetail.getByRole("region", { name: "Event filter" })).toContainText(
          "exactly 1 × eventMatch(message)",
        );

        const commandAssertion = dialog.locator("details.niceeval-source-line > summary").filter({ hasText: "t.check({" });
        const commandAssertionDetails = commandAssertion.locator("xpath=..");
        if (await commandAssertionDetails.getAttribute("open") === null) await commandAssertion.click();
        const commandDetail = commandAssertionDetails.locator(":scope > .niceeval-source-line-detail");
        await expect(commandDetail).toBeVisible();
        await commandDetail.getByLabel("commandSucceeded(): matched").click();
        const commandResult = commandDetail.getByRole("heading", { name: "Command result" }).locator("xpath=..");
        await expect(commandResult).toBeVisible();
        await expect(commandResult.getByText("pnpm test", { exact: true })).toBeVisible();
        await expect(commandResult.getByText("Exit code 0", { exact: true })).toBeVisible();
        await expect(commandResult.getByText("PASS src/example.test.ts", { exact: true })).not.toBeVisible();

        const trajectory = sendDetail.getByRole("region", { name: "Trajectory timeline" });
        await expect(trajectory).toBeVisible();
        await expect(trajectory.getByText("Input / User", { exact: true })).toBeVisible();
        await expect(trajectory.getByText("Model / Assistant", { exact: true })).toBeVisible();
        await expect(trajectory.getByText("Tools / Tool", { exact: true })).toBeVisible();
        const search = sendDetail.getByRole("searchbox", { name: "Search trajectory" });
        await expect(search).toBeVisible();
        const toolOccurrence = sendDetail.getByRole("button", { name: /^tool: command_execution\b/i }).first();
        await toolOccurrence.click();
        await expect(toolOccurrence).toHaveAttribute("aria-expanded", "true");
        const toolPreview = toolOccurrence
          .locator("xpath=ancestor::article[1]")
          .getByRole("tabpanel", { name: "Preview" });
        await expect(toolPreview).toBeVisible();
        await expect(toolPreview.getByText("wrote memory-note.txt", { exact: false })).toBeVisible();
        const trajectoryControls = sendDetail.getByRole("toolbar", { name: "Trajectory controls" });
        await trajectoryControls.getByRole("button", { name: "Calls 1", exact: true }).click();
        await trajectoryControls.getByRole("button", { name: "Turns 1", exact: true }).click();
        await search.fill("RECALL_OK");
        await expect(sendDetail.getByRole("button", { name: /^assistant:.*RECALL_OK/i }).first()).toBeVisible();
        await expect(dialog.getByText("turns", { exact: true })).toBeVisible();
        await expect(dialog.getByText("tool calls", { exact: true })).toBeVisible();
        await expect(dialog.getByText(/Execution timeline/u).first()).toBeVisible();
        const calloutSummary = dialog.getByText("2 groups · 2 warnings", { exact: true });
        await expect(calloutSummary).toBeVisible();
        const callouts = calloutSummary.locator("xpath=..");
        await calloutSummary.click();
        await expect(callouts).toHaveAttribute("open", "");
        await expect(callouts.getByText(
          "file-changes-not-recorded: File changes collection was not recorded for this Attempt.",
          { exact: true },
        )).toBeVisible();

        await testInfo.attach("snapshot-attempt", {
          body: await page.screenshot({ fullPage: true }),
          contentType: "image/png",
        });

        await dialog.getByRole("button", { name: "Close" }).click();
        await experimentSelector.selectOption("/group/singleton/main");
        await expect(page).toHaveURL(/#\/group\/singleton\/main$/u);
        const frozenOverviewText = await page.locator(".niceeval-view-report-slot").first().innerText();
        const singletonSummary = page.locator("summary.niceeval-table-hierarchy-summary").filter({
          hasText: /^main \(1\/1\)/u,
        });
        await expect(singletonSummary).toHaveCount(1);
        await singletonSummary.click();
        const singletonDetails = singletonSummary.locator("xpath=..");
        await expect(singletonDetails).toHaveAttribute("open", "");
        const inspectionSummary = singletonDetails.locator("summary.niceeval-table-hierarchy-summary").filter({
          hasText: /^inspection/u,
        });
        await expect(inspectionSummary).toHaveCount(1);
        await inspectionSummary.click();
        const inspectionDetails = inspectionSummary.locator("xpath=..");
        await expect(inspectionDetails).toHaveAttribute("open", "");
        await expect(inspectionDetails.getByRole("link", { name: comparisonLocator, exact: true })).toBeVisible();
        await expect(inspectionDetails.getByRole("link", { name: inspectionLocator, exact: true })).toHaveCount(0);

        const later = await niceeval.run(["exp", "main", "--rerun", "all", "--json"]);
        expect(later.exitCode, later.diagnostic()).toBe(0);
        const laterRunId = only(later.expReceipt().createdRunIds, () => true, later.diagnostic());
        await page.reload();
        await expect(page.getByRole("heading", { name: "NiceEval overview", exact: true })).toBeVisible();
        expect(await page.locator(".niceeval-view-report-slot").first().innerText()).toBe(frozenOverviewText);
        await expect(page.getByRole("button", { name: /refresh/i })).toHaveCount(1);
        expect(laterRunId).not.toBe(inspectionRunId);
        expect(comparisonRunId).not.toBe(inspectionRunId);
        expect(pageErrors).toEqual([]);
        expect(consoleErrors).toEqual([]);
        expect(failedResponses).toEqual([]);
      } finally {
        await stopView(view);
      }
    },
  );
});

function withAt(locator: string): string {
  return locator.startsWith("@") ? locator : `@${locator}`;
}

async function stopView(view: ProcessHandle): Promise<void> {
  if (!view.settledExit) expect(view.signal("SIGTERM")).toBe(true);
  const closed = await view.done;
  expect(closed.exitCode, closed.diagnostic()).toBe(0);
  expect(decodeViewLifecycle(closed.stdout).at(-1)?.event).toBe("closed");
  await view.dispose();
}
