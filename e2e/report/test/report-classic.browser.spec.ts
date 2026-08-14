// owner: docs/engineering/testing/e2e/report.md#report-classic-browser-journey
// rerun: pnpm e2e --repo report -- --run test/report-classic.browser.spec.ts

import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";
import { pollUntil, waitForOutput } from "./support/testkit.ts";
import { expectNoHorizontalOverflow, followVisibleLink } from "./support/browser.ts";
import { PINNED_ENV, reportCaseArtifacts, reportE2E } from "./support/context.ts";

const DESKTOP = { width: 1280, height: 800 };
const MOBILE = { width: 390, height: 844 };

test("static Journey: live exp → view --out → exported documents", async ({ page }) => {
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
      const indexPath = join(projectRoot, "site-export", "index.html");
      expect(existsSync(indexPath)).toBe(true);
      expect(await readFile(indexPath, "utf8")).toContain("MemoryBench Classic");

      await page.setViewportSize(DESKTOP);
      await page.goto(pathToFileURL(indexPath).href);
      await expect(page.getByRole("heading", { name: /MemoryBench Classic/i }).first()).toBeVisible();
      await expect(page.getByRole("link", { name: "NiceEval" }).first()).toBeVisible();
      await expectNoHorizontalOverflow(page);

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

      await page.setViewportSize(MOBILE);
      await page.goto(pathToFileURL(indexPath).href);
      await expectNoHorizontalOverflow(page);
      await expectAccessibleCollapse(page);

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
      await expect(page.getByRole("heading", { name: "MemoryBench Single Page" }).first()).toBeVisible();
      await expect(page.getByRole("row").filter({ hasText: "classic/baseline" }).first()).toBeVisible();
      await expect(page.getByRole("link", { name: /classic\// })).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
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

      const wildcardView = niceeval.start(
        [
          "view",
          "--report",
          "./reports/classic.tsx",
          "--host",
          "--port",
          "0",
          "--no-open",
        ],
        { timeoutMs: 60_000, env: PINNED_ENV },
      );
      const wildcardWarning = await waitForOutput(
        wildcardView,
        "stderr",
        /without authentication or TLS/i,
        { timeoutMs: 30_000, label: "non-loopback exposure warning" },
      );
      expect(wildcardWarning).toMatch(/reachable client.*report data/i);
      const wildcardStartup = await waitForOutput(
        wildcardView,
        "stdout",
        /http:\/\/127\.0\.0\.1:\d+\//,
        { timeoutMs: 30_000, label: "wildcard report view URL" },
      );
      const wildcardOrigin = wildcardStartup.match(/http:\/\/127\.0\.0\.1:\d+\//)?.[0];
      expect(wildcardOrigin, wildcardStartup).toBeDefined();

      const wildcardGet = await page.request.get(wildcardOrigin!);
      expect(wildcardGet.status()).toBe(200);
      const wildcardHead = await page.request.head(wildcardOrigin!);
      expect(wildcardHead.status()).toBe(200);
      expect(await wildcardHead.body()).toHaveLength(0);
      const rejectedMethod = await page.request.post(wildcardOrigin!);
      expect(rejectedMethod.status()).toBe(405);
      expect(rejectedMethod.headers()["allow"]).toBe("GET, HEAD");
      const rejectedHost = await page.request.get(wildcardOrigin!, {
        headers: { host: "rebind.invalid" },
      });
      expect(rejectedHost.status()).toBe(421);

      const ipv6View = niceeval.start(
        [
          "view",
          "--report",
          "./reports/classic.tsx",
          "--host",
          "::",
          "--port",
          "0",
          "--no-open",
        ],
        { timeoutMs: 60_000, env: PINNED_ENV },
      );
      const ipv6Startup = await waitForOutput(ipv6View, "stdout", /http:\/\/\[::1\]:\d+\//, {
        timeoutMs: 30_000,
        label: "IPv6 wildcard report view URL",
      });
      const ipv6Origin = ipv6Startup.match(/http:\/\/\[::1\]:\d+\//)?.[0];
      expect(ipv6Origin, ipv6Startup).toBeDefined();
      expect((await page.request.get(ipv6Origin!)).status()).toBe(200);

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

function resolveExportedFile(exportDir: string, href: string): string {
  const relative = href.split("#")[0] ?? href;
  return join(exportDir, relative.replace(/^\.\//, ""));
}

async function expectAccessibleCollapse(page: import("@playwright/test").Page): Promise<void> {
  const disclosure = page.getByRole("button").or(page.locator("summary")).first();
  if ((await disclosure.count()) === 0) return;
  if (await disclosure.isVisible()) {
    await disclosure.focus();
    await expect(disclosure).toBeFocused();
  }
}
