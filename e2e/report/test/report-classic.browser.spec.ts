// owner: docs/engineering/testing/e2e/report.md#report-classic-browser-journey
// rerun: pnpm e2e --repo report -- --run test/report-classic.browser.spec.ts

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  expectAbove,
  expectContained,
  expectHorizontallyCenteredWith,
  expectLeftOf,
  expectLocalHorizontalScroll,
  expectRootNoHorizontalOverflow,
  expectSameRow,
  expectWiderThan,
} from "./support/browser.ts";
import { PINNED_ENV, reportCaseArtifacts, reportE2E } from "./support/context.ts";
import { pollUntil, waitForOutput } from "./support/testkit.ts";

test.use({ screenshot: "only-on-failure" });

const DESKTOP = { width: 1280, height: 800 };
const MOBILE = { width: 390, height: 844 };
const MEMORY_A = "classic/memory-a";
const MEMORY_B = "classic/memory-b";
const BASELINE = "classic/baseline";
const MEMORY_A_GROUP = "classic (8 evals)";
const RECALL_ENTITY_LABEL = "recall-entity";
const RECALL_NAME_LABEL = "recall-name";
const ATTEMPT_LOCATOR = /^@1[0-9A-HJKMNP-TV-Z]{12}$/;
const BRAND_ORIGIN = "https://niceeval.com";
const AUTHOR_LINK = "https://github.com/NiceEval/NiceEval";

