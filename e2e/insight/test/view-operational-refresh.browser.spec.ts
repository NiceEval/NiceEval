// rerun: pnpm e2e test --repo insight -- --run test/view-operational-refresh.browser.spec.ts

import { only } from "@niceeval/testkit";
import { expect, test, type APIResponse, type Page, type Route } from "@playwright/test";
import {
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
      const alternate = await niceeval.run(["exp", "alternate", "--rerun", "all", "--json"]);
      expect(alternate.exitCode, alternate.diagnostic()).toBe(0);
      const baseline = await niceeval.run(["exp", "classic/baseline", "--rerun", "all", "--json"]);
      expect(baseline.expReceipt(), baseline.diagnostic()).toMatchObject({ completion: "completed" });

      const view = niceeval.start([
        "view",
        "--no-open",
        "--port",
        "0",
      ], { timeoutMs: 90_000 });

      let stopped = false;
      try {
        const ready = await waitForViewReady(view);
        await page.goto(expectLoopbackReadyUrl(ready.url).href);
        await expect(page.getByRole("heading", { name: "NiceEval Insight", exact: true })).toBeVisible();
        const selector = page.getByRole("banner").getByRole("combobox", { name: "Experiments" });
        await expect(selector).toBeVisible();
        await expect(selector.getByRole("option")).toContainText(["singleton/main"]);
        await expect(page).toHaveURL(/#\/group\/named\/classic$/u);
        const initialUrl = page.url();
        const initialSelection = await selector.inputValue();
        await selector.selectOption({ label: "singleton/main" });
        await expect(page).toHaveURL(/#\/group\/singleton\/main$/u);
        const mainSelection = await selector.inputValue();
        const mainUrl = page.url();
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

        // Establish real main → alternate history before the final publication step.
        await selector.selectOption({ label: "singleton/alternate" });
        await expect(page).toHaveURL(/#\/group\/singleton\/alternate$/u);
        const alternateSelection = await selector.inputValue();
        const alternateUrl = page.url();
        const commit = await holdNextResponse(page, "**/_niceeval/generation/commit");
        try {
          await page.getByRole("button", { name: /refresh/i }).click();
          expect((await commit.reached()).ok()).toBe(true);
          await page.evaluate(() => new Promise<void>((resolve) => {
            window.addEventListener("popstate", () => resolve(), { once: true });
            window.history.back();
          }));
          await expect(selector).toBeDisabled();
          await expect(selector).toHaveValue(alternateSelection);
          await expect(page).toHaveURL(alternateUrl);
          await expect(page.getByRole("button", { name: /refreshing/i })).toBeVisible();
          // A second Back targets the initial classic entry; the last intent wins.
          await page.evaluate(() => new Promise<void>((resolve) => {
            window.addEventListener("popstate", () => resolve(), { once: true });
            window.history.go(-2);
          }));
          await expect(selector).toHaveValue(alternateSelection);
          await expect(page).toHaveURL(alternateUrl);
        } finally {
          await commit.release();
        }
        await expect(selector).toBeEnabled();
        await expect(page).toHaveURL(initialUrl);
        await expect(selector).toHaveValue(initialSelection);
        await page.goForward();
        await expect(page).toHaveURL(mainUrl);
        await expect(selector).toBeVisible();
        await expect(selector).toHaveValue(mainSelection);
        await openMainHierarchy(page);
        await expect(page.getByRole("link", { name: firstLocator, exact: true })).toHaveCount(0);
        await expect(page.getByRole("link", { name: secondLocator, exact: true })).toBeVisible();

        await page.goForward();
        await expect(page).toHaveURL(alternateUrl);
        await expect(selector).toHaveValue(alternateSelection);

        // Navigation during preparation remains available and discards that candidate.
        const third = await niceeval.run(["exp", "main", "--rerun", "all", "--json"]);
        expect(third.exitCode, third.diagnostic()).toBe(0);
        const thirdLocator = withAt(only(
          third.expEvalEvents(),
          (event) => event.evalId === "inspection",
          third.diagnostic(),
        ).locator);
        await expect(page.getByRole("status")).toContainText(/update|new run|refresh/i, { timeout: 15_000 });
        const preparation = await holdNextResponse(page, "**/_niceeval/inspection");
        try {
          await page.getByRole("button", { name: /refresh/i }).click();
          expect((await preparation.reached()).ok()).toBe(true);
          await expect(selector).toBeEnabled();
          await selector.selectOption({ label: "singleton/main" });
          await expect(page).toHaveURL(mainUrl);
          await openMainHierarchy(page);
          await expect(page.getByRole("link", { name: secondLocator, exact: true })).toBeVisible();
        } finally {
          await preparation.release();
        }
        await expect(page.getByRole("alert")).toBeVisible();
        await expect(page.getByRole("link", { name: thirdLocator, exact: true })).toHaveCount(0);
        await page.getByRole("button", { name: /refresh/i }).click();
        await openMainHierarchy(page);
        await expect(page.getByRole("link", { name: thirdLocator, exact: true })).toBeVisible();
        await expect(page.getByRole("link", { name: secondLocator, exact: true })).toHaveCount(0);

        // Refreshing an unchanged generation preserves the expanded hierarchy.
        await page.getByRole("button", { name: "Refresh", exact: true }).click();
        await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeEnabled();
        await expect(page.getByRole("alert")).toHaveCount(0);
        await expect(page.getByRole("link", { name: thirdLocator, exact: true })).toBeVisible();

        const fourth = await niceeval.run(["exp", "main", "--rerun", "all", "--json"]);
        expect(fourth.exitCode, fourth.diagnostic()).toBe(0);
        const fourthLocator = withAt(only(
          fourth.expEvalEvents(),
          (event) => event.evalId === "inspection",
          fourth.diagnostic(),
        ).locator);
        await expect(page.getByRole("status")).toContainText(/update|new run|refresh/i, { timeout: 15_000 });

        // Lose the real Host commit response and its recovery readback.
        const commitDrops: Promise<APIResponse>[] = [];
        const readbackDrops: Promise<void>[] = [];
        const loseCommit = (route: Route) => {
          const completed = (async () => {
            try {
              return await route.fetch({ timeout: 15_000 });
            } finally {
              await route.abort("failed");
            }
          })();
          commitDrops.push(completed);
          return completed.then(() => undefined);
        };
        const loseReadback = (route: Route) => {
          const completed = route.abort("failed");
          readbackDrops.push(completed);
          return completed;
        };
        await page.route("**/_niceeval/generation/commit", loseCommit);
        await page.route("**/_niceeval/generation", loseReadback);
        try {
          await page.getByRole("button", { name: "Refresh", exact: true }).click();
          await expect(page.getByRole("button", { name: "Reload", exact: true })).toBeEnabled();
          await expect(page.getByRole("alert")).toContainText(/reload/i);
          await expect(selector).toHaveCount(0);
          await expect(page.getByRole("link", { name: thirdLocator, exact: true })).toHaveCount(0);
          expect(commitDrops).toHaveLength(1);
          expect((await commitDrops[0]!).ok()).toBe(true);
          expect(readbackDrops).toHaveLength(1);
          await readbackDrops[0];
        } finally {
          await page.unroute("**/_niceeval/generation/commit", loseCommit);
          await page.unroute("**/_niceeval/generation", loseReadback);
          await Promise.all([...commitDrops, ...readbackDrops]);
        }
        await Promise.all([
          page.waitForEvent("domcontentloaded"),
          page.getByRole("button", { name: "Reload", exact: true }).click(),
        ]);
        await expect(selector).toHaveValue(mainSelection);
        await openMainHierarchy(page);
        await expect(page.getByRole("link", { name: fourthLocator, exact: true })).toBeVisible();
        await expect(page.getByRole("link", { name: thirdLocator, exact: true })).toHaveCount(0);

        expect(view.signal("SIGTERM")).toBe(true);
        const closed = await view.done;
        stopped = true;
        expect(closed.exitCode, closed.diagnostic()).toBe(0);
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

// Delay a real transport response; product actions and assertions remain in the Journey.
async function holdNextResponse(page: Page, pattern: string) {
  let resume!: () => void;
  const gate = new Promise<void>((resolve) => { resume = resolve; });
  let arrived!: (response: APIResponse) => void;
  let failed!: (cause: unknown) => void;
  const arrival = new Promise<APIResponse>((resolve, reject) => { arrived = resolve; failed = reject; });
  void arrival.catch(() => {});
  let completion = Promise.resolve();
  const handler = (route: Route) => {
    completion = (async () => {
      try {
        const response = await route.fetch({ timeout: 15_000 });
        arrived(response);
        await gate;
        await route.fulfill({ response });
      } catch (cause) {
        failed(cause);
        throw cause;
      }
    })();
    void completion.catch(() => {});
    return completion;
  };
  await page.route(pattern, handler, { times: 1 });
  return {
    async reached(): Promise<APIResponse> {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          arrival,
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error(`Response gate was not reached: ${pattern}`)), 15_000);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    },
    async release(): Promise<void> {
      resume();
      try {
        await completion;
      } finally {
        await page.unroute(pattern, handler);
      }
    },
  };
}
