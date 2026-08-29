// rerun: pnpm e2e test --repo insight -- --run test/view-operational-refresh.browser.spec.ts

import { only } from "@niceeval/testkit";
import { expect, test, type Page } from "@playwright/test";
import {
  decodeViewLifecycle,
  expectLoopbackReadyUrl,
  insightCaseArtifacts,
  insightE2E,
  waitForViewReady,
} from "./support.ts";

test("project view 在确认刷新前保留 last-good hierarchy，确认后原子呈现新封口 Attempt [necase_77F5PRE3YTPSA078]", async ({ page }) => {
  await insightE2E.case(
    "view-operational-refresh",
    { artifacts: insightCaseArtifacts() },
    async ({ commands: { niceeval } }) => {
      const first = await niceeval.run(["exp", "main", "--rerun", "all", "--json"]);
      expect(first.exitCode, first.diagnostic()).toBe(0);
      const firstAttempt = only(
        first.expEvalEvents(),
        (event) => event.evalId === "inspection",
        first.diagnostic(),
      );
      const firstLocator = withAt(firstAttempt.locator);

      const view = niceeval.start([
        "view",
        "--no-open",
        "--port",
        "0",
        "--json",
      ], { timeoutMs: 90_000 });

      let stopped = false;
      try {
        const ready = await waitForViewReady(view);
        await page.goto(expectLoopbackReadyUrl(ready.url).href);
        await expect(page.getByRole("heading", { name: "NiceEval overview", exact: true })).toBeVisible();
        const selector = page.getByRole("banner").getByRole("combobox", { name: "Experiments" });
        await expect(selector).toBeVisible();
        await expect(selector.getByRole("option")).toContainText(["singleton/main"]);
        await expect(page).toHaveURL(/#\/group\/singleton\/main$/u);
        await openMainHierarchy(page);
        await expect(page.getByRole("link", { name: firstLocator, exact: true })).toBeVisible();

        const second = await niceeval.run(["exp", "main", "--rerun", "all", "--json"]);
        expect(second.exitCode, second.diagnostic()).toBe(0);
        const secondAttempt = only(
          second.expEvalEvents(),
          (event) => event.evalId === "inspection",
          second.diagnostic(),
        );
        const secondLocator = withAt(secondAttempt.locator);
        expect(secondLocator).not.toBe(firstLocator);

        await expect(page.getByRole("status")).toContainText(/update|new run|refresh/i, {
          timeout: 15_000,
        });
        await expect(page.getByRole("link", { name: firstLocator, exact: true })).toBeVisible();
        await expect(page.getByRole("link", { name: secondLocator, exact: true })).toHaveCount(0);
        await page.getByRole("button", { name: /refresh/i }).click();
        await expect(selector).toBeVisible();
        await expect(selector).toHaveValue("/group/singleton/main");
        await openMainHierarchy(page);
        await expect(page.getByRole("link", { name: firstLocator, exact: true })).toHaveCount(0);
        await expect(page.getByRole("link", { name: secondLocator, exact: true })).toBeVisible();

        expect(view.signal("SIGTERM")).toBe(true);
        const closed = await view.done;
        stopped = true;
        expect(closed.exitCode, closed.diagnostic()).toBe(0);
        expect(decodeViewLifecycle(closed.stdout).at(-1)?.event).toBe("closed");
      } finally {
        if (!stopped && !view.settledExit) view.signal("SIGTERM");
        await view.dispose();
      }
    },
  );
});

async function openMainHierarchy(page: Page): Promise<void> {
  const experimentSummary = page.locator("summary.niceeval-table-hierarchy-summary").filter({
    hasText: /^main \(/u,
  });
  await expect(experimentSummary).toHaveCount(1);
  if (await experimentSummary.locator("xpath=..").getAttribute("open") === null) {
    await experimentSummary.click();
  }
  const experimentDetails = experimentSummary.locator("xpath=..");
  await expect(experimentDetails).toHaveAttribute("open", "");

  const evalSummary = experimentDetails.locator("summary.niceeval-table-hierarchy-summary").filter({
    hasText: /^inspection/u,
  });
  await expect(evalSummary).toHaveCount(1);
  if (await evalSummary.locator("xpath=..").getAttribute("open") === null) {
    await evalSummary.click();
  }
  await expect(evalSummary.locator("xpath=..")).toHaveAttribute("open", "");
}

function withAt(locator: string): string {
  return locator.startsWith("@") ? locator : `@${locator}`;
}
