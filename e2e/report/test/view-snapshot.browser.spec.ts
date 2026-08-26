// owner: docs/engineering/testing/e2e/report.md#snapshot-browser-journey
// regression: memory/report-match-details-obscure-score-and-collection.md
// regression: memory/report-result-cell-exposes-float-noise-and-unlabeled-coverage.md
// regression: memory/report-header-experiment-selector-regression.md
// regression: memory/view-renderer-flattens-debug-evidence.md
// rerun: pnpm e2e test --repo report -- --run test/view-snapshot.browser.spec.ts

import { only, type ProcessHandle } from "@niceeval/testkit";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  decodeViewLifecycle,
  expectLoopbackReadyUrl,
  reportCaseArtifacts,
  reportE2E,
  waitForViewReady,
} from "./support.ts";

test("读者从 Record snapshot 审阅 overview、Run 与 Attempt，并始终读取同一 sealed cutoff", async ({ page }, testInfo) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const responses: Array<{ readonly path: string; readonly status: number }> = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.hostname === "127.0.0.1") responses.push({ path: url.pathname, status: response.status() });
  });

  await reportE2E.case(
    "view-snapshot-browser",
    { artifacts: reportCaseArtifacts() },
    async ({ paths: { projectRoot }, commands: { niceeval } }) => {
      const produced = await niceeval.run(["exp", "main", "--rerun", "all", "--json"]);
      expect(produced.exitCode, produced.diagnostic()).toBe(0);
      expect(produced.expReceipt(), produced.diagnostic()).toMatchObject({ completion: "completed" });
      const runId = only(produced.expReceipt().runIds, () => true, produced.diagnostic());
      const attempt = only(
        produced.expEvalEvents(),
        (event) => event.evalId === "inspection",
        produced.diagnostic(),
      );
      expect(attempt).toMatchObject({ verdict: "passed" });
      const locator = attempt.locator.startsWith("@") ? attempt.locator : `@${attempt.locator}`;

      const comparisonRun = await niceeval.run(["exp", "main", "--rerun", "all", "--json"]);
      expect(comparisonRun.exitCode, comparisonRun.diagnostic()).toBe(0);
      expect(comparisonRun.expReceipt(), comparisonRun.diagnostic()).toMatchObject({ completion: "completed" });
      const comparisonRunId = only(comparisonRun.expReceipt().runIds, () => true, comparisonRun.diagnostic());
      expect(comparisonRunId).not.toBe(runId);

      const alternate = await niceeval.run(["exp", "alternate", "--rerun", "all", "--json"]);
      expect(alternate.exitCode, alternate.diagnostic()).toBe(0);
      expect(alternate.expReceipt(), alternate.diagnostic()).toMatchObject({ completion: "completed" });
      const alternateRunId = only(alternate.expReceipt().runIds, () => true, alternate.diagnostic());

      const snapshot = join(projectRoot, "inspection.record-snapshot.sqlite");
      const exported = await niceeval.run(["record", "snapshot", "--output", snapshot]);
      expect(exported.exitCode, exported.diagnostic()).toBe(0);

      const view = niceeval.start([
        "view",
        "--record",
        snapshot,
        "--no-open",
        "--port",
        "0",
        "--json",
      ], { timeoutMs: 90_000 });
      let overviewContentHash: string | undefined;

      try {
        const requestedPaths: string[] = [];
        page.on("request", (request) => requestedPaths.push(new URL(request.url()).pathname));
        const ready = await waitForViewReady(view);
        const response = await page.goto(expectLoopbackReadyUrl(ready.url).href);
        expect(response?.status()).toBe(200);
        await expect(page.getByRole("heading", { name: "NiceEval overview", exact: true })).toBeVisible();
        const header = page.getByRole("banner");
        await expect(header).toHaveCSS("height", "64px");
        expect(await header.evaluate((element) => getComputedStyle(element).backgroundColor)).toMatch(
          /^(?:rgb|lab)\(.+\/\s*0\.95\)$/u,
        );
        const experimentSelector = page.getByRole("combobox", { name: "Experiments" });
        await expect(experimentSelector).toBeVisible();
        await expect(experimentSelector.getByRole("option")).toHaveText(["alternate", "main"]);
        await expect(experimentSelector).toHaveValue("main");
        const headerComboboxes = page.locator("header").getByRole("combobox");
        await expect(headerComboboxes).toHaveCount(2);
        await expect(headerComboboxes.nth(0)).toHaveAccessibleName("Experiments");
        await expect(headerComboboxes.nth(1)).toHaveAccessibleName("Language");
        const summary = page.getByRole("heading", { name: "Summary", exact: true }).locator("xpath=../..");
        await expect(summary).toBeVisible();
        await expect(summary.getByRole("article")).toHaveCount(6);
        const summaryMetrics = [
          ["Pass rate", "100%"],
          ["Experiments", "2"],
          ["Evals", "1"],
          ["Attempts", "2"],
          ["Results", "2"],
          ["Total cost", "$0"],
        ] as const;
        for (const [label, value] of summaryMetrics) {
          const metric = summary.getByRole("article").filter({
            has: page.getByText(label, { exact: true }),
          });
          await expect(metric).toHaveCount(1);
          await expect(metric.getByText(value, { exact: true })).toBeVisible();
        }
        const comparison = page.getByRole("img", { name: "Experiment comparison" });
        await expect(comparison).toBeVisible();
        await expect(comparison).toContainText("alternate");
        await expect(comparison).toContainText("1/1");
        await expect(comparison).toContainText("main");
        await expect(comparison).toContainText("2/2");
        await expect(page.getByRole("heading", { name: "Experiment results", exact: true })).toBeVisible();
        const experimentTable = page.getByRole("table", { name: "Experiment results" });
        const mainRows = experimentTable.getByRole("row").filter({
          has: page.getByRole("rowheader", { name: /^main\s+\//i }),
        });
        await expect(mainRows).toHaveCount(2);
        const selectedRunRow = experimentTable.getByRole("row").filter({
          has: page.getByRole("link", { name: runId, exact: true }),
        });
        await expect(selectedRunRow).toHaveCount(1);
        await expect(selectedRunRow.getByRole("rowheader")).toContainText("main");
        const selectedEvalRow = experimentTable.getByRole("row").filter({
          has: page.getByRole("link", { name: locator, exact: true }),
        });
        await expect(selectedEvalRow).toHaveCount(1);
        await expect(selectedEvalRow.getByRole("cell").nth(1)).toHaveText("inspection");
        await expect(page.getByText(runId, { exact: false }).first()).toBeVisible();
        await expect(page.getByRole("heading", { name: "Issues", exact: true })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Evidence", exact: true })).toBeVisible();

        await experimentSelector.selectOption("alternate");
        await expect(experimentSelector).toHaveValue("alternate");
        await expect(page).toHaveURL(/#\/experiment\/alternate$/u);
        await expect(experimentTable.getByRole("row", { name: /alternate/i })).toBeVisible();
        await expect(page.getByText(alternateRunId, { exact: false }).first()).toBeVisible();
        const alternateUrl = page.url();
        await page.reload();
        expect(page.url()).toBe(alternateUrl);
        await expect(experimentSelector).toHaveValue("alternate");
        await expect(page.getByText(alternateRunId, { exact: false }).first()).toBeVisible();
        await page.goBack();
        await expect(experimentSelector).toHaveValue("main");
        await expect(page.getByText(runId, { exact: false }).first()).toBeVisible();
        await page.goForward();
        await expect(experimentSelector).toHaveValue("alternate");
        await experimentSelector.selectOption("main");

        const language = page.getByRole("combobox", { name: "Language" });
        await expect(language).toBeVisible();
        await language.selectOption("zh-CN");
        await expect(page.getByRole("heading", { name: "NiceEval 总览", exact: true })).toBeVisible();
        await page.getByRole("combobox", { name: "语言" }).selectOption("en");
        await expect(page.getByRole("heading", { name: "NiceEval overview", exact: true })).toBeVisible();

        await testInfo.attach("snapshot-overview", {
          body: await page.screenshot({ fullPage: true }),
          contentType: "image/png",
        });

        const sharedOverview = await page.request.get(page.url());
        expect(sharedOverview.status()).toBe(200);
        expect(await sharedOverview.text()).not.toContain("/_niceeval/session-check");
        const sharedRecord = await page.request.get(new URL("record.sqlite", page.url()).href);
        expect(sharedRecord.status()).toBe(200);
        overviewContentHash = sharedRecord.headers()["x-niceeval-view-content-hash"];
        expect(overviewContentHash).toMatch(/^[0-9a-f]{64}$/u);

        const runLink = page.getByRole("link", { name: runId, exact: true }).first();
        const overviewUrl = page.url();
        const runHref = await runLink.getAttribute("href");
        expect(runHref).not.toBeNull();
        await runLink.click();
        expect(new URL(page.url()).pathname).toBe(new URL(runHref!, overviewUrl).pathname);
        await expect(page.getByRole("heading", { name: new RegExp(`^Run\\s+${runId}$`) })).toBeVisible();
        await expect(page.getByText(locator, { exact: false }).first()).toBeVisible();
        await expect(page.getByRole("columnheader", { name: "Verdict" })).toBeVisible();
        await expect(page.getByRole("columnheader", { name: "Score" })).toBeVisible();
        await expect(page.getByRole("columnheader", { name: /Coverage/i })).toBeVisible();
        const denominatorMetric = page.getByRole("article").filter({
          has: page.getByText("Expected denominator", { exact: true }),
        });
        await expect(denominatorMetric.getByText("1", { exact: true })).toBeVisible();
        const observedMetric = page.getByRole("article").filter({
          has: page.getByText("Observed", { exact: true }),
        });
        await expect(observedMetric.getByText("1", { exact: true })).toBeVisible();
        await expect(page.getByText(/passed/i).first()).toBeVisible();
        await expect(page.getByText(/37\.1(?:\s*pts)?/).filter({ visible: true }).first()).toBeVisible();
        await expect(page.getByText("37.111111111111114", { exact: true }).filter({ visible: true })).toHaveCount(0);
        await expect(page.getByText(/messages\s+partial/i).filter({ visible: true }).first()).toBeVisible();
        await expect(page.getByRole("heading", { name: "Issues", exact: true })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Evidence", exact: true })).toBeVisible();

        const attemptLink = page.getByRole("link", { name: locator, exact: true }).first();
        const runUrl = page.url();
        const attemptHref = await attemptLink.getAttribute("href");
        expect(attemptHref).not.toBeNull();
        await attemptLink.click();
        expect(new URL(page.url()).pathname).toBe(new URL(attemptHref!, runUrl).pathname);
        await expect(page.getByRole("heading", { name: new RegExp(`^Attempt\\s+${locator}$`) })).toBeVisible();
        const verdictMetric = page.getByRole("article").filter({
          has: page.getByText("Verdict", { exact: true }),
        });
        await expect(verdictMetric.getByText("passed", { exact: true })).toBeVisible();
        const scoreMetric = page.getByRole("article").filter({
          has: page.getByText("Score", { exact: true }),
        });
        await expect(scoreMetric.getByText("complete", { exact: true })).toBeVisible();
        await expect(scoreMetric.getByText(/37\.1(?:\s*\/)/u)).toBeVisible();
        await expect(page.getByText("37.111111111111114", { exact: true }).filter({ visible: true })).toHaveCount(0);

        const matcherRegions = page.getByRole("region", { name: "Matcher regions" });
        await expect(matcherRegions).toBeVisible();
        const mismatchedAssertion = matcherRegions.getByRole("listitem").filter({
          has: page.getByText("Mismatched Boolean contributes zero", { exact: true }),
        });
        await expect(mismatchedAssertion).toBeVisible();
        await expect(mismatchedAssertion.getByText("Weight", { exact: true })).toBeVisible();
        await expect(mismatchedAssertion.getByText("5 pts", { exact: true })).toBeVisible();
        await expect(mismatchedAssertion.getByText("Earned", { exact: true })).toBeVisible();
        await expect(mismatchedAssertion.getByText("0 pts", { exact: true })).toBeVisible();
        const measurementAssertion = matcherRegions.getByRole("listitem").filter({
          has: page.getByText("Measurement contributes three points", { exact: true }),
        });
        await expect(measurementAssertion).toContainText("value: 0.75");
        await expect(measurementAssertion).toContainText("≥ 0.5");
        await expect(matcherRegions.getByRole("listitem").filter({
          has: page.getByText("Collection evidence remains bounded", { exact: true }),
        })).toBeVisible();

        await expect(page.getByRole("heading", {
          name: "Source & assertions",
          exact: true,
        })).toBeVisible();
        await expect(page.getByRole("heading", {
          name: "evals/inspection.eval.ts",
          exact: true,
        })).toBeVisible();
        await expect(page.getByRole("article", { name: "evals/inspection.eval.ts source code" }).getByText(
          'await t.send("produce deterministic inspection evidence")',
          { exact: false },
        )).toBeVisible();

        await expect(page.getByRole("heading", { name: "Session log", exact: true })).toBeVisible();
        const sequencePlot = page.getByRole("region", { name: "Sequence plot" });
        await expect(sequencePlot).toBeVisible();
        await expect(sequencePlot.getByText("Input / User", { exact: true })).toBeVisible();
        await expect(sequencePlot.getByText("Model / Assistant", { exact: true })).toBeVisible();
        await expect(sequencePlot.getByText("Tools / Tool", { exact: true })).toBeVisible();
        const trajectory = page.getByRole("region", { name: "Trajectory timeline" });
        await expect(trajectory).toBeVisible();
        const trajectorySearch = page.getByRole("searchbox", { name: "Search trajectory" });
        const collapseTurns = page.getByRole("button", { name: "Collapse turns" });
        const collapseTools = page.getByRole("button", { name: "Collapse tool calls" });
        await expect(trajectorySearch).toBeVisible();
        await expect(collapseTurns).toBeVisible();
        await expect(collapseTools).toBeVisible();

        const firstTurn = trajectory.getByText(/^Turn\s+\d+\b/u).first();
        await expect(firstTurn).toBeVisible();
        const toolOccurrence = trajectory.getByRole("button", {
          name: /tool.*inspection_fixture/i,
        }).first();
        const toolInput = trajectory.getByText("inspection-tool-input", { exact: false }).first();
        const toolResult = trajectory.getByText("inspection-tool-result", { exact: false }).first();
        await expect(toolOccurrence).toBeVisible();
        await toolOccurrence.click();
        await expect(toolInput).toBeVisible();
        await expect(toolResult).toBeVisible();

        await collapseTools.click();
        await expect(toolInput).toBeHidden();
        await toolOccurrence.click();
        await expect(toolInput).toBeVisible();

        await collapseTurns.click();
        await expect(toolOccurrence).toBeHidden();
        await firstTurn.click();
        await expect(toolOccurrence).toBeVisible();

        await trajectorySearch.fill("Deterministic inspection fixture response");
        await expect(trajectory.getByText(
          "Deterministic inspection fixture response.",
          { exact: true },
        ).first()).toBeVisible();
        await expect(toolOccurrence).toBeHidden();
        await trajectorySearch.fill("");
        await expect(toolOccurrence).toBeVisible();

        await expect(page.getByRole("heading", {
          name: "Execution timeline",
          exact: true,
        })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Usage", exact: true })).toBeVisible();
        const coverage = page.getByRole("heading", {
          name: "Evidence coverage",
          exact: true,
        }).locator("xpath=../..");
        await expect(coverage).toBeVisible();
        await expect(coverage.getByRole("listitem")).toHaveCount(6);
        for (const channel of ["events", "actions", "usage", "status", "data"] as const) {
          const channelCoverage = coverage.getByRole("listitem").filter({
            has: page.getByText(channel, { exact: true }),
          });
          await expect(channelCoverage).toHaveCount(1);
          await expect(channelCoverage).toContainText("complete");
        }
        const messageCoverage = coverage.getByRole("listitem").filter({
          has: page.getByText("messages", { exact: true }),
        });
        await expect(messageCoverage).toHaveCount(1);
        await expect(messageCoverage).toContainText("partial");
        await expect(messageCoverage).toContainText("fixture conversation history is intentionally partial");

        for (const heading of ["Commands", "Diagnostics", "Diff & file changes", "Artifacts"] as const) {
          const section = page.getByRole("heading", { name: heading, exact: true }).locator("xpath=../..");
          await expect(section).toBeVisible();
          const state = section.getByRole("status");
          await expect(state).toContainText("not-recorded");
          await expect(state).toContainText("partial, not-recorded, or truncated facts are not invented");
        }

        await testInfo.attach("snapshot-attempt", {
          body: await page.screenshot({ fullPage: true }),
          contentType: "image/png",
        });

        await page.getByRole("combobox", { name: "Language" }).selectOption("zh-CN");
        await expect(page.getByRole("heading", { name: "证据覆盖", exact: true })).toBeVisible();
        const chineseMismatch = page.getByRole("listitem").filter({
          has: page.getByText("Mismatched Boolean contributes zero", { exact: true }),
        });
        await expect(chineseMismatch.getByText("权重", { exact: true })).toBeVisible();
        await expect(chineseMismatch.getByText("5 pts", { exact: true })).toBeVisible();
        await expect(chineseMismatch.getByText("获得", { exact: true })).toBeVisible();
        await expect(chineseMismatch.getByText("0 pts", { exact: true })).toBeVisible();
        await page.getByRole("combobox", { name: "语言" }).selectOption("en");
        await expect(page.getByRole("heading", { name: "Issues", exact: true })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Evidence", exact: true })).toBeVisible();

        const sourcesLink = page.getByRole("link", { name: "Sources", exact: true });
        const attemptUrl = page.url();
        const sourcesHref = await sourcesLink.getAttribute("href");
        expect(sourcesHref).not.toBeNull();
        await sourcesLink.click();
        expect(new URL(page.url()).pathname).toBe(new URL(sourcesHref!, attemptUrl).pathname);
        await expect(page.getByRole("heading", { name: new RegExp(`^Sources\\s+${locator}$`) })).toBeVisible();
        const source = page.getByRole("article", { name: "evals/inspection.eval.ts source code" });
        await expect(source).toBeVisible();
        await expect(source.getByRole("heading", {
          name: "evals/inspection.eval.ts",
          exact: true,
        })).toBeVisible();

        await page.getByRole("link", { name: "Attempt", exact: true }).click();
        await expect(page.getByRole("heading", { name: new RegExp(`^Attempt\\s+${locator}$`) })).toBeVisible();
        const artifactsLink = page.getByRole("link", { name: "Artifacts", exact: true });
        const returnedAttemptUrl = page.url();
        const artifactsHref = await artifactsLink.getAttribute("href");
        expect(artifactsHref).not.toBeNull();
        await artifactsLink.click();
        expect(new URL(page.url()).pathname).toBe(new URL(artifactsHref!, returnedAttemptUrl).pathname);
        await expect(page.getByRole("heading", { name: new RegExp(`^Artifacts\\s+${locator}$`) })).toBeVisible();
        await expect(page.getByText("not-recorded", { exact: true }).first()).toBeVisible();

        await page.getByRole("link", { name: "Compare", exact: true }).click();
        await expect(page.getByRole("heading", { name: "Compare Runs", exact: true })).toBeVisible();
        await expect(page.getByText(runId, { exact: true }).first()).toBeVisible();
        await expect(page.getByText(comparisonRunId, { exact: true }).first()).toBeVisible();
        await page.getByRole("banner").getByRole("link", { name: "Overview", exact: true }).click();
        await expect(page.getByRole("heading", { name: "NiceEval overview", exact: true })).toBeVisible();
        expect(requestedPaths).not.toContain("/_niceeval/session-check");

        // A Snapshot view has no project watcher or refresh path. A later
        // operational Run must remain outside its sealed cutoff, even reload.
        const later = await niceeval.run(["exp", "main", "--rerun", "all", "--json"]);
        expect(later.exitCode, later.diagnostic()).toBe(0);
        const laterRunId = only(later.expReceipt().runIds, () => true, later.diagnostic());
        expect(laterRunId).not.toBe(runId);
        await page.reload();
        await expect(page.getByText(runId, { exact: false }).first()).toBeVisible();
        await expect(page.getByText(laterRunId, { exact: false })).toHaveCount(0);
        await expect(page.getByRole("button", { name: /refresh/i })).toHaveCount(0);
        await expect.poll(() => responses.some(({ path, status }) => path === "/record.sqlite" && status === 200)).toBe(true);
        await expect.poll(() => responses.some(({ path, status }) => /\/worker-[^/]+\.js$/u.test(path) && status === 200)).toBe(true);
        await expect.poll(() => responses.some(({ path, status }) => path.endsWith(".wasm") && status === 200)).toBe(true);
        expect(pageErrors).toEqual([]);
        expect(consoleErrors).toEqual([]);
      } finally {
        await stopView(view);
      }

      const rebuiltOverview = niceeval.start([
        "view",
        "--record",
        snapshot,
        "--run",
        runId,
        "--run",
        comparisonRunId,
        "--no-open",
        "--port",
        "0",
        "--json",
      ], { timeoutMs: 90_000 });
      try {
        const ready = await waitForViewReady(rebuiltOverview);
        const response = await page.goto(expectLoopbackReadyUrl(ready.url).href);
        expect(response?.status()).toBe(200);
        await expect(page.getByRole("heading", { name: "NiceEval overview", exact: true })).toBeVisible();
        expect(new URL(page.url()).searchParams.getAll("run")).toEqual([runId, comparisonRunId]);
        await expect(page.getByRole("status")).toContainText("Showing 2 requested Run(s).");
        await expect(page.getByText(runId, { exact: false }).first()).toBeVisible();
        await expect(page.getByText(comparisonRunId, { exact: false }).first()).toBeVisible();
        await expect(page.getByText(alternateRunId, { exact: false })).toHaveCount(0);
        const rebuiltRecord = await page.request.get(new URL("record.sqlite", page.url()).href);
        expect(rebuiltRecord.headers()["x-niceeval-view-content-hash"]).toBe(overviewContentHash);
      } finally {
        await stopView(rebuiltOverview);
      }
    },
  );
});

async function stopView(view: ProcessHandle): Promise<void> {
  if (!view.settledExit) expect(view.signal("SIGTERM")).toBe(true);
  const closed = await view.done;
  expect(closed.exitCode, closed.diagnostic()).toBe(0);
  expect(decodeViewLifecycle(closed.stdout).at(-1)?.event).toBe("closed");
  await view.dispose();
}
