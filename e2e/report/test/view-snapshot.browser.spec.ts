// owner: docs/engineering/testing/e2e/report.md#snapshot-browser-journey
// regression: memory/report-match-details-obscure-score-and-collection.md
// regression: memory/report-result-cell-exposes-float-noise-and-unlabeled-coverage.md
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

test("读者从 Record snapshot 审阅 overview、Run 与 Attempt，并始终读取同一 sealed cutoff", async ({ page }) => {
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
        await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
        await expect(page.getByText(runId, { exact: false }).first()).toBeVisible();
        await expect(page.getByRole("heading", { name: "Issues", exact: true })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Evidence", exact: true })).toBeVisible();

        const language = page.getByRole("combobox", { name: "Language" });
        await expect(language).toBeVisible();
        await language.selectOption("zh-CN");
        await expect(page.getByRole("heading", { name: "总览", exact: true })).toBeVisible();
        await page.getByRole("combobox", { name: "语言" }).selectOption("en");
        await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();

        const sharedOverview = await page.request.get(page.url());
        expect(sharedOverview.status()).toBe(200);
        expect(await sharedOverview.text()).not.toContain("/_niceeval/session-check");
        overviewContentHash = sharedOverview.headers()["x-niceeval-view-content-hash"];
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
        await expect(page.getByText(/^1\s*Expected denominator$/u)).toBeVisible();
        await expect(page.getByText(/^1\s*Observed$/u)).toBeVisible();
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
        await expect(page.getByRole("heading", { name: "Verdict", exact: true })).toBeVisible();
        await expect(page.getByText("passed", { exact: true }).first()).toBeVisible();
        await expect(page.getByRole("heading", { name: "Score", exact: true })).toBeVisible();
        await expect(page.getByText("complete", { exact: true }).first()).toBeVisible();
        await expect(page.getByText(/37\.1(?:\s*pts)?/).filter({ visible: true }).first()).toBeVisible();
        await expect(page.getByText("37.111111111111114", { exact: true }).filter({ visible: true })).toHaveCount(0);

        const mismatchedAssertion = page.getByRole("heading", {
          name: "Mismatched Boolean contributes zero",
          exact: true,
        }).locator("..");
        await expect(mismatchedAssertion).toBeVisible();
        await expect(mismatchedAssertion.getByText("Weight", { exact: true })).toBeVisible();
        await expect(mismatchedAssertion.getByText("5 pts", { exact: true })).toBeVisible();
        await expect(mismatchedAssertion.getByText("Earned", { exact: true })).toBeVisible();
        await expect(mismatchedAssertion.getByText("0 pts", { exact: true })).toBeVisible();
        await expect(page.getByRole("heading", {
          name: "Measurement contributes three points",
          exact: true,
        }).first()).toBeVisible();
        await expect(page.getByText("0.75", { exact: true }).filter({ visible: true }).first()).toBeVisible();
        await expect(page.getByText(/≥\s*0\.5/).filter({ visible: true }).first()).toBeVisible();
        await expect(page.getByRole("heading", {
          name: "Collection evidence remains bounded",
          exact: true,
        }).first()).toBeVisible();

        await expect(page.getByRole("heading", {
          name: "Source & assertions",
          exact: true,
        })).toBeVisible();
        await expect(page.getByRole("heading", {
          name: "evals/inspection.eval.ts",
          exact: true,
        })).toBeVisible();
        await expect(page.getByLabel("evals/inspection.eval.ts source code").getByText(
          'await t.send("produce deterministic inspection evidence")',
          { exact: false },
        )).toBeVisible();

        await expect(page.getByRole("heading", { name: "Session log", exact: true })).toBeVisible();
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
        await expect(page.getByRole("heading", { name: /Evidence coverage/i })).toBeVisible();
        await expect(page.getByText(/messages\s+partial/i).filter({ visible: true }).first()).toBeVisible();
        await expect(page.getByText(
          "fixture conversation history is intentionally partial",
          { exact: false },
        ).first()).toBeVisible();

        await page.getByRole("combobox", { name: "Language" }).selectOption("zh-CN");
        await expect(page.getByRole("heading", { name: "证据覆盖", exact: true })).toBeVisible();
        const chineseMismatch = page.getByRole("heading", {
          name: "Mismatched Boolean contributes zero",
          exact: true,
        }).locator("..");
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
        await expect(page.getByRole("cell", {
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
        await page.getByRole("link", { name: "Overview", exact: true }).click();
        await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
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
      } finally {
        await stopView(view);
      }

      const rebuiltOverview = niceeval.start([
        "view",
        "--record",
        snapshot,
        "--no-open",
        "--port",
        "0",
        "--json",
      ], { timeoutMs: 90_000 });
      try {
        const ready = await waitForViewReady(rebuiltOverview);
        const response = await page.goto(expectLoopbackReadyUrl(ready.url).href);
        expect(response?.status()).toBe(200);
        await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
        const rebuiltPage = await page.request.get(page.url());
        expect(rebuiltPage.headers()["x-niceeval-view-content-hash"]).toBe(overviewContentHash);
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
