// owner: docs/engineering/testing/e2e/report.md#report-classic-browser-journey
// rerun: pnpm e2e --repo report -- --run test/report-classic.browser.spec.ts

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./support/browser.ts";
import { PINNED_ENV, reportCaseArtifacts, reportE2E } from "./support/context.ts";
import { pollUntil, waitForOutput } from "./support/testkit.ts";

const DESKTOP = { width: 1280, height: 800 };
const MOBILE = { width: 390, height: 844 };
const MEMORY_A = "classic/memory-a";
const MEMORY_A_GROUP = "classic (8 evals)";
const RECALL_ENTITY = "classic/recall-entity";
const RECALL_ENTITY_LABEL = "recall-entity";
const ATTEMPT_LOCATOR = /^@1[0-9A-HJKMNP-TV-Z]{12}$/;

test("static Journey: no-JS export preserves hierarchy and canonical detail links", async ({ browser }) => {
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
        await test.step("the exported overview is readable without JavaScript", async () => {
          await page.goto(pathToFileURL(indexPath).href);
          await expect(page.getByRole("heading", { name: "MemoryBench Classic", exact: true }).first()).toBeVisible();
          await expect(page.getByRole("link", { name: "NiceEval", exact: true })).toBeVisible();
          await expectNoHorizontalOverflow(page);
        });

        await test.step("keyboard disclosure exposes the authored experiment hierarchy", async () => {
          const experiment = page.getByRole("button", { name: new RegExp(`^${escapeRegExp(MEMORY_A)}(?:\\s|$)`) });
          const group = page.getByRole("button", { name: new RegExp(`^${escapeRegExp(MEMORY_A_GROUP)}(?:\\s|$)`) });
          const evaluation = page.getByRole("button", { name: new RegExp(`^${RECALL_ENTITY_LABEL}(?:\\s|$)`) });
          const evaluationChildren = page.getByRole("rowgroup", {
            name: `${RECALL_ENTITY_LABEL} children`,
            exact: true,
          });
          const attempt = evaluationChildren.getByRole("link", { name: /^@/ });

          await expect(experiment).toBeVisible();
          await expect(attempt).not.toBeVisible();
          await experiment.focus();
          await expect(experiment).toBeFocused();
          await experiment.press("Enter");
          await expect(group).toBeVisible();
          await group.press("Enter");
          await expect(evaluation).toBeVisible();
          await evaluation.press("Enter");
          await expect(attempt).toBeVisible();
          attemptLocator = (await attempt.textContent())?.trim() ?? "";
          expect(attemptLocator).toMatch(ATTEMPT_LOCATOR);
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
          await expectNoHorizontalOverflow(page);
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
          await expectNoHorizontalOverflow(page);
        });
      } finally {
        await context.close();
      }
    },
  );
});

test("live Journey: authored tabs, hierarchy, and detail dialogs preserve context", async ({ page }) => {
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

      const overview = page.getByRole("tab", { name: "Overview", exact: true });
      const attempts = page.getByRole("tab", { name: "Attempts", exact: true });
      const traces = page.getByRole("tab", { name: "Traces", exact: true });

      await test.step("authored fixed pages form one accessible tab set", async () => {
        await expect(page.getByRole("tablist")).toHaveCount(1);
        await expect(page.getByRole("tab")).toHaveCount(3);
        await expect(overview).toHaveAttribute("aria-selected", "true");
        await expect(page.getByRole("heading", { name: "MemoryBench Classic", exact: true }).first()).toBeVisible();

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
        await expect(page.getByRole("heading", { name: "MemoryBench Classic", exact: true }).first()).toBeVisible();
      });

      await test.step("a scatter point opens its canonical Experiment page in a dialog", async () => {
        const point = page.getByRole("link", {
          name: new RegExp(`${escapeRegExp(MEMORY_A)};.*costUSD.*passRate`, "i"),
        }).first();
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
        const experiment = page.getByRole("button", { name: new RegExp(`^${escapeRegExp(MEMORY_A)}(?:\\s|$)`) });
        const group = page.getByRole("button", { name: new RegExp(`^${escapeRegExp(MEMORY_A_GROUP)}(?:\\s|$)`) });
        const evaluation = page.getByRole("button", { name: new RegExp(`^${RECALL_ENTITY_LABEL}(?:\\s|$)`) });
        const evaluationChildren = page.getByRole("rowgroup", {
          name: `${RECALL_ENTITY_LABEL} children`,
          exact: true,
        });
        const attempt = evaluationChildren.getByRole("link", { name: /^@/ });

        await expect(experiment).toHaveAttribute("aria-expanded", "false");
        await expect(attempt).not.toBeVisible();
        await experiment.click();
        await expect(experiment).toHaveAttribute("aria-expanded", "true");
        await expect(group).toBeVisible();
        await group.click();
        await expect(group).toHaveAttribute("aria-expanded", "true");
        await expect(evaluation).toBeVisible();
        await evaluation.click();
        await expect(evaluation).toHaveAttribute("aria-expanded", "true");
        await expect(attempt).toBeVisible();
        attemptLocator = (await attempt.textContent())?.trim() ?? "";
        expect(attemptLocator).toMatch(ATTEMPT_LOCATOR);

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

      await test.step("the live report stays readable at desktop and mobile widths", async () => {
        await expectNoHorizontalOverflow(page);
        await page.setViewportSize(MOBILE);
        await expectNoHorizontalOverflow(page);
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

function resolveExportedFile(exportDir: string, href: string): string {
  const relative = href.split("#")[0] ?? href;
  return join(exportDir, relative.replace(/^\.\//, ""));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
