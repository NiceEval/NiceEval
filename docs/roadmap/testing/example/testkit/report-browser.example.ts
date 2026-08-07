import { rmSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { command, only } from "./api.ts";

const niceeval = command(["pnpm", "--silent", "exec", "niceeval"]);

interface HistoryDocument {
  format: "niceeval.show";
  view: "history";
  data: {
    sections: Array<{
      evalId: string;
      attempts: Array<{ locator: string; verdict: string }>;
    }>;
  };
}

test("导出首页沿实际 href 打开同一 Attempt", async ({ page }) => {
  rmSync(".niceeval", { recursive: true, force: true });
  rmSync("site", { recursive: true, force: true });

  const run = await niceeval.run(["exp", "onboarding", "--rerun", "all", "--json"]);
  expect(run.exitCode, run.diagnostic()).toBe(1);

  const history = await niceeval.run([
    "show", "onboarding/fails", "--history", "--json",
  ]);
  expect(history.exitCode, history.diagnostic()).toBe(0);
  const historyDocument = history.json<HistoryDocument>();
  const section = only(
    historyDocument.data.sections,
    (item) => item.evalId === "onboarding/fails",
    () => history.diagnostic(),
  );
  const failed = only(
    section.attempts,
    (attempt) => attempt.verdict === "failed",
    () => history.diagnostic(),
  );

  const exported = await niceeval.run(["view", "--out", "site", "--no-open"]);
  expect(exported.exitCode, exported.diagnostic()).toBe(0);

  const indexUrl = pathToFileURL(resolve("site/index.html")).href;
  await page.goto(indexUrl);

  const link = page.getByRole("link", { name: /onboarding\/fails/ }).first();
  await expect(link).toBeVisible();
  const href = await link.getAttribute("href");
  expect(href).toBeTruthy();

  await link.click();
  expect(page.url()).toBe(new URL(href as string, indexUrl).href);
  await expect(page.getByText(failed.locator, { exact: true })).toBeVisible();

  // Browser、page、trace 和 screenshot 仍完全由 Playwright Test 管理。
});
