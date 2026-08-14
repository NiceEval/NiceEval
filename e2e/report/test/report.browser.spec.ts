// owner: e2e/report static + live browser Journey
// rerun: pnpm e2e --repo report -- --run test/report.browser.spec.ts

import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { pollUntil, waitForOutput } from "./support/testkit.ts";
import { expectNoHorizontalOverflow, followVisibleLink } from "./support/browser.ts";
import { PINNED_ENV, reportCaseArtifacts, reportE2E } from "./support/context.ts";
import { browserReport } from "./support/browser-report.ts";
import { CLASSIC_REPORT_CONTRACT } from "./support/classic-report-contract.ts";
import { classicExpFacts, type ClassicExpFacts, type ExpEvalEvent } from "./support/exp.ts";

const DESKTOP = { width: 1280, height: 800 };
const MOBILE = { width: 390, height: 844 };

test("static Journey: live exp → view --out → exported documents", async ({ page }) => {
  test.setTimeout(180_000);
  await reportE2E.case(
    "browser-static",
    { artifacts: reportCaseArtifacts(["site-export"]) },
    async ({ paths: { projectRoot }, commands: { niceeval } }) => {
      const run = await niceeval.run(["exp", "classic", "--rerun", "all", "--json"], {
        env: PINNED_ENV,
        timeoutMs: 120_000,
      });
      expect(run.exitCode, run.diagnostic()).toBe(1);
      const facts = classicExpFacts(run.stdout);

      const exported = await niceeval.run(
        ["view", "--report", "./reports/classic.tsx", "--out", "site-export", "--no-open"],
        { env: PINNED_ENV, timeoutMs: 60_000 },
      );
      expect(exported.exitCode, exported.diagnostic()).toBe(0);
      const indexPath = join(projectRoot, "site-export", "index.html");
      expect(existsSync(indexPath)).toBe(true);
      expect(await readFile(indexPath, "utf8")).toContain("MemoryBench Classic");

      await page.setViewportSize(DESKTOP);
      await page.goto(pathToFileURL(indexPath).href);
      await expect(page.getByRole("heading", { name: /MemoryBench Classic/i }).first()).toBeVisible();
      await expect(page.getByRole("link", { name: "NiceEval" }).first()).toBeVisible();
      await expectNoHorizontalOverflow(page);
      const attempt = await expectClassicReport(page, facts);

      const experimentLink = page.getByRole("link", { name: /classic\// }).first();
      await expect(experimentLink).toBeVisible();
      const href = await experimentLink.getAttribute("href");
      expect(href).toBeTruthy();
      const target = new URL(href!, page.url());
      if (target.protocol === "file:") {
        const exported = resolveExportedFile(join(projectRoot, "site-export"), href!);
        expect(existsSync(exported), `export target for ${href}`).toBe(true);
        expect(await readFile(exported, "utf8")).toMatch(/classic\//);
      } else if (target.hash.length > 0) {
        await page.goto(target.href);
        await expect(page.getByText(/classic\//).first()).toBeVisible();
      } else {
        expect((await page.request.get(target.href)).status()).toBe(200);
        await page.goto(target.href);
        await expect(page.getByText(/classic\//).first()).toBeVisible();
      }

      // 0.12 writes the percent-encoded route key as the literal filename. A file: URL
      // decodes that key before lookup, so load the emitted document directly here;
      // the live Journey below owns the real link-click contract.
      const attemptTarget = resolveExportedFile(join(projectRoot, "site-export"), attempt.href);
      expect(existsSync(attemptTarget), `export target for ${attempt.href}`).toBe(true);
      await page.goto(pathToFileURL(attemptTarget).href);
      await browserReport(page).attemptDetails().expectSummary(attempt.event);
      await expectNoHorizontalOverflow(page);

      await page.setViewportSize(MOBILE);
      await page.goto(pathToFileURL(indexPath).href);
      await expectNoHorizontalOverflow(page);
      await expectAccessibleCollapse(page);
    },
  );
});

test("live Journey: live exp → view --out → real niceeval view server", async ({ page }) => {
  test.setTimeout(180_000);
  await reportE2E.case(
    "browser-live",
    { artifacts: reportCaseArtifacts(["site-export"]) },
    async ({ paths: { projectRoot }, commands: { niceeval } }) => {
      const run = await niceeval.run(["exp", "classic", "--rerun", "all", "--json"], {
        env: PINNED_ENV,
        timeoutMs: 120_000,
      });
      expect(run.exitCode, run.diagnostic()).toBe(1);
      const facts = classicExpFacts(run.stdout);

      const exported = await niceeval.run(
        ["view", "--report", "./reports/classic.tsx", "--out", "site-export", "--no-open"],
        { env: PINNED_ENV, timeoutMs: 60_000 },
      );
      expect(exported.exitCode, exported.diagnostic()).toBe(0);
      expect((await stat(join(projectRoot, "site-export", "index.html"))).isFile()).toBe(true);

      const view = niceeval.start(
        [
          "view",
          "--report",
          "./reports/classic.tsx",
          "--host",
          "127.0.0.1",
          "--port",
          "0",
          "--no-open",
        ],
        { timeoutMs: 60_000, env: PINNED_ENV },
      );
      const startup = await waitForOutput(view, "stdout", /http:\/\/127\.0\.0\.1:\d+\//, {
        timeoutMs: 30_000,
        label: "report view URL",
      });
      const origin = startup.match(/http:\/\/127\.0\.0\.1:\d+\//)?.[0];
      expect(origin, startup).toBeDefined();

      await pollUntil(
        async () => {
          try {
            return (await page.request.get(origin!)).status() === 200 ? true : undefined;
          } catch {
            return undefined;
          }
        },
        { timeoutMs: 15_000, intervalMs: 100, label: "report view readiness" },
      );

      await page.setViewportSize(DESKTOP);
      await page.goto(origin!);
      await expect(page.getByRole("heading", { name: /MemoryBench Classic/i }).first()).toBeVisible();
      await expect(page.getByRole("navigation").or(page.getByRole("link", { name: /Overview|Attempts|Traces/i })).first()).toBeVisible();
      const attempt = await expectClassicReport(page, facts);
      await attempt.link.click();
      await browserReport(page).attemptDetails().expectSummary(attempt.event);
      await expectNoHorizontalOverflow(page);

      await page.goto(origin!);
      await followVisibleLink(page, /classic\//);
      await expect(page.getByText(/classic\//).first()).toBeVisible();
      await expectNoHorizontalOverflow(page);

      await page.goto(origin!);
      await page.setViewportSize(MOBILE);
      await expectNoHorizontalOverflow(page);
      await expectAccessibleCollapse(page);
    },
  );
});

async function expectClassicReport(
  page: Page,
  facts: ClassicExpFacts,
): Promise<{ event: ExpEvalEvent; href: string; link: Locator }> {
  const report = browserReport(page);
  await report.expectStats(CLASSIC_REPORT_CONTRACT.stats);

  await report.bars(CLASSIC_REPORT_CONTRACT.bars.heading).expectRows(CLASSIC_REPORT_CONTRACT.bars.rows);

  const scatter = report.scatter(CLASSIC_REPORT_CONTRACT.scatter.accessibleName);
  await scatter.expectAxes(CLASSIC_REPORT_CONTRACT.scatter);
  await scatter.expectPoints(CLASSIC_REPORT_CONTRACT.scatter.points);
  await scatter.expectVisualOrder(CLASSIC_REPORT_CONTRACT.scatter);

  const table = report.experimentTable(CLASSIC_REPORT_CONTRACT.experimentTable.headers);
  await table.expectHeaders();
  await table.expectExperiments(CLASSIC_REPORT_CONTRACT.experimentTable.experiments);
  await table.expectAttempts(facts.evals);

  const failedLocator = facts.locator("classic/memory-a", "classic/recall-entity");
  const failedEvent = facts.evals.find((event) => event.locator === failedLocator);
  expect(failedEvent, `failed attempt event ${failedLocator}`).toBeDefined();
  await table.expandPath(["classic/memory-a", "classic (8 evals)", "recall-entity"]);
  const attemptLink = await table.expectAttemptVisible(failedLocator);
  await expect(attemptLink).toHaveAttribute("href", new RegExp(`attempt/.+${failedLocator.slice(1)}\\.html$`));
  const href = await attemptLink.getAttribute("href");
  expect(href, `attempt target ${failedLocator}`).toBeTruthy();
  return { event: failedEvent!, href: href!, link: attemptLink };
}

function resolveExportedFile(exportDir: string, href: string): string {
  const relative = href.split("#")[0] ?? href;
  return join(exportDir, relative.replace(/^\.\//, ""));
}

async function expectAccessibleCollapse(page: Page): Promise<void> {
  const disclosure = page.getByRole("button").or(page.locator("summary")).first();
  if ((await disclosure.count()) === 0) return;
  if (await disclosure.isVisible()) {
    await disclosure.focus();
    await expect(disclosure).toBeFocused();
  }
}
