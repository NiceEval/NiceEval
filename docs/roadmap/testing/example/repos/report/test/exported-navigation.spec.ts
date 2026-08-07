import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { join, resolve } from "node:path";
import { command, defined, only, withProjectCopy } from "@niceeval/testkit";
import { expect, test } from "@playwright/test";

// 场景 Repo：e2e/report；导出站在本 case 的私有副本里生成，不碰共享现场。
// Root runner:
//   pnpm e2e --repo report -- --grep "actual href"
// Isolated repo:
//   pnpm test -- --grep "actual href"
// feature: docs/feature/reports/view.md

interface HistoryDocument {
  format: "niceeval.show";
  view: "history";
  data: { sections: Array<{ evalId: string; attempts: Array<{ locator: string; verdict: string }> }> };
}

const niceeval = command(["pnpm", "--silent", "exec", "niceeval"]);
const PROJECT_COPY = {
  from: process.cwd(),
  prefix: "niceeval-example-exported-nav-",
  omitTopLevel: [".niceeval", "node_modules", "test"],
  links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
} as const;

test("an exported report reaches the failed attempt through the page's actual href", async ({ page }) => {
  await withProjectCopy(PROJECT_COPY, async ({ root }) => {
    const run = await niceeval.run(["exp", "onboarding", "--rerun", "all", "--json"], { cwd: root });
    expect(run.exitCode, run.diagnostic()).toBe(1);

    const history = await niceeval.run(["show", "onboarding/fails", "--history", "--json"], { cwd: root });
    expect(history.exitCode, history.diagnostic()).toBe(0);
    const section = only(
      history.json<HistoryDocument>().data.sections,
      (item) => item.evalId === "onboarding/fails",
      () => history.diagnostic(),
    );
    const failed = only(
      section.attempts,
      (attempt) => attempt.verdict === "failed",
      () => history.diagnostic(),
    );
    expect(failed.locator).toMatch(/^@/);

    const exported = await niceeval.run(["view", "--out", join(root, "site"), "--no-open"], { cwd: root });
    expect(exported.exitCode, exported.diagnostic()).toBe(0);

    const indexUrl = pathToFileURL(join(root, "site", "index.html")).href;
    await page.goto(indexUrl);
    const link = page.getByRole("link", { name: /onboarding\/fails/ }).first();
    await expect(link).toBeVisible();
    const href = defined(await link.getAttribute("href"), "Attempt link 应提供 href");

    await link.click();
    expect(page.url()).toBe(new URL(href, indexUrl).href);
    await expect(page.getByText(failed.locator, { exact: true })).toBeVisible();

    // The no-JavaScript fallback is checked at the target discovered from the page,
    // never at a path synthesized from the locator by the test.
    const targetPath = new URL(href, indexUrl);
    const withoutScripts = readFileSync(targetPath, "utf8").replace(/<script[\s\S]*?<\/script>/gi, "");
    expect(withoutScripts).toContain("onboarding/fails");
    expect(withoutScripts).toContain("failed");
  });
});
