import { expect, test, type Page } from "@playwright/test";
import {
  CLASSIC_BARS,
  CLASSIC_EXPERIMENTS,
  CLASSIC_SCATTER,
  CLASSIC_SUMMARY,
  CLASSIC_TITLE,
} from "../support/classic-contract.ts";
import { expectNoHorizontalOverflow, serveStaticSite } from "../support/browser.ts";
import { browserReport, type OverviewExpectation } from "../support/browser-report.ts";
import { PINNED_ENV } from "../support/context.ts";
import { pollUntil, waitForOutput } from "../support/testkit.ts";
import { withClassicWorld } from "../support/world.ts";

const DESKTOP = { width: 1280, height: 800 };
const MOBILE = { width: 390, height: 844 };

const CLASSIC_OVERVIEW: OverviewExpectation = {
  title: CLASSIC_TITLE,
  stats: [
    { label: "Pass rate", lines: ["Pass rate", "70.4%"] },
    { label: "Experiments", lines: ["Experiments", String(CLASSIC_SUMMARY.experiments)] },
    { label: "Evals", lines: ["Evals", String(CLASSIC_SUMMARY.attempts)] },
    { label: "Attempts", lines: ["Attempts", String(CLASSIC_SUMMARY.attempts)] },
    { label: "Eval results", lines: ["Eval results", `${CLASSIC_SUMMARY.passed} passed`, `${CLASSIC_SUMMARY.failed} failed`] },
    {
      label: "Total cost",
      lines: [
        "Total cost",
        `${CLASSIC_SUMMARY.totalCost}${CLASSIC_SUMMARY.pricedAttempts}/${CLASSIC_SUMMARY.costAttempts}`,
        CLASSIC_SUMMARY.costDetail,
      ],
    },
  ],
  bars: CLASSIC_BARS.map(({ experiment, passRate }) => ({ label: experiment, value: passRate })),
  scatter: CLASSIC_SCATTER.map(({ experiment, cost, passRate }) => ({ experimentId: experiment, cost, passRate })),
  experiments: [...CLASSIC_EXPERIMENTS].reverse().map((experiment) => ({
    id: experiment.id,
    model: experiment.model,
    agent: experiment.agent,
    passRate: experiment.passRate,
    cost: experiment.averageCost,
    costCoverage: "8/9",
    record: [
      ...(experiment.passed > 0 ? [`${experiment.passed} passed`] : []),
      ...(experiment.failed > 0 ? [`${experiment.failed} failed`] : []),
    ],
  })),
};

test("static Journey uses the frozen export and completes the report route", async ({ page }) => {
  await withClassicWorld("view-static", async ({ staticSiteDir, world }) => {
    const site = await serveStaticSite(staticSiteDir);
    try {
      await exerciseJourney(page, site.origin, attemptLocators(world));
    } finally {
      await site.close();
    }
  });
});

test("live Journey reads the frozen Record without another experiment run", async ({ page }) => {
  await withClassicWorld("view-live", async ({ commands: { niceeval }, world }) => {
    const view = niceeval.start(
      ["view", "--report", "./reports/classic.tsx", "--host", "127.0.0.1", "--port", "0", "--no-open"],
      { timeoutMs: 60_000, env: PINNED_ENV },
    );
    const startup = await waitForOutput(view, "stdout", /http:\/\/127\.0\.0\.1:\d+\//, {
      timeoutMs: 30_000,
      label: "frozen report view URL",
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
      { timeoutMs: 15_000, intervalMs: 100, label: "frozen report view readiness" },
    );
    await exerciseJourney(page, origin!, attemptLocators(world));
  });
});

interface AttemptLocators {
  readonly failed: string;
  readonly tool: string;
  readonly sourceSnapshot: string;
}

function attemptLocators(world: Parameters<Parameters<typeof withClassicWorld>[1]>[0]["world"]): AttemptLocators {
  return {
    failed: world.attemptLocator("classic/memory-a", "classic/recall-entity"),
    tool: world.attemptLocator("classic/memory-a", "classic/tool-note"),
    sourceSnapshot: world.attemptLocator("classic/memory-a", "source-snapshot"),
  };
}

async function exerciseJourney(page: Page, origin: string, locators: AttemptLocators): Promise<void> {
  await page.setViewportSize(DESKTOP);
  await page.goto(origin);
  const journey = browserReport(page);
  await journey.expectOverview(CLASSIC_OVERVIEW);
  await journey.visitAttemptsThenOverview();
  await journey.openExperiment(CLASSIC_OVERVIEW.scatter[1]!);
  await journey.openMemoryAFailedAttempt(locators.failed);
  await journey.openMemoryAToolAttempt(locators.tool);
  await journey.openMemoryASourceSnapshotAttempt(locators.sourceSnapshot);
  await expectNoHorizontalOverflow(page);

  await page.setViewportSize(MOBILE);
  await page.goto(origin);
  await browserReport(page).expectOverview(CLASSIC_OVERVIEW, { navigation: false });
  await expectNoHorizontalOverflow(page);
}
