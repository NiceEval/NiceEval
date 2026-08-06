import { readFileSync, rmSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { parseJson, runProcess } from "./support/process.ts";

interface HistoryDocument {
  format: "niceeval.show";
  view: "history";
  data: { sections: Array<{ evalId: string; attempts: Array<{ locator: string; verdict: string }> }> };
}

// Root runner:
//   pnpm e2e --repo report -- --grep "actual href"
// Isolated repo:
//   pnpm test -- --grep "actual href"
test("an exported report reaches the failed attempt through the page's actual href", async ({ page }) => {
  rmSync(".niceeval", { recursive: true, force: true });
  rmSync("site", { recursive: true, force: true });

  const run = await runProcess([
    "pnpm", "--silent", "exec", "niceeval",
    "exp", "onboarding", "--rerun", "all", "--json",
  ]);
  expect(run.exitCode, run.diagnostic()).toBe(1);

  const history = await runProcess([
    "pnpm", "--silent", "exec", "niceeval",
    "show", "onboarding/fails", "--history", "--json",
  ]);
  expect(history.exitCode, history.diagnostic()).toBe(0);
  const historyDocument = parseJson<HistoryDocument>(history.stdout, history.diagnostic());
  const failed = historyDocument.data.sections
    .find((section) => section.evalId === "onboarding/fails")
    ?.attempts.find((attempt) => attempt.verdict === "failed");
  expect(failed?.locator, history.diagnostic()).toMatch(/^@/);

  const exported = await runProcess([
    "pnpm", "--silent", "exec", "niceeval",
    "view", "--out", "site", "--no-open",
  ]);
  expect(exported.exitCode, exported.diagnostic()).toBe(0);

  const indexUrl = pathToFileURL(resolve("site/index.html")).href;
  await page.goto(indexUrl);
  const link = page.getByRole("link", { name: /onboarding\/fails/ }).first();
  await expect(link).toBeVisible();
  const href = await link.getAttribute("href");
  expect(href).toBeTruthy();

  await link.click();
  expect(page.url()).toBe(new URL(href as string, indexUrl).href);
  await expect(page.getByText(failed?.locator as string, { exact: true })).toBeVisible();

  // The no-JavaScript fallback is checked at the target discovered from the page,
  // never at a path synthesized from the locator by the test.
  const targetPath = new URL(href as string, indexUrl);
  const withoutScripts = readFileSync(targetPath, "utf8").replace(/<script[\s\S]*?<\/script>/gi, "");
  expect(withoutScripts).toContain("onboarding/fails");
  expect(withoutScripts).toContain("failed");
});
