// owner: docs/engineering/testing/e2e/report.md#snapshot-browser-journey
// regression: memory/report-match-details-obscure-score-and-collection.md
// regression: memory/report-result-cell-exposes-float-noise-and-unlabeled-coverage.md
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

      const snapshot = join(projectRoot, "inspection.record-snapshot.sqlite");
      const exported = await niceeval.run(["record", "snapshot", "--output", snapshot]);
      expect(exported.exitCode, exported.diagnostic()).toBe(0);

      const overviewView = niceeval.start([
        "view",
        "--record",
        snapshot,
        "--no-open",
        "--port",
        "0",
        "--json",
      ], { timeoutMs: 90_000 });

      try {
        const ready = await waitForViewReady(overviewView);
        const readyUrl = expectLoopbackReadyUrl(ready.url);
        const overviewResponse = await page.goto(readyUrl.href);
        expect(overviewResponse?.status()).toBe(200);
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
        await stopView(overviewView);
      }

      const runView = niceeval.start([
        "view",
        "--record",
        snapshot,
        "--run",
        runId,
        "--no-open",
        "--port",
        "0",
        "--json",
      ], { timeoutMs: 90_000 });
      try {
        const ready = await waitForViewReady(runView);
        const response = await page.goto(expectLoopbackReadyUrl(ready.url).href);
        expect(response?.status()).toBe(200);
        await expect(page.getByRole("heading", { name: new RegExp(`^Run\\s+${runId}$`) })).toBeVisible();
        await expect(page.getByText(locator, { exact: false }).first()).toBeVisible();
        await expect(page.getByRole("columnheader", { name: "Verdict" })).toBeVisible();
        await expect(page.getByRole("columnheader", { name: "Score" })).toBeVisible();
        await expect(page.getByRole("columnheader", { name: /Coverage/i })).toBeVisible();
        await expect(page.locator(".metric").filter({ hasText: "Expected denominator" })).toContainText("1");
        await expect(page.locator(".metric").filter({ hasText: "Observed" })).toContainText("1");
        await expect(page.getByText(/passed/i).first()).toBeVisible();
        await expect(page.getByText(/37\.1(?:\s*pts)?/).filter({ visible: true }).first()).toBeVisible();
        await expect(page.getByText("37.111111111111114", { exact: true }).filter({ visible: true })).toHaveCount(0);
        await expect(page.getByText(/messages\s+partial/i).filter({ visible: true }).first()).toBeVisible();
        await expect(page.getByRole("heading", { name: "Issues", exact: true })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Evidence", exact: true })).toBeVisible();
      } finally {
        await stopView(runView);
      }

      const attemptView = niceeval.start([
        "view",
        "--record",
        snapshot,
        locator,
        "--no-open",
        "--port",
        "0",
        "--json",
      ], { timeoutMs: 90_000 });
      try {
        const ready = await waitForViewReady(attemptView);
        const response = await page.goto(expectLoopbackReadyUrl(ready.url).href);
        expect(response?.status()).toBe(200);
        await page.getByRole("combobox").first().selectOption("en");
        await expect(page.getByRole("heading", { name: new RegExp(`^Attempt\\s+${locator}$`) })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Verdict", exact: true })).toBeVisible();
        await expect(page.getByText("passed", { exact: true }).first()).toBeVisible();
        await expect(page.getByRole("heading", { name: "Score", exact: true })).toBeVisible();
        await expect(page.getByText("complete", { exact: true }).first()).toBeVisible();
        await expect(page.getByText(/37\.1(?:\s*pts)?/).filter({ visible: true }).first()).toBeVisible();
        await expect(page.getByText("37.111111111111114", { exact: true }).filter({ visible: true })).toHaveCount(0);

        const englishAttempt = page.locator('main[data-insight-locale="en"]');
        const mismatchedAssertion = englishAttempt.locator("article.assertion").filter({
          hasText: "Mismatched Boolean contributes zero",
        }).first();
        await expect(mismatchedAssertion.getByRole("heading", {
          name: "Mismatched Boolean contributes zero",
          exact: true,
        })).toBeVisible();
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
        await expect(englishAttempt.getByRole("heading", {
          name: "Collection evidence remains bounded",
          exact: true,
        }).first()).toBeVisible();

        await expect(page.getByRole("heading", { name: /Evidence coverage/i })).toBeVisible();
        await expect(page.getByText(/messages\s+partial/i).filter({ visible: true }).first()).toBeVisible();
        await expect(englishAttempt.locator("li").filter({
          hasText: "fixture conversation history is intentionally partial",
        }).first()).toContainText("fixture conversation history is intentionally partial");
        await page.getByRole("combobox", { name: "Language" }).selectOption("zh-CN");
        await expect(page.getByRole("heading", { name: "证据覆盖", exact: true })).toBeVisible();
        const chineseAttempt = page.locator('main[data-insight-locale="zh-CN"]');
        const chineseMismatch = chineseAttempt.locator("article.assertion").filter({
          hasText: "Mismatched Boolean contributes zero",
        }).first();
        await expect(chineseMismatch.getByText("权重", { exact: true })).toBeVisible();
        await expect(chineseMismatch.getByText("5 pts", { exact: true })).toBeVisible();
        await expect(chineseMismatch.getByText("获得", { exact: true })).toBeVisible();
        await expect(chineseMismatch.getByText("0 pts", { exact: true })).toBeVisible();
        await expect(chineseAttempt.locator("li").filter({
          hasText: "fixture conversation history is intentionally partial",
        }).first()).toContainText("fixture conversation history is intentionally partial");
        await page.getByRole("combobox", { name: "语言" }).selectOption("en");
        await expect(page.getByRole("heading", { name: "Issues", exact: true })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Evidence", exact: true })).toBeVisible();
      } finally {
        await stopView(attemptView);
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