test("static Journey: no-JS export preserves the 0.12 classic product end state", async ({ browser }) => {
  test.setTimeout(180_000);
  await reportE2E.case(
    "browser-static",
    { artifacts: reportCaseArtifacts(["site-export", "single-page-export"]) },
    async ({ paths: { projectRoot }, commands: { niceeval } }) => {
      const run = await niceeval.run(["exp", "classic", "--rerun", "all", "--json"], {
        env: PINNED_ENV,
        timeoutMs: 120_000,
      });
      expect(run.exitCode, run.diagnostic()).toBe(1);

      const exported = await niceeval.run(
        ["view", "--report", "./reports/classic.tsx", "--out", "site-export", "--no-open"],
        { env: PINNED_ENV, timeoutMs: 60_000 },
      );
      expect(exported.exitCode, exported.diagnostic()).toBe(0);
      const exportRoot = join(projectRoot, "site-export");
      const indexPath = join(exportRoot, "index.html");
      expect(existsSync(indexPath)).toBe(true);
      expect(await readFile(indexPath, "utf8")).toContain("MemoryBench Classic");

      const context = await browser.newContext({ javaScriptEnabled: false, viewport: DESKTOP });
      const page = await context.newPage();
      let attemptLocator = "";
      try {
        await test.step("the exported overview is the 0.12 classic product surface", async () => {
          await page.goto(pathToFileURL(indexPath).href);
          await expectClassicProductEndState(page, "desktop", page.getByRole("main"));
        });

        await test.step("keyboard disclosure exposes the authored experiment hierarchy", async () => {
          attemptLocator = await expandMemoryAAttempt(page);
        });

        await test.step("the Attempt href remains a directly navigable static route", async () => {
          const attempt = page.getByRole("link", { name: attemptLocator, exact: true });
          const href = await attempt.getAttribute("href");
          expect(href, "Attempt link must expose its canonical route").toBeTruthy();
          expect(href).not.toMatch(/^#/);
          expect(existsSync(resolveExportedFile(exportRoot, href!)), `export target for ${href}`).toBe(true);

          await attempt.click();
          await expect(page.getByRole("heading", { name: attemptLocator, exact: true })).toBeVisible();
        });

        await test.step("the no-JS site remains readable on a narrow viewport", async () => {
          await page.setViewportSize(MOBILE);
          await page.goto(pathToFileURL(indexPath).href);
          await expectClassicProductEndState(page, "mobile", page.getByRole("main"));
        });

        await test.step("missing detail families remove links without removing report data", async () => {
          const singlePageExport = await niceeval.run(
            [
              "view",
              "--report",
              "./reports/classic-single-page.tsx",
              "--out",
              "single-page-export",
              "--no-open",
            ],
            { env: PINNED_ENV, timeoutMs: 60_000 },
          );
          expect(singlePageExport.exitCode, singlePageExport.diagnostic()).toBe(0);
          const singlePageIndex = join(projectRoot, "single-page-export", "index.html");
          await page.setViewportSize(DESKTOP);
          await page.goto(pathToFileURL(singlePageIndex).href);
          await expect(page.getByRole("heading", { name: "MemoryBench Single Page", exact: true }).first()).toBeVisible();
          await expect(page.getByText("classic/baseline", { exact: true }).first()).toBeVisible();
          await expect(page.getByRole("link", { name: /classic\// })).toHaveCount(0);
          await expectRootNoHorizontalOverflow(page);
        });
      } finally {
        await context.close();
      }
    },
  );
});

test("live Journey: locale, filters, and the 0.12 classic product end state", async ({ page }) => {
  test.setTimeout(180_000);
  await reportE2E.case(
    "browser-live",
    { artifacts: reportCaseArtifacts() },
    async ({ commands: { niceeval } }) => {
      const run = await niceeval.run(["exp", "classic", "--rerun", "all", "--json"], {
        env: PINNED_ENV,
        timeoutMs: 120_000,
      });
      expect(run.exitCode, run.diagnostic()).toBe(1);
      let attemptLocator = "";

      const view = niceeval.start(
        ["view", "--report", "./reports/classic.tsx", "--port", "0", "--no-open"],
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
      const liveUrl = page.url();

      const overview = page.getByRole("tab", { name: "Overview", exact: true });
      const attempts = page.getByRole("tab", { name: "Attempts", exact: true });
      const traces = page.getByRole("tab", { name: "Traces", exact: true });

      await test.step("the live overview is the 0.12 classic product surface", async () => {
        await expectClassicProductEndState(page, "desktop", page.getByRole("main"));
      });

      await test.step("authored fixed pages form one accessible tab set", async () => {
        await expect(page.getByRole("tablist")).toHaveCount(1);
        await expect(page.getByRole("tab")).toHaveCount(3);
        await expect(overview).toHaveAttribute("aria-selected", "true");
        await expect(page.getByRole("heading", { name: "MemoryBench Classic", exact: true })).toBeVisible();

        await overview.focus();
        await overview.press("ArrowRight");
        await expect(attempts).toBeFocused();
        await expect(attempts).toHaveAttribute("aria-selected", "true");
        await expect(overview).toHaveAttribute("aria-selected", "false");
        await expect(page.getByRole("heading", { name: "Attempts", exact: true })).toBeVisible();

        await attempts.press("ArrowRight");
        await expect(traces).toBeFocused();
        await expect(traces).toHaveAttribute("aria-selected", "true");
        await expect(page.getByRole("heading", { name: "Conversation traces", exact: true })).toBeVisible();

        await traces.press("Home");
        await expect(overview).toBeFocused();
        await expect(overview).toHaveAttribute("aria-selected", "true");
        await expect(page.getByRole("heading", { name: "MemoryBench Classic", exact: true })).toBeVisible();
      });

      await test.step("a scatter point opens its canonical Experiment page in a dialog", async () => {
        const point = scatterPoint(page, MEMORY_A, "$0.0070", "77.8%");
        await expect(point).toBeVisible();
        const href = await point.getAttribute("href");
        expect(href, "Experiment point must expose its canonical route").toBeTruthy();
        expect(href).not.toMatch(/^#/);
        expect((await page.request.get(new URL(href!, page.url()).href)).status()).toBe(200);

        await point.click();
        const dialog = page.getByRole("dialog", { name: MEMORY_A, exact: true });
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole("heading", { name: MEMORY_A, exact: true })).toBeVisible();
        await dialog.getByRole("button", { name: "Close", exact: true }).click();
        await expect(dialog).toBeHidden();
        await expect(point).toBeFocused();
        await expect(overview).toHaveAttribute("aria-selected", "true");
      });

      await test.step("an exact Attempt link opens a dialog and restores expanded context", async () => {
        attemptLocator = await expandMemoryAAttempt(page, { ariaExpanded: true });

        const attempt = memoryAAttemptLink(page);
        const href = await attempt.getAttribute("href");
        expect(href, "Attempt link must expose its canonical route").toBeTruthy();
        expect(href).not.toMatch(/^#/);
        expect((await page.request.get(new URL(href!, page.url()).href)).status()).toBe(200);

        await attempt.click();
        const dialog = page.getByRole("dialog", { name: attemptLocator, exact: true });
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole("heading", { name: attemptLocator, exact: true })).toBeVisible();
        await expect(dialog.getByRole("button", { name: "Close", exact: true })).toBeFocused();
        await page.keyboard.press("Escape");
        await expect(dialog).toBeHidden();
        await expect(attempt).toBeFocused();
        await expect(attempt).toBeVisible();
        await expect(overview).toHaveAttribute("aria-selected", "true");
      });

      await test.step("named filters keep ancestors, restore on clear, and report no match", async () => {
        const experiment = page.getByRole("button", { name: new RegExp(`^${escapeRegExp(MEMORY_A)}(?:\\s|$)`) });
        const group = page.getByRole("button", { name: new RegExp(`^${escapeRegExp(MEMORY_A_GROUP)}(?:\\s|$)`) });
        const matchingEval = page.getByRole("button", { name: new RegExp(`^${RECALL_ENTITY_LABEL}(?:\\s|$)`) });
        const siblingEval = page.getByRole("button", { name: new RegExp(`^${RECALL_NAME_LABEL}(?:\\s|$)`) });
        const filter = page.getByRole("searchbox", { name: "Filter", exact: true });
        await expect(filter).toBeVisible();

        await filter.fill(RECALL_ENTITY_LABEL);
        await expect(experiment).toBeVisible();
        await expect(group).toBeVisible();
        await expect(matchingEval).toBeVisible();
        await expect(siblingEval).toHaveCount(0);

        await page.getByRole("button", { name: "Clear", exact: true }).click();
        await expect(siblingEval).toBeVisible();
        await expect(page.getByRole("button", { name: new RegExp(`^${escapeRegExp(MEMORY_B)}(?:\\s|$)`) })).toBeVisible();

        await filter.fill("no-such-eval");
        await expect(page.getByRole("status").getByText("No matching experiments", { exact: true })).toBeVisible();
        await expect(experiment).toHaveCount(0);
      });

      await test.step("EN and 中文 switch labels on the same live revision", async () => {
        await page.getByRole("button", { name: "Clear", exact: true }).click();
        const filter = page.getByRole("searchbox", { name: "Filter", exact: true });
        await filter.fill(RECALL_ENTITY_LABEL);
        await expect(memoryAAttemptLink(page)).toBeVisible();
        const english = page.getByRole("button", { name: "EN", exact: true });
        const chinese = page.getByRole("button", { name: "中文", exact: true });
        await expect(english).toHaveAttribute("aria-pressed", "true");
        await expect(overview).toHaveAttribute("aria-selected", "true");

        await chinese.click();
        await expect(chinese).toHaveAttribute("aria-pressed", "true");
        await expect(english).toHaveAttribute("aria-pressed", "false");
        await expect(page.getByRole("tab", { name: "总览", exact: true })).toHaveAttribute("aria-selected", "true");
        await expect(page.getByRole("heading", { name: "排行榜", exact: true })).toBeVisible();
        const zhPassRate = await metricPair(page.getByRole("main"), "通过率");
        await expect(zhPassRate.term).toBeVisible();
        await expect(zhPassRate.definition).toContainText("70.4%");
        await expect(page.getByRole("link", { name: attemptLocator, exact: true })).toBeVisible();
        await expect(page.getByRole("searchbox", { name: "筛选", exact: true })).toHaveValue(RECALL_ENTITY_LABEL);
        await expect(page.getByRole("button", { name: new RegExp(`^${RECALL_NAME_LABEL}(?:\\s|$)`) })).toHaveCount(0);
        expect(page.url()).toBe(liveUrl);

        await english.click();
        await expect(english).toHaveAttribute("aria-pressed", "true");
        await expect(page.getByRole("tab", { name: "Overview", exact: true })).toHaveAttribute("aria-selected", "true");
        await expect(page.getByRole("heading", { name: "Leaderboard", exact: true })).toBeVisible();
        const enPassRate = await metricPair(page.getByRole("main"), "Pass rate");
        await expect(enPassRate.term).toBeVisible();
        await expect(enPassRate.definition).toContainText("70.4%");
        await expect(filter).toHaveValue(RECALL_ENTITY_LABEL);
        expect(page.url()).toBe(liveUrl);
      });

      await test.step("the live report stays readable at a narrow viewport", async () => {
        await page.setViewportSize(MOBILE);
        await expectClassicProductEndState(page, "mobile", page.getByRole("main"));
      });

      await test.step("the live host keeps its public HTTP boundary", async () => {
        const wildcardView = niceeval.start(
          ["view", "--report", "./reports/classic.tsx", "--host", "--port", "0", "--no-open"],
          { timeoutMs: 60_000, env: PINNED_ENV },
        );
        const warning = await waitForOutput(wildcardView, "stderr", /without authentication or TLS/i, {
          timeoutMs: 30_000,
          label: "non-loopback exposure warning",
        });
        expect(warning).toMatch(/reachable client.*report data/i);
        const wildcardStartup = await waitForOutput(wildcardView, "stdout", /http:\/\/127\.0\.0\.1:\d+\//, {
          timeoutMs: 30_000,
          label: "wildcard report view URL",
        });
        const wildcardOrigin = wildcardStartup.match(/http:\/\/127\.0\.0\.1:\d+\//)?.[0];
        expect(wildcardOrigin, wildcardStartup).toBeDefined();

        expect((await page.request.get(wildcardOrigin!)).status()).toBe(200);
        const head = await page.request.head(wildcardOrigin!);
        expect(head.status()).toBe(200);
        expect(await head.body()).toHaveLength(0);
        const rejectedMethod = await page.request.post(wildcardOrigin!);
        expect(rejectedMethod.status()).toBe(405);
        expect(rejectedMethod.headers()["allow"]).toBe("GET, HEAD");
        expect((await page.request.get(wildcardOrigin!, { headers: { host: "rebind.invalid" } })).status()).toBe(421);

        const ipv6View = niceeval.start(
          ["view", "--report", "./reports/classic.tsx", "--host", "::", "--port", "0", "--no-open"],
          { timeoutMs: 60_000, env: PINNED_ENV },
        );
        const ipv6Startup = await waitForOutput(ipv6View, "stdout", /http:\/\/\[::1\]:\d+\//, {
          timeoutMs: 30_000,
          label: "IPv6 wildcard report view URL",
        });
        const ipv6Origin = ipv6Startup.match(/http:\/\/\[::1\]:\d+\//)?.[0];
        expect(ipv6Origin, ipv6Startup).toBeDefined();
        expect((await page.request.get(ipv6Origin!)).status()).toBe(200);
      });
    },
  );
});

async function expectClassicProductEndState(
  page: Page,
  viewport: "desktop" | "mobile",
  scope: Locator,
): Promise<void> {
  // Earlier disclosure/filter focus can scroll the page to the bottom; the
  // banner is sticky and boundingBox reads viewport coordinates, so top
  // layout geometry must be measured from the document top.
  await page.evaluate(() => window.scrollTo(0, 0));
  const brand = page.getByRole("banner").getByRole("link", { name: "NiceEval", exact: true });
  await expect(brand).toBeVisible();
  const brandHref = await brand.getAttribute("href");
  expect(brandHref, "package brand must expose an https NiceEval origin").toBeTruthy();
  expect(new URL(brandHref!).origin).toBe(BRAND_ORIGIN);

  const language = page.getByRole("group", { name: "Language", exact: true });
  const english = language.getByRole("button", { name: "EN", exact: true });
  const chinese = language.getByRole("button", { name: "中文", exact: true });
  await expect(english).toBeVisible();
  await expect(chinese).toBeVisible();

  const hero = scope.getByRole("heading", { name: "MemoryBench Classic", exact: true });
  await expect(hero).toHaveCount(1);
  await expect(hero).toBeVisible();
  await expect(scope.getByRole("img", { name: "MemoryBench Classic", exact: true })).toBeVisible();
  await expect(scope.getByText(
    "Deterministic 0.12 classic report: Hero, SampleSummary, leaderboard Bars, ExperimentScatter, and ExperimentTable.",
    { exact: true },
  )).toBeVisible();
  await expect(scope.getByText(/Last run/)).toBeVisible();
  await expect(scope.getByText(/composed from 3 runs/)).toBeVisible();
  const powered = page.getByRole("link", { name: "Powered by NiceEval", exact: true });
  await expect(powered).toBeVisible();
  const poweredHref = await powered.getAttribute("href");
  expect(poweredHref, "powered-by must expose an https NiceEval origin").toBeTruthy();
  expect(new URL(poweredHref!).origin).toBe(BRAND_ORIGIN);
  const author = scope.getByRole("navigation", { name: "Report links", exact: true })
    .getByRole("link", { name: "NiceEval", exact: true });
  await expect(author).toBeVisible();
  expect(await author.getAttribute("href")).toBe(AUTHOR_LINK);
  await expectHorizontallyCenteredWith(author, hero);

  const leaderboard = scope.getByRole("heading", { name: "Leaderboard", exact: true });
  await expect(leaderboard).toBeVisible();
  const passRatePair = await metricPair(scope, "Pass rate");
  const experimentsPair = await metricPair(scope, "Experiments");
  const evalsPair = await metricPair(scope, "Evals");
  const attemptCountPair = await metricPair(scope, "Attempts");
  const evalResultsPair = await metricPair(scope, "Eval results");
  const totalCostPair = await metricPair(scope, "Total cost");
  const passRate = passRatePair.term;
  const experiments = experimentsPair.term;
  const evals = evalsPair.term;
  const attemptCount = attemptCountPair.term;
  const evalResults = evalResultsPair.term;
  const totalCost = totalCostPair.term;
  await expect(passRate).toBeVisible();
  await expect(passRatePair.definition).toContainText("70.4%");
  await expect(experiments).toBeVisible();
  await expect(experimentsPair.definition).toHaveText("3");
  await expect(evals).toBeVisible();
  await expect(attemptCount).toBeVisible();
  await expect(attemptCountPair.definition).toHaveText("27");
  await expect(evalResults).toBeVisible();
  await expect(evalResultsPair.definition).toContainText("19 passed · 8 failed");
  await expect(totalCost).toBeVisible();
  await expect(totalCostPair.definition).toContainText("$0.16");
  await expect(totalCostPair.definition).toContainText("Cost available for 24/27 attempts");

  const memoryB = scope.getByRole("meter", { name: MEMORY_B, exact: true });
  const memoryA = scope.getByRole("meter", { name: MEMORY_A, exact: true });
  const baseline = scope.getByRole("meter", { name: BASELINE, exact: true });
  const memoryBLabel = scope.getByText("memory-b", { exact: true }).first();
  const memoryBValue = scope.getByText("100%", { exact: true }).first();
  await expect(memoryB).toBeVisible();
  await expect(memoryA).toBeVisible();
  await expect(baseline).toBeVisible();
  await expect(memoryBLabel).toBeVisible();
  await expect(memoryBValue).toBeVisible();
  await expect(scope.getByText("77.8%", { exact: true }).first()).toBeVisible();
  await expect(scope.getByText("33.3%", { exact: true }).first()).toBeVisible();
  await expectSameRow(memoryBLabel, memoryB);
  await expectSameRow(memoryB, memoryBValue);
  await expectWiderThan(memoryB, memoryA);
  await expectWiderThan(memoryA, baseline);
  const leaderboardFigure = scope.getByRole("figure", { name: /^Pass rate/ });
  const barSeries = leaderboardFigure.getByRole("list", { name: "Series key", exact: true });
  await expect(barSeries).toBeVisible();
  await expect(barSeries.getByText("baseline", { exact: true })).toBeVisible();
  await expect(barSeries.getByText("memory-a", { exact: true })).toBeVisible();
  await expect(barSeries.getByText("memory-b", { exact: true })).toBeVisible();

  const scatter = scope.getByRole("img", { name: /costUSD.*passRate/i });
  await expect(scatter).toBeVisible();
  const cheapest = scatterPoint(scope, BASELINE, "$0.0040", "33.3%");
  const mid = scatterPoint(scope, MEMORY_A, "$0.0070", "77.8%");
  const richest = scatterPoint(scope, MEMORY_B, "$0.0090", "100%");
  await expect(cheapest).toBeVisible();
  await expect(mid).toBeVisible();
  await expect(richest).toBeVisible();
  await expectContained(cheapest, scatter);
  await expectContained(mid, scatter);
  await expectContained(richest, scatter);
  // costUSD is lower-is-better; the plot reads better → upper right.
  await expectLeftOf(richest, mid);
  await expectLeftOf(mid, cheapest);
  await expectAbove(richest, mid);
  await expectAbove(mid, cheapest);

  const hierarchy = scope.getByRole("table", { name: "Experiment hierarchy", exact: true });
  await expect(hierarchy).toBeVisible();
  await expect(scope.getByRole("button", { name: new RegExp(`^${escapeRegExp(MEMORY_A)}(?:\\s|$)`) })).toBeVisible();

  await expectAbove(brand, hero);
  await expectAbove(hero, passRate);
  await expectAbove(passRate, leaderboard);
  await expectAbove(leaderboard, scatter);
  await expectAbove(scatter, hierarchy);
  if (viewport === "desktop") {
    await expectSameRow(brand, english);
    await expectSameRow(passRate, experiments);
    await expectSameRow(experiments, evals);
    await expectSameRow(passRate, totalCost);
    await expectLeftOf(passRate, experiments);
    await expectLeftOf(experiments, evals);
  } else {
    await expectSameRow(passRate, experiments);
    await expectSameRow(evals, attemptCount);
    await expectSameRow(evalResults, totalCost);
    await expectAbove(passRate, evals);
    await expectAbove(evals, evalResults);
    await expectRootNoHorizontalOverflow(page);
    const hierarchyScroll = page.getByRole("region", { name: "Experiment hierarchy", exact: true });
    await expect(hierarchyScroll.getByRole("table", { name: "Experiment hierarchy", exact: true })).toBeVisible();
    await expectLocalHorizontalScroll(hierarchyScroll);
  }
}

function scatterPoint(scope: Page | Locator, experimentId: string, cost: string, passRate: string): Locator {
  return scope.getByRole("link", {
    name: new RegExp(
      `${escapeRegExp(experimentId)}.*costUSD.*${escapeRegExp(cost)}.*passRate.*${escapeRegExp(passRate)}`,
      "i",
    ),
  });
}

/**
 * Playwright does not derive a `term` accessible name from its contents, so
 * within the page's single public `main` landmark, match the public role by
 * its exact visible label text and pair it with the same-order `definition`
 * from the same scope. Only public role order is relied on — no tag
 * nesting, class, or xpath. Business labels stay at the call sites; this
 * helper is purely mechanical.
 */
async function metricPair(
  scope: Locator,
  label: string,
): Promise<{ readonly term: Locator; readonly definition: Locator }> {
  const terms = scope.getByRole("term");
  const count = await terms.count();
  for (let index = 0; index < count; index += 1) {
    const text = (await terms.nth(index).textContent())?.trim();
    if (text === label) {
      return Object.freeze({
        term: terms.nth(index),
        definition: scope.getByRole("definition").nth(index),
      });
    }
  }
  throw new Error(`metric term not found in scope: ${label}`);
}

async function expandMemoryAAttempt(page: Page, options: { ariaExpanded?: boolean } = {}): Promise<string> {
  const experiment = page.getByRole("button", { name: new RegExp(`^${escapeRegExp(MEMORY_A)}(?:\\s|$)`) });
  const group = page.getByRole("button", { name: new RegExp(`^${escapeRegExp(MEMORY_A_GROUP)}(?:\\s|$)`) });
  const evaluation = page.getByRole("button", { name: new RegExp(`^${RECALL_ENTITY_LABEL}(?:\\s|$)`) });
  const attempt = memoryAAttemptLink(page);

  if (options.ariaExpanded === true) {
    await expect(experiment).toHaveAttribute("aria-expanded", "false");
  }
  await expect(attempt).not.toBeVisible();
  if (options.ariaExpanded === true) {
    await experiment.click();
    await expect(experiment).toHaveAttribute("aria-expanded", "true");
  } else {
    await experiment.focus();
    await expect(experiment).toBeFocused();
    await experiment.press("Enter");
  }
  await expect(group).toBeVisible();
  if (options.ariaExpanded === true) {
    await group.click();
    await expect(group).toHaveAttribute("aria-expanded", "true");
  } else {
    await group.press("Enter");
  }
  await expect(evaluation).toBeVisible();
  if (options.ariaExpanded === true) {
    await evaluation.click();
    await expect(evaluation).toHaveAttribute("aria-expanded", "true");
  } else {
    await evaluation.press("Enter");
  }
  await expect(attempt).toBeVisible();
  const attemptLocator = (await attempt.textContent())?.trim() ?? "";
  expect(attemptLocator).toMatch(ATTEMPT_LOCATOR);
  return attemptLocator;
}

function memoryAAttemptLink(page: Page): Locator {
  return page.getByRole("rowgroup", {
    name: `${RECALL_ENTITY_LABEL} children`,
    exact: true,
  }).getByRole("link", { name: /^@/ });
}

function resolveExportedFile(exportDir: string, href: string): string {
  const relative = href.split("#")[0] ?? href;
  return join(exportDir, relative.replace(/^\.\//, ""));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
